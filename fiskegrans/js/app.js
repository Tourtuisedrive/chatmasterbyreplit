import { toPolygons, locate, zoneFor, bbox, padBbox, tilesForBbox, kmlToGeoJSON, gpxToGeoJSON } from './geo.js';
import { SOUNDS, unlockAudio, audioState, play, vibrate } from './alarm.js';

// Nedre Boksjön (koordinat från användaren).
const LAKE = { lat: 65.58488, lng: 16.06088 };
const STORE_SETTINGS = 'fiskegrans.settings.v1';
const STORE_BOUNDARY = 'fiskegrans.boundary.v1';
const TILE_CACHE = 'fiskegrans-tiles-v1';
const MAX_TILES = 4000;

const TILE_SOURCES = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap-bidragsgivare',
  },
  topo: {
    name: 'OpenTopoMap (terräng)',
    url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    maxZoom: 17,
    attribution: '© OpenStreetMap-bidragsgivare, SRTM | © OpenTopoMap (CC-BY-SA)',
  },
  sat: {
    name: 'Satellit (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
  },
};

const DEFAULTS = {
  warnDistance: 50,
  useAccuracy: true,
  nearEnabled: true,
  nearSound: 'dubbelpip',
  nearVolume: 1,
  nearRepeat: 5,
  outsideEnabled: true,
  outsideSound: 'klick',
  outsideVolume: 0.3,
  outsideRepeat: 60,
  enterEnabled: true,
  enterSound: 'klocka',
  enterVolume: 0.6,
  tileSource: 'osm',
};

const ZONE_TEXT = {
  inside: 'Innanför området',
  near: 'Nära gränsen!',
  outside: 'Utanför området',
  unknown: 'Okänd position',
};

// ---------- tillstånd ----------
const $ = (id) => document.getElementById(id);
const settings = { ...DEFAULTS, ...readJSON(STORE_SETTINGS, {}) };
let boundaryGeoJSON = null;
let polygons = [];
let watchId = null;
let zone = 'unknown';
let lastFix = null;
let lastNearAlarm = 0;
let lastOutsideAlarm = 0;
let follow = true;
let wakeLock = null;
let gpsWatchdog = null;

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* privat läge */ }
}
function saveSettings() { writeJSON(STORE_SETTINGS, settings); }

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- karta ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([LAKE.lat, LAKE.lng], 14);
L.control.zoom({ position: 'topright' }).addTo(map);
let tileLayer = null;
function setTileSource(key) {
  const src = TILE_SOURCES[key] || TILE_SOURCES.osm;
  if (tileLayer) tileLayer.remove();
  tileLayer = L.tileLayer(src.url, { maxZoom: src.maxZoom, maxNativeZoom: src.maxZoom, attribution: src.attribution, crossOrigin: true }).addTo(map);
}
setTileSource(settings.tileSource);

const boundaryLayer = L.geoJSON(null, { style: { color: '#0050ff', weight: 3, fillColor: '#2f9fe0', fillOpacity: 0.12 } }).addTo(map);
const accuracyCircle = L.circle([0, 0], { radius: 0, color: '#2f9fe0', weight: 1, fillOpacity: 0.15, interactive: false });
const posMarker = L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#007aff', fillOpacity: 1, interactive: false });

map.on('dragstart', () => { follow = false; });

// ---------- gräns ----------
function setBoundary(geojson, { persist = true } = {}) {
  const polys = toPolygons(geojson);
  boundaryGeoJSON = polys.length ? geojson : null;
  polygons = polys;
  boundaryLayer.clearLayers();
  if (boundaryGeoJSON) boundaryLayer.addData(boundaryGeoJSON);
  if (persist) {
    if (boundaryGeoJSON) writeJSON(STORE_BOUNDARY, boundaryGeoJSON);
    else localStorage.removeItem(STORE_BOUNDARY);
  }
  updateBoundaryInfo();
  if (lastFix) evaluate(lastFix);
}

