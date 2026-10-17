// Geometri för fiskegränsen. Rena funktioner utan DOM-beroenden så att de
// kan testas i Node (se test/geo.test.mjs).
//
// Koordinater i GeoJSON-ordning: [lng, lat]. Avstånd i meter.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG_EQ = 111320;

/**
 * Normaliserar GeoJSON (FeatureCollection, Feature, Polygon, MultiPolygon)
 * till en lista polygoner: [[yttreRing, hål1, hål2...], ...].
 * LineString/MultiLineString tolkas som stängda ringar (praktiskt vid
 * import av GPX-spår som gåtts/åkts längs gränsen).
 */
export function toPolygons(geojson) {
  const out = [];
  const visit = (g) => {
    if (!g) return;
    switch (g.type) {
      case 'FeatureCollection':
        g.features.forEach((f) => visit(f));
        break;
      case 'Feature':
        visit(g.geometry);
        break;
      case 'GeometryCollection':
        g.geometries.forEach(visit);
        break;
      case 'Polygon':
        out.push(g.coordinates.map(closeRing));
        break;
      case 'MultiPolygon':
        g.coordinates.forEach((p) => out.push(p.map(closeRing)));
        break;
      case 'LineString':
        if (g.coordinates.length >= 3) out.push([closeRing(g.coordinates)]);
        break;
      case 'MultiLineString':
        g.coordinates.forEach((c) => c.length >= 3 && out.push([closeRing(c)]));
        break;
      default:
        break;
    }
  };
  visit(geojson);
  return out.filter((p) => p[0] && p[0].length >= 4);
}

function closeRing(ring) {
  const r = ring.map((c) => [Number(c[0]), Number(c[1])]);
  if (r.length === 0) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

/** Ray casting i grad-koordinater (tillräckligt för små områden). */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Avstånd i meter från punkt till segment, lokal ekvirektangulär projektion. */
function distToSegmentM(lng, lat, a, b, kx) {
  const ax = (a[0] - lng) * kx;
  const ay = (a[1] - lat) * M_PER_DEG_LAT;
  const bx = (b[0] - lng) * kx;
  const by = (b[1] - lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.hypot(px, py);
}

/**
 * Var befinner sig punkten i förhållande till området?
 * Returnerar { inside, distance } där distance är kortaste avståndet (m)
 * till någon gränslinje (inklusive hål, t.ex. undantagna vikar).
 */
export function locate(lat, lng, polygons) {
  if (!polygons || polygons.length === 0) return { inside: false, distance: NaN };
  const kx = M_PER_DEG_LNG_EQ * Math.cos((lat * Math.PI) / 180);
  let inside = false;
  let distance = Infinity;
  for (const poly of polygons) {
    const [outer, ...holes] = poly;
    if (pointInRing(lng, lat, outer) && !holes.some((h) => pointInRing(lng, lat, h))) {
      inside = true;
    }
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = distToSegmentM(lng, lat, ring[i], ring[i + 1], kx);
        if (d < distance) distance = d;
      }
    }
  }
  return { inside, distance };
}

/**
 * Bestämmer zon utifrån position och inställningar.
 *  - 'inside'  : innanför och längre från gränsen än varningsavståndet
 *  - 'near'    : innanför men inom varningsavståndet
 *  - 'outside' : utanför området
 *
 * accuracy (m) dras av från avståndet när useAccuracy är satt, så att
 * varningen kommer tidigare när GPS-signalen är osäker.
 * previous används för hysteres så att larmet inte fladdrar vid gränsen.
 */
export function zoneFor({ inside, distance }, { warnDistance, accuracy = 0, useAccuracy = true, hysteresis = 3, previous = null }) {
  if (!Number.isFinite(distance)) return 'unknown';
  if (!inside) return 'outside';
  const effective = useAccuracy ? distance - accuracy : distance;
  const limit = previous === 'near' ? warnDistance + hysteresis : warnDistance;
  return effective <= limit ? 'near' : 'inside';
}

/** Bounding box [minLng, minLat, maxLng, maxLat] för polygonerna. */
export function bbox(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Utökar en bbox med marginal i meter. */
export function padBbox([minX, minY, maxX, maxY], meters) {
  const lat = (minY + maxY) / 2;
  const dLat = meters / M_PER_DEG_LAT;
  const dLng = meters / (M_PER_DEG_LNG_EQ * Math.cos((lat * Math.PI) / 180));
  return [minX - dLng, minY - dLat, maxX + dLng, maxY + dLat];
}

/** Slippy-map-tiles som täcker en bbox på given zoomnivå. */
export function tilesForBbox([minX, minY, maxX, maxY], z) {
  const n = 2 ** z;
  const tx = (lng) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const tiles = [];
  for (let x = tx(minX); x <= tx(maxX); x++) {
    for (let y = ty(maxY); y <= ty(minY); y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/** Tolkar KML-text till GeoJSON (kräver en DOMParser-implementation). */
export function kmlToGeoJSON(text, parser) {
  const doc = parser.parseFromString(text, 'application/xml');
  const parseCoords = (s) =>
    s.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)).map((c) => [c[0], c[1]]);
  const features = [];
  for (const poly of Array.from(doc.getElementsByTagName('Polygon'))) {
    const rings = [];
    const outer = poly.getElementsByTagName('outerBoundaryIs')[0];
    if (outer) rings.push(parseCoords(outer.getElementsByTagName('coordinates')[0].textContent));
    for (const inner of Array.from(poly.getElementsByTagName('innerBoundaryIs'))) {
      rings.push(parseCoords(inner.getElementsByTagName('coordinates')[0].textContent));
    }
    if (rings.length) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } });
  }
  if (features.length === 0) {
    for (const ls of Array.from(doc.getElementsByTagName('LineString'))) {
      const c = parseCoords(ls.getElementsByTagName('coordinates')[0].textContent);
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Tolkar GPX (spår, rutt eller waypoints) till en polygon. */
export function gpxToGeoJSON(text, parser) {
  const doc = parser.parseFromString(text, 'application/xml');
  const features = [];
  const pts = (tag) =>
    Array.from(doc.getElementsByTagName(tag)).map((p) => [Number(p.getAttribute('lon')), Number(p.getAttribute('lat'))]);
  for (const seg of Array.from(doc.getElementsByTagName('trkseg'))) {
    const c = Array.from(seg.getElementsByTagName('trkpt')).map((p) => [Number(p.getAttribute('lon')), Number(p.getAttribute('lat'))]);
    if (c.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeRing(c)] } });
  }
  if (features.length === 0) {
    const c = pts('rtept').length >= 3 ? pts('rtept') : pts('wpt');
    if (c.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeRing(c)] } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Tolkar Länsstyrelsens upplåtelsetext, t.ex. "Ej upplåtet 5/5-14/6"
 * (dag/månad), och avgör om datumet ligger inom förbudsperioden.
 */
export function isClosedSeason(text, date = new Date()) {
  const m = /Ej upplåtet\s*(\d+)\/(\d+)\s*-\s*(\d+)\/(\d+)/i.exec(text || '');
  if (!m) return false;
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const from = Number(m[2]) * 100 + Number(m[1]);
  const to = Number(m[4]) * 100 + Number(m[3]);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
