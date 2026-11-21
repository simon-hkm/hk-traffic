"use client"

import { useEffect, useRef, useState } from "react"
import type { DataDrivenPropertyValueSpecification, GeoJSONSource, Map as MaplibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { trainCoordinate } from "@/lib/moving-trains"
import { cameras, lineByCode, network } from "@/lib/network"
import type { LineCode, MovingTrain, Selection } from "@/lib/types"

export type MapFocus = {
  lng: number
  lat: number
  token: number
}

type MapViewProps = {
  showMtr: boolean
  showCameras: boolean
  activeLine: LineCode | "all"
  trains: MovingTrain[]
  selected: Selection | null
  focus: MapFocus | null
  onSelect: (selection: Selection | null) => void
  onBasemapProblem: () => void
  onBasemapReady: () => void
}

const stationFeatures = {
  type: "FeatureCollection" as const,
  features: network.stations.map((station) => ({
    type: "Feature" as const,
    id: station.code,
    properties: {
      code: station.code,
      label: station.name,
      lineCodes: station.lines.join("|"),
      color: lineByCode(station.lines[0])?.color ?? "#1c1917",
      interchange: station.lines.length > 1,
    },
    geometry: {
      type: "Point" as const,
      coordinates: [station.lng, station.lat],
    },
  })),
}

const lineFeatures = {
  type: "FeatureCollection" as const,
  features: network.segments.map((segment) => ({
    type: "Feature" as const,
    properties: {
      line: segment.line,
      color: lineByCode(segment.line)?.color ?? "#334155",
    },
    geometry: {
      type: "LineString" as const,
      coordinates: segment.path,
    },
  })),
}

const cameraFeatures = {
  type: "FeatureCollection" as const,
  features: cameras.map((camera) => ({
    type: "Feature" as const,
    id: camera.key,
    properties: {
      key: camera.key,
      label: camera.description,
    },
    geometry: {
      type: "Point" as const,
      coordinates: [camera.lng, camera.lat],
    },
  })),
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }
    return replacements[character] ?? character
  })
}

function queriedLayers(showMtr: boolean, showCameras: boolean): string[] {
  const layers: string[] = []
  if (showMtr) layers.push("stations")
  if (showCameras) layers.push("cameras")
  return layers
}

function applyScene(
  map: MaplibreMap,
  showMtr: boolean,
  showCameras: boolean,
  activeLine: LineCode | "all",
  selected: Selection | null,
  previous: { station: string | null; camera: string | null },
) {
  map.setLayoutProperty("line-casing", "visibility", showMtr ? "visible" : "none")
  map.setLayoutProperty("mtr-lines", "visibility", showMtr ? "visible" : "none")
  map.setLayoutProperty("stations", "visibility", showMtr ? "visible" : "none")
  map.setLayoutProperty("trains", "visibility", showMtr ? "visible" : "none")
  map.setLayoutProperty("cameras", "visibility", showCameras ? "visible" : "none")

  const lineOpacity: DataDrivenPropertyValueSpecification<number> =
    activeLine === "all"
      ? 1
      : ["case", ["==", ["get", "line"], activeLine], 1, 0.14]
  const stationOpacity: DataDrivenPropertyValueSpecification<number> =
    activeLine === "all"
      ? 1
      : ["case", ["in", activeLine, ["get", "lineCodes"]], 1, 0.18]
  map.setPaintProperty("line-casing", "line-opacity", lineOpacity)
  map.setPaintProperty("mtr-lines", "line-opacity", lineOpacity)
  map.setPaintProperty("stations", "circle-opacity", stationOpacity)
  map.setPaintProperty("stations", "circle-stroke-opacity", stationOpacity)

  const narrow = window.matchMedia("(max-width: 767px)").matches
  const bottom = narrow ? Math.round(window.innerHeight * (selected ? 0.52 : 0.3)) : 0
  map.setPadding({ top: 12, right: 12, bottom, left: 12 })

  if (previous.station) {
    map.setFeatureState({ source: "stations", id: previous.station }, { selected: false })
  }
  if (previous.camera) {
    map.setFeatureState({ source: "cameras", id: previous.camera }, { selected: false })
  }
  const stationId = selected?.kind === "station" ? selected.code : null
  const cameraId = selected?.kind === "camera" ? selected.key : null
  if (stationId) map.setFeatureState({ source: "stations", id: stationId }, { selected: true })
  if (cameraId) map.setFeatureState({ source: "cameras", id: cameraId }, { selected: true })
  previous.station = stationId
  previous.camera = cameraId
}

