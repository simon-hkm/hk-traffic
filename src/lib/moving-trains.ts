import { loadLineSchedules, loadNetworkSchedules } from "@/lib/mtr"
import { network } from "@/lib/network"
import { hongKongInstant } from "@/lib/train-time"
import type { LineBoard, LineCode, MovingTrain } from "@/lib/types"

// About 29 km/h. This only decides whether the arrival time is short enough for the
// train to already be on the leg. After that it covers the remaining distance in the remaining time.
const SPEED_MPS = 8

export type ArrivalSample = {
  station: string
  destCode: string
  destination: string
  seq: number
  arrivalMs: number
}

export type MotionResult = {
  trains: MovingTrain[]
  status: "ok" | "empty" | "error" | "limited"
  note: string | null
}

type Candidate = {
  id: string
  destination: string
  destCode: string
  station: string
  hop: number
  path: [number, number][]
  etaMs: number
  runtimeMs: number
}

export async function loadMovingTrains(line: LineCode): Promise<MotionResult> {
  const stations = await loadLineSchedules(line)
  if (!stations) return { trains: [], status: "error", note: "暫時無法估算列車位置。" }
  return resultFromSchedules([{ line, stations }])
}

export async function loadNetworkTrains(): Promise<MotionResult> {
  const lines = await loadNetworkSchedules()
  if (!lines) return { trains: [], status: "error", note: "暫時無法估算列車位置。" }
  const groups = Object.entries(lines).flatMap(([line, stations]) =>
    stations ? [{ line: line as LineCode, stations }] : [],
  )
  return resultFromSchedules(groups)
}

function resultFromSchedules(groups: { line: LineCode; stations: Record<string, LineBoard> }[]): MotionResult {
  const now = Date.now()
  let rateLimited = false
  let failures = 0
  let boards = 0
  const trains: MovingTrain[] = []
  for (const group of groups) {
    const arrivals: ArrivalSample[] = []
    for (const [code, board] of Object.entries(group.stations)) {
      boards += 1
      if (board.error?.includes("頻繁")) rateLimited = true
      if (board.error) {
        failures += 1
        continue
      }
      for (const direction of board.directions) {
        for (const train of direction.trains) {
          const arrivalMs = hongKongInstant(train.time)
          if (!train.destCode || arrivalMs === null) continue
          arrivals.push({
            station: code,
            destCode: train.destCode,
            destination: train.destination,
            seq: train.seq,
            arrivalMs,
          })
        }
      }
    }
    trains.push(...motionsFromArrivals(group.line, arrivals, now))
  }
  if (rateLimited && trains.length === 0) {
    return { trains, status: "limited", note: "查詢過於頻繁，列車位置稍後再更新。" }
  }
  if (boards > 0 && failures === boards) {
    return { trains: [], status: "error", note: "暫時無法估算列車位置。" }
  }
  if (trains.length === 0) {
    return { trains, status: "empty", note: "暫時沒有可顯示的班次。" }
  }
  return {
    trains,
    status: rateLimited ? "limited" : "ok",
    note: rateLimited ? "查詢過於頻繁，列車位置稍後再更新。" : null,
  }
}

export function motionsFromArrivals(line: LineCode, arrivals: ArrivalSample[], now: number): MovingTrain[] {
  const candidates: Candidate[] = []
  for (const arrival of arrivals) {
    const placed = placeArrival(line, arrival, now)
    if (placed) candidates.push(placed)
  }
  candidates.sort((a, b) => a.hop - b.hop || a.etaMs - b.etaMs)
  const kept: Candidate[] = []
  for (const candidate of candidates) {
    if (kept.some((existing) => sameTrain(line, existing, candidate))) continue
    kept.push(candidate)
  }
  return kept.map((candidate) => ({
    id: candidate.id,
    line,
    destination: candidate.destination,
    path: candidate.path,
    fraction: candidate.runtimeMs <= 0 ? 1 : 1 - Math.max(0, candidate.etaMs) / candidate.runtimeMs,
    etaMs: Math.max(0, candidate.etaMs),
    capturedAt: now,
  }))
}

export function trainCoordinate(train: MovingTrain, now: number): [number, number] | null {
  const remaining = train.etaMs - (now - train.capturedAt)
  if (remaining < -45_000) return null
  return pointAlong(train.path, fractionAt(train, remaining))
}

function fractionAt(train: MovingTrain, remaining: number): number {
  if (train.fraction >= 1 || train.etaMs <= 0) return 1
  if (remaining <= 0) return 1
  const runtime = train.etaMs / (1 - train.fraction)
  if (runtime <= 0) return 1
  return Math.min(1, Math.max(0, 1 - remaining / runtime))
}

function placeArrival(line: LineCode, arrival: ArrivalSample, now: number): Candidate | null {
  const etaMs = arrival.arrivalMs - now
  if (etaMs < 8_000) return null
  const includeRacecourse = arrival.destCode === "RAC" || arrival.station === "RAC"
  const adjacent = adjacency(line, includeRacecourse)
  const hop = hopsFrom(adjacent, arrival.destCode)
  const here = hop.get(arrival.station)
  if (here === undefined) return null
  const previous = predecessor(adjacent, hop, arrival.station, here)
  if (!previous) return null
  const path = directedPath(line, previous, arrival.station)
  if (!path || path.length < 2) return null
  const runtimeMs = (pathLength(path) / SPEED_MPS) * 1000
  if (etaMs > runtimeMs) return null
  return {
    id: `${line}:${arrival.station}:${arrival.destCode}:${arrival.seq}:${arrival.arrivalMs}`,
    destination: arrival.destination,
    destCode: arrival.destCode,
    station: arrival.station,
    hop: here,
    path,
    etaMs,
    runtimeMs,
  }
}

