"""Generate data/walkins.js: walking routes from every car park to its crag.

Run from the project root after changing crag or parking coordinates:

    python3 tools/build_walkins.py

Sources:
  - Walking routes: OSRM foot profile on routing.openstreetmap.de (FOSSGIS),
    built from OpenStreetMap paths (© OpenStreetMap contributors, ODbL)
  - Elevation: Open-Meteo elevation API (Copernicus 90 m DEM, CC BY 4.0)
  - Postcodes: postcodes.io (Ordnance Survey / ONS open data, OGL)

Walking time uses Naismith's rule:
5 km/h plus 10 minutes per 100 m of ascent, rounded to 5 minutes.
Uses curl for HTTP because the macOS system Python's SSL is too old for some of these hosts.
"""
import json, math, re, subprocess, time, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "uk-boulders-walkins/0.1 (static site generator)"


def get_json(url, tries=4):
    for attempt in range(tries):
        try:
            out = subprocess.run(["curl", "-s", "-m", "60", "-A", UA, url], capture_output=True, text=True, check=True)
            return json.loads(out.stdout)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
            if attempt == tries - 1:
                raise
            print(f"  request failed ({type(e).__name__}), retrying…")
            time.sleep(5 * (attempt + 1))


def parse_areas():
    src = (ROOT / "data/areas.js").read_text()
    areas = []
    for m in re.finditer(r'\n  \{\n    id: "([^"]+)",.*?\n    lat: ([-\d.]+), lng: ([-\d.]+),.*?parking: \[\n(.*?)\n    \],', src, re.S):
        parking = [
            {"name": p[0], "lat": float(p[1]), "lng": float(p[2])}
            for p in re.findall(r'\{ name: "((?:[^"\\]|\\.)*)", lat: ([-\d.]+), lng: ([-\d.]+),', m.group(4))
        ]
        areas.append({"id": m.group(1), "lat": float(m.group(2)), "lng": float(m.group(3)), "parking": parking})
    return areas


def metres(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(lat), (b[0] - a[0]) * 110540)


def simplify(pts, tol=8.0):
    """Douglas–Peucker in metres; keeps the line light for the page."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = metres(a, b) or 1e-9

    def dist(p):  # perpendicular distance via triangle area
        s = (metres(a, p) + metres(p, b) + ab) / 2
        area = math.sqrt(max(s * (s - metres(a, p)) * (s - metres(p, b)) * (s - ab), 0))
        return 2 * area / ab

    i, d = max(((i, dist(p)) for i, p in enumerate(pts[1:-1], 1)), key=lambda x: x[1])
    if d <= tol:
        return [a, b]
    return simplify(pts[: i + 1], tol)[:-1] + simplify(pts[i:], tol)


def resample(pts, step=40.0, limit=100):
    """Points every ~step metres along the line, for elevation sampling."""
    total = sum(metres(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    step = max(step, total / (limit - 1))
    out, carry = [pts[0]], 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seg = metres(a, b)
        t = step - carry
        while t <= seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            t += step
        carry = (carry + seg) % step
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out[:limit]


def route(p, area):
    url = (
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
        f"{p['lng']},{p['lat']};{area['lng']},{area['lat']}?overview=full&geometries=geojson"
    )
    d = get_json(url)
    if d.get("code") != "Ok":
        return None
    r = d["routes"][0]
    pts = [(c[1], c[0]) for c in r["geometry"]["coordinates"]]
    # OSRM snaps to the nearest path; join the real start/end so the line reaches the pins
    pts = [(p["lat"], p["lng"])] + pts + [(area["lat"], area["lng"])]
    offpath = round(d["waypoints"][1]["distance"])
    return pts, r["distance"] + d["waypoints"][0]["distance"] + d["waypoints"][1]["distance"], offpath


def elevation(pts):
    q = urllib.parse.urlencode({
        "latitude": ",".join(f"{p[0]:.5f}" for p in pts),
        "longitude": ",".join(f"{p[1]:.5f}" for p in pts),
    })
    for attempt in range(4):
        d = get_json(f"https://api.open-meteo.com/v1/elevation?{q}")
        if "elevation" in d:
            return d["elevation"]
        print("  elevation API:", d.get("reason", d), "– retrying")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("elevation API kept failing")


def climb(elev, threshold=8.0):
    """Total ascent/descent, ignoring wiggles smaller than `threshold` metres.
    The 90 m DEM is noisy, so summing every tiny rise badly overstates the climb."""
    ascent = descent = 0.0
    ref = elev[0]
    for e in elev[1:]:
        if e - ref >= threshold:
            ascent += e - ref
            ref = e
        elif ref - e >= threshold:
            descent += ref - e
            ref = e
    # count the final partial move so start→end difference is preserved
    last = elev[-1] - ref
    ascent += max(0, last)
    descent += max(0, -last)
    return ascent, descent


def postcode(p):
    d = get_json(f"https://api.postcodes.io/postcodes?lon={p['lng']}&lat={p['lat']}&radius=2000&limit=1")
    r = (d.get("result") or [None])[0]
    return (r["postcode"], round(r["distance"])) if r else (None, None)


def main():
    result = {}
    for area in parse_areas():
        walks = []
        for i, p in enumerate(area["parking"]):
            pc, pc_dist = postcode(p)
            entry = {"parking": i, "postcode": pc, "postcodeDistance": pc_dist}
            got = route(p, area)
            time.sleep(1.1)  # be polite to the free routing server
            straight = metres((p["lat"], p["lng"]), (area["lat"], area["lng"]))
            if got and got[1] > 4 * straight + 1000:
                # The path network isn't connected in OSM (e.g. a 30 km detour) – don't show a bogus route
                print(f"  dropping route: {round(got[1])} m vs {round(straight)} m straight line")
                entry["unrouted"] = True
                entry["straight"] = round(straight)
                got = None
            if got:
                pts, dist, offpath = got
                time.sleep(1.5)  # Open-Meteo has a per-minute limit
                elev = elevation(resample(pts))
                ascent, descent = climb(elev)
                minutes = dist / 1000 / 5 * 60 + ascent / 100 * 10
                entry.update({
                    "distance": round(dist),
                    "ascent": round(ascent),
                    "descent": round(descent),
                    "minutes": max(5, int(5 * round(minutes / 5))),
                    "offPath": offpath,
                    "path": [[round(a, 5), round(b, 5)] for a, b in simplify(pts)],
                })
            walks.append(entry)
            print(f"{area['id']:<22} {p['name'][:38]:<38} {entry.get('distance', '-'):>6} m  "
                  f"↑{entry.get('ascent', '-'):>4} m  {entry.get('minutes', '-'):>3} min  {pc}")
        result[area["id"]] = walks

    header = (
        "// GENERATED by tools/build_walkins.py – do not edit by hand.\n"
        "// Walking routes: OSRM foot routing over OpenStreetMap (© OpenStreetMap contributors, ODbL).\n"
        "// Elevation: Open-Meteo (CC BY 4.0). Postcodes: postcodes.io (OS/ONS open data, OGL).\n"
        f"// Generated {time.strftime('%Y-%m-%d')}.\n"
    )
    body = "export const WALKINS = " + json.dumps(result, separators=(",", ":")) + ";\n"
    (ROOT / "data/walkins.js").write_text(header + body)
    print("wrote data/walkins.js")


if __name__ == "__main__":
    main()
