const CACHE = 'eaac-v3', TILES = 'eaac-tiles-v1', MAX_TILES = 4000;
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  '/lib/leaflet.js', '/lib/leaflet.css', '/lib/geotiff.js', '/dem.js', '/hs.js', '/map.js',
  '/lib/images/layers.png', '/lib/images/layers-2x.png'];
const TILE_HOSTS = ['arcgisonline.com', 'openstreetmap.org', 'opentopomap.org'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles() {
  const c = await caches.open(TILES), ks = await c.keys();
  if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES)) await c.delete(k);
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // Tuiles de carte : cache d'abord (la carte déjà consultée reste visible hors ligne)
  if (TILE_HOSTS.some(h => u.hostname.endsWith(h))) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
        return res;
      } catch (err) { return Response.error(); }
    }));
    return;
  }
  if (u.origin !== location.origin) return;
  // Fichiers de l'application : réseau d'abord, cache en secours
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
  }).catch(() => caches.match(req).then(h => h || caches.match('/index.html'))));
});
