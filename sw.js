const CACHE_NAME = 'sandeco-ball-v1';
const assets = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sandeco.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    fetch(evt.request).catch(() => {
      return caches.match(evt.request);
    })
  );
});

