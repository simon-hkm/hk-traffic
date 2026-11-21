#!/usr/bin/env python3
"""Build static station, line, and camera files from official open data.

Station coordinates are not in the MTR open-data files. They come from
Wikidata, with two checked overrides where a historical station shares the
Chinese name, plus Racecourse which is absent from the lines file.
"""

from __future__ import annotations

import csv
import heapq
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
ROUTE_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "mtr-route-ways.json"
LINE_CODES = {item["code"] for item in LINES}


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
    route_ways = load_route_ways()
    segments = curved_segments(route_ways)
    covered = {segment["line"] for segment in segments}
    segments.extend(straight_segments(rows, coords, LINE_CODES - covered))
    legs = build_legs(route_ways, stations, official_pairs(rows))
    return {"lines": LINES, "stations": stations, "segments": segments, "legs": legs}


def straight_segments(rows: list[dict[str, str]], coords: dict[str, dict[str, object]], lines: set[str]) -> list[dict[str, object]]:
    pair_seen: set[tuple[str, str, str]] = set()
    segments: list[dict[str, object]] = []
    grouped: dict[tuple[str, str], list[tuple[float, str]]] = defaultdict(list)
    for row in rows:
        line = row["Line Code"].strip()
        if line not in lines:
            continue
        grouped[(line, row["Direction"].strip())].append((float(row["Sequence"]), row["Station Code"].strip()))
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
    if "EAL" in lines:
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
    return segments


def perpendicular_distance_m(point: list[float], start: list[float], end: list[float]) -> float:
    def to_xy(coord: list[float], origin: list[float]) -> tuple[float, float]:
        lat = math.radians(origin[1])
        x = math.radians(coord[0] - origin[0]) * math.cos(lat) * 6_371_000
        y = math.radians(coord[1] - origin[1]) * 6_371_000
        return x, y

    end_x, end_y = to_xy(end, start)
    point_x, point_y = to_xy(point, start)
    length_sq = end_x * end_x + end_y * end_y
    if length_sq == 0:
        return math.hypot(point_x, point_y)
    ratio = max(0.0, min(1.0, (point_x * end_x + point_y * end_y) / length_sq))
    return math.hypot(point_x - ratio * end_x, point_y - ratio * end_y)


def simplify_path(points: list[list[float]], tolerance_m: float) -> list[list[float]]:
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    index = 0
    farthest = 0.0
    for position in range(1, len(points) - 1):
        distance = perpendicular_distance_m(points[position], start, end)
        if distance > farthest:
            index = position
            farthest = distance
    if farthest <= tolerance_m:
        return [start, end]
    left = simplify_path(points[: index + 1], tolerance_m)
    right = simplify_path(points[index:], tolerance_m)
    return left[:-1] + right


def load_route_ways() -> dict[str, dict[str, list[list[float]]]]:
    query = """
    [out:json][timeout:180];
    relation["network"="港鐵 MTR"]["route"="subway"]["ref"~"^(AEL|TCL|TML|TKL|EAL|SIL|TWL|ISL|KTL|DRL)$"](22.13,113.82,22.58,114.45);
    out geom;
    """
    url = "https://overpass-api.de/api/interpreter"
    try:
        request = urllib.request.Request(
            url,
            data=query.encode(),
            headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read())
        ways = ways_from_overpass(payload)
        ROUTE_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        ROUTE_FIXTURE.write_text(json.dumps(ways, separators=(",", ":")), encoding="utf-8")
        return ways
    except urllib.error.HTTPError as error:
        if not ROUTE_FIXTURE.exists():
            raise
        print(f"Overpass HTTP {error.code}; using saved route fixture")
        return json.loads(ROUTE_FIXTURE.read_text(encoding="utf-8"))
    except urllib.error.URLError:
        if not ROUTE_FIXTURE.exists():
            raise
        print("Overpass unavailable; using saved route fixture")
        return json.loads(ROUTE_FIXTURE.read_text(encoding="utf-8"))


def ways_from_overpass(payload: dict[str, object]) -> dict[str, dict[str, list[list[float]]]]:
    ways: dict[str, dict[str, list[list[float]]]] = {}
    elements = payload.get("elements", [])
    assert isinstance(elements, list)
    for element in elements:
        if not isinstance(element, dict):
            continue
        tags = element.get("tags", {})
        if not isinstance(tags, dict):
            continue
        line = str(tags.get("ref", ""))
        if line not in LINE_CODES:
            continue
        members = element.get("members", [])
        if not isinstance(members, list):
            continue
        for member in members:
            if not isinstance(member, dict) or member.get("type") != "way":
                continue
            geometry = member.get("geometry") or []
            if not isinstance(geometry, list) or len(geometry) < 2:
                continue
            coords = [[round(float(point["lon"]), 5), round(float(point["lat"]), 5)] for point in geometry]
            ways.setdefault(line, {})[str(member["ref"])] = coords
    return ways


