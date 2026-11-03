// Temporary retirement worker at BrewLite's original URL. Existing registrations
// discover it through browser update checks; the website never registers it.
// No fetch handler, precaching, client navigation, reload, or storage reset.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  if (self.registration.scope !== new URL('/', self.location.origin).href) return;
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.allSettled(keys.filter((key) => key.startsWith('brewlite-pwa-'))
        .map((key) => caches.delete(key)));
    } catch {
      // Cache access may be denied; retirement should still finish.
    }
    try {
      // Release old controlled tabs without navigating them.
      await self.clients.claim();
    } finally {
      await self.registration.unregister();
    }
  })());
});
