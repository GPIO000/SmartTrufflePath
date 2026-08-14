// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-14d';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/backup-utils.js',
  './js/storage-sync.js',
  './js/fiscal-utils.js',
  './vendor/leaflet/dist/leaflet.css',
  './vendor/leaflet/dist/leaflet.js',
  './vendor/leaflet/dist/images/layers.png',
  './vendor/leaflet/dist/images/layers-2x.png',
  './vendor/leaflet/dist/images/marker-icon.png',
  './vendor/leaflet/dist/images/marker-icon-2x.png',
  './vendor/leaflet/dist/images/marker-shadow.png',
  './vendor/html2pdf/html2pdf.bundle.min.js'
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
      return cache.addAll(ASSETS).then(() => self.skipWaiting());
    })
  );
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

  const requestUrl = new URL(e.request.url);

  // Gestione speciale per le tile delle mappe (OpenStreetMap) o risorse esterne dinamiche
  if (requestUrl.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        // Cerca prima nella cache offline dedicata alla mappa, poi nel cache generale
        if (cachedResponse) return cachedResponse;
        return caches.open('smarttruffle-map-offline').then(offlineCache =>
          offlineCache.match(e.request)
        ).then((offlineResponse) => {
          if (offlineResponse) return offlineResponse;
          return fetch(e.request).then((networkResponse) => {
            return caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, networkResponse.clone());
              return networkResponse;
            });
          }).catch(() => {
            return serviceUnavailableResponse();
          });
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
          return caches.match('./index.html').then((offlinePage) => {
            return offlinePage || serviceUnavailableResponse();
          });
        }
        return serviceUnavailableResponse();
      });
    })
  );
});