function updateBoundaryInfo() {
  const n = polygons.reduce((s, p) => s + p[0].length - 1, 0);
  $('boundaryInfo').textContent = polygons.length
    ? `Gräns inläst: ${polygons.length} område(n), ${n} hörnpunkter.`
    : 'Ingen gräns inläst ännu. Rita in den eller importera en fil.';
}

async function loadInitialBoundary() {
  const stored = readJSON(STORE_BOUNDARY, null);
  if (stored) return setBoundary(stored, { persist: false });
  try {
    const res = await fetch('data/boundary.geojson', { cache: 'no-cache' });
    if (res.ok) setBoundary(await res.json(), { persist: false });
  } catch (_) { /* ingen standardgräns */ }
  if (!polygons.length) {
    updateBoundaryInfo();
    setTimeout(() => toast('Ingen fiskegräns inläst. Öppna ✏️ för att rita eller importera den.', 4500), 600);
  }
}

// ---------- position & zon ----------
function evaluate(fix) {
  const { latitude: lat, longitude: lng, accuracy } = fix.coords;
  posMarker.setLatLng([lat, lng]);
  accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
  if (!map.hasLayer(posMarker)) { accuracyCircle.addTo(map); posMarker.addTo(map); }
  if (follow) map.panTo([lat, lng], { animate: true });

  if (!polygons.length) {
    setZone('unknown', 'Ingen gräns inläst', `GPS ±${Math.round(accuracy)} m`);
    return;
  }
  const loc = locate(lat, lng, polygons);
  const next = zoneFor(loc, {
    warnDistance: settings.warnDistance,
    accuracy,
    useAccuracy: settings.useAccuracy,
    previous: zone,
  });
  const dist = Math.round(loc.distance);
  const detail = next === 'outside' ? `${dist} m till gränsen` : `${dist} m kvar till gränsen`;
  setZone(next, detail, `GPS ±${Math.round(accuracy)} m`);
}

function setZone(next, detail, gps) {
  const prev = zone;
  zone = next;
  for (const el of [$('frame'), $('pocket')]) {
    el.classList.remove('zone-inside', 'zone-near', 'zone-outside', 'zone-unknown');
    el.classList.add(`zone-${next}`);
  }
  $('zoneLabel').textContent = ZONE_TEXT[next];
  $('zoneDetail').textContent = `${detail} · ${gps}`;
  $('pocketZone').textContent = ZONE_TEXT[next];
  $('pocketDetail').textContent = detail;
  if (watchId !== null) soundForZone(prev, next);
}

function soundForZone(prev, next) {
  const now = Date.now();
  if (next === 'near' && settings.nearEnabled) {
    if (prev !== 'near' || now - lastNearAlarm >= settings.nearRepeat * 1000) {
      lastNearAlarm = now;
      play(settings.nearSound, settings.nearVolume);
      vibrate([300, 150, 300]);
    }
  } else if (next === 'outside' && settings.outsideEnabled) {
    if (prev !== 'outside' || now - lastOutsideAlarm >= settings.outsideRepeat * 1000) {
      lastOutsideAlarm = now;
      play(settings.outsideSound, settings.outsideVolume);
      vibrate(80);
    }
  } else if (next !== 'outside' && prev === 'outside' && settings.enterEnabled) {
    play(settings.enterSound, settings.enterVolume);
  }
}

// GPS:en levererar bara nya positioner när den rör sig mycket; upprepa
// larmen med en timer så att de fortsätter även när man står still.
setInterval(() => {
  if (watchId === null) return;
  if (zone === 'near' || zone === 'outside') soundForZone(zone, zone);
  if (lastFix && Date.now() - lastFix.timestamp > 30000) {
    $('zoneDetail').textContent = `Ingen ny GPS-position på ${Math.round((Date.now() - lastFix.timestamp) / 1000)} s`;
  }
}, 1000);

