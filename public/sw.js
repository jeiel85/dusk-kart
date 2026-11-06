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
    // ./assets/ 밖의 파일(페이지·manifest·아이콘)은 주소에 해시가 없어 내용이 바뀌어도 주소가 같다. 그냥 받으면
    // HTTP 캐시(Pages 10분)에 남은 옛 파일이 새 캐시에 들어가 캐시 우선으로 나간다(manifest id를 고쳐도 Chrome이
    // 옛 id를 보던 문제). 그래서 설치 때 HTTP 캐시를 건너뛰고 새로 받는다. 해시가 붙은 ./assets/는 그대로 받는다.
    const request = (url) => (url.startsWith('./assets/') ? url : new Request(url, { cache: 'reload' }));
    await Promise.allSettled(PRECACHE.map((url) => cache.add(request(url))));
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
