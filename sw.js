const CACHE_NAME = 'sandeco-ball-v1';
const assets = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sandeco.png'
];

// Instalación y cacheo de archivos críticos
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

// Estrategia de respuesta: Primero red, luego caché (para asegurar ranking actualizado)
self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    fetch(evt.request).catch(() => {
      return caches.match(evt.request);
    })
  );
});