async function start() {
  if (!('geolocation' in navigator)) return toast('Platstjänster stöds inte i den här webbläsaren.');
  try { await unlockAudio(); } catch (e) { console.warn(e); }
  watchId = navigator.geolocation.watchPosition(
    (fix) => { lastFix = fix; evaluate(fix); },
    (err) => {
      const msg = err.code === 1 ? 'Platsåtkomst nekad. Tillåt plats för Safari/sidan i Inställningar.' : `GPS-fel: ${err.message}`;
      setZone('unknown', msg, '');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
  );
  $('btnStart').textContent = '■ Stoppa';
  $('btnStart').classList.add('running');
  follow = true;
  requestWakeLock();
  setZone('unknown', 'Väntar på GPS…', '');
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('btnStart').textContent = '▶ Starta';
  $('btnStart').classList.remove('running');
  releaseWakeLock();
  setZone('unknown', 'Bevakning avstängd', '');
  $('zoneLabel').textContent = 'Ej startad';
}

// ---------- skärmlås (wake lock) ----------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {
    console.warn('Wake lock', e);
  }
  renderDiag();
}
function releaseWakeLock() { if (wakeLock) wakeLock.release(); wakeLock = null; }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && watchId !== null) {
    requestWakeLock();
    unlockAudio().catch(() => {});
    if (gpsWatchdog && Date.now() - gpsWatchdog > 5000) {
      toast('Skärmen var släckt – bevakningen kan ha pausats. Använd fickläget så hålls skärmen vaken.', 5000);
    }
  } else if (document.visibilityState === 'hidden') {
    gpsWatchdog = Date.now();
  }
});

// ---------- fickläge ----------
function enterPocket() {
  if (watchId === null) start();
  $('pocket').hidden = false;
  requestWakeLock();
}
(function setupPocketUnlock() {
  const btn = $('pocketUnlock');
  let timer = null;
  const begin = (e) => {
    e.preventDefault();
    btn.classList.add('holding');
    timer = setTimeout(() => { $('pocket').hidden = true; btn.classList.remove('holding'); }, 2000);
  };
  const end = () => { clearTimeout(timer); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', begin);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('pointercancel', end);
  // Blockera allt annat i fickläge.
  $('pocket').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
})();

// ---------- inställningar ----------
function fillSelect(el, options, value) {
  el.innerHTML = '';
  for (const [k, label] of Object.entries(options)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = label;
    el.appendChild(o);
  }
  el.value = String(value);
}

function bindSettings() {
  fillSelect($('nearSound'), SOUNDS, settings.nearSound);
  fillSelect($('outsideSound'), SOUNDS, settings.outsideSound);
  fillSelect($('enterSound'), SOUNDS, settings.enterSound);
  fillSelect($('tileSource'), Object.fromEntries(Object.entries(TILE_SOURCES).map(([k, v]) => [k, v.name])), settings.tileSource);
  $('nearRepeat').value = String(settings.nearRepeat);
  $('outsideRepeat').value = String(settings.outsideRepeat);

  const numeric = new Set(['warnDistance', 'nearVolume', 'outsideVolume', 'enterVolume', 'nearRepeat', 'outsideRepeat']);
  for (const key of Object.keys(DEFAULTS)) {
    const el = $(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = settings[key];
    else el.value = String(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : numeric.has(key) ? Number(el.value) : el.value;
      saveSettings();
      if (key === 'warnDistance') $('warnDistanceOut').textContent = settings.warnDistance;
      if (key === 'tileSource') setTileSource(settings.tileSource);
      if (lastFix && key === 'warnDistance') evaluate(lastFix);
    });
  }
  $('warnDistanceOut').textContent = settings.warnDistance;

  document.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
    await unlockAudio();
    const k = b.dataset.test;
    play(settings[`${k}Sound`], settings[`${k}Volume`]);
  }));
  for (const sel of ['nearSound', 'outsideSound', 'enterSound']) {
    $(sel).addEventListener('change', async () => {
      await unlockAudio();
      play(settings[sel], settings[sel.replace('Sound', 'Volume')]);
    });
  }
}

function openSheet(id) {
  document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id; });
  if (id === 'settingsSheet') renderDiag();
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.sheet').hidden = true; }));