const emptyTrains = {
  type: "FeatureCollection" as const,
  features: [],
}

function trainCollection(trains: MovingTrain[] | undefined, now: number) {
  return {
    type: "FeatureCollection" as const,
    features: (trains ?? []).flatMap((train) => {
      const coordinates = trainCoordinate(train, now)
      if (!coordinates) return []
      return [
        {
          type: "Feature" as const,
          properties: {
            label: `往${train.destination}`,
            color: lineByCode(train.line)?.color ?? "#17232b",
          },
          geometry: { type: "Point" as const, coordinates },
        },
      ]
    }),
  }
}

export function MapView({
  showMtr,
  showCameras,
  activeLine,
  trains,
  selected,
  focus,
  onSelect,
  onBasemapProblem,
  onBasemapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const previousRef = useRef({ station: null as string | null, camera: null as string | null })
  const handlers = useRef({ onSelect, onBasemapProblem, onBasemapReady, showMtr, showCameras })
  const trainsRef = useRef(trains)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    trainsRef.current = trains
  }, [trains])

  useEffect(() => {
    handlers.current = { onSelect, onBasemapProblem, onBasemapReady, showMtr, showCameras }
  }, [onSelect, onBasemapProblem, onBasemapReady, showMtr, showCameras])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let map: MaplibreMap | null = null
    let cancelled = false

    ;(async () => {
      const maplibregl = await import("maplibre-gl")
      if (cancelled || !containerRef.current) return
      maplibregl.setWorkerUrl("/maplibre-gl-worker.js")
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [114.15, 22.36],
        zoom: 10.4,
        minZoom: 9,
        maxZoom: 18,
        maxBounds: [
          [113.72, 22.05],
          [114.55, 22.64],
        ],
        attributionControl: false,
      })
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-left")
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "hk-popup",
      })

      map.on("load", () => {
        if (!map) return
        map.addSource("mtr-lines", { type: "geojson", data: lineFeatures })
        map.addSource("stations", { type: "geojson", data: stationFeatures })
        map.addSource("cameras", { type: "geojson", data: cameraFeatures })
        map.addSource("trains", { type: "geojson", data: emptyTrains })
        map.addLayer({
          id: "line-casing",
          type: "line",
          source: "mtr-lines",
          paint: {
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 6, 16, 9],
            "line-opacity": 0.95,
          },
        })
        map.addLayer({
          id: "mtr-lines",
          type: "line",
          source: "mtr-lines",
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 13, 4, 16, 6],
          },
        })
        map.addLayer({
          id: "cameras",
          type: "circle",
          source: "cameras",
          paint: {
            "circle-color": "#c2410c",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.4, 13, 4.5, 16, 7],
            "circle-stroke-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#0e5e5b",
              "#ffffff",
            ],
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              3,
              1,
            ],
            "circle-opacity": 0.92,
          },
        })
        map.addLayer({
          id: "stations",
          type: "circle",
          source: "stations",
          paint: {
            "circle-color": [
              "case",
              ["==", ["get", "interchange"], true],
              "#1c1917",
              ["get", "color"],
            ],
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              ["case", ["==", ["get", "interchange"], true], 5, 3.5],
              14,
              ["case", ["==", ["get", "interchange"], true], 8, 6],
            ],
            "circle-stroke-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#0e5e5b",
              "#ffffff",
            ],
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              4,
              2,
            ],
          },
        })
        map.addLayer({
          id: "trains",
          type: "circle",
          source: "trains",
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4.5, 12, 7, 16, 11],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 3,
          },
        })

        const bounds = new maplibregl.LngLatBounds()
        for (const station of network.stations) bounds.extend([station.lng, station.lat])
        const narrow = window.matchMedia("(max-width: 767px)").matches
        map.setPadding({
          top: 12,
          right: 12,
          bottom: narrow ? Math.round(window.innerHeight * 0.3) : 0,
          left: 12,
        })
        map.fitBounds(bounds, { padding: 28, maxZoom: 12, duration: 0 })
        mapRef.current = map
        setReady(true)
        handlers.current.onBasemapReady()
      })

      map.on("error", (event) => {
        const message = event.error instanceof Error ? event.error.message : ""
        if (!mapRef.current && /style|ajax|fetch|sprite/i.test(message)) {
          handlers.current.onBasemapProblem()
        }
      })

      map.on("click", (event) => {
        const current = mapRef.current
        if (!current) return
        const layers = queriedLayers(handlers.current.showMtr, handlers.current.showCameras)
        if (layers.length === 0) {
          handlers.current.onSelect(null)
          return
        }
        const hits = current.queryRenderedFeatures(event.point, { layers })
        const station = hits.find((hit) => hit.layer.id === "stations")
        const camera = hits.find((hit) => hit.layer.id === "cameras")
        const chosen = station ?? camera
        popup.remove()
        if (!chosen) {
          handlers.current.onSelect(null)
          return
        }
        if (chosen.layer.id === "stations") {
          handlers.current.onSelect({
            kind: "station",
            code: String(chosen.properties.code ?? ""),
          })
          return
        }
        handlers.current.onSelect({
          kind: "camera",
          key: String(chosen.properties.key ?? ""),
        })
      })

      map.on("mousemove", (event) => {
        const current = mapRef.current
        if (!current) return
        const layers = queriedLayers(handlers.current.showMtr, handlers.current.showCameras)
        const stationHit = layers.length
          ? current.queryRenderedFeatures(event.point, { layers })[0]
          : undefined
        const trainHit =
          handlers.current.showMtr && current.getLayer("trains")
            ? current.queryRenderedFeatures(event.point, { layers: ["trains"] })[0]
            : undefined
        const hit = stationHit ?? trainHit
        current.getCanvas().style.cursor = stationHit ? "pointer" : ""
        if (!hit) {
          popup.remove()
          return
        }
        const label = String(hit.properties.label ?? "")
        popup.setLngLat(event.lngLat).setHTML(`<strong>${escapeHtml(label)}</strong>`).addTo(current)
      })

      map.on("mouseout", () => {
        popup.remove()
        map?.getCanvas().style.setProperty("cursor", "")
      })
    })()

    return () => {
      cancelled = true
      setReady(false)
      map?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    applyScene(map, showMtr, showCameras, activeLine, selected, previousRef.current)
  }, [ready, showMtr, showCameras, activeLine, selected])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const stations =
      activeLine === "all" ? network.stations : network.stations.filter((station) => station.lines.includes(activeLine))
    if (stations.length === 0) return
    let west = Infinity
    let south = Infinity
    let east = -Infinity
    let north = -Infinity
    for (const station of stations) {
      west = Math.min(west, station.lng)
      south = Math.min(south, station.lat)
      east = Math.max(east, station.lng)
      north = Math.max(north, station.lat)
    }
    const narrow = window.matchMedia("(max-width: 767px)").matches
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: {
          top: 48,
          right: 48,
          bottom: narrow ? Math.round(window.innerHeight * 0.34) : 48,
          left: 48,
        },
        maxZoom: activeLine === "all" ? 12 : 14,
        duration: 700,
      },
    )
    if (activeLine === "all") return
    const nudgeCloser = () => {
      if (map.getZoom() < 13.4) map.easeTo({ zoom: 13.4, duration: 450 })
    }
    map.once("idle", nudgeCloser)
    return () => {
      map.off("idle", nudgeCloser)
    }
  }, [ready, activeLine])

  useEffect(() => {
    if (!ready) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last > 100) {
        last = now
        const source = mapRef.current?.getSource("trains")
        if (source?.type === "geojson") {
          (source as GeoJSONSource).setData(trainCollection(trainsRef.current, Date.now()))
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 14),
      essential: true,
    })
  }, [ready, focus])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!ready || !map || !container) return
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [ready])

  return <div ref={containerRef} className="h-full w-full" role="application" aria-label="香港地圖" />
}
