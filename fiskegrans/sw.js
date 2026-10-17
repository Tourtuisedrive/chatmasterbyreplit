// Service worker: gör appen och nedladdade kartbilder tillgängliga offline.
const APP_CACHE = 'fiskegrans-app-v1';
const TILE_CACHE = 'fiskegrans-tiles-v1';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/geo.js',
  'js/alarm.js',
  'data/boundary.geojson',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/images/layers.png',
];
const TILE_HOSTS = ['tile.openstreetmap.org', 'a.tile.opentopomap.org', 'server.arcgisonline.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Kartbilder: cache först, annars nätet (och spara det vi hämtar).
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request.url);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          if (res.ok || res.type === 'opaque') cache.put(e.request.url, res.clone());
          return res;
        } catch (_) {
          return new Response('', { status: 504 });
        }
      }),
    );
    return;
  }

  // Appens egna filer: nätet först (så uppdateringar slår igenom), cache som reserv.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(APP_CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
  }
});
