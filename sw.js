// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-16';
const MAP_OFFLINE_CACHE_NAME = 'smarttruffle-map-offline';
let legacyAppCacheNames = null;
let legacyAppCacheNamesPromise = null;
const LOCAL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/storage-sync.js',
  './js/fiscal-utils.js',
  './js/backup-utils.js',
  './js/offline-cache-utils.js',
  './js/offline-map-download-utils.js',
];
const REMOTE_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
];

async function warmRemoteAssets(cache) {
  await Promise.allSettled(
    REMOTE_ASSETS.map(async (url) => {
      const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (response.ok) {
        await cache.put(url, response.clone());
      }
    })
  );
}

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

function getLegacyAppCacheNamesFromKeys(keys) {
  return keys.filter((key) => key.startsWith('smarttruffle-path-') && key !== CACHE_NAME);
}

async function loadLegacyAppCacheNames() {
  if (Array.isArray(legacyAppCacheNames)) return legacyAppCacheNames;
  if (!legacyAppCacheNamesPromise) {
    legacyAppCacheNamesPromise = caches.keys().then((keys) => getLegacyAppCacheNamesFromKeys(keys));
  }
  const names = await legacyAppCacheNamesPromise;
  legacyAppCacheNames = names;
  legacyAppCacheNamesPromise = null;
  return names;
}

async function migrateLegacyOsmTilesToOfflineCache() {
  const legacyAppCaches = await loadLegacyAppCacheNames();
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

async function getLegacyOsmTileResponse(request) {
  const legacyAppCaches = await loadLegacyAppCacheNames();
  for (const cacheName of legacyAppCaches) {
    const legacyCache = await caches.open(cacheName);
    const cachedResponse = await legacyCache.match(request);
    if (cachedResponse) return cachedResponse;
  }
  return null;
}

// Installazione Service Worker e salvataggio in cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);
      await warmRemoteAssets(cache);
      await self.skipWaiting();
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
        ).then(() => {
          legacyAppCacheNames = [];
          legacyAppCacheNamesPromise = null;
        });
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

          const legacyResponse = await getLegacyOsmTileResponse(e.request);
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
