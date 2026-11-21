"use client"

import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cameras, lineByCode, network } from "@/lib/network"
import type { Camera, LineBoard, Selection, SnapshotView, Station } from "@/lib/types"

type BoardState = { state: "idle" | "loading" | "ready"; lines: LineBoard[] }

type SnapshotState =
  | { status: "idle" | "loading" }
  | { status: "ready"; view: SnapshotView }

type DetailPanelProps = {
  selection: Selection | null
  station: Station | null
  camera: Camera | null
  board: BoardState
  snapshot: SnapshotState
  onClose: () => void
  onRefresh: () => void
}

function SourceNote() {
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      到站班次來自港鐵，由本站暫存，同一站約每 15 秒才向港鐵核對一次。快拍照片來自運輸署，同一地點約每 90 秒才取一次。底圖為 OpenFreeMap，由瀏覽器直接讀取，地圖資料來自 OpenStreetMap。
      車站位置是用公開地圖座標對上官方站名；九龍、大埔墟和馬場已另行核對。路綫沿 OpenStreetMap 的港鐵路軌彎曲。
      選定一條路綫後，列車會沿路軌移動，位置由到站時間推算，不是港鐵定位。
    </p>
  )
}

function TrainList({ line }: { line: LineBoard }) {
  const info = lineByCode(line.line)
  const quiet = line.directions.every((direction) => direction.trains.length === 0)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <span
            className="size-2.5 rounded-full"
            style={{ background: info?.color ?? "#334155" }}
            aria-hidden
          />
          {info?.name ?? line.line}
        </h3>
        {line.updatedAt ? (
          <p className="text-xs text-muted-foreground">港鐵時間 {line.updatedAt}</p>
        ) : null}
      </div>
      {line.delay ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">港鐵表示列車有延誤。</p>
      ) : null}
      {line.alertTitle ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">{line.alertTitle}</p>
          {line.alertDetail ? <p className="mt-1 break-words">{line.alertDetail}</p> : null}
          {line.alertUrl ? (
            <a className="mt-2 inline-block underline" href={line.alertUrl} target="_blank" rel="noreferrer">
              查看港鐵公告
            </a>
          ) : null}
        </div>
      ) : null}
      {line.error ? <p className="text-sm text-destructive">{line.error}</p> : null}
      {!line.error && quiet && !line.alertTitle ? (
        <p className="text-sm text-muted-foreground">這條綫暫時沒有到站班次。</p>
      ) : null}
      {!line.error && !quiet
        ? line.directions.map((direction, index) => (
            <div key={`${line.line}-${index}`} className="space-y-2">
              {index === 1 ? <Separator /> : null}
              {direction.trains.length === 0 ? (
                <p className="text-sm text-muted-foreground">這個方向暫時沒有班次。</p>
              ) : (
                <ul>
                  {direction.trains.map((train) => (
                    <li
                      key={`${line.line}-${index}-${train.seq}-${train.destination}-${train.clock}`}
                      className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium">往{train.destination}</p>
                        <p className="text-xs text-muted-foreground">
                          {train.platform ? `${train.platform} 號月台` : "月台未提供"}
                          {train.unconfirmed ? " · 這班資料未確認" : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">{train.minutesLabel}</p>
                        {train.clock ? <p className="text-xs text-muted-foreground">{train.clock}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        : null}
    </section>
  )
}

function StationBody({ station, board }: { station: Station; board: BoardState }) {
  const quiet =
    board.state === "ready" &&
    board.lines.every(
      (line) => !line.error && line.directions.every((direction) => direction.trains.length === 0),
    )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{station.name}</h2>
        <p className="text-sm text-muted-foreground">{station.nameEn}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {station.lines.map((code) => {
            const line = lineByCode(code)
            return (
              <Badge key={code} variant="outline">
                <span className="size-1.5 rounded-full" style={{ background: line?.color }} />
                {line?.name ?? code}
              </Badge>
            )
          })}
        </div>
      </div>
      {board.state === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在查詢到站班次…
        </p>
      ) : null}
      {board.state === "ready"
        ? board.lines.map((line) => <TrainList key={line.line} line={line} />)
        : null}
      {quiet ? (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
          這個車站暫時沒有到站班次。
          {station.code === "RAC" ? "馬場站通常只在賽馬日有列車。" : ""}
        </p>
      ) : null}
    </div>
  )
}

function CameraBody({ camera, snapshot }: { camera: Camera; snapshot: SnapshotState }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">
          {camera.region} · {camera.district}
        </p>
        <h2 className="text-xl font-semibold tracking-tight">{camera.description}</h2>
        <p className="text-xs text-muted-foreground">編號 {camera.key}</p>
      </div>
      {snapshot.status === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在讀取最新照片…
        </p>
      ) : null}
      {snapshot.status === "ready" ? <SnapshotBody camera={camera} view={snapshot.view} /> : null}
    </div>
  )
}

function SnapshotBody({ camera, view }: { camera: Camera; view: SnapshotView }) {
  if (view.state === "error") {
    return (
      <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
        {view.message}
      </p>
    )
  }

  if (view.state === "unavailable") {
    return (
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
        <p role="status" className="font-medium">
          運輸署暫時未能提供這個快拍點的照片。
        </p>
        <p className="text-sm">官方圖像寫著「暫時未能提供服務」。這不是路面實況。</p>
        {view.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.src} alt="暫時未能提供服務" className="w-full max-w-[320px] rounded-md" />
        ) : null}
      </div>
    )
  }

  return (
    <figure className="space-y-2">
      {view.message ? <p className="text-sm text-muted-foreground">{view.message}</p> : null}
      {view.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={view.src}
          alt={`${camera.description}的最新快拍`}
          className="w-full max-w-[320px] rounded-lg bg-muted"
        />
      ) : null}
      <figcaption className="text-xs text-muted-foreground">
        {view.updatedAt
          ? `照片時間 ${view.updatedAt}（香港時間）`
          : "運輸署約每兩分鐘更新照片。這次未讀到照片時間。"}
      </figcaption>
    </figure>
  )
}

export function DetailPanel({
  selection,
  station,
  camera,
  board,
  snapshot,
  onClose,
  onRefresh,
}: DetailPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-white" aria-live="polite">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-sm font-medium text-[#17232b]">
          {selection ? "查閱資料" : "怎樣使用"}
        </p>
        <div className="flex gap-1">
          {selection ? (
            <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
              重新查詢
            </Button>
          ) : null}
          {selection ? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="關閉資料">
              <X />
            </Button>
          ) : null}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4">
          {!selection ? (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">先點地圖上的點</h2>
              <p className="text-sm leading-6">
                點一個車站，查看即將到站的班次。在上方選定一條路綫，列車會沿路軌移動。點一個橙色快拍點，查看該路段的最新照片。沒有班次或照片時，這裡會直接說明。
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                現有 {network.stations.length} 個重鐵站、{cameras.length} 個快拍點。快拍點很多，縮小地圖時會叠在一起，可以用搜尋或關掉其中一層。
              </p>
              <SourceNote />
            </div>
          ) : null}
          {station ? <StationBody station={station} board={board} /> : null}
          {camera ? <CameraBody camera={camera} snapshot={snapshot} /> : null}
          {selection ? <SourceNote /> : null}
        </div>
      </ScrollArea>
    </section>
  )
}
