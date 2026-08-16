import { describe, expect, it, vi } from 'vitest';
import {
  buildTileDownloadFailureResult,
  downloadTileBatchesWithRecovery,
  downloadTileWithRetry,
  getAdaptiveBatchPauseMs,
  getProviderCooldownMs,
  isOpaqueTileResponse,
  isOpenStreetMapTileUrl,
  isProviderThrottledResponse,
  isQuotaExceededError,
  isValidCachedTileResponse,
  isValidDownloadedTileResponse,
  summarizeTileDownloadResults
} from '../js/offline-map-download-utils.js';

describe('isQuotaExceededError', () => {
  it('detects the most common quota errors', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError({ code: 1014 })).toBe(true);
    expect(isQuotaExceededError(new Error('generic'))).toBe(false);
  });
});

describe('tile response validation', () => {
  it('recognizes OpenStreetMap tile URLs', () => {
    expect(isOpenStreetMapTileUrl('https://a.tile.openstreetmap.org/8/1/1.png')).toBe(true);
    expect(isOpenStreetMapTileUrl('https://tile.openstreetmap.org/8/1/1.png')).toBe(true);
    expect(isOpenStreetMapTileUrl('https://example.com/8/1/1.png')).toBe(false);
  });

  it('accepts opaque responses in cache and only for explicit download fallback', () => {
    const response = { type: 'opaque', status: 0 };
    expect(isOpaqueTileResponse(response)).toBe(true);
    expect(isValidCachedTileResponse(response)).toBe(true);
    expect(isValidDownloadedTileResponse(response)).toBe(false);
    expect(isValidDownloadedTileResponse(response, 512, { allowOpaque: true })).toBe(true);
  });

  it('rejects cached tiles that are too small', () => {
    const response = {
      type: 'basic',
      status: 200,
      headers: new Headers({ 'content-length': '128' })
    };
    expect(isValidCachedTileResponse(response)).toBe(false);
  });

  it('rejects cached tiles that are not ok even when large', () => {
    const response = {
      type: 'basic',
      status: 503,
      ok: false,
      headers: new Headers({ 'content-length': '2048' })
    };
    expect(isValidCachedTileResponse(response)).toBe(false);
  });

  it('rejects downloads that are too small or not ok', () => {
    const tooSmall = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': '128' })
    };
    const notOk = {
      type: 'cors',
      status: 503,
      ok: false,
      headers: new Headers({ 'content-length': '2048' })
    };
    expect(isValidDownloadedTileResponse(tooSmall)).toBe(false);
    expect(isValidDownloadedTileResponse(notOk)).toBe(false);
  });

  it('accepts image responses without content-length header', () => {
    const response = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' })
    };
    expect(isValidCachedTileResponse(response)).toBe(true);
    expect(isValidDownloadedTileResponse(response)).toBe(true);
  });

  it('rejects non-image responses even if status is ok and large', () => {
    const response = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/html', 'content-length': '2048' })
    };
    expect(isValidCachedTileResponse(response)).toBe(false);
    expect(isValidDownloadedTileResponse(response)).toBe(false);
  });

  it('recognizes provider throttling responses and retry-after headers', () => {
    const throttledResponse = {
      status: 429,
      headers: new Headers({ 'retry-after': '12' })
    };
    expect(isProviderThrottledResponse(throttledResponse)).toBe(true);
    expect(buildTileDownloadFailureResult({ response: throttledResponse })).toEqual({
      ok: false,
      reason: 'provider_throttled',
      status: 429,
      retryAfterMs: 12000
    });
  });

  it('does not treat successful or forbidden responses as provider throttling', () => {
    expect(isProviderThrottledResponse({
      status: 200,
      headers: new Headers({ 'retry-after': '12' })
    })).toBe(false);
    expect(isProviderThrottledResponse({
      status: 403,
      headers: new Headers()
    })).toBe(false);
  });
});

