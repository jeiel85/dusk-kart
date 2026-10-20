// Service worker for Dusk Kart PWA: precaches the app shell and hashed build
// chunks so the game installs and launches offline, while keeping navigation
// network-first so new deployments take effect on the next online launch.
const CACHE_NAME = 'dusk-kart-__SW_VERSION__';
const PRECACHE = /* __SW_PRECACHE__ */ [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dusk-kart-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  // Let the Vite dev server handle raw source and HMR requests directly.
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/__') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', res.clone());
        }
        return res;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, res.clone());
      }
      return res;
    } catch {
      return Response.error();
    }
  })());
});
