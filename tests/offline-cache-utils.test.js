import { describe, expect, it } from 'vitest';
import {
  countCachedTileUrls,
  isOfflineRegionFullyCached,
  shouldRestoreOfflineMapCache,
} from '../js/offline-cache-utils.js';

describe('countCachedTileUrls', () => {
  it('conta solo le tile presenti nella cache', () => {
    const cachedUrls = new Set(['tile-a', 'tile-c']);
    expect(countCachedTileUrls(cachedUrls, ['tile-a', 'tile-b', 'tile-c'])).toBe(2);
  });

  it('deduplica gli URL richiesti', () => {
    const cachedUrls = new Set(['tile-a']);
    expect(countCachedTileUrls(cachedUrls, ['tile-a', 'tile-a'])).toBe(1);
  });
});

describe('isOfflineRegionFullyCached', () => {
  it('restituisce false quando la cache è parziale', () => {
    const cachedUrls = new Set(['tile-a']);
    expect(isOfflineRegionFullyCached(cachedUrls, ['tile-a', 'tile-b'])).toBe(false);
  });

  it('restituisce true quando tutte le tile sono presenti', () => {
    const cachedUrls = new Set(['tile-a', 'tile-b']);
    expect(isOfflineRegionFullyCached(cachedUrls, ['tile-a', 'tile-b'])).toBe(true);
  });
});

describe('shouldRestoreOfflineMapCache', () => {
  it('richiede il re-download quando la cache è vuota o incompleta', () => {
    expect(shouldRestoreOfflineMapCache(new Set(), ['tile-a'])).toBe(true);
    expect(shouldRestoreOfflineMapCache(new Set(['tile-a']), ['tile-a', 'tile-b'])).toBe(true);
  });

  it('non richiede il re-download quando la cache è completa', () => {
    expect(shouldRestoreOfflineMapCache(new Set(['tile-a', 'tile-b']), ['tile-a', 'tile-b'])).toBe(false);
  });

  it('non richiede il re-download quando non ci sono tile preferite', () => {
    expect(shouldRestoreOfflineMapCache(new Set(['tile-a']), [])).toBe(false);
  });
});
