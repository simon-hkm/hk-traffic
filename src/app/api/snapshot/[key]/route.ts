import { getSnapshot } from "@/server/snapshot-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  const snapshot = await getSnapshot(key)
  if (!snapshot) {
    return Response.json({ error: "沒有這個快拍點。" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } })
  }
  if (snapshot.status !== 200) {
    const message = snapshot.status === 404 ? "這個快拍點暫時沒有照片。" : "暫時無法讀取照片，請稍後再試。"
    return Response.json(
      { error: message },
      { status: snapshot.status === 404 ? 404 : 502, headers: { "Cache-Control": "public, max-age=15", "X-Cache": snapshot.cache } },
    )
  }
  const headers = new Headers({
    "Content-Type": snapshot.contentType,
    "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
    "X-Cache": snapshot.cache,
  })
  if (snapshot.lastModified) headers.set("Last-Modified", snapshot.lastModified)
  return new Response(Buffer.from(snapshot.bytes), { headers })
}