function sameTrain(line: LineCode, first: Candidate, second: Candidate): boolean {
  if (first.destCode !== second.destCode) return false
  const closer = first.hop <= second.hop ? first : second
  const farther = closer === first ? second : first
  const hopGap = farther.hop - closer.hop
  if (hopGap === 0) return Math.abs(first.etaMs - second.etaMs) < 25_000
  const extra = farther.etaMs - closer.etaMs
  const includeRacecourse = first.destCode === "RAC" || first.station === "RAC" || second.station === "RAC"
  const between = travelMs(line, farther.station, closer.station, includeRacecourse)
  if (between === null) return false
  // The same train shows up at the next station with an ETA larger by about the ride between them.
  // The following train is one headway later, so it stays on the map.
  const tolerance = Math.max(75_000, between * 0.45)
  return Math.abs(extra - between) <= tolerance
}

function travelMs(line: LineCode, from: string, to: string, includeRacecourse: boolean): number | null {
  if (from === to) return 0
  const adjacent = adjacency(line, includeRacecourse)
  const cost = new Map<string, number>([[from, 0]])
  const queue: { station: string; cost: number }[] = [{ station: from, cost: 0 }]
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost)
    const current = queue.shift()
    if (!current || current.cost !== cost.get(current.station)) continue
    if (current.station === to) return current.cost
    for (const next of adjacent.get(current.station) ?? []) {
      const path = directedPath(line, current.station, next)
      if (!path) continue
      const nextCost = current.cost + (pathLength(path) / SPEED_MPS) * 1000
      if (nextCost >= (cost.get(next) ?? Number.POSITIVE_INFINITY)) continue
      cost.set(next, nextCost)
      queue.push({ station: next, cost: nextCost })
    }
  }
  return null
}

function predecessor(
  adjacent: Map<string, string[]>,
  hop: Map<string, number>,
  station: string,
  here: number,
): string | null {
  const candidates = (adjacent.get(station) ?? []).filter((next) => hop.get(next) === here + 1)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  return candidates.sort((a, b) => reachableCount(adjacent, b, station) - reachableCount(adjacent, a, station))[0]
}

function reachableCount(adjacent: Map<string, string[]>, start: string, blocked: string): number {
  const seen = new Set([blocked])
  const queue = [start]
  let count = 0
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node || seen.has(node)) continue
    seen.add(node)
    count += 1
    for (const next of adjacent.get(node) ?? []) queue.push(next)
  }
  return count
}

function adjacency(line: LineCode, includeRacecourse: boolean): Map<string, string[]> {
  const adjacent = new Map<string, string[]>()
  for (const leg of network.legs) {
    if (leg.line !== line) continue
    if (!includeRacecourse && (leg.from === "RAC" || leg.to === "RAC")) continue
    link(adjacent, leg.from, leg.to)
    link(adjacent, leg.to, leg.from)
  }
  return adjacent
}

function link(adjacent: Map<string, string[]>, from: string, to: string) {
  const list = adjacent.get(from)
  if (list) {
    if (!list.includes(to)) list.push(to)
    return
  }
  adjacent.set(from, [to])
}

function hopsFrom(adjacent: Map<string, string[]>, origin: string): Map<string, number> {
  const hop = new Map<string, number>([[origin, 0]])
  const queue = [origin]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    const here = hop.get(node) ?? 0
    for (const next of adjacent.get(node) ?? []) {
      if (hop.has(next)) continue
      hop.set(next, here + 1)
      queue.push(next)
    }
  }
  return hop
}

function directedPath(line: LineCode, from: string, to: string): [number, number][] | null {
  const leg = network.legs.find(
    (item) => item.line === line && ((item.from === from && item.to === to) || (item.from === to && item.to === from)),
  )
  if (!leg) return null
  return leg.from === from ? leg.path : [...leg.path].reverse()
}

export function pointAlong(path: [number, number][], fraction: number): [number, number] | null {
  if (path.length === 0) return null
  if (path.length === 1 || fraction <= 0) return path[0]
  if (fraction >= 1) return path[path.length - 1]
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index < path.length - 1; index += 1) {
    const length = meters(path[index], path[index + 1])
    lengths.push(length)
    total += length
  }
  if (total <= 0) return path[path.length - 1]
  let remaining = total * fraction
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length
      const start = path[index]
      const end = path[index + 1]
      return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
    }
    remaining -= length
  }
  return path[path.length - 1]
}

function pathLength(path: [number, number][]): number {
  let total = 0
  for (let index = 0; index < path.length - 1; index += 1) total += meters(path[index], path[index + 1])
  return total
}

function meters(start: [number, number], end: [number, number]): number {
  const lat = ((start[1] + end[1]) / 2) * (Math.PI / 180)
  const dx = ((end[0] - start[0]) * Math.PI) / 180 * Math.cos(lat) * 6_371_000
  const dy = ((end[1] - start[1]) * Math.PI) / 180 * 6_371_000
  return Math.hypot(dx, dy)
}