async function renderDiag() {
  const lines = [];
  lines.push(`Ljud: ${audioState()}`);
  lines.push(`Skärm hålls vaken: ${wakeLock ? 'ja' : 'wakeLock' in navigator ? 'nej (starta bevakningen)' : 'stöds ej – sätt Autolås till Aldrig'}`);
  lines.push(`Offline-app: ${navigator.serviceWorker?.controller ? 'ja' : 'nej (ladda om sidan en gång)'}`);
  try {
    const c = await caches.open(TILE_CACHE);
    lines.push(`Nedladdade kartbilder: ${(await c.keys()).length}`);
  } catch (_) { /* inget cache-API */ }
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    lines.push(`Lagring: ${(e.usage / 1e6).toFixed(1)} MB`);
  }
  if (lastFix) lines.push(`Senaste position: ${lastFix.coords.latitude.toFixed(5)}, ${lastFix.coords.longitude.toFixed(5)} ±${Math.round(lastFix.coords.accuracy)} m`);
  $('diag').textContent = lines.join('\n');
}

// ---------- nedladdning av karta ----------
async function downloadTiles() {
  const src = TILE_SOURCES[settings.tileSource];
  const area = polygons.length ? padBbox(bbox(polygons), 1000) : padBbox([LAKE.lng, LAKE.lat, LAKE.lng, LAKE.lat], 3000);
  let tiles = [];
  let maxZ = Math.min(src.maxZoom, 17);
  for (;;) {
    tiles = [];
    for (let z = 9; z <= maxZ; z++) tiles.push(...tilesForBbox(area, z));
    if (tiles.length <= MAX_TILES || maxZ <= 12) break;
    maxZ--;
  }
  const cache = await caches.open(TILE_CACHE);
  const status = $('downloadStatus');
  let done = 0;
  let failed = 0;
  const urlFor = ({ z, x, y }) => src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const queue = tiles.slice();
  const worker = async () => {
    while (queue.length) {
      const url = urlFor(queue.shift());
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(res.status);
          await cache.put(url, res);
        }
      } catch (_) { failed++; }
      done++;
      if (done % 10 === 0 || done === tiles.length) status.textContent = `Laddar ner zoom 9–${maxZ}: ${done}/${tiles.length}${failed ? ` (${failed} misslyckades)` : ''}`;
    }
  };
  $('btnDownload').disabled = true;
  await Promise.all(Array.from({ length: 6 }, worker));
  $('btnDownload').disabled = false;
  status.textContent = `Klart: ${tiles.length - failed} kartbilder sparade (zoom 9–${maxZ})${failed ? `, ${failed} misslyckades – försök igen` : ''}.`;
  if (navigator.storage?.persist) navigator.storage.persist();
  renderDiag();
}

// ---------- ritverktyg ----------
const editor = { active: false, points: [], layer: L.layerGroup(), backup: null };

function startEdit() {
  editor.active = true;
  editor.backup = boundaryGeoJSON;
  const first = polygons[0];
  editor.points = first ? first[0].slice(0, -1).map(([lng, lat]) => L.latLng(lat, lng)) : [];
  if (polygons.length > 1) toast('Endast det första området redigeras.');
  boundaryLayer.clearLayers();
  editor.layer.addTo(map);
  $('editBar').hidden = false;
  $('toolbar').hidden = true;
  document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; });
  if (editor.points.length) map.fitBounds(L.latLngBounds(editor.points).pad(0.1));
  renderEditor();
}

function renderEditor() {
  editor.layer.clearLayers();
  const pts = editor.points;
  if (pts.length >= 2) L.polygon(pts, { color: '#0050ff', weight: 3, fillOpacity: 0.1, interactive: false }).addTo(editor.layer);
  pts.forEach((p, i) => {
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vertex-icon', iconSize: [22, 22] }) }).addTo(editor.layer);
    m.on('drag', (e) => { pts[i] = e.target.getLatLng(); });
    m.on('dragend', renderEditor);
    m.on('click', () => { pts.splice(i, 1); renderEditor(); });
  });
  if (pts.length >= 3) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const mid = L.latLng((p.lat + q.lat) / 2, (p.lng + q.lng) / 2);
      L.marker(mid, { icon: L.divIcon({ className: 'mid-icon', iconSize: [14, 14] }) })
        .on('click', () => { pts.splice(i + 1, 0, mid); renderEditor(); })
        .addTo(editor.layer);
    });
  }
}

