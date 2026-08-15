// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-15';
const MAP_OFFLINE_CACHE_NAME = 'smarttruffle-map-offline';
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

function isOsmTileRequestUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'tile.openstreetmap.org' || /^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function migrateLegacyOsmTilesToOfflineCache() {
  const keys = await caches.keys();
  const legacyAppCaches = keys.filter((key) => key.startsWith('smarttruffle-path-'));
  if (!legacyAppCaches.length) return;

  const offlineCache = await caches.open(MAP_OFFLINE_CACHE_NAME);
  await Promise.all(legacyAppCaches.map(async (cacheName) => {
    const legacyCache = await caches.open(cacheName);
    const requests = await legacyCache.keys();
    await Promise.all(requests.map(async (request) => {
      if (!isOsmTileRequestUrl(request.url)) return;
      const existing = await offlineCache.match(request);
      if (existing) return;
      const response = await legacyCache.match(request);
      if (response) {
        await offlineCache.put(request, response.clone());
      }
    }));
  }));
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
    migrateLegacyOsmTilesToOfflineCache().then(() =>
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== MAP_OFFLINE_CACHE_NAME) {
              console.log('[Service Worker] Eliminazione vecchia cache:', key);
              return caches.delete(key);
            }
          })
        );
      })
    )
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
      (async () => {
        try {
          const offlineCache = await caches.open(MAP_OFFLINE_CACHE_NAME);
          const offlineResponse = await offlineCache.match(e.request);
          if (offlineResponse) return offlineResponse;

          const appCache = await caches.open(CACHE_NAME);
          const legacyResponse = await appCache.match(e.request);
          if (legacyResponse) {
            offlineCache.put(e.request, legacyResponse.clone()).catch(() => {});
            return legacyResponse;
          }

          const networkResponse = await fetch(e.request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            offlineCache.put(e.request, networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        } catch {
          return serviceUnavailableResponse();
        }
      })()
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
