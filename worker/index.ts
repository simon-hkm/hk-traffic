import cameras from "../src/data/cameras.json"
import network from "../src/data/network.json"
import { boardFailure, parseMtrPayload } from "../src/lib/mtr-parse"
import type { Camera, LineBoard, LineCode, Network } from "../src/lib/types"

const lines = network as Network
const cameraList = cameras as Camera[]
const lineCodes = new Set(lines.lines.map((line) => line.code))
const stationByCode = new Map(lines.stations.map((station) => [station.code, station]))
const stationName = new Map(lines.stations.map((station) => [station.code, station.name]))
const cameraByKey = new Map(cameraList.map((camera) => [camera.key, camera]))

const MTR = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php"
const PAUSE_KEY = "https://hk-traffic.internal/mtr-pause"
const SCHEDULE_TTL = 15
const PAUSE_TTL = 45
const SNAPSHOT_TTL = 90
const MAX_UPSTREAM = 4

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text("方法不支援", 405)
    }
    if (url.pathname === "/api/mtr/network") return networkRoute(request)
    if (url.pathname.startsWith("/api/mtr/line/")) return lineRoute(request, url.pathname.slice("/api/mtr/line/".length))
    if (url.pathname.startsWith("/api/mtr/station/")) {
      return stationRoute(request, url.pathname.slice("/api/mtr/station/".length))
    }
    if (url.pathname.startsWith("/api/snapshot/")) {
      return snapshotRoute(request, url.pathname.slice("/api/snapshot/".length))
    }
    return text("沒有這個接口", 404)
  },
}

async function networkRoute(request: Request): Promise<Response> {
  // One Worker invocation can make only 50 upstream requests. The full
  // network is 121 stations, so each line is fetched as its own request.
  return remember(request, SCHEDULE_TTL, async () => {
    const origin = new URL(request.url).origin
    const entries = await mapPool(lines.lines, MAX_UPSTREAM, async (line) => {
      const response = await fetch(`${origin}/api/mtr/line/${line.code}`)
      if (!response.ok) return [line.code, {}] as const
      const body = (await response.json()) as { stations?: Record<string, LineBoard> }
      return [line.code, body.stations ?? {}] as const
    })
    return json({ lines: Object.fromEntries(entries) }, 200, "MISS")
  })
}

async function lineRoute(request: Request, rawLine: string): Promise<Response> {
  const line = knownLine(decodeURIComponent(rawLine))
  if (!line) return json({ error: "沒有這條綫。" }, 404, "HIT", 300)
  return remember(request, SCHEDULE_TTL, async () => json({ line, stations: await boardsForLine(line) }, 200, "MISS"))
}

async function stationRoute(request: Request, rawStation: string): Promise<Response> {
  const code = decodeURIComponent(rawStation).toUpperCase()
  const station = stationByCode.get(code)
  if (!station) return json({ error: "沒有這個車站。" }, 404, "HIT", 300)
  return remember(request, SCHEDULE_TTL, async () => {
    const boards = await mapPool(station.lines, MAX_UPSTREAM, (line) => oneBoard(line, code))
    return json({ station: code, boards }, 200, "MISS")
  })
}

async function snapshotRoute(request: Request, rawKey: string): Promise<Response> {
  const key = decodeURIComponent(rawKey)
  const camera = cameraByKey.get(key)
  if (!camera || !camera.url.startsWith("https://tdcctv.data.one.gov.hk/")) {
    return json({ error: "沒有這個快拍點。" }, 404, "HIT", 300)
  }
  return remember(request, SNAPSHOT_TTL, () => fetchSnapshot(camera.url))
}

async function boardsForLine(line: LineCode): Promise<Record<string, LineBoard>> {
  const codes = lines.stations.filter((station) => station.lines.includes(line)).map((station) => station.code)
  const boards = await mapPool(codes, MAX_UPSTREAM, async (code) => [code, await oneBoard(line, code)] as const)
  return Object.fromEntries(boards)
}

async function oneBoard(line: LineCode, station: string): Promise<LineBoard> {
  if (await paused()) return boardFailure(line, "查詢過於頻繁，請稍後再試。")
  const url = `${MTR}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}&lang=TC`
  let response: Response
  try {
    if (await paused()) return boardFailure(line, "查詢過於頻繁，請稍後再試。")
    response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json", "User-Agent": "hk-traffic-map" },
    })
  } catch {
    return boardFailure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")
  }
  if (response.status === 429) {
    await markPaused()
    return boardFailure(line, "查詢過於頻繁，請稍後再試。")
  }
  if (!response.ok) return boardFailure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")
  try {
    return parseMtrPayload(await response.json(), line, station, (code) => stationName.get(code) ?? code)
  } catch {
    return boardFailure(line, "到站資料格式未能讀取，請稍後再試。")
  }
}

async function fetchSnapshot(url: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "hk-traffic-map" },
    })
  } catch {
    return json({ error: "暫時無法讀取照片，請稍後再試。" }, 502, "MISS", 15)
  }
  if (response.status === 404) return json({ error: "這個快拍點暫時沒有照片。" }, 404, "MISS", SNAPSHOT_TTL)
  if (!response.ok) return json({ error: "暫時無法讀取照片，請稍後再試。" }, 502, "MISS", 15)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const gif = bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
  const headers = new Headers({
    "Content-Type": gif ? "image/gif" : "image/jpeg",
    "Cache-Control": `public, max-age=${SNAPSHOT_TTL}`,
    "X-Cache": "MISS",
  })
  const modified = response.headers.get("last-modified")
  if (modified) headers.set("Last-Modified", modified)
  return new Response(bytes, { headers })
}

async function remember(request: Request, ttl: number, load: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache()
  const key = new Request(request.url, { method: "GET" })
  const hit = await cache.match(key)
  if (hit) return stamp(hit, "HIT")

  const response = await load()
  const stored = stamp(response, "MISS")
  const control = stored.headers.get("Cache-Control") ?? `public, max-age=${ttl}`
  const cacheable = new Response(stored.clone().body, {
    status: stored.status,
    headers: replaceHeader(stored.headers, "Cache-Control", control),
  })
  if (stored.ok || stored.status === 404 || stored.status === 502) await cache.put(key, cacheable.clone())
  return cacheable
}

function stamp(response: Response, cache: "HIT" | "MISS"): Response {
  return new Response(response.body, {
    status: response.status,
    headers: replaceHeader(response.headers, "X-Cache", cache),
  })
}

function replaceHeader(headers: Headers, name: string, value: string): Headers {
  const next = new Headers(headers)
  next.set(name, value)
  return next
}

function json(body: unknown, status: number, cache: "HIT" | "MISS", ttl = SCHEDULE_TTL): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
      "X-Cache": cache,
    },
  })
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Cache-Control": "public, max-age=60" } })
}

function knownLine(value: string): LineCode | null {
  const code = value.toUpperCase()
  return lineCodes.has(code as LineCode) ? (code as LineCode) : null
}

function edgeCache(): Cache {
  const storage = caches as CacheStorage & { default: Cache }
  return storage.default
}

async function paused(): Promise<boolean> {
  return Boolean(await edgeCache().match(new Request(PAUSE_KEY)))
}

async function markPaused(): Promise<void> {
  await edgeCache().put(
    new Request(PAUSE_KEY),
    new Response("paused", { headers: { "Cache-Control": `public, max-age=${PAUSE_TTL}` } }),
  )
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results[index] = await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}
