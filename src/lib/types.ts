export type LineCode =
  | "AEL"
  | "TCL"
  | "TML"
  | "TKL"
  | "EAL"
  | "SIL"
  | "TWL"
  | "ISL"
  | "KTL"
  | "DRL"

export type LineInfo = {
  code: LineCode
  name: string
  color: string
}

export type Station = {
  code: string
  name: string
  nameEn: string
  lat: number
  lng: number
  lines: LineCode[]
  coordinateSource: "override" | "wikidata"
}

export type Segment = {
  line: LineCode
  from: string
  to: string
  path: [number, number][]
}

export type Network = {
  lines: LineInfo[]
  stations: Station[]
  segments: Segment[]
}

export type Camera = {
  key: string
  region: string
  district: string
  description: string
  lat: number
  lng: number
  url: string
}

export type Selection =
  | { kind: "station"; code: string }
  | { kind: "camera"; key: string }

export type TrainRow = {
  seq: number
  destination: string
  platform: string
  clock: string
  minutesLabel: string
  unconfirmed: boolean
}

export type LineBoard = {
  line: LineCode
  delay: boolean
  alertTitle: string | null
  alertDetail: string | null
  alertUrl: string | null
  updatedAt: string | null
  directions: { trains: TrainRow[] }[]
  error: string | null
}

export type SnapshotView = {
  state: "photo" | "remote" | "unavailable" | "error"
  src?: string
  updatedAt?: string | null
  message?: string
}