def official_pairs(rows: list[dict[str, str]]) -> list[tuple[str, str, str]]:
    pair_seen: set[tuple[str, str, str]] = set()
    pairs: list[tuple[str, str, str]] = []
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
            pairs.append((line, start, end))
    for start, end in (("SHT", "RAC"), ("RAC", "UNI")):
        key = ("EAL", *sorted((start, end)))
        if key not in pair_seen:
            pairs.append(("EAL", start, end))
    return pairs


def distance_m(start: list[float], end: list[float]) -> float:
    lat = math.radians((start[1] + end[1]) / 2)
    dx = math.radians(end[0] - start[0]) * math.cos(lat) * 6_371_000
    dy = math.radians(end[1] - start[1]) * 6_371_000
    return math.hypot(dx, dy)


def path_length(path: list[list[float]]) -> float:
    return sum(distance_m(path[index], path[index + 1]) for index in range(len(path) - 1))


def build_legs(
    route_ways: dict[str, dict[str, list[list[float]]]],
    stations: list[dict[str, object]],
    pairs: list[tuple[str, str, str]],
) -> list[dict[str, object]]:
    by_code = {str(station["code"]): station for station in stations}
    legs: list[dict[str, object]] = []
    for line in LINE_CODES:
        ways = route_ways.get(line, {})
        line_pairs = [(start, end) for pair_line, start, end in pairs if pair_line == line]
        routed = route_line({way_id: coords for way_id, coords in ways.items()}, line_pairs, by_code)
        for start, end, path in routed:
            legs.append({"line": line, "from": start, "to": end, "path": path})
    return legs


