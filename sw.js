// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'truffle-mobile-first-' + '2026-08-08';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './css/style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

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
          // Ritorna una Response vuota con status 503 invece di undefined
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
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
        // Fallback di sicurezza offline per pagine HTML
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
