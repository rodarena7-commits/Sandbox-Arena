const CACHE_NAME = 'sandeco-ball-v2';
const assets = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sandeco.png',
  // Asegúrate de que tu build genera estos archivos
  '/assets/index-*.js',
  '/assets/index-*.css'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Cacheando assets');
      return cache.addAll(assets).catch(err => {
        console.log('Error cacheando algunos assets:', err);
      });
    })
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      return cacheRes || fetch(evt.request).then(fetchRes => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(evt.request.url, fetchRes.clone());
          return fetchRes;
        });
      });
    }).catch(() => {
      // Si falla todo, devolver offline page si existe
      if (evt.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
