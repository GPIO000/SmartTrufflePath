const CACHE_NAME = 'truffle-mobile-first-v20';
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

  const requestUrl = e.request.url;

  // 1) Runtime caching per i JS/CSS core non inclusi in ASSETS (Network-first)
  if (requestUrl.includes('/js/register-ui-handlers.js') || requestUrl.includes('/js/app.js')) {
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        // Aggiorna la cache con la versione più recente
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
        });
        return networkResponse;
      }).catch(() => {
        // Fallback: prendi dalla cache se la rete non è disponibile
        return caches.match(e.request);
      })
    );
    return;
  }

  // 2) Cache-first per risorse esterne CDN (es. unpkg, cdnjs) con salvataggio on-the-fly
  if (requestUrl.includes('unpkg.com') || requestUrl.includes('cdnjs.cloudflare.com')) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(e.request).then((networkResponse) => {
          // Salva nella cache per usi futuri
          caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(e.request, networkResponse.clone()); } catch (err) { /* some responses are opaque and may fail */ }
          });
          return networkResponse;
        }).catch(() => {
          // Se non disponibile e non in cache, lascia fallire silenziosamente
        });
      })
    );
    return;
  }

  // 3) Gestione speciale per le tile delle mappe (OpenStreetMap) - cache on fetch
  if (requestUrl.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => {
          // Fallback silenzioso se manca la mappa offline
        });
      })
    );
    return;
  }

  // Default: Cache-first per risorse generiche con fallback a index.html per richieste HTML
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
      });
    })
  );
});
