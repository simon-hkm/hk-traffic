import { isLineCode } from "@/lib/network"
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

export async function loadNetworkSchedules(): Promise<Partial<Record<LineCode, Record<string, LineBoard>>> | null> {
  try {
    const response = await fetch("/api/mtr/network")
    if (!response.ok) return null
    const payload = (await response.json()) as { lines?: unknown }
    if (!payload.lines || typeof payload.lines !== "object") return null
    const lines: Partial<Record<LineCode, Record<string, LineBoard>>> = {}
    for (const [code, stations] of Object.entries(payload.lines)) {
      if (!isLineCode(code) || !stations || typeof stations !== "object") continue
      const boards: Record<string, LineBoard> = {}
      for (const [station, board] of Object.entries(stations)) {
        if (isBoard(board)) boards[station] = board
      }
      lines[code] = boards
    }
    return lines
  } catch {
    return null
  }
}

export async function loadLineSchedules(line: LineCode): Promise<Record<string, LineBoard> | null> {
  try {
    const response = await fetch(`/api/mtr/line/${encodeURIComponent(line)}`)
    if (!response.ok) return null
    const payload = (await response.json()) as { stations?: unknown }
    if (!payload.stations || typeof payload.stations !== "object") return null
    const stations: Record<string, LineBoard> = {}
    for (const [code, board] of Object.entries(payload.stations)) {
      if (isBoard(board)) stations[code] = board
    }
    return stations
  } catch {
    return null
  }
}
