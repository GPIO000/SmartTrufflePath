// Il suffisso di versione viene aggiornato ad ogni modifica del SW per forzare il refresh della cache
const CACHE_NAME = 'smarttruffle-path-' + '2026-08-20b';
const MAP_OFFLINE_CACHE_NAME = 'smarttruffle-map-offline';
let legacyAppCacheNames = null;
let legacyAppCacheNamesPromise = null;
let lastTileNetworkSignalType = '';
let lastTileNetworkSignalAt = 0;

// Asset locali: il precaching blocca l'installazione se uno di questi fallisce.
// I file locali devono sempre essere presenti, quindi è corretto fallire in caso di errore.
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
  './js/sw-utils.js'
];

// Asset CDN esterni: vengono aggiunti alla cache in modalità best-effort.
// Un eventuale fallimento non blocca l'installazione del Service Worker.
const EXTERNAL_ASSETS = [
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

/**
 * Normalizza un URL OSM con sottodominio (a/b/c.tile.openstreetmap.org)
 * nella forma canonica senza sottodominio (tile.openstreetmap.org).
 * Utile per trovare tile in cache indipendentemente dal sottodominio
 * usato da Leaflet al momento della richiesta.
 * Funzione inlined da js/sw-utils.js per evitare l'uso di import ES Module
 * nel Service Worker, garantendo compatibilità massima con tutti i browser.
 *
 * @param {string} url
 * @returns {string}
 */
function canonicalizeOsmTileUrl(url) {
  try {
    const parsed = new URL(url);
    if (/^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname)) {
      parsed.hostname = 'tile.openstreetmap.org';
      return parsed.toString();
    }
  } catch {
    // URL non valida, restituisce invariata
  }
  return url;
}

function isOsmTileRequestUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'tile.openstreetmap.org' || /^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function getCachedAppShellResponse() {
  const candidates = [
    ['./index.html', undefined],
    ['./', undefined],
    ['./index.html', { ignoreSearch: true }],
    ['./', { ignoreSearch: true }]
  ];

  for (const [request, options] of candidates) {
    try {
      const response = await caches.match(request, options);
      if (response) return response;
    } catch {
      // Ignora lookup non supportati dal browser.
    }
  }

  return null;
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
      const canonicalUrl = canonicalizeOsmTileUrl(request.url);
      const canonicalRequest = canonicalUrl !== request.url ? new Request(canonicalUrl) : request;
      const existing = await offlineCache.match(canonicalRequest, { ignoreVary: true });
      if (existing) return;
      const response = await legacyCache.match(request);
      if (response) {
        await offlineCache.put(canonicalRequest, response.clone());
      }
    }));
  }));
}

async function getLegacyOsmTileResponse(request) {
  const legacyAppCaches = await loadLegacyAppCacheNames();
  for (const cacheName of legacyAppCaches) {
    const legacyCache = await caches.open(cacheName);
    const cachedResponse = await legacyCache.match(request, { ignoreVary: true });
    if (cachedResponse) return cachedResponse;
  }
  return null;
}

async function notifyClientsTileNetworkStatus(type) {
  const now = Date.now();
  if (lastTileNetworkSignalType === type && (now - lastTileNetworkSignalAt) < 2000) return;
  lastTileNetworkSignalType = type;
  lastTileNetworkSignalAt = now;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    try {
      client.postMessage({ type });
    } catch {
      // Ignore unreachable clients.
    }
  }
}

// Installazione Service Worker e salvataggio in cache.
// skipWaiting() forza l'attivazione immediata anche se altri tab usano il vecchio SW.
// clients.claim() viene chiamato nell'evento activate per prendere controllo subito
// di tutti i tab aperti, senza attendere un ricaricamento della pagina.
// Gli asset locali vengono aggiunti in modo bloccante (addAll è atomico): se uno fallisce
// l'installazione viene interrotta, il che è corretto perché i file locali devono essere presenti.
// Le CDN esterne vengono aggiunte in modo non-bloccante (best-effort): un eventuale fallimento
// di rete o CDN non impedisce l'installazione del Service Worker.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);
      await Promise.allSettled(EXTERNAL_ASSETS.map((url) => cache.add(url)));
      return self.skipWaiting();
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
    ).then(() => self.clients.claim())
  );
});

// Intercettazione richieste con strategia Cache-First e fallback di rete
self.addEventListener('fetch', (e) => {
  // Ignora richieste non GET
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          return await fetch(e.request);
        } catch {
          const cachedAppShell = await getCachedAppShellResponse();
          return cachedAppShell || serviceUnavailableResponse();
        }
      })()
    );
    return;
  }

  const requestUrl = new URL(e.request.url);

  // Gestione speciale per le tile delle mappe (OpenStreetMap) o risorse esterne dinamiche
  if (requestUrl.hostname === 'tile.openstreetmap.org' || /^[abc]\.tile\.openstreetmap\.org$/.test(requestUrl.hostname)) {
    e.respondWith(
      (async () => {
        try {
          const offlineCache = await caches.open(MAP_OFFLINE_CACHE_NAME);
          const canonicalUrl = canonicalizeOsmTileUrl(e.request.url);
          const cacheRequest = canonicalUrl !== e.request.url ? new Request(canonicalUrl) : e.request;
          const offlineResponse = await offlineCache.match(cacheRequest, { ignoreVary: true });
          if (offlineResponse) return offlineResponse;

          const legacyResponse = await getLegacyOsmTileResponse(e.request);
          if (legacyResponse) {
            offlineCache.put(cacheRequest, legacyResponse.clone()).catch(() => {});
            return legacyResponse;
          }

          // Always fetch with a fresh CORS request so the stored response is a
          // readable (non-opaque) CORS response that can be validated and served
          // correctly from the cache. The original request mode (e.g. no-cors
          // for <img> elements) must not be forwarded to the network fetch.
          const corsRequest = new Request(canonicalUrl, { mode: 'cors', cache: 'no-store' });
          const networkResponse = await fetch(corsRequest);
          if (networkResponse && networkResponse.ok) {
            offlineCache.put(corsRequest, networkResponse.clone()).catch(() => {});
            notifyClientsTileNetworkStatus('tile-network-ok').catch(() => {});
          } else {
            notifyClientsTileNetworkStatus('tile-network-unavailable').catch(() => {});
          }
          if (!networkResponse) return serviceUnavailableResponse();
          return networkResponse;
        } catch {
          notifyClientsTileNetworkStatus('tile-network-unavailable').catch(() => {});
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
