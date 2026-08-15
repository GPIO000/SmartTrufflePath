import { describe, expect, it, vi } from 'vitest';
import {
  downloadTileWithRetry,
  isOpaqueTileResponse,
  isQuotaExceededError,
  isValidCachedTileResponse,
  isValidDownloadedTileResponse
} from '../js/offline-map-download-utils.js';

describe('isQuotaExceededError', () => {
  it('riconosce gli errori quota più comuni', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError({ code: 1014 })).toBe(true);
    expect(isQuotaExceededError(new Error('generic'))).toBe(false);
  });
});

describe('tile response validation', () => {
  it('considera valide le risposte opaque per cache e download', () => {
    const response = { type: 'opaque', status: 0 };
    expect(isOpaqueTileResponse(response)).toBe(true);
    expect(isValidCachedTileResponse(response)).toBe(true);
    expect(isValidDownloadedTileResponse(response)).toBe(true);
  });

  it('scarta le tile cached troppo piccole', () => {
    const response = {
      type: 'basic',
      status: 200,
      headers: new Headers({ 'content-length': '128' })
    };
    expect(isValidCachedTileResponse(response)).toBe(false);
  });

  it('scarta i download con risposta troppo piccola o non ok', () => {
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
  it('riusa una tile opaque già presente in cache', async () => {
    const cache = {
      match: vi.fn().mockResolvedValue({ type: 'opaque', status: 0 }),
      delete: vi.fn(),
      put: vi.fn()
    };
    const fetchImpl = vi.fn();

    const result = await downloadTileWithRetry(cache, 'https://a.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('scarica e salva una tile opaque quando il browser non espone CORS', async () => {
    const response = {
      type: 'opaque',
      status: 0,
      clone: vi.fn().mockReturnThis()
    };
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined)
    };
    const fetchImpl = vi.fn().mockResolvedValue(response);

    const result = await downloadTileWithRetry(cache, 'https://b.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://b.tile.openstreetmap.org/8/1/1.png', { mode: 'no-cors', cache: 'no-store' });
    expect(cache.put).toHaveBeenCalledWith('https://b.tile.openstreetmap.org/8/1/1.png', response);
  });

  it('classifica correttamente gli errori di quota', async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
      put: vi.fn()
    };
    const fetchImpl = vi.fn().mockRejectedValue({ name: 'QuotaExceededError' });

    const result = await downloadTileWithRetry(cache, 'https://c.tile.openstreetmap.org/8/1/1.png', { fetchImpl });

    expect(result).toEqual({ ok: false, reason: 'quota_exceeded' });
  });
});
