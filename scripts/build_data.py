#!/usr/bin/env python3
"""Build static station, line, and camera files from official open data.

Station coordinates are not in the MTR open-data files. They come from
Wikidata, with two checked overrides where a historical station shares the
Chinese name, plus Racecourse which is absent from the lines file.
"""

from __future__ import annotations

import csv
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "data"
UA = "hk-traffic-map/1.0 (classroom map; static data build)"

LINES = [
    {"code": "AEL", "name": "機場快綫", "color": "#1C7670"},
    {"code": "TCL", "name": "東涌綫", "color": "#F7941D"},
    {"code": "TML", "name": "屯馬綫", "color": "#9A3B26"},
    {"code": "TKL", "name": "將軍澳綫", "color": "#6B208D"},
    {"code": "EAL", "name": "東鐵綫", "color": "#5EB6E4"},
    {"code": "SIL", "name": "南港島綫", "color": "#B5BD00"},
    {"code": "TWL", "name": "荃灣綫", "color": "#E2231A"},
    {"code": "ISL", "name": "港島綫", "color": "#007DC5"},
    {"code": "KTL", "name": "觀塘綫", "color": "#1A9431"},
    {"code": "DRL", "name": "迪士尼綫", "color": "#F550A6"},
]

# Current stations. The other Wikidata points are historical namesakes.
OVERRIDES = {
    "九龍": (22.3049, 114.1615),
    "大埔墟": (22.4446, 114.1706),
    "馬場": (22.4004, 114.2029),
}

