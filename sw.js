// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-14';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/storage-sync.js',
  './js/fiscal-utils.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
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
          if (key !== CACHE_NAME && key !== 'smarttruffle-map-offline') {
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
  if (requestUrl.hostname === 'tile.openstreetmap.org' || /^[abc]\.tile\.openstreetmap\.org$/.test(requestUrl.hostname)) {
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
