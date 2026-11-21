import { stationName } from "@/lib/network"
import { minutesUntil } from "@/lib/train-time"
import type { LineBoard, LineCode, TrainRow } from "@/lib/types"

const ENDPOINT = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php"

type RawTrain = {
  seq?: string | number
  dest?: string
  plat?: string | number
  time?: string
  valid?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function clockOf(value: unknown): string {
  if (typeof value !== "string") return ""
  const match = value.match(/(\d{2}:\d{2}:\d{2})/)
  return match?.[1] ?? ""
}

function explainAlert(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("special train")) return "這條綫現正實施特別列車服務安排。"
  if (lower.includes("suspend")) return "港鐵表示此站或此綫暫停服務。"
  if (lower.includes("delay") || message.includes("延誤")) return "港鐵表示服務有延誤。"
  return "港鐵傳回以下提示。"
}

function readTrains(value: unknown, reference: unknown): TrainRow[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const train = asRecord(item) as RawTrain | null
      if (!train) return null
      const destinationCode = String(train.dest ?? "")
      const seq = Number(train.seq)
      return {
        seq: Number.isFinite(seq) ? seq : 0,
        destination: destinationCode ? stationName(destinationCode) : "未注明目的地",
        platform: train.plat === undefined || train.plat === "" ? "" : String(train.plat),
        clock: clockOf(train.time),
        minutesLabel: minutesUntil(reference, train.time),
        unconfirmed: String(train.valid ?? "Y") !== "Y",
      }
    })
    .filter((train): train is TrainRow => train !== null)
    .sort((a, b) => a.seq - b.seq)
}

function failure(line: LineCode, message: string): LineBoard {
  return {
    line,
    delay: false,
    alertTitle: null,
    alertDetail: null,
    alertUrl: null,
    updatedAt: null,
    directions: [],
    error: message,
  }
}

export async function loadLine(line: LineCode, stationCode: string): Promise<LineBoard> {
  const url = `${ENDPOINT}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(stationCode)}&lang=TC`
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store" })
  } catch {
    return failure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")
  }

  if (response.status === 429) {
    return failure(line, "查詢過於頻繁，請稍後再試。")
  }
  if (!response.ok) {
    return failure(line, "暫時無法取得這條綫的到站資料，請稍後再試。")
  }

  let payload: Record<string, unknown>
  try {
    payload = asRecord(await response.json()) ?? {}
  } catch {
    return failure(line, "到站資料格式未能讀取，請稍後再試。")
  }

  const status = Number(payload.status)
  const message = typeof payload.message === "string" ? payload.message : ""
  const alert = status === 0 || (message !== "" && message.toLowerCase() !== "successful")
  const block = asRecord(asRecord(payload.data)?.[`${line}-${stationCode}`])
  const reference = block?.curr_time ?? payload.curr_time ?? block?.sys_time ?? payload.sys_time
  const updatedAt = clockOf(reference)

  return {
    line,
    delay: payload.isdelay === "Y",
    alertTitle: alert ? explainAlert(message) : null,
    alertDetail: alert && message ? message : null,
    alertUrl: typeof payload.url === "string" ? payload.url : null,
    updatedAt: updatedAt || null,
    directions: [
      { trains: readTrains(block?.UP, reference) },
      { trains: readTrains(block?.DOWN, reference) },
    ],
    error: null,
  }
}

export async function loadStationBoard(lines: LineCode[], stationCode: string): Promise<LineBoard[]> {
  return Promise.all(lines.map((line) => loadLine(line, stationCode)))
}
