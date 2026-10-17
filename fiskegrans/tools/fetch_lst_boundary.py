"""Hämtar Länsstyrelsen Västerbottens polygoner "Område upplåtet för fiske"
(Fiske på statens vatten) kring Nedre Boksjön som GeoJSON (WGS84).

Körs i GitHub Actions (se .github/workflows/fetch-boundary.yml) eftersom
utvecklingsmiljön saknar åtkomst till lansstyrelsen.se. Resultatet skrivs
till stdout mellan GEOJSON-BEGIN/GEOJSON-END och till filen som anges.

    python3 fetch_lst_boundary.py [utfil]
"""
import json
import sys
import urllib.parse
import urllib.request

PORTAL = "https://ext-geoportal.lansstyrelsen.se/arcgis"
WEBMAP = "0cf53fc396ed40019197352c8658c062"  # LstAC Fiske på statens vatten - WebMap
LAYER_ID = "19b08bbea77-layer-2"             # LstAC Område upplåtet för fiske
ENVELOPE = "15.90,65.52,16.25,65.65"         # lng/lat kring Nedre Boksjön
UA = {"User-Agent": "Mozilla/5.0 (fiskegrans)"}


def get_json(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def find_layers(layers):
    for lyr in layers or []:
        yield lyr
        yield from find_layers(lyr.get("layers"))


webmap = get_json(f"{PORTAL}/sharing/rest/content/items/{WEBMAP}/data", {"f": "json"})
ops = list(find_layers(webmap.get("operationalLayers")))
for lyr in ops:
    print("LAYER:", lyr.get("id"), "|", lyr.get("title"), "|", lyr.get("url"),
          "| def:", (lyr.get("layerDefinition") or {}).get("definitionExpression"))
layer = next(l for l in ops if l.get("id") == LAYER_ID or "upplåtet" in (l.get("title") or "").lower())
url = layer["url"]
where = (layer.get("layerDefinition") or {}).get("definitionExpression") or "1=1"

info = get_json(url, {"f": "json"})
print("SERVICE LAYER:", info.get("name"), "| geometry:", info.get("geometryType"))
print("FIELDS:", [f["name"] for f in info.get("fields", [])])

res = get_json(f"{url}/query", {
    "where": where,
    "geometry": ENVELOPE,
    "geometryType": "esriGeometryEnvelope",
    "inSR": 4326,
    "spatialRel": "esriSpatialRelIntersects",
    "outFields": "*",
    "outSR": 4326,
    "returnGeometry": "true",
    "geometryPrecision": 7,
    "f": "geojson",
})
feats = res.get("features", [])
print(f"OBJEKT: {len(feats)}")
for f in feats:
    print("PROPS:", json.dumps(f.get("properties"), ensure_ascii=False))

out = {
    "type": "FeatureCollection",
    "source": f"Länsstyrelsen Västerbotten, {layer.get('title')} ({url})",
    "features": feats,
}
text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
print("GEOJSON-BEGIN")
print(text)
print("GEOJSON-END")
if len(sys.argv) > 1:
    with open(sys.argv[1], "w", encoding="utf-8") as fh:
        fh.write(text)
