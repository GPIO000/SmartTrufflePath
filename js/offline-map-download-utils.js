const TILE_MIN_VALID_SIZE = 512;
const TILE_MAX_ATTEMPTS = 3;
const TILE_RETRY_BASE_DELAY_MS = 250;
const TILE_RETRY_MAX_DELAY_MS = 2000;

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

function isImageTileResponse(response) {
  const contentType = (response?.headers?.get?.('content-type') || '').toLowerCase();
  return contentType.startsWith('image/');
}

function hasValidTileLengthHeader(response, minValidSize = TILE_MIN_VALID_SIZE) {
  const raw = response?.headers?.get?.('content-length');
  if (!raw) return true;
  const contentLength = parseInt(raw, 10);
  if (!Number.isFinite(contentLength)) return true;
  return contentLength >= minValidSize;
}

function isValidTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE) {
  if (!response) return false;
  if (isOpaqueTileResponse(response)) return true;
  if (!response.ok) return false;
  if (!isImageTileResponse(response)) return false;
  return hasValidTileLengthHeader(response, minValidSize);
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
  if (!isImageTileResponse(response)) return false;
  return hasValidTileLengthHeader(response, minValidSize);
}

function sleep(ms, sleepImpl = globalThis.setTimeout) {
  if (!Number.isFinite(ms) || ms <= 0 || typeof sleepImpl !== 'function') return Promise.resolve();
  return new Promise((resolve) => sleepImpl(resolve, ms));
}

function getRetryDelay(attempt, baseRetryDelayMs, maxRetryDelayMs) {
  return Math.min(maxRetryDelayMs, baseRetryDelayMs * (2 ** attempt));
}

async function applyRetryDelayIfNeeded(attempt, resolvedMaxAttempts, baseRetryDelayMs, maxRetryDelayMs, sleepImpl) {
  if (attempt >= resolvedMaxAttempts - 1) return;
  const delayMs = getRetryDelay(attempt, baseRetryDelayMs, maxRetryDelayMs);
  await sleep(delayMs, sleepImpl);
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
  minValidSize = TILE_MIN_VALID_SIZE,
  baseRetryDelayMs = TILE_RETRY_BASE_DELAY_MS,
  maxRetryDelayMs = TILE_RETRY_MAX_DELAY_MS,
  sleepImpl = globalThis.setTimeout
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
        await applyRetryDelayIfNeeded(attempt, resolvedMaxAttempts, baseRetryDelayMs, maxRetryDelayMs, sleepImpl);
        continue;
      }
      await cache.put(url, response.clone());
      return { ok: true };
    } catch (error) {
      if (isQuotaExceededError(error)) {
        return { ok: false, reason: 'quota_exceeded' };
      }
      await applyRetryDelayIfNeeded(attempt, resolvedMaxAttempts, baseRetryDelayMs, maxRetryDelayMs, sleepImpl);
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
