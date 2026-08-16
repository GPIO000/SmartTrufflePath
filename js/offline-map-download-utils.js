const TILE_MIN_VALID_SIZE = 512;
const TILE_MAX_ATTEMPTS = 3;
const TILE_RETRY_BASE_DELAY_MS = 250;
const TILE_RETRY_MAX_DELAY_MS = 2000;
const TILE_RETRY_JITTER_RATIO = 0.2;
const TILE_PROVIDER_SLOWDOWN_THRESHOLD = 2;
const TILE_PROVIDER_COOLDOWN_THRESHOLD = 6;
const TILE_PROVIDER_COOLDOWN_BASE_MS = 15000;
const TILE_PROVIDER_COOLDOWN_MAX_MS = 120000;
const TILE_ADAPTIVE_BATCH_PAUSE_MAX_MS = 4000;
const TILE_PROVIDER_THROTTLED_STATUSES = [408, 425, 429, 500, 502, 503, 504];

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

function parseRetryAfterMs(rawRetryAfter, nowMs = Date.now()) {
  if (rawRetryAfter === null || rawRetryAfter === undefined) return null;
  const normalized = String(rawRetryAfter).trim();
  if (!normalized) return null;
  const seconds = parseInt(normalized, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const parsedDateMs = Date.parse(normalized);
  if (!Number.isFinite(parsedDateMs)) return null;
  return Math.max(0, parsedDateMs - nowMs);
}

function getRetryAfterMs(response, nowMs = Date.now()) {
  return parseRetryAfterMs(response?.headers?.get?.('retry-after'), nowMs);
}

function isProviderThrottledResponse(response) {
  if (!response) return false;
  return TILE_PROVIDER_THROTTLED_STATUSES.includes(response.status);
}

function buildTileDownloadFailureResult({ response, error } = {}) {
  if (isQuotaExceededError(error)) {
    return { ok: false, reason: 'quota_exceeded' };
  }
  if (response && isProviderThrottledResponse(response)) {
    return {
      ok: false,
      reason: 'provider_throttled',
      status: response.status,
      retryAfterMs: getRetryAfterMs(response)
    };
  }
  return {
    ok: false,
    reason: 'network_or_server',
    status: response?.status
  };
}

function mergeTileDownloadFailureResult(currentFailure, candidateFailure) {
  if (!candidateFailure) return currentFailure;
  if (!currentFailure) return candidateFailure;
  const priority = {
    quota_exceeded: 3,
    provider_throttled: 2,
    network_or_server: 1
  };
  const currentPriority = priority[currentFailure.reason] || 0;
  const candidatePriority = priority[candidateFailure.reason] || 0;
  if (candidatePriority > currentPriority) return candidateFailure;
  if (
    candidatePriority === currentPriority
    && candidateFailure.reason === 'provider_throttled'
    && (candidateFailure.retryAfterMs || 0) > (currentFailure.retryAfterMs || 0)
  ) {
    return candidateFailure;
  }
  return currentFailure;
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
    } else if (result?.reason === 'provider_throttled') {
      summary.providerErrors++;
      summary.throttledErrors++;
      summary.maxRetryAfterMs = Math.max(summary.maxRetryAfterMs, result?.retryAfterMs || 0);
    } else {
      summary.providerErrors++;
      summary.networkErrors++;
    }
    return summary;
  }, {
    errors: 0,
    quotaErrors: 0,
    networkErrors: 0,
    providerErrors: 0,
    throttledErrors: 0,
    maxRetryAfterMs: 0
  });
}

function getAdaptiveBatchPauseMs(consecutiveProviderErrors, {
  baseDelayMs = 0,
  maxDelayMs = TILE_ADAPTIVE_BATCH_PAUSE_MAX_MS,
  jitterMs = 0,
  providerSlowdownThreshold = TILE_PROVIDER_SLOWDOWN_THRESHOLD,
  randomFn = Math.random
} = {}) {
  const normalizedConsecutiveErrors = Math.max(0, Number(consecutiveProviderErrors) || 0);
  const slowdownThreshold = Math.max(1, Number(providerSlowdownThreshold) || TILE_PROVIDER_SLOWDOWN_THRESHOLD);
  const slowdownLevel = Math.floor(normalizedConsecutiveErrors / slowdownThreshold);
  const scaledBaseDelay = Math.min(maxDelayMs, Math.max(0, baseDelayMs) * (2 ** slowdownLevel));
  const safeJitterMs = Math.max(0, Number(jitterMs) || 0);
  if (safeJitterMs === 0 || typeof randomFn !== 'function') {
    return scaledBaseDelay;
  }
  const normalizedRandom = Math.max(0, Math.min(1, Number(randomFn())));
  const jitter = Math.round(safeJitterMs * normalizedRandom);
  return Math.min(maxDelayMs, scaledBaseDelay + jitter);
}

