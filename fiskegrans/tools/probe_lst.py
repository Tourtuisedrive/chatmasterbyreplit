"""Undersöker Länsstyrelsens webbkarta för att hitta datakällan för
fiskeområdena (WMS/WFS/ArcGIS). Körs i GitHub Actions, utskrift i loggen."""
import json
import re
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (fiskegrans-probe)"}
BASE = "https://ext-webbgis.lansstyrelsen.se"
APP = "3a06b1e6-9856-44f2-b1e3-ddee6c04a7b5"
META = "https://ext-geodatakatalog.lansstyrelsen.se/GeodataKatalogen/srv/api/records/GetMetaDataById?id=b45f642e-d633-42bc-bfea-13384ad5d47e"


def get(url, limit=2_000_000):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("content-type", ""), r.read(limit).decode("utf-8", "replace")


def urls_in(body):
    return sorted(set(re.findall(r"https?://[^\s\"'<>)\\]+", body)))


def try_url(url, dump=3000):
    try:
        s, c, b = get(url)
        print(f"\n### {url}\n{s} {c} {len(b)} bytes")
        print(b[:dump])
        return b
    except Exception as e:  # noqa: BLE001
        print(f"\n### {url}\n!! {e}")
        return ""


# 1. Metadata
meta = try_url(META, dump=1500)
for u in urls_in(meta):
    print("META-URL:", u)
meta2 = try_url("https://ext-geodatakatalog.lansstyrelsen.se/GeodataKatalogen/srv/api/records/b45f642e-d633-42bc-bfea-13384ad5d47e/formatters/xml", dump=0)
for u in urls_in(meta2):
    print("META2-URL:", u)

# 2. Init-skriptets hänvisningar till konfiguration
_, _, init = get(f"{BASE}/_/29/cdn/0/jimu-core/init.js")
for m in sorted(set(re.findall(r"[\"'`]([^\"'`]*(?:config|api/|lstApplication|publicIdentifier)[^\"'`]*)[\"'`]", init)))[:80]:
    print("INIT:", m)

# 3. Kandidatadresser för appkonfigurationen
cands = [
    f"{BASE}/{APP}/config.json",
    f"{BASE}/{APP}/config/config.json",
    f"{BASE}/{APP}/cdn/0/config.json",
    f"{BASE}/api/applications/{APP}",
    f"{BASE}/api/applications/{APP}/config",
    f"{BASE}/api/application/{APP}/config",
    f"{BASE}/api/apps/{APP}/config",
    f"{BASE}/_/120/config.json",
    f"{BASE}/{APP}/config.json?draft=false",
]
found = {}
for c in cands:
    b = try_url(c, dump=600)
    if b.strip().startswith("{"):
        found[c] = b
for c, b in found.items():
    for u in urls_in(b):
        print("CFG-URL:", u)
