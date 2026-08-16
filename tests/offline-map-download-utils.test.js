import { describe, expect, it, vi } from 'vitest';
import {
  downloadTileWithRetry,
  isOpaqueTileResponse,
  isOpenStreetMapTileUrl,
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

  it('treats opaque responses as invalid for both cache and download flows', () => {
    const response = { type: 'opaque', status: 0 };
    expect(isOpaqueTileResponse(response)).toBe(true);
    expect(isValidCachedTileResponse(response)).toBe(false);
    expect(isValidDownloadedTileResponse(response)).toBe(false);
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
});

describe('downloadTileWithRetry', () => {
  it('deletes an opaque tile from cache and re-fetches it as CORS', async () => {
    const corsClone = { type: 'cors', status: 200, ok: true };
    const corsResponse = {
      type: 'cors',
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': '2048' }),
      clone: vi.fn().mockReturnValue(corsClone)
    };
    const cache = {
      match: vi.fn().mockResolvedValue({ type: 'opaque', status: 0 }),
      delete: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn().mockResolvedValue(corsResponse);

    const result = await downloadTileWithRetry(cache, 'https://a.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(cache.delete).toHaveBeenCalledWith('https://a.tile.openstreetmap.org/8/1/1.png');
    expect(fetchImpl).toHaveBeenCalledWith('https://a.tile.openstreetmap.org/8/1/1.png', { mode: 'cors', cache: 'no-store' });
    expect(cache.put).toHaveBeenCalledWith('https://a.tile.openstreetmap.org/8/1/1.png', corsClone);
  });

  it('rejects an opaque network response and retries until all attempts exhausted', async () => {
    const opaqueResponse = { type: 'opaque', status: 0 };
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn().mockResolvedValue(opaqueResponse);

    const result = await downloadTileWithRetry(cache, 'https://b.tile.openstreetmap.org/8/1/1.png', { fetchImpl, maxAttempts: 2 });

    expect(result).toEqual({ ok: false, reason: 'network_or_server' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cache.put).not.toHaveBeenCalled();
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
      headers: new Headers({ 'content-length': '2048' }),
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
});

describe('summarizeTileDownloadResults', () => {
  it('counts quota and network/provider failures separately', () => {
    const summary = summarizeTileDownloadResults([
      { ok: true },
      { ok: false, reason: 'quota_exceeded' },
      { ok: false, reason: 'network_or_server' },
      { ok: false, reason: 'unexpected_reason' },
      { ok: false }
    ]);

    expect(summary).toEqual({
      errors: 4,
      quotaErrors: 1,
      networkErrors: 3
    });
  });
});
