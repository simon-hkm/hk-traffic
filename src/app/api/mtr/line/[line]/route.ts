import { getLineBoards, knownLine } from "@/server/mtr-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CACHE_CONTROL = "public, max-age=15, s-maxage=15, stale-while-revalidate=30"

export async function GET(_request: Request, context: { params: Promise<{ line: string }> }) {
  const { line } = await context.params
  const code = knownLine(line)
  if (!code) {
    return Response.json({ error: "沒有這條綫。" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } })
  }
  const result = await getLineBoards(code)
  return Response.json(
    { line: code, stations: result.stations },
    { headers: { "Cache-Control": CACHE_CONTROL, "X-Cache": result.cache } },
  )
}
