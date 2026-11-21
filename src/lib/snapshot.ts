import type { SnapshotView } from "@/lib/types"

export function formatHongKong(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
}

export async function loadSnapshot(key: string): Promise<SnapshotView> {
  try {
    const response = await fetch(`/api/snapshot/${encodeURIComponent(key)}`)
    if (response.status === 404) {
      return { state: "error", message: "這個快拍點暫時沒有照片。" }
    }
    if (!response.ok) {
      return { state: "error", message: "暫時無法讀取照片，請稍後再試。" }
    }

    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const updatedAt = formatHongKong(response.headers.get("last-modified") ?? "")
    const gif = isGif(bytes)
    const src = URL.createObjectURL(new Blob([buffer], { type: gif ? "image/gif" : "image/jpeg" }))
    if (gif) return { state: "unavailable", src, updatedAt }
    return { state: "photo", src, updatedAt }
  } catch {
    return { state: "error", message: "暫時無法讀取照片，請稍後再試。" }
  }
}
