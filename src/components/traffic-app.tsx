"use client"

import { useEffect, useMemo, useState } from "react"
import { DetailPanel } from "@/components/detail-panel"
import { MapView, type MapFocus } from "@/components/map-view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cameraByKey, cameras, lineByCode, network, stationByCode } from "@/lib/network"
import { loadStationBoard } from "@/lib/mtr"
import { loadSnapshot } from "@/lib/snapshot"
import type { Camera, LineBoard, LineCode, Selection, SnapshotView, Station } from "@/lib/types"

type SearchHit =
  | { kind: "station"; station: Station }
  | { kind: "camera"; camera: Camera }

export function TrafficApp() {
  const [showMtr, setShowMtr] = useState(true)
  const [showCameras, setShowCameras] = useState(true)
  const [activeLine, setActiveLine] = useState<LineCode | "all">("all")
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [query, setQuery] = useState("")
  const [basemapProblem, setBasemapProblem] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [boardCache, setBoardCache] = useState<
    { code: string; token: number; lines: LineBoard[] } | null
  >(null)
  const [snapshotCache, setSnapshotCache] = useState<
    { key: string; token: number; view: SnapshotView } | null
  >(null)

  const station = selection?.kind === "station" ? stationByCode(selection.code) ?? null : null
  const camera = selection?.kind === "camera" ? cameraByKey(selection.key) ?? null : null
  const board = !station
    ? { state: "idle" as const, lines: [] }
    : boardCache?.code === station.code && boardCache.token === reloadToken
      ? { state: "ready" as const, lines: boardCache.lines }
      : { state: "loading" as const, lines: [] }
  const snapshot = !camera
    ? { status: "idle" as const }
    : snapshotCache?.key === camera.key && snapshotCache.token === reloadToken
      ? { status: "ready" as const, view: snapshotCache.view }
      : { status: "loading" as const }

  useEffect(() => {
    if (!station) return
    const code = station.code
    const token = reloadToken
    let cancelled = false
    loadStationBoard(station.lines, code).then((lines) => {
      if (!cancelled) setBoardCache({ code, token, lines })
    })
    return () => {
      cancelled = true
    }
  }, [station, reloadToken])

  useEffect(() => {
    if (!camera) return
    const key = camera.key
    const token = reloadToken
    let cancelled = false
    let objectUrl: string | null = null
    loadSnapshot(camera.url).then((view) => {
      if (cancelled) {
        if (view.src?.startsWith("blob:")) URL.revokeObjectURL(view.src)
        return
      }
      objectUrl = view.src?.startsWith("blob:") ? view.src : null
      setSnapshotCache({ key, token, view })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [camera, reloadToken])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelection(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const results = useMemo(() => search(query), [query])

  function chooseStation(next: Station) {
    if (activeLine !== "all" && !next.lines.includes(activeLine)) setActiveLine("all")
    setShowMtr(true)
    setSelection({ kind: "station", code: next.code })
    setFocus((current) => ({
      lng: next.lng,
      lat: next.lat,
      token: (current?.token ?? 0) + 1,
    }))
    setQuery("")
  }

  function chooseCamera(next: Camera) {
    setShowCameras(true)
    setSelection({ kind: "camera", key: next.key })
    setFocus((current) => ({
      lng: next.lng,
      lat: next.lat,
      token: (current?.token ?? 0) + 1,
    }))
    setQuery("")
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#f6f3ec] text-[#17232b]">
      <header className="z-20 border-b border-[#e4ddd0] bg-[#f6f3ec]">
        <div className="flex items-center justify-between gap-3 px-3 py-2 md:px-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">香港交通實況</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              點車站查到站班次，點橙色點看道路快拍
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant={showMtr ? "default" : "outline"}
              aria-pressed={showMtr}
              onClick={() => setShowMtr((value) => !value)}
            >
              港鐵
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showCameras ? "default" : "outline"}
              aria-pressed={showCameras}
              onClick={() => setShowCameras((value) => !value)}
            >
              快拍
            </Button>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 md:px-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={activeLine === "all"}
            className={activeLine === "all" ? "ring-2 ring-[#0e5e5b]" : "shrink-0"}
            onClick={() => setActiveLine("all")}
          >
            全部路綫
          </Button>
          {network.lines.map((line) => (
            <Button
              key={line.code}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={activeLine === line.code}
              className={activeLine === line.code ? "shrink-0 ring-2 ring-[#0e5e5b]" : "shrink-0"}
              onClick={() => setActiveLine(line.code)}
            >
              <span className="size-2 rounded-full" style={{ background: line.color }} />
              {line.name}
            </Button>
          ))}
        </div>
        <form
          className="relative px-3 pb-3 md:px-4"
          onSubmit={(event) => {
            event.preventDefault()
            const first = results[0]
            if (!first) return
            if (first.kind === "station") chooseStation(first.station)
            else chooseCamera(first.camera)
          }}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋車站、地區或道路"
            aria-label="搜尋車站或快拍地點"
            autoComplete="off"
          />
          {query.trim() ? (
            <ul className="absolute inset-x-3 z-30 mt-1 max-h-72 overflow-auto rounded-lg border bg-white shadow-lg md:inset-x-4">
              {results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">找不到符合的車站或快拍點。</li>
              ) : (
                results.map((result) =>
                  result.kind === "station" ? (
                    <li key={`station-${result.station.code}`}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => chooseStation(result.station)}
                      >
                        <span>{result.station.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {result.station.lines.map((code) => lineByCode(code)?.name ?? code).join("、")}
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={`camera-${result.camera.key}`}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => chooseCamera(result.camera)}
                      >
                        <span className="line-clamp-2">{result.camera.description}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{result.camera.district}</span>
                      </button>
                    </li>
                  ),
                )
              )}
            </ul>
          ) : null}
        </form>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 md:right-[22.5rem]">
          <MapView
            showMtr={showMtr}
            showCameras={showCameras}
            activeLine={activeLine}
            selected={selection}
            focus={focus}
            onSelect={setSelection}
            onBasemapProblem={() => setBasemapProblem(true)}
            onBasemapReady={() => setBasemapProblem(false)}
          />
          {basemapProblem ? (
            <p className="pointer-events-none absolute top-14 right-3 left-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-sm shadow">
              底圖暫時無法載入。你仍可用上方搜尋開啟車站和快拍點。
            </p>
          ) : null}
          {!showMtr && !showCameras ? (
            <p className="pointer-events-none absolute top-14 right-3 left-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-sm shadow">
              港鐵和快拍圖層都已關閉。請在上方重新開啟。
            </p>
          ) : null}
        </div>
        <aside className="absolute inset-x-0 bottom-0 z-10 h-[min(52dvh,28rem)] border-t bg-white shadow-2xl md:inset-y-0 md:left-auto md:h-auto md:w-[22.5rem] md:border-t-0 md:border-l md:shadow-none">
          <DetailPanel
            selection={selection}
            station={station}
            camera={camera}
            board={board}
            snapshot={snapshot}
            onClose={() => setSelection(null)}
            onRefresh={() => setReloadToken((value) => value + 1)}
          />
        </aside>
      </div>
    </div>
  )
}

function foldName(value: string): string {
  return value.replaceAll("茘", "荔").toLowerCase()
}

function search(query: string): SearchHit[] {
  const text = query.trim()
  if (!text) return []
  const folded = foldName(text)
  const stationHits = network.stations
    .filter(
      (station) =>
        foldName(station.name).includes(folded) ||
        station.nameEn.toLowerCase().includes(folded) ||
        station.code.toLowerCase() === folded,
    )
    .slice(0, 5)
    .map((station) => ({ kind: "station" as const, station }))
  const cameraHits = cameras
    .filter(
      (camera) =>
        camera.description.includes(text) ||
        camera.district.includes(text) ||
        camera.region.includes(text) ||
        camera.key.toLowerCase().includes(folded),
    )
    .slice(0, 5)
    .map((camera) => ({ kind: "camera" as const, camera }))
  return [...stationHits, ...cameraHits]
}
