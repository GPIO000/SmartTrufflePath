// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-12';
const ASSETS = [
  '/SmartTrufflePath/',
  '/SmartTrufflePath/index.html',
  '/SmartTrufflePath/manifest.json',
  '/SmartTrufflePath/icon-192.png',
  '/SmartTrufflePath/icon-512.png',
  '/SmartTrufflePath/css/style.css',
  '/SmartTrufflePath/js/app.js',
  '/SmartTrufflePath/js/install-utils.js',
  '/SmartTrufflePath/js/backup-utils.js',
  '/SmartTrufflePath/js/fiscal-utils.js',
  '/SmartTrufflePath/js/storage-sync.js'
];

function serviceUnavailableResponse() {
  return new Response('Service Unavailable', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// Installazione Service Worker e salvataggio in cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  // Forza l'attivazione immediata del nuovo service worker
  self.skipWaiting();
});

// Attivazione e pulizia delle vecchie cache
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminazione vecchia cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Prende il controllo immediato delle pagine aperte
  self.clients.claim();
});

// Intercettazione richieste con strategia Cache-First e fallback di rete
self.addEventListener('fetch', (e) => {
  // Ignora richieste non GET
  if (e.request.method !== 'GET') return;

  // Gestione speciale per le tile delle mappe (OpenStreetMap) o risorse esterne dinamiche
  if (e.request.url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => {
          return serviceUnavailableResponse();
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
          }).catch(() => {});
        }
        return networkResponse;
      }).catch(() => {
        // Fallback di sicurezza offline per pagine HTML
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
        return caches.match('/SmartTrufflePath/index.html').then((offlinePage) => {
            return offlinePage || serviceUnavailableResponse();
        });
        }
        return serviceUnavailableResponse();
      });
    })
  );
});
