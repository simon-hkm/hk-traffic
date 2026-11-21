import { getStationBoards } from "@/server/mtr-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_CONTROL = "public, max-age=15, s-maxage=15, stale-while-revalidate=30"

export async function GET(_request: Request, context: { params: Promise<{ station: string }> }) {
  const { station } = await context.params
  const result = await getStationBoards(station)
  if (!result) {
    return Response.json({ error: "沒有這個車站。" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } })
  }
  return Response.json(
    { station, boards: result.boards },
    { headers: { "Cache-Control": CACHE_CONTROL, "X-Cache": result.cache } },
  )
}
