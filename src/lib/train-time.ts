const HONG_KONG_OFFSET = "+08:00"

function hongKongInstant(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/)
  if (!match) return null
  const instant = Date.parse(`${match[1]}T${match[2]}${HONG_KONG_OFFSET}`)
  return Number.isNaN(instant) ? null : instant
}

export function minutesUntil(reference: unknown, arrival: unknown): string {
  const from = hongKongInstant(reference)
  const to = hongKongInstant(arrival)
  if (from === null || to === null) return "到站時間未提供"
  const minutes = Math.round((to - from) / 60_000)
  if (minutes <= 0) return "即將開出或已到站"
  return `尚餘 ${minutes} 分鐘`
}
