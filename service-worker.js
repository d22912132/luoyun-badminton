const VERSION = '__LUOYUN_VERSION__';
const CACHE_PREFIX = 'luoyun-offline-';
const CACHE = CACHE_PREFIX + VERSION;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([
    '/offline.html', '/icons/app-192.png', '/icons/app-512.png', '/icons/app-maskable-512.png'
  ])));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method === 'GET' && url.origin === self.location.origin &&
      ['/icons/app-192.png', '/icons/app-512.png', '/icons/app-maskable-512.png'].includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(event.request)));
    return;
  }
  // 名單、帳號與所有寫入請求都走網路，不進入離線快取。
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' ||
      url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match('/offline.html')) || Response.error();
  }));
});
