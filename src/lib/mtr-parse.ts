import { minutesUntil } from "./train-time"
import type { LineBoard, LineCode, TrainRow } from "./types"

type RawTrain = {
  seq?: string | number
  dest?: string
  plat?: string | number
  time?: string
  valid?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function clockOf(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.match(/(\d{2}:\d{2}:\d{2})/)?.[1] ?? ""
}

function explainAlert(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("special train")) return "這條綫現正實施特別列車服務安排。"
  if (lower.includes("suspend")) return "港鐵表示此站或此綫暫停服務。"
  if (lower.includes("delay") || message.includes("延誤")) return "港鐵表示服務有延誤。"
  return "港鐵傳回以下提示。"
}

function readTrains(value: unknown, reference: unknown, nameOf: (code: string) => string): TrainRow[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const train = asRecord(item) as RawTrain | null
      if (!train) return null
      const destinationCode = String(train.dest ?? "")
      const seq = Number(train.seq)
      return {
        seq: Number.isFinite(seq) ? seq : 0,
        destCode: destinationCode,
        destination: destinationCode ? nameOf(destinationCode) : "未注明目的地",
        platform: train.plat === undefined || train.plat === "" ? "" : String(train.plat),
        clock: clockOf(train.time),
        time: typeof train.time === "string" ? train.time : "",
        minutesLabel: minutesUntil(reference, train.time),
        unconfirmed: String(train.valid ?? "Y") !== "Y",
      }
    })
    .filter((train): train is TrainRow => train !== null)
    .sort((a, b) => a.seq - b.seq)
}

export function boardFailure(line: LineCode, message: string): LineBoard {
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

export function parseMtrPayload(
  payload: unknown,
  line: LineCode,
  station: string,
  nameOf: (code: string) => string,
): LineBoard {
  const record = asRecord(payload) ?? {}
  const status = Number(record.status)
  const message = typeof record.message === "string" ? record.message : ""
  const alert = status === 0 || (message !== "" && message.toLowerCase() !== "successful")
  const block = asRecord(asRecord(record.data)?.[`${line}-${station}`])
  const reference = block?.curr_time ?? record.curr_time ?? block?.sys_time ?? record.sys_time
  const updatedAt = clockOf(reference)
  const alertUrl = typeof record.url === "string" && /^https:\/\//i.test(record.url) ? record.url : null

  return {
    line,
    delay: record.isdelay === "Y",
    alertTitle: alert ? explainAlert(message) : null,
    alertDetail: alert && message ? message : null,
    alertUrl,
    updatedAt: updatedAt || null,
    reference: typeof reference === "string" ? reference : null,
    directions: [
      { trains: readTrains(block?.UP, reference, nameOf) },
      { trains: readTrains(block?.DOWN, reference, nameOf) },
    ],
    error: null,
  }
}