function getProviderCooldownMs(consecutiveProviderErrors, {
  providerCooldownThreshold = TILE_PROVIDER_COOLDOWN_THRESHOLD,
  baseCooldownMs = TILE_PROVIDER_COOLDOWN_BASE_MS,
  maxCooldownMs = TILE_PROVIDER_COOLDOWN_MAX_MS,
  retryAfterMs = 0
} = {}) {
  const normalizedConsecutiveErrors = Math.max(0, Number(consecutiveProviderErrors) || 0);
  const cooldownThreshold = Math.max(1, Number(providerCooldownThreshold) || TILE_PROVIDER_COOLDOWN_THRESHOLD);
  const safeRetryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  let computedCooldownMs = 0;
  if (normalizedConsecutiveErrors >= cooldownThreshold) {
    const cooldownLevel = Math.floor((normalizedConsecutiveErrors - cooldownThreshold) / cooldownThreshold);
    computedCooldownMs = Math.max(0, baseCooldownMs) * (2 ** cooldownLevel);
  }
  return Math.min(maxCooldownMs, Math.max(safeRetryAfterMs, computedCooldownMs));
}

async function downloadTileBatchesWithRecovery(levels = [], {
  cache,
  downloadTileFn = downloadTileWithRetry,
  batchSize = 1,
  quotaErrorsToAbort = Number.POSITIVE_INFINITY,
  initialState = {},
  batchPauseBaseMs = 0,
  batchPauseMaxMs = TILE_ADAPTIVE_BATCH_PAUSE_MAX_MS,
  batchPauseJitterMs = 0,
  providerSlowdownThreshold = TILE_PROVIDER_SLOWDOWN_THRESHOLD,
  providerCooldownThreshold = TILE_PROVIDER_COOLDOWN_THRESHOLD,
  providerCooldownBaseMs = TILE_PROVIDER_COOLDOWN_BASE_MS,
  providerCooldownMaxMs = TILE_PROVIDER_COOLDOWN_MAX_MS,
  randomFn = Math.random,
  sleepImpl = globalThis.setTimeout,
  onBatchComplete,
  downloadOptions = {}
} = {}) {
  const safeLevels = Array.isArray(levels) ? levels : [];
  const state = {
    consecutiveProviderErrors: Math.max(0, Number(initialState?.consecutiveProviderErrors) || 0),
    consecutiveThrottledErrors: Math.max(0, Number(initialState?.consecutiveThrottledErrors) || 0)
  };
  const totals = {
    done: 0,
    errors: 0,
    quotaErrors: 0,
    networkErrors: 0,
    providerErrors: 0,
    throttledErrors: 0,
    pausedForProvider: false,
    abortedByQuota: false,
    cooldownMs: 0,
    state
  };

  for (let levelIndex = 0; levelIndex < safeLevels.length; levelIndex++) {
    const level = safeLevels[levelIndex];
    const sourceUrls = Array.isArray(level?.missingUrls) ? level.missingUrls : Array.isArray(level?.urls) ? level.urls : [];
    for (let batchIndex = 0; batchIndex < sourceUrls.length; batchIndex += batchSize) {
      const batch = sourceUrls.slice(batchIndex, batchIndex + batchSize);
      const results = await Promise.all(batch.map((url) => downloadTileFn(cache, url, downloadOptions)));
      const summary = summarizeTileDownloadResults(results);
      const successCount = Math.max(0, batch.length - summary.errors);
      if (summary.providerErrors > 0 && successCount === 0) {
        state.consecutiveProviderErrors += summary.providerErrors;
      } else if (successCount > 0 || summary.providerErrors === 0) {
        state.consecutiveProviderErrors = 0;
      }
      if (summary.throttledErrors > 0 && successCount === 0) {
        state.consecutiveThrottledErrors += summary.throttledErrors;
      } else if (successCount > 0 || summary.throttledErrors === 0) {
        state.consecutiveThrottledErrors = 0;
      }

      totals.done += batch.length;
      totals.errors += summary.errors;
      totals.quotaErrors += summary.quotaErrors;
      totals.networkErrors += summary.networkErrors;
      totals.providerErrors += summary.providerErrors;
      totals.throttledErrors += summary.throttledErrors;

      const adaptivePauseMs = getAdaptiveBatchPauseMs(state.consecutiveProviderErrors, {
        baseDelayMs: batchPauseBaseMs,
        maxDelayMs: batchPauseMaxMs,
        jitterMs: batchPauseJitterMs,
        providerSlowdownThreshold,
        randomFn
      });
      const cooldownMs = getProviderCooldownMs(state.consecutiveThrottledErrors, {
        providerCooldownThreshold,
        baseCooldownMs: providerCooldownBaseMs,
        maxCooldownMs: providerCooldownMaxMs,
        retryAfterMs: summary.maxRetryAfterMs
      });
      const hasMoreWork = batchIndex + batchSize < sourceUrls.length || levelIndex < safeLevels.length - 1;

      if (typeof onBatchComplete === 'function') {
        await onBatchComplete({
          batch,
          results,
          summary,
          level,
          levelIndex,
          batchIndex,
          successCount,
          adaptivePauseMs,
          cooldownMs,
          totals: { ...totals },
          state: { ...state }
        });
      }

      if (totals.quotaErrors >= quotaErrorsToAbort) {
        totals.abortedByQuota = true;
        totals.cooldownMs = 0;
        return totals;
      }

      if (cooldownMs > 0 && hasMoreWork) {
        totals.pausedForProvider = true;
        totals.cooldownMs = cooldownMs;
        return totals;
      }

      if (hasMoreWork) {
        await sleep(adaptivePauseMs, sleepImpl);
      }
    }
  }

  return totals;
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
  let lastFailure = null;
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
        lastFailure = mergeTileDownloadFailureResult(lastFailure, buildTileDownloadFailureResult({ response }));
        response?.body?.cancel?.();
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        return { ok: false, reason: 'quota_exceeded' };
      }
      lastFailure = mergeTileDownloadFailureResult(lastFailure, buildTileDownloadFailureResult({ error }));
      if (shouldTryNoCorsFallback) {
        try {
          const noCorsResponse = await fetchImpl(url, { mode: 'no-cors', cache: 'no-store' });
          if (isValidDownloadedTileResponse(noCorsResponse, minValidSize, { allowOpaque: true })) {
            await cache.put(url, noCorsResponse.clone());
            stored = true;
          } else {
            lastFailure = mergeTileDownloadFailureResult(lastFailure, buildTileDownloadFailureResult({ response: noCorsResponse }));
            noCorsResponse?.body?.cancel?.();
          }
        } catch (fallbackError) {
          if (isQuotaExceededError(fallbackError)) {
            return { ok: false, reason: 'quota_exceeded' };
          }
          lastFailure = mergeTileDownloadFailureResult(lastFailure, buildTileDownloadFailureResult({ error: fallbackError }));
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
  return lastFailure || { ok: false, reason: 'network_or_server' };
}

export {
  TILE_ADAPTIVE_BATCH_PAUSE_MAX_MS,
  TILE_MAX_ATTEMPTS,
  TILE_MIN_VALID_SIZE,
  TILE_PROVIDER_COOLDOWN_BASE_MS,
  TILE_PROVIDER_COOLDOWN_MAX_MS,
  TILE_PROVIDER_COOLDOWN_THRESHOLD,
  TILE_PROVIDER_SLOWDOWN_THRESHOLD,
  buildTileDownloadFailureResult,
  downloadTileBatchesWithRecovery,
  downloadTileWithRetry,
  getAdaptiveBatchPauseMs,
  getProviderCooldownMs,
  getRetryAfterMs,
  isOpaqueTileResponse,
  isOpenStreetMapTileUrl,
  isProviderThrottledResponse,
  isQuotaExceededError,
  isValidCachedTileResponse,
  isValidTileResponse,
  isValidDownloadedTileResponse,
  summarizeTileDownloadResults
};
