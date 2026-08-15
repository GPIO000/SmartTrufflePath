const TILE_MIN_VALID_SIZE = 512;
const TILE_MAX_RETRIES = 2;

function isOpenStreetMapTileUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'tile.openstreetmap.org'
      || /^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isQuotaExceededError(error) {
  if (!error) return false;
  return error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014;
}

function isOpaqueTileResponse(response) {
  return response?.type === 'opaque';
}

function isValidCachedTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  if (!response) return false;
  if (isOpaqueTileResponse(response)) return true;
  if (!response.ok) return false;
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  return contentLength >= minValidSize;
}

function isValidDownloadedTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  if (!response) return false;
  if (isOpaqueTileResponse(response)) return true;
  if (!response.ok) return false;
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  return contentLength >= minValidSize;
}

async function downloadTileWithRetry(cache, url, {
  fetchImpl = globalThis.fetch,
  fetchMode,
  maxRetries = TILE_MAX_RETRIES,
  minValidSize = TILE_MIN_VALID_SIZE
} = {}) {
  try {
    const cached = await cache.match(url);
    if (isValidCachedTileResponse(cached, minValidSize)) {
      return { ok: true };
    }
    if (cached) {
      await cache.delete(url).catch(() => {});
    }
  } catch {
    // match() o delete() non disponibili: procedi comunque con il download
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resolvedFetchMode = fetchMode ?? (isOpenStreetMapTileUrl(url) ? 'no-cors' : 'cors');
      const response = await fetchImpl(url, { mode: resolvedFetchMode, cache: 'no-store' });
      if (!isValidDownloadedTileResponse(response, minValidSize)) {
        response?.body?.cancel?.();
        continue;
      }
      await cache.put(url, response.clone());
      return { ok: true };
    } catch (error) {
      if (isQuotaExceededError(error)) {
        return { ok: false, reason: 'quota_exceeded' };
      }
    }
  }
  return { ok: false, reason: 'network_or_server' };
}

export {
  TILE_MAX_RETRIES,
  TILE_MIN_VALID_SIZE,
  downloadTileWithRetry,
  isOpaqueTileResponse,
  isOpenStreetMapTileUrl,
  isQuotaExceededError,
  isValidCachedTileResponse,
  isValidDownloadedTileResponse
};