describe('downloadTileWithRetry', () => {
  it('keeps a cached opaque tile as valid coverage', async () => {
    const cache = {
      match: vi.fn().mockResolvedValue({ type: 'opaque', status: 0 }),
      delete: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn();

    const result = await downloadTileWithRetry(cache, 'https://a.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(cache.delete).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('falls back to no-cors when CORS fetch fails on OSM tiles', async () => {
    const opaqueClone = { type: 'opaque', status: 0 };
    const opaqueResponse = {
      type: 'opaque',
      status: 0,
      clone: vi.fn().mockReturnValue(opaqueClone)
    };
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(opaqueResponse);

    const result = await downloadTileWithRetry(cache, 'https://b.tile.openstreetmap.org/8/1/1.png', { fetchImpl, maxAttempts: 1 });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://b.tile.openstreetmap.org/8/1/1.png', { mode: 'cors', cache: 'no-store' });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://b.tile.openstreetmap.org/8/1/1.png', { mode: 'no-cors', cache: 'no-store' });
    expect(cache.put).toHaveBeenCalledWith('https://b.tile.openstreetmap.org/8/1/1.png', opaqueClone);
  });

  it('classifies quota errors correctly', async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn()
    };
    const fetchImpl = vi.fn().mockRejectedValue({ name: 'QuotaExceededError' });

    const result = await downloadTileWithRetry(cache, 'https://c.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: false, reason: 'quota_exceeded' });
  });

  it('uses cors for non-OSM providers when no fetch mode is forced', async () => {
    const response = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': '2048', 'content-type': 'image/png' }),
      clone: vi.fn().mockReturnValue({ ok: true })
    };
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn().mockResolvedValue(response);

    const result = await downloadTileWithRetry(cache, 'https://example.com/tiles/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/tiles/8/1/1.png', { mode: 'cors', cache: 'no-store' });
  });

  it('applies retry backoff between invalid attempts', async () => {
    const response = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: vi.fn() }
    };
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const sleepImpl = vi.fn((cb, _ms) => cb());

    const result = await downloadTileWithRetry(cache, 'https://example.com/tiles/8/1/1.png', {
      fetchImpl,
      maxAttempts: 3,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 150,
      retryJitterRatio: 0,
      sleepImpl
    });

    expect(result).toMatchObject({ ok: false, reason: 'network_or_server' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, expect.any(Function), 100);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, expect.any(Function), 150);
  });
});

describe('summarizeTileDownloadResults', () => {
  it('counts quota and network/provider failures separately', () => {
    const summary = summarizeTileDownloadResults([
      { ok: true },
      { ok: false, reason: 'quota_exceeded' },
      { ok: false, reason: 'provider_throttled', retryAfterMs: 4000 },
      { ok: false, reason: 'network_or_server' },
      { ok: false, reason: 'unexpected_reason' },
      { ok: false }
    ]);

    expect(summary).toEqual({
      errors: 5,
      quotaErrors: 1,
      networkErrors: 3,
      providerErrors: 4,
      throttledErrors: 1,
      maxRetryAfterMs: 4000
    });
  });
});

describe('adaptive provider recovery helpers', () => {
  it('increases the pause as provider errors accumulate', () => {
    expect(getAdaptiveBatchPauseMs(0, {
      baseDelayMs: 450,
      maxDelayMs: 4000,
      jitterMs: 0,
      providerSlowdownThreshold: 2
    })).toBe(450);
    expect(getAdaptiveBatchPauseMs(2, {
      baseDelayMs: 450,
      maxDelayMs: 4000,
      jitterMs: 0,
      providerSlowdownThreshold: 2
    })).toBe(900);
    expect(getAdaptiveBatchPauseMs(4, {
      baseDelayMs: 450,
      maxDelayMs: 4000,
      jitterMs: 0,
      providerSlowdownThreshold: 2
    })).toBe(1800);
  });

  it('uses retry-after or cooldown thresholds to pause provider-limited downloads', () => {
    expect(getProviderCooldownMs(1, {
      providerCooldownThreshold: 6,
      baseCooldownMs: 15000,
      maxCooldownMs: 120000,
      retryAfterMs: 5000
    })).toBe(5000);
    expect(getProviderCooldownMs(6, {
      providerCooldownThreshold: 6,
      baseCooldownMs: 15000,
      maxCooldownMs: 120000
    })).toBe(15000);
  });
});