map.on('click', (e) => {
  if (!editor.active) return;
  editor.points.push(e.latlng);
  renderEditor();
});

function endEdit(save) {
  editor.active = false;
  editor.layer.remove();
  $('editBar').hidden = true;
  $('toolbar').hidden = false;
  if (save) {
    if (editor.points.length < 3) {
      toast('Minst 3 punkter behövs. Gränsen sparades inte.');
      setBoundary(editor.backup, { persist: false });
      return;
    }
    const ring = editor.points.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
    ring.push(ring[0]);
    const others = boundaryGeoJSON && polygons.length > 1
      ? polygons.slice(1).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: p } }))
      : [];
    setBoundary({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Nedre Boksjön – statens vatten' }, geometry: { type: 'Polygon', coordinates: [ring] } }, ...others],
    });
    toast('Gränsen sparad.');
  } else {
    setBoundary(editor.backup, { persist: false });
  }
}

// ---------- import / export ----------
async function importFile(file) {
  const text = await file.text();
  const parser = new DOMParser();
  let gj;
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.kml')) gj = kmlToGeoJSON(text, parser);
    else if (name.endsWith('.gpx')) gj = gpxToGeoJSON(text, parser);
    else gj = JSON.parse(text);
  } catch (e) {
    return toast(`Kunde inte läsa filen: ${e.message}`);
  }
  if (!toPolygons(gj).length) return toast('Hittade ingen polygon i filen.');
  setBoundary(gj);
  map.fitBounds(boundaryLayer.getBounds().pad(0.1));
  toast('Gränsen importerad.');
}

function exportBoundary() {
  if (!boundaryGeoJSON) return toast('Ingen gräns att exportera.');
  const blob = new Blob([JSON.stringify(boundaryGeoJSON, null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'boundary.geojson';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- knappar ----------
$('btnStart').addEventListener('click', () => (watchId === null ? start() : stop()));
$('btnCenter').addEventListener('click', () => {
  follow = true;
  if (lastFix) map.setView([lastFix.coords.latitude, lastFix.coords.longitude], Math.max(map.getZoom(), 15));
  else if (polygons.length) map.fitBounds(boundaryLayer.getBounds().pad(0.1));
  else map.setView([LAKE.lat, LAKE.lng], 14);
});
$('btnPocket').addEventListener('click', enterPocket);
$('btnSettings').addEventListener('click', () => openSheet('settingsSheet'));
$('btnBoundary').addEventListener('click', () => openSheet('boundarySheet'));
$('btnDraw').addEventListener('click', startEdit);
$('editUndo').addEventListener('click', () => { editor.points.pop(); renderEditor(); });
$('editHere').addEventListener('click', () => {
  if (!lastFix) return toast('Ingen GPS-position ännu – tryck Starta först.');
  editor.points.push(L.latLng(lastFix.coords.latitude, lastFix.coords.longitude));
  renderEditor();
});
$('editDone').addEventListener('click', () => endEdit(true));
$('editCancel').addEventListener('click', () => endEdit(false));
$('fileImport').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
$('btnExport').addEventListener('click', exportBoundary);
$('btnDeleteBoundary').addEventListener('click', () => {
  if (confirm('Ta bort den inlästa gränsen?')) setBoundary(null);
});
$('btnDownload').addEventListener('click', () => downloadTiles().catch((e) => toast(`Nedladdning misslyckades: ${e.message}`)));
$('btnClearTiles').addEventListener('click', async () => {
  await caches.delete(TILE_CACHE);
  $('downloadStatus').textContent = 'Nedladdad karta borttagen.';
  renderDiag();
});

// ---------- start ----------
bindSettings();
loadInitialBoundary().then(() => {
  if (polygons.length) map.fitBounds(boundaryLayer.getBounds().pad(0.1));
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
