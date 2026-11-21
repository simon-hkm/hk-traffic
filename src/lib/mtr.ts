import { stationCodesOnLine } from "@/lib/network"
import type { LineBoard, LineCode } from "@/lib/types"

function failure(line: LineCode, message: string): LineBoard {
  return {
    line,
    delay: false,
    alertTitle: null,
    alertDetail: null,
    alertUrl: null,
    updatedAt: null,
    reference: null,
    directions: [],
    error: message,
  }
}

function isBoard(value: unknown): value is LineBoard {
  if (!value || typeof value !== "object") return false
  const board = value as Partial<LineBoard>
  return typeof board.line === "string" && Array.isArray(board.directions)
}

export async function loadStationBoard(stationCode: string, lines: LineCode[]): Promise<LineBoard[]> {
  const offline = (message: string) => lines.map((line) => failure(line, message))
  try {
    const response = await fetch(`/api/mtr/station/${encodeURIComponent(stationCode)}`)
    if (response.status === 404) return []
    if (!response.ok) return offline("暫時無法取得到站資料，請稍後再試。")
    const payload = (await response.json()) as { boards?: unknown }
    if (!Array.isArray(payload.boards)) return offline("到站資料格式未能讀取，請稍後再試。")
    const boards = payload.boards.filter(isBoard)
    return boards.length > 0 ? boards : offline("暫時無法取得到站資料，請稍後再試。")
  } catch {
    return offline("暫時無法取得到站資料，請稍後再試。")
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

async function fetchCachedBoards(stationCode: string): Promise<LineBoard[]> {
  try {
    const response = await fetch(`/api/mtr/station/${encodeURIComponent(stationCode)}`)
    if (!response.ok) return []
    const payload = (await response.json()) as { boards?: unknown }
    return Array.isArray(payload.boards) ? payload.boards.filter(isBoard) : []
  } catch {
    return []
  }
}

export async function loadLineSchedules(line: LineCode): Promise<Record<string, LineBoard> | null> {
  const codes = stationCodesOnLine(line)
  const lists = await pool(codes, 6, fetchCachedBoards)
  const stations: Record<string, LineBoard> = {}
  codes.forEach((code, index) => {
    const board = lists[index]?.find((item) => item.line === line)
    if (board) stations[code] = board
  })
  return Object.keys(stations).length > 0 ? stations : null
}

export async function loadCachedBoards(codes: string[]): Promise<LineBoard[][]> {
  return pool(codes, 6, fetchCachedBoards)
}