describe('downloadTileBatchesWithRecovery', () => {
  it('pauses with a cooldown after repeated provider errors', async () => {
    const downloadTileFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'network_or_server' })
      .mockResolvedValueOnce({ ok: false, reason: 'network_or_server' })
      .mockResolvedValueOnce({ ok: false, reason: 'network_or_server' })
      .mockResolvedValueOnce({ ok: false, reason: 'provider_throttled', retryAfterMs: 12000 })
      .mockResolvedValueOnce({ ok: false, reason: 'provider_throttled', retryAfterMs: 12000 })
      .mockResolvedValueOnce({ ok: false, reason: 'provider_throttled', retryAfterMs: 12000 });
    const sleepImpl = vi.fn((cb, _ms) => cb());

    const result = await downloadTileBatchesWithRecovery([
      { zoom: 8, missingUrls: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    ], {
      cache: {},
      downloadTileFn,
      batchSize: 3,
      batchPauseBaseMs: 450,
      batchPauseJitterMs: 0,
      providerSlowdownThreshold: 2,
      providerCooldownThreshold: 6,
      providerCooldownBaseMs: 15000,
      providerCooldownMaxMs: 120000,
      sleepImpl
    });

    expect(result.pausedForProvider).toBe(true);
    expect(result.abortedByQuota).toBe(false);
    expect(result.done).toBe(6);
    expect(result.errors).toBe(6);
    expect(result.providerErrors).toBe(6);
    expect(result.throttledErrors).toBe(3);
    expect(result.cooldownMs).toBe(15000);
    expect(result.state).toEqual({ consecutiveProviderErrors: 6 });
    expect(downloadTileFn).toHaveBeenCalledTimes(6);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, expect.any(Function), 900);
  });

  it('can resume from a persisted provider pause state and reset after success', async () => {
    const firstRun = await downloadTileBatchesWithRecovery([
      { zoom: 8, missingUrls: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    ], {
      cache: {},
      downloadTileFn: vi.fn().mockImplementation(async (_cache, url) => {
        if (url === 'g') return { ok: true };
        return { ok: false, reason: 'provider_throttled', retryAfterMs: 1000 };
      }),
      batchSize: 3,
      batchPauseBaseMs: 0,
      batchPauseJitterMs: 0,
      providerCooldownThreshold: 6,
      providerCooldownBaseMs: 15000,
      sleepImpl: vi.fn((cb, _ms) => cb())
    });

    expect(firstRun.pausedForProvider).toBe(true);
    expect(firstRun.state).toEqual({ consecutiveProviderErrors: 3 });

    const resumedRun = await downloadTileBatchesWithRecovery([
      { zoom: 8, missingUrls: ['g'] }
    ], {
      cache: {},
      downloadTileFn: vi.fn().mockResolvedValue({ ok: true }),
      batchSize: 3,
      batchPauseBaseMs: 0,
      batchPauseJitterMs: 0,
      initialState: firstRun.state
    });

    expect(resumedRun.pausedForProvider).toBe(false);
    expect(resumedRun.errors).toBe(0);
    expect(resumedRun.done).toBe(1);
    expect(resumedRun.state).toEqual({ consecutiveProviderErrors: 0 });
  });

  it('keeps quota exhaustion as the only immediate hard stop', async () => {
    const result = await downloadTileBatchesWithRecovery([
      { zoom: 8, missingUrls: ['a', 'b', 'c', 'd'] }
    ], {
      cache: {},
      downloadTileFn: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
        .mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
        .mockResolvedValueOnce({ ok: true }),
      batchSize: 3,
      quotaErrorsToAbort: 2
    });

    expect(result.abortedByQuota).toBe(true);
    expect(result.pausedForProvider).toBe(false);
    expect(result.done).toBe(3);
    expect(result.quotaErrors).toBe(2);
  });
});
