import camerasJson from "@/data/cameras.json"
import networkJson from "@/data/network.json"
import type { Camera, LineCode, LineInfo, Network, Station } from "@/lib/types"

export const network = networkJson as Network
export const cameras = camerasJson as Camera[]

const lines = new Map(network.lines.map((line) => [line.code, line]))
const stations = new Map(network.stations.map((station) => [station.code, station]))
const cameraIndex = new Map(cameras.map((camera) => [camera.key, camera]))

export function lineByCode(code: string): LineInfo | undefined {
  return lines.get(code as LineCode)
}

export function stationByCode(code: string): Station | undefined {
  return stations.get(code)
}

export function cameraByKey(key: string): Camera | undefined {
  return cameraIndex.get(key)
}

export function stationName(code: string): string {
  return stations.get(code)?.name ?? code
}

export function stationCodesOnLine(line: LineCode): string[] {
  return network.stations.filter((station) => station.lines.includes(line)).map((station) => station.code)
}

export function isLineCode(value: string): value is LineCode {
  return lines.has(value as LineCode)
}
