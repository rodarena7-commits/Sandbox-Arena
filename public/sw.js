// --- CONFIGURACIÓN DE CACHE DINÁMICA ---
const CACHE_VERSION = 'sandeco-ball-v1.1.0'; // INCREMENTAR ESTA VERSIÓN CON CADA ACTUALIZACIÓN
const DYNAMIC_CACHE = 'sandeco-dynamic-v1.1.0';
const STATIC_CACHE = 'sandeco-static-v1.1.0';

// Archivos esenciales que se cachearán inmediatamente
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sandeco.png'
];

// Archivos que se cachearán bajo demanda
const DYNAMIC_ASSETS = [
  // URLs de Firebase y otros recursos externos que queremos cachear
];

// --- INSTALACIÓN: Cachear archivos estáticos ---
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando versión:', CACHE_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Cachear archivos estáticos
      caches.open(STATIC_CACHE).then(cache => {
        console.log('[SW] Cacheando archivos estáticos');
        return cache.addAll(STATIC_ASSETS);
      }),
      // Limpiar caches antiguos inmediatamente
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.filter(cacheName => {
            // Eliminar todas las caches que NO sean las actuales
            return cacheName !== STATIC_CACHE && 
                   cacheName !== DYNAMIC_CACHE &&
                   cacheName.startsWith('sandeco-');
          }).map(cacheName => {
            console.log('[SW] Eliminando cache antigua:', cacheName);
            return caches.delete(cacheName);
          })
        );
      })
    ]).then(() => {
      console.log('[SW] Instalación completada');
      return self.skipWaiting();
    })
  );
});

// --- ACTIVACIÓN: Limpiar caches antiguas ---
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activando versión:', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          // Eliminar TODAS las caches antiguas (excepto las actuales)
          return cacheName !== STATIC_CACHE && 
                 cacheName !== DYNAMIC_CACHE &&
                 cacheName.startsWith('sandeco-');
        }).map(cacheName => {
          console.log('[SW] Activación: Eliminando cache antigua:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[SW] Activación completada - Caches limpiadas');
      return self.clients.claim();
    })
  );
});

// --- STRATEGIA DE CACHE: Stale-While-Revalidate con versionado ---
self.addEventListener('fetch', (event) => {
  // Solo manejar solicitudes GET
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  
  // EXCEPCIONES: No cachear estas solicitudes
  const noCacheUrls = [
    '/socket.io/', // WebSockets
    'firebaseio.com', // Firebase Realtime Database
    'googleapis.com', // APIs de Google
    'firestore.googleapis.com', // Firestore
    'api.dicebear.com' // Avatares externos
  ];

  // Verificar si la URL debe ser excluida del cache
  const shouldSkipCache = noCacheUrls.some(url => requestUrl.href.includes(url));
  
  if (shouldSkipCache) {
    // Para URLs excluidas, solo fetch sin cache
    event.respondWith(fetch(event.request));
    return;
  }

  // Estrategia: Network First con fallback a Cache para HTML
  if (event.request.mode === 'navigate' || 
      event.request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Si la respuesta es exitosa, actualizar cache
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Si falla la red, buscar en cache
          return caches.match(event.request).then(cachedResponse => {
            return cachedResponse || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Estrategia: Stale-While-Revalidate para otros recursos
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Siempre intentar obtener de red primero
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          // Cachear la nueva respuesta
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(DYNAMIC_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(error => {
          console.log('[SW] Fetch falló:', error);
        });

      // Devolver cache inmediatamente si existe, luego actualizar
      return cachedResponse || fetchPromise;
    })
  );
});

// --- SISTEMA DE ACTUALIZACIÓN AUTOMÁTICA ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          console.log('[SW] Limpiando cache por solicitud:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[SW] Todas las caches limpiadas');
      event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});

// --- CHEQUEO PERIÓDICO DE ACTUALIZACIONES ---
// Esto se ejecuta periódicamente para detectar cambios
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-updates') {
    console.log('[SW] Chequeando actualizaciones...');
    // Podrías implementar lógica para verificar si hay nueva versión
  }
});

// --- MANEJO DE OFFLINE ---
self.addEventListener('offline', () => {
  console.log('[SW] Aplicación sin conexión');
});

self.addEventListener('online', () => {
  console.log('[SW] Aplicación en línea - Sincronizando...');
});
