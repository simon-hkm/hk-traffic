import "server-only"

import { cameraByKey } from "@/lib/network"

const FRESH_MS = 90_000
const MAX_ENTRIES = 120

export type CachedSnapshot = {
  status: number
  bytes: Uint8Array
  contentType: string
  lastModified: string | null
  cache: "HIT" | "MISS"
}

type Entry = {
  status: number
  bytes: Uint8Array
  contentType: string
  lastModified: string | null
  freshUntil: number
}

type Memory = {
  entries: Map<string, Entry>
  inflight: Map<string, Promise<Entry>>
}

const memory: Memory = (() => {
  const holder = globalThis as typeof globalThis & { __hkSnapshotCache?: Memory }
  if (!holder.__hkSnapshotCache) {
    holder.__hkSnapshotCache = { entries: new Map(), inflight: new Map() }
  }
  return holder.__hkSnapshotCache
})()

function remember(key: string, entry: Entry) {
  memory.entries.delete(key)
  memory.entries.set(key, entry)
  while (memory.entries.size > MAX_ENTRIES) {
    const oldest = memory.entries.keys().next().value
    if (oldest === undefined) break
    memory.entries.delete(oldest)
  }
}

async function fetchSnapshot(key: string, url: string): Promise<Entry> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "hk-traffic-map" },
    })
    if (response.status === 404) {
      return { status: 404, bytes: new Uint8Array(), contentType: "application/octet-stream", lastModified: null, freshUntil: Date.now() + FRESH_MS }
    }
    if (!response.ok) {
      return { status: response.status, bytes: new Uint8Array(), contentType: "application/octet-stream", lastModified: null, freshUntil: Date.now() + 15_000 }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const gif = bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
    return {
      status: 200,
      bytes,
      contentType: gif ? "image/gif" : "image/jpeg",
      lastModified: response.headers.get("last-modified"),
      freshUntil: Date.now() + FRESH_MS,
    }
  } catch {
    return { status: 502, bytes: new Uint8Array(), contentType: "application/octet-stream", lastModified: null, freshUntil: Date.now() + 15_000 }
  }
}

export async function getSnapshot(key: string): Promise<CachedSnapshot | null> {
  const camera = cameraByKey(key)
  if (!camera || !camera.url.startsWith("https://tdcctv.data.one.gov.hk/")) return null

  const hit = memory.entries.get(key)
  if (hit && hit.freshUntil > Date.now()) {
    return { status: hit.status, bytes: hit.bytes, contentType: hit.contentType, lastModified: hit.lastModified, cache: "HIT" }
  }

  const pending = memory.inflight.get(key)
  if (pending) {
    const entry = await pending
    return { status: entry.status, bytes: entry.bytes, contentType: entry.contentType, lastModified: entry.lastModified, cache: "MISS" }
  }

  const promise = fetchSnapshot(key, camera.url).finally(() => {
    if (memory.inflight.get(key) === promise) memory.inflight.delete(key)
  })
  memory.inflight.set(key, promise)
  const entry = await promise
  if (entry.status === 200 || entry.status === 404) remember(key, entry)
  return { status: entry.status, bytes: entry.bytes, contentType: entry.contentType, lastModified: entry.lastModified, cache: "MISS" }
}
