"""Hämtar Länsstyrelsens polygoner för "Fiske på statens vatten" kring
Nedre Boksjön. Körs i GitHub Actions; resultatet skrivs i loggen mellan
markörerna GEOJSON-BEGIN/GEOJSON-END."""
import json
import re
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (fiskegrans)"}
CONFIG = "https://ext-webbgis.lansstyrelsen.se/3a06b1e6-9856-44f2-b1e3-ddee6c04a7b5/cdn/0/config.json"
# Område kring Nedre Boksjön (lng/lat)
ENVELOPE = "15.95,65.53,16.20,65.64"


def get_json(url, params=None):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


cfg = get_json(CONFIG)
ds = cfg.get("dataSources", {})
print("DATASOURCES:")
for k, v in ds.items():
    print(" ", k, v.get("type"), v.get("itemId"), v.get("portalUrl"), v.get("url"))
portal_hits = set(re.findall(r'"portalUrl"\s*:\s*"([^"]+)"', json.dumps(cfg)))
print("PORTALS:", portal_hits)

layers = []  # (title, url)
for k, v in ds.items():
    if v.get("url"):
        layers.append((v.get("label") or k, v["url"]))
    item, portal = v.get("itemId"), v.get("portalUrl") or "https://ext-geoportal.lansstyrelsen.se/arcgis"
    if not item:
        continue
    try:
        data = get_json(f"{portal}/sharing/rest/content/items/{item}/data", {"f": "json"})
    except Exception as e:  # noqa: BLE001
        print("item fail", item, e)
        continue

    def walk(lst, prefix=""):
        for lyr in lst or []:
            t = prefix + (lyr.get("title") or "")
            print("  LAYER:", t, "|", lyr.get("url"), "|", lyr.get("itemId"))
            if lyr.get("url"):
                layers.append((t, lyr["url"]))
            walk(lyr.get("layers"), t + " / ")

    walk(data.get("operationalLayers"))

# Expandera map-/feature-tjänster utan lagerindex till deras lager.
expanded = []
for title, url in layers:
    if re.search(r"/(MapServer|FeatureServer)/?$", url):
        try:
            info = get_json(url, {"f": "json"})
            for l in info.get("layers", []):
                expanded.append((f"{title} / {l['name']}", f"{url.rstrip('/')}/{l['id']}"))
        except Exception as e:  # noqa: BLE001
            print("svc fail", url, e)
    else:
        expanded.append((title, url))

print("\nALL LAYERS:")
for t, u in expanded:
    print(" ", t, "->", u)

for title, url in expanded:
    if not re.search(r"fisk|statens|vatten|kronan", title + url, re.I):
        continue
    try:
        res = get_json(f"{url}/query", {
            "where": "1=1",
            "geometry": ENVELOPE,
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "outSR": 4326,
            "returnGeometry": "true",
            "f": "geojson",
        })
    except Exception as e:  # noqa: BLE001
        print("query fail", url, e)
        continue
    feats = res.get("features", [])
    print(f"\nQUERY {title} -> {len(feats)} objekt")
    for f in feats:
        g = f.get("geometry") or {}

        def rnd(c):
            return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]

        if g.get("coordinates"):
            g["coordinates"] = rnd(g["coordinates"])
        print("PROPS:", json.dumps(f.get("properties"), ensure_ascii=False))
    print("GEOJSON-BEGIN", title)
    print(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
    print("GEOJSON-END")
