import { getNetworkBoards } from "@/server/mtr-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_CONTROL = "public, max-age=15, s-maxage=15, stale-while-revalidate=30"

export async function GET() {
  const result = await getNetworkBoards()
  return Response.json(
    { lines: result.lines },
    { headers: { "Cache-Control": CACHE_CONTROL, "X-Cache": result.cache } },
  )
}