def main_track(polylines: list[list[list[float]]], join_m: float = 45) -> list[list[list[float]]]:
    """Keep the connected passenger track and drop short depot sidings."""
    count = len(polylines)
    parent = list(range(count))

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for index, coords in enumerate(polylines):
        for endpoint in (coords[0], coords[-1]):
            nearest: tuple[float, int] | None = None
            for other_index, other in enumerate(polylines):
                if index == other_index:
                    continue
                projected = project_path(other, endpoint)
                if projected is not None and (nearest is None or projected[0] < nearest[0]):
                    nearest = (projected[0], other_index)
            if nearest is not None and nearest[0] <= join_m:
                parent[find(index)] = find(nearest[1])
    groups: dict[int, list[list[list[float]]]] = defaultdict(list)
    for index, coords in enumerate(polylines):
        groups[find(index)].append(coords)
    largest = max(groups.values(), key=len)
    if len(largest) < max(3, count // 2):
        return polylines
    return largest


def route_line(
    ways: dict[str, list[list[float]]],
    pairs: list[tuple[str, str]],
    stations: dict[str, dict[str, object]],
) -> list[tuple[str, str, list[list[float]]]]:
    straight_routes = [
        (
            start,
            end,
            [
                [float(stations[start]["lng"]), float(stations[start]["lat"])],
                [float(stations[end]["lng"]), float(stations[end]["lat"])],
            ],
        )
        for start, end in pairs
        if start in stations and end in stations
    ]
    if not ways:
        return straight_routes

    polylines = main_track(list(ways.values()))
    needed = {code for pair in pairs for code in pair}
    endpoint_count = len(polylines) * 2
    parent = list(range(endpoint_count))

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    endpoints = [point for coords in polylines for point in (coords[0], coords[-1])]
    for index, point in enumerate(endpoints):
        for earlier in range(index):
            if distance_m(point, endpoints[earlier]) <= 45:
                parent[find(index)] = find(earlier)

    splits: list[list[tuple[float, str, list[float]]]] = [[] for _ in polylines]
    for index, coords in enumerate(polylines):
        for which, endpoint in enumerate((coords[0], coords[-1])):
            node = f"n{find(index * 2 + which)}"
            for other_index, other in enumerate(polylines):
                if index == other_index:
                    continue
                projected = project_path(other, endpoint)
                if projected is None or projected[0] > 45:
                    continue
                _gap, along, point = projected
                other_length = path_length(other)
                if along <= 20 or along >= other_length - 20:
                    continue
                splits[other_index].append((along, node, point))

    station_point: dict[str, list[float]] = {}
    for code in needed:
        point = [float(stations[code]["lng"]), float(stations[code]["lat"])]
        station_point[code] = point
        projections: list[tuple[float, int, float, list[float]]] = []
        for other_index, other in enumerate(polylines):
            projected = project_path(other, point)
            if projected is not None:
                projections.append((projected[0], other_index, projected[1], projected[2]))
        if projections:
            nearest = min(item[0] for item in projections)
            # Both rails usually run within a few metres. Link the station to each
            # of them so a train is not sent to the far end to change tracks.
            for gap, other_index, along, snapped in projections:
                if gap <= 450 and gap <= max(40, nearest + 25):
                    splits[other_index].append((along, code, snapped))

    edges: dict[str, list[tuple[str, list[list[float]]]]] = defaultdict(list)

    def add_edge(start: str, end: str, path: list[list[float]]) -> None:
        if start == end or len(path) < 2:
            return
        edges[start].append((end, path))
        edges[end].append((start, list(reversed(path))))

    for index, coords in enumerate(polylines):
        total = path_length(coords)
        cuts = [(0.0, f"n{find(index * 2)}", coords[0])]
        for along, node, point in splits[index]:
            cuts.append((max(0.0, min(total, along)), node, point))
        cuts.append((total, f"n{find(index * 2 + 1)}", coords[-1]))
        cuts.sort(key=lambda item: (item[0], item[1]))
        for left, right in zip(cuts, cuts[1:]):
            geometry = slice_path(coords, left[0], right[0], left[2], right[2])
            if len(geometry) < 2:
                geometry = [left[2], right[2]]
            add_edge(left[1], right[1], geometry)

    routed: list[tuple[str, str, list[list[float]]]] = []
    for start, end in pairs:
        path = shortest_path(edges, start, end)
        straight = [station_point[start], station_point[end]]
        limit = max(1_500, distance_m(straight[0], straight[1]) * 4)
        if path is None or path_length(path) > limit:
            path = straight
        else:
            path = anchor_path(path, station_point[start], station_point[end])
            path = simplify_path(path, 8)
        routed.append((start, end, [[round(coord[0], 5), round(coord[1], 5)] for coord in path]))
    return routed


def anchor_path(path: list[list[float]], start: list[float], end: list[float]) -> list[list[float]]:
    anchored = list(path)
    if distance_m(anchored[0], start) > 15:
        anchored.insert(0, start)
    else:
        anchored[0] = start
    if distance_m(anchored[-1], end) > 15:
        anchored.append(end)
    else:
        anchored[-1] = end
    return anchored


def project_path(path: list[list[float]], point: list[float]) -> tuple[float, float, list[float]] | None:
    best: tuple[float, float, list[float]] | None = None
    walked = 0.0
    for index in range(len(path) - 1):
        start, end = path[index], path[index + 1]
        length = distance_m(start, end)
        if length == 0:
            continue
        lat = math.radians((start[1] + end[1]) / 2)
        sx = 0.0
        sy = 0.0
        ex = math.radians(end[0] - start[0]) * math.cos(lat) * 6_371_000
        ey = math.radians(end[1] - start[1]) * 6_371_000
        px = math.radians(point[0] - start[0]) * math.cos(lat) * 6_371_000
        py = math.radians(point[1] - start[1]) * 6_371_000
        ratio = max(0.0, min(1.0, (px * ex + py * ey) / (ex * ex + ey * ey)))
        projected = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
        distance = distance_m(projected, point)
        if best is None or distance < best[0]:
            best = (distance, walked + length * ratio, projected)
        walked += length
    return best


def slice_path(
    path: list[list[float]],
    start_distance: float,
    end_distance: float,
    start_point: list[float],
    end_point: list[float],
) -> list[list[float]]:
    if end_distance < start_distance:
        start_distance, end_distance = end_distance, start_distance
        start_point, end_point = end_point, start_point
    points = [start_point]
    walked = 0.0
    for index in range(len(path) - 1):
        length = distance_m(path[index], path[index + 1])
        next_walked = walked + length
        if next_walked > start_distance + 1 and walked < end_distance - 1:
            points.append(path[index + 1])
        walked = next_walked
    points.append(end_point)
    compact = [points[0]]
    for point in points[1:]:
        if distance_m(compact[-1], point) >= 1:
            compact.append(point)
    return compact


def shortest_path(
    edges: dict[str, list[tuple[str, list[list[float]]]]],
    start: str,
    end: str,
) -> list[list[float]] | None:
    if start == end:
        return None
    costs: dict[str, float] = {start: 0.0}
    previous: dict[str, tuple[str, list[list[float]]]] = {}
    queue = [(0.0, start)]
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != costs.get(node):
            continue
        if node == end:
            break
        for neighbor, path in edges.get(node, []):
            next_cost = cost + path_length(path)
            if next_cost < costs.get(neighbor, float("inf")):
                costs[neighbor] = next_cost
                previous[neighbor] = (node, path)
                heapq.heappush(queue, (next_cost, neighbor))
    if end not in previous:
        return None
    pieces: list[list[list[float]]] = []
    node = end
    while node != start:
        node, path = previous[node]
        pieces.append(path)
    pieces.reverse()
    full = [pieces[0][0]]
    for piece in pieces:
        full.extend(piece[1:])
    return full


def curved_segments(route_ways: dict[str, dict[str, list[list[float]]]]) -> list[dict[str, object]]:
    segments: list[dict[str, object]] = []
    for line, ways in route_ways.items():
        for way_id, coords in ways.items():
            path = simplify_path(coords, 8)
            if len(path) < 2:
                continue
            segments.append({"line": line, "from": way_id, "to": way_id, "path": path})
    return segments


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
