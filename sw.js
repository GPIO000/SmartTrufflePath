const CACHE_NAME = 'truffle-mobile-first-v19';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './css/style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Installazione Service Worker e salvataggio in cache[span_0](start_span)[span_0](end_span)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  // Forza l'attivazione immediata del nuovo service worker[span_1](start_span)[span_1](end_span)
  self.skipWaiting();
});

// Attivazione e pulizia delle vecchie cache[span_2](start_span)[span_2](end_span)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminazione vecchia cache:', key);[span_3](start_span)[span_3](end_span)
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Prende il controllo immediato delle pagine aperte[span_4](start_span)[span_4](end_span)
  self.clients.claim();
});

// Intercettazione richieste con strategia Cache-First e fallback di rete[span_5](start_span)[span_5](end_span)
self.addEventListener('fetch', (e) => {
  // Ignora richieste non GET[span_6](start_span)[span_6](end_span)
  if (e.request.method !== 'GET') return;

  // Gestione speciale per le tile delle mappe (OpenStreetMap) o risorse esterne dinamiche[span_7](start_span)[span_7](end_span)
  if (e.request.url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => {
          // Fallback silenzioso se manca la mappa offline[span_8](start_span)[span_8](end_span)
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
        return networkResponse;
      }).catch(() => {
        // Fallback di sicurezza offline per pagine HTML[span_9](start_span)[span_9](end_span)
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