# Racecourse is in the next-train spec but missing from the lines CSV.
RACECOURSE = {
    "code": "RAC",
    "name": "馬場",
    "nameEn": "Racecourse",
    "lines": ["EAL"],
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def norm(name: str) -> str:
    return name.replace("站", "").replace(" ", "").replace("\u3000", "").strip()


def load_lines() -> list[dict[str, str]]:
    raw = fetch("https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv")
    text = raw.decode("utf-8-sig")
    return [row for row in csv.DictReader(text.splitlines()) if row["Line Code"].strip()]


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "wikidata-stations.json"


def load_wikidata() -> list[dict[str, object]]:
    query = """
    SELECT ?station ?zh ?en ?coord WHERE {
      ?station wdt:P31 wd:Q928830;
               wdt:P131/wdt:P131* wd:Q8646;
               wdt:P625 ?coord;
               rdfs:label ?zh, ?en.
      FILTER(LANG(?zh) = "zh-hant")
      FILTER(LANG(?en) = "en")
    }
    """
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode(
        {"format": "json", "query": query}
    )
    try:
        payload = json.loads(fetch(url))
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except urllib.error.HTTPError as error:
        if error.code != 429 or not FIXTURE.exists():
            raise
        print("Wikidata rate limited; using saved fixture")
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    points = []
    for row in payload["results"]["bindings"]:
        coord = row["coord"]["value"]
        # Point(lon lat)
        inner = coord[coord.find("(") + 1 : coord.find(")")]
        lon_s, lat_s = inner.split()
        points.append(
            {
                "zh": row["zh"]["value"],
                "en": row["en"]["value"],
                "lat": float(lat_s),
                "lng": float(lon_s),
            }
        )
    return points


def in_hong_kong(lat: float, lng: float) -> bool:
    return 22.13 <= lat <= 22.58 and 113.82 <= lng <= 114.45


def choose_coord(name: str, name_en: str, points: list[dict[str, object]]) -> tuple[float, float, str]:
    if name in OVERRIDES:
        lat, lng = OVERRIDES[name]
        return lat, lng, "override"
    wanted = norm(name)
    hits = [p for p in points if norm(str(p["zh"])) == wanted]
    if not hits:
        en = norm(name_en).lower()
        hits = [p for p in points if en and en in norm(str(p["en"])).lower()]
    unique: list[tuple[float, float]] = []
    for hit in hits:
        pair = (round(float(hit["lat"]), 5), round(float(hit["lng"]), 5))
        if pair not in unique:
            unique.append(pair)
    if not unique:
        raise SystemExit(f"No coordinate for {name} / {name_en}")
    if len(unique) > 1:
        spread = max(
            math.dist((a[0], a[1]), (b[0], b[1])) for a in unique for b in unique
        )
        if spread > 0.01:
            raise SystemExit(f"Ambiguous coordinate for {name}: {unique}")
    lat, lng = unique[0]
    if not in_hong_kong(lat, lng):
        raise SystemExit(f"Coordinate outside Hong Kong for {name}: {lat}, {lng}")
    return lat, lng, "wikidata"


def build_network(rows: list[dict[str, str]], points: list[dict[str, object]]) -> dict[str, object]:
    by_code: dict[str, dict[str, object]] = {}
    for row in rows:
        code = row["Station Code"].strip()
        station = by_code.setdefault(
            code,
            {
                "code": code,
                "name": row["Chinese Name"].strip(),
                "nameEn": row["English Name"].strip(),
                "lines": [],
            },
        )
        line = row["Line Code"].strip()
        lines = station["lines"]
        assert isinstance(lines, list)
        if line not in lines:
            lines.append(line)

    by_code["RAC"] = dict(RACECOURSE)

    stations = []
    for code, station in by_code.items():
        lat, lng, source = choose_coord(str(station["name"]), str(station["nameEn"]), points)
        line_order = {item["code"]: index for index, item in enumerate(LINES)}
        lines = sorted(station["lines"], key=lambda item: line_order[str(item)])
        stations.append(
            {
                "code": code,
                "name": station["name"],
                "nameEn": station["nameEn"],
                "lat": lat,
                "lng": lng,
                "lines": lines,
                "coordinateSource": source,
            }
        )
    stations.sort(key=lambda item: str(item["name"]))

    coords = {item["code"]: item for item in stations}
    pair_seen: set[tuple[str, str, str]] = set()
    segments = []
    grouped: dict[tuple[str, str], list[tuple[float, str]]] = defaultdict(list)
    for row in rows:
        grouped[(row["Line Code"].strip(), row["Direction"].strip())].append(
            (float(row["Sequence"]), row["Station Code"].strip())
        )
    for (line, _direction), entries in grouped.items():
        ordered = [code for _seq, code in sorted(entries)]
        for start, end in zip(ordered, ordered[1:]):
            key = (line, *sorted((start, end)))
            if key in pair_seen:
                continue
            pair_seen.add(key)
            segments.append(
                {
                    "line": line,
                    "from": start,
                    "to": end,
                    "path": [
                        [coords[start]["lng"], coords[start]["lat"]],
                        [coords[end]["lng"], coords[end]["lat"]],
                    ],
                }
            )

    # Race-day trains run Sha Tin–Racecourse–University and skip Fo Tan.
    for start, end in (("SHT", "RAC"), ("RAC", "UNI")):
        segments.append(
            {
                "line": "EAL",
                "from": start,
                "to": end,
                "path": [
                    [coords[start]["lng"], coords[start]["lat"]],
                    [coords[end]["lng"], coords[end]["lat"]],
                ],
            }
        )

    return {"lines": LINES, "stations": stations, "segments": segments}


def build_cameras() -> list[dict[str, object]]:
    raw = fetch(
        "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv"
    )
    text = raw.decode("utf-16")
    cameras = []
    seen: set[str] = set()
    for row in csv.DictReader(text.splitlines(), delimiter="\t"):
        key = (row.get("key") or row.get("\ufeffkey") or "").strip()
        lat = float(row["latitude"])
        lng = float(row["longitude"])
        if not key or key in seen:
            raise SystemExit(f"Bad camera key: {key!r}")
        if not in_hong_kong(lat, lng):
            raise SystemExit(f"Camera outside Hong Kong: {key} {lat}, {lng}")
        seen.add(key)
        cameras.append(
            {
                "key": key,
                "region": row["region"].strip(),
                "district": row["district"].strip(),
                "description": row["description"].strip(),
                "lat": lat,
                "lng": lng,
                "url": row["url"].strip(),
            }
        )
    return cameras


def main() -> None:
    rows = load_lines()
    points = load_wikidata()
    network = build_network(rows, points)
    cameras = build_cameras()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "network.json").write_text(
        json.dumps(network, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT_DIR / "cameras.json").write_text(
        json.dumps(cameras, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    stations = network["stations"]
    assert isinstance(stations, list)
    print(f"stations {len(stations)}")
    print(f"segments {len(network['segments'])}")
    print(f"cameras {len(cameras)}")
    for station in stations:
        print(
            f"{station['code']:4} {station['name']:6} {station['lat']:.5f},{station['lng']:.5f} "
            f"{','.join(station['lines'])} {station['coordinateSource']}"
        )


if __name__ == "__main__":
    main()
