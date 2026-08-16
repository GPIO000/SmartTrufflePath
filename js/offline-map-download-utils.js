const TILE_MIN_VALID_SIZE = 512;
const TILE_MAX_ATTEMPTS = 3;

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

function isValidTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  if (!response) return false;
  if (isOpaqueTileResponse(response)) return true;
  if (!response.ok) return false;
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  return contentLength >= minValidSize;
}

function isValidCachedTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  // Opaque responses cannot be validated; treat them as invalid so the cache
  // cleanup removes them and the auto-redownload replaces them with proper CORS responses.
  if (isOpaqueTileResponse(response)) return false;
  return isValidTileResponse(response, minValidSize);
}

function isValidDownloadedTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  if (!response) return false;
  // Opaque responses (from no-cors requests) cannot have their status or body
  // validated; they must not be accepted as valid downloads.
  if (isOpaqueTileResponse(response)) return false;
  if (!response.ok) return false;
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  return contentLength >= minValidSize;
}

function summarizeTileDownloadResults(results = []) {
  return results.reduce((summary, result) => {
    if (result?.ok) return summary;
    summary.errors++;
    if (result?.reason === 'quota_exceeded') {
      summary.quotaErrors++;
    } else {
      summary.networkErrors++;
    }
    return summary;
  }, {
    errors: 0,
    quotaErrors: 0,
    networkErrors: 0
  });
}

async function downloadTileWithRetry(cache, url, {
  fetchImpl = globalThis.fetch,
  fetchMode,
  maxAttempts = TILE_MAX_ATTEMPTS,
  maxRetries,
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
    // If match() or delete() are unavailable, continue with a network attempt.
  }

  // `maxRetries` is the legacy option name and takes precedence when provided.
  const resolvedMaxAttempts = Number.isInteger(maxRetries) && maxRetries >= 0
    ? maxRetries + 1
    : maxAttempts;

  for (let attempt = 0; attempt < resolvedMaxAttempts; attempt++) {
    try {
      const resolvedFetchMode = fetchMode ?? 'cors';
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
  TILE_MAX_ATTEMPTS,
  TILE_MIN_VALID_SIZE,
  downloadTileWithRetry,
  isOpaqueTileResponse,
  isOpenStreetMapTileUrl,
  isQuotaExceededError,
  isValidCachedTileResponse,
  isValidTileResponse,
  isValidDownloadedTileResponse,
  summarizeTileDownloadResults
};
