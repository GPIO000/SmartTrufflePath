const CACHE_NAME = 'truffle-mobil-frist-v7';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
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
  // Ignora richieste non GET (es. estensioni, chrome-extension, ecc.)
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Opzionale: puoi aggiungere qui una logica per mettere in cache 
        // le nuove risorse dinamiche se necessario.
        return networkResponse;
      }).catch(() => {
        // Fallback di sicurezza offline (es. se richiami una pagina html offline)
        if (e.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
