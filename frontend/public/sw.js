const CACHE_PREFIX = 'brewlite-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}v1.0.2`;
const STATIC_ASSETS = [
  '/offline.html', '/manifest.webmanifest', '/favicon.ico',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(STATIC_ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // API data and mutations must never be cached or automatically retried.
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match('/offline.html') || Response.error();
    }));
    return;
  }

  if (['image', 'style', 'script', 'font'].includes(request.destination)) {
    const cachePromise = caches.open(CACHE_NAME);
    const cached = cachePromise.then((cache) => cache.match(request)).catch(() => undefined);
    // One request serves both the browser and the background cache refresh.
    const network = fetch(request);
    const update = network.then(async (response) => {
      if (response.ok) {
        const copy = response.clone();
        const cache = await cachePromise;
        await cache.put(request, copy);
      }
    });
    event.waitUntil(update.catch(() => {}));
    event.respondWith(cached.then((response) => response || network));
  }
  // Next RSC/prefetch requests stay network-only, never return HTML for them.
});
