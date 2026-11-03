// Retire only BrewLite's former root-scoped /sw.js. Never register a new worker,
// reload a checkout, or touch account/cart/theme/checkout browser storage.
export async function cleanupLegacyPwa(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if ('serviceWorker' in navigator) {
    tasks.push((async () => {
      const script = new URL('/sw.js', window.location.origin).href;
      const scope = new URL('/', window.location.origin).href;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.filter((registration) => {
        const workers = [registration.active, registration.waiting, registration.installing];
        // A different worker being installed on the same scope belongs to its new owner.
        return registration.scope === scope &&
          workers.some((worker) => worker?.scriptURL === script) &&
          workers.every((worker) => !worker || worker.scriptURL === script);
      }).map((registration) => registration.unregister()));
    })());
  }
  if ('caches' in window) {
    tasks.push((async () => {
      const keys = await window.caches.keys();
      await Promise.allSettled(keys.filter((key) => key.startsWith('brewlite-pwa-'))
        .map((key) => window.caches.delete(key)));
    })());
  }
  // Privacy settings can deny either API independently. Retry on the next visit.
  await Promise.allSettled(tasks);
}
