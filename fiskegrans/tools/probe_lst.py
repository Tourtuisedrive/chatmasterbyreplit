"""Undersöker Länsstyrelsens webbkarta för att hitta datakällan för
fiskeområdena (WMS/WFS/ArcGIS). Körs i GitHub Actions, utskrift i loggen."""
import json
import re
import sys
import urllib.parse
import urllib.request

START = sys.argv[1]
UA = {"User-Agent": "Mozilla/5.0 (fiskegrans-probe)"}
seen = set()


def get(url, limit=400_000):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("content-type", ""), r.read(limit).decode("utf-8", "replace")


def show(url, depth=0):
    if url in seen or len(seen) > 40:
        return
    seen.add(url)
    try:
        status, ctype, body = get(url)
    except Exception as e:  # noqa: BLE001
        print(f"\n### {url}\n!! {e}")
        return
    print(f"\n### {url}\n{status} {ctype} {len(body)} bytes")
    if url.endswith(".json") or "json" in ctype or depth == 0:
        print(body[:12000])
    for m in sorted(set(re.findall(r"https?://[^\s\"'<>)]+", body))):
        if re.search(r"wms|wfs|ows|geoserver|arcgis|mapserver|qgis|json|api", m, re.I):
            print("URL:", m)
    for line in body.splitlines():
        if re.search(r"fiske|statens|layer|source|wfs|wms", line, re.I) and len(line) < 400:
            print("LINE:", line.strip())
    if depth < 2:
        refs = re.findall(r"""(?:src|href)=["']([^"']+)["']|["']([^"'\s]+\.json)["']""", body)
        for a, b in refs:
            ref = a or b
            if ref.startswith(("data:", "#", "mailto:")) or re.search(r"\.(css|png|svg|ico|woff2?)(\?|$)", ref):
                continue
            show(urllib.parse.urljoin(url, ref), depth + 1)


show(START)
