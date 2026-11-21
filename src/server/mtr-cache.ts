import "server-only"

import { boardFailure, parseMtrPayload } from "@/lib/mtr-parse"
import { isLineCode, network, stationByCode, stationCodesOnLine, stationName } from "@/lib/network"
import type { LineBoard, LineCode } from "@/lib/types"

const ENDPOINT = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php"
const FRESH_MS = 15_000
const ERROR_MS = 15_000
const PAUSE_MS = 45_000
const STALE_MS = 60_000
const MAX_UPSTREAM = 4

type Entry = {
  board: LineBoard
  freshUntil: number
  storedAt: number
}

type Memory = {
  entries: Map<string, Entry>
  inflight: Map<string, Promise<LineBoard>>
  pausedUntil: number
  active: number
  queue: Array<() => void>
}

const memory: Memory = (() => {
  const holder = globalThis as typeof globalThis & { __hkMtrCache?: Memory }
  if (!holder.__hkMtrCache) {
    holder.__hkMtrCache = {
      entries: new Map(),
      inflight: new Map(),
      pausedUntil: 0,
      active: 0,
      queue: [],
    }
  }
  return holder.__hkMtrCache
})()

export type CachedBoard = {
  board: LineBoard
  cache: "HIT" | "MISS" | "STALE"
}

function failure(line: LineCode, message: string): LineBoard {
  return boardFailure(line, message)
}

function withSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      memory.active += 1
      task()
        .then(resolve, reject)
        .finally(() => {
          memory.active -= 1
          const next = memory.queue.shift()
          if (next) next()
        })
    }
    if (memory.active < MAX_UPSTREAM) start()
    else memory.queue.push(start)
  })
}

async function fetchBoard(line: LineCode, station: string): Promise<LineBoard> {
  const url = `${ENDPOINT}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}&lang=TC`
  let response: Response
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json", "User-Agent": "hk-traffic-map" },
    })
  } catch {
    return failure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")
  }

  if (response.status === 429) {
    memory.pausedUntil = Date.now() + PAUSE_MS
    return failure(line, "查詢過於頻繁，請稍後再試。")
  }
  if (!response.ok) return failure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")

  try {
    return parseMtrPayload(await response.json(), line, station, stationName)
  } catch {
    return failure(line, "到站資料格式未能讀取，請稍後再試。")
  }
}

async function refresh(line: LineCode, station: string, previous: Entry | undefined): Promise<LineBoard> {
  const now = Date.now()
  const stale = previous && now - previous.storedAt < STALE_MS ? previous.board : null
  if (now < memory.pausedUntil) {
    return stale ?? failure(line, "查詢過於頻繁，請稍後再試。")
  }

  const board = await withSlot(async () => {
    if (Date.now() < memory.pausedUntil) return failure(line, "查詢過於頻繁，請稍後再試。")
    return fetchBoard(line, station)
  })
  if (board.error && stale && !stale.error) {
    if (board.error.includes("頻繁")) memory.pausedUntil = Date.now() + PAUSE_MS
    return stale
  }

  const ttl = board.error ? (board.error.includes("頻繁") ? PAUSE_MS : ERROR_MS) : FRESH_MS
  memory.entries.set(`${line}:${station}`, { board, freshUntil: Date.now() + ttl, storedAt: Date.now() })
  return board
}

export function knownLine(value: string): LineCode | null {
  return isLineCode(value) ? value : null
}

export async function getStationBoard(line: LineCode, station: string): Promise<CachedBoard> {
  const stationInfo = stationByCode(station)
  if (!stationInfo?.lines.includes(line)) {
    return { board: failure(line, "這個車站不在這條綫上。"), cache: "HIT" }
  }

  const key = `${line}:${station}`
  const now = Date.now()
  const hit = memory.entries.get(key)
  if (hit && hit.freshUntil > now) return { board: hit.board, cache: "HIT" }

  const pending = memory.inflight.get(key)
  if (pending) return { board: await pending, cache: hit ? "STALE" : "MISS" }

  const promise = refresh(line, station, hit).finally(() => {
    if (memory.inflight.get(key) === promise) memory.inflight.delete(key)
  })
  memory.inflight.set(key, promise)
  return { board: await promise, cache: hit ? "STALE" : "MISS" }
}

export async function getLineBoards(line: LineCode): Promise<{ stations: Record<string, LineBoard>; cache: "HIT" | "MISS" }> {
  const codes = stationCodesOnLine(line)
  const results = await Promise.all(codes.map(async (code) => [code, await getStationBoard(line, code)] as const))
  const stations: Record<string, LineBoard> = {}
  let miss = false
  for (const [code, result] of results) {
    stations[code] = result.board
    if (result.cache !== "HIT") miss = true
  }
  return { stations, cache: miss ? "MISS" : "HIT" }
}

export async function getNetworkBoards(): Promise<{
  lines: Record<LineCode, Record<string, LineBoard>>
  cache: "HIT" | "MISS"
}> {
  const results = await Promise.all(
    network.lines.map(async (line) => [line.code, await getLineBoards(line.code)] as const),
  )
  const lines = {} as Record<LineCode, Record<string, LineBoard>>
  let miss = false
  for (const [code, boards] of results) {
    lines[code] = boards.stations
    if (boards.cache !== "HIT") miss = true
  }
  return { lines, cache: miss ? "MISS" : "HIT" }
}

export async function getStationBoards(station: string): Promise<{ boards: LineBoard[]; cache: "HIT" | "MISS" } | null> {
  const info = stationByCode(station)
  if (!info) return null
  const results = await Promise.all(info.lines.map((line) => getStationBoard(line, station)))
  return {
    boards: results.map((result) => result.board),
    cache: results.every((result) => result.cache === "HIT") ? "HIT" : "MISS",
  }
}
