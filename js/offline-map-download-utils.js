const TILE_MIN_VALID_SIZE = 512;
const TILE_MAX_ATTEMPTS = 3;
const TILE_RETRY_BASE_DELAY_MS = 250;
const TILE_RETRY_MAX_DELAY_MS = 2000;
const TILE_RETRY_JITTER_RATIO = 0.2;

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
  // In some environments/providers CORS fetches can fail while tile downloads
  // still succeed with no-cors (opaque responses). Keep opaque cached tiles as
  // valid so offline coverage can progress instead of staying stuck at 0%.
  if (isOpaqueTileResponse(response)) return true;
  return isValidTileResponse(response, minValidSize);
}

function isValidDownloadedTileResponse(response, minValidSize = TILE_MIN_VALID_SIZE, { allowOpaque = false } = {}) {
  if (!response) return false;
  if (isOpaqueTileResponse(response)) return allowOpaque;
  if (!response.ok) return false;
  if (!isImageTileResponse(response)) return false;
  return hasValidTileLengthHeader(response, minValidSize);
}

function sleep(ms, sleepImpl = globalThis.setTimeout) {
  if (!Number.isFinite(ms) || ms <= 0 || typeof sleepImpl !== 'function') return Promise.resolve();
  return new Promise((resolve) => sleepImpl(resolve, ms));
}

function getRetryDelay(attempt, baseRetryDelayMs, maxRetryDelayMs, {
  retryJitterRatio = TILE_RETRY_JITTER_RATIO,
  randomFn = Math.random
} = {}) {
  const baseDelay = Math.min(maxRetryDelayMs, baseRetryDelayMs * (2 ** attempt));
  if (!Number.isFinite(retryJitterRatio) || retryJitterRatio <= 0 || typeof randomFn !== 'function') {
    return baseDelay;
  }
  const normalizedRandom = Math.max(0, Math.min(1, Number(randomFn())));
  const jitter = Math.round(baseDelay * retryJitterRatio * normalizedRandom);
  return Math.min(maxRetryDelayMs, baseDelay + jitter);
}

async function applyRetryDelayIfNeeded(attempt, resolvedMaxAttempts, {
  baseRetryDelayMs,
  maxRetryDelayMs,
  sleepImpl,
  retryJitterRatio,
  randomFn
}) {
  if (attempt >= resolvedMaxAttempts - 1) return;
  const delayMs = getRetryDelay(attempt, baseRetryDelayMs, maxRetryDelayMs, { retryJitterRatio, randomFn });
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
  retryJitterRatio = TILE_RETRY_JITTER_RATIO,
  randomFn = Math.random,
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
  const shouldTryNoCorsFallback = fetchMode === undefined && isOpenStreetMapTileUrl(url);

  for (let attempt = 0; attempt < resolvedMaxAttempts; attempt++) {
    let stored = false;
    const primaryMode = fetchMode ?? 'cors';
    try {
      const response = await fetchImpl(url, { mode: primaryMode, cache: 'no-store' });
      if (isValidDownloadedTileResponse(response, minValidSize, { allowOpaque: false })) {
        await cache.put(url, response.clone());
        stored = true;
      } else {
        response?.body?.cancel?.();
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        return { ok: false, reason: 'quota_exceeded' };
      }
      if (shouldTryNoCorsFallback) {
        try {
          const noCorsResponse = await fetchImpl(url, { mode: 'no-cors', cache: 'no-store' });
          if (isValidDownloadedTileResponse(noCorsResponse, minValidSize, { allowOpaque: true })) {
            await cache.put(url, noCorsResponse.clone());
            stored = true;
          } else {
            noCorsResponse?.body?.cancel?.();
          }
        } catch (fallbackError) {
          if (isQuotaExceededError(fallbackError)) {
            return { ok: false, reason: 'quota_exceeded' };
          }
        }
      }
    }
    if (stored) return { ok: true };
    await applyRetryDelayIfNeeded(
      attempt,
      resolvedMaxAttempts,
      {
        baseRetryDelayMs,
        maxRetryDelayMs,
        sleepImpl,
        retryJitterRatio,
        randomFn
      }
    );
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
