import { describe, expect, it } from 'vitest';
import {
  countCachedTileUrls,
  isOfflineRegionFullyCached,
  shouldRestoreOfflineMapCache,
  normalizeTileUrls,
} from '../js/offline-cache-utils.js';

describe('normalizeTileUrls', () => {
  it('restituisce array vuoto se tileUrls non è un array', () => {
    expect(normalizeTileUrls(null)).toEqual([]);
    expect(normalizeTileUrls(undefined)).toEqual([]);
    expect(normalizeTileUrls('tile-a')).toEqual([]);
  });

  it('rimuove stringhe vuote e non-stringhe', () => {
    expect(normalizeTileUrls(['tile-a', '', null, 42, 'tile-b'])).toEqual(['tile-a', 'tile-b']);
  });

  it('deduplica gli URL', () => {
    expect(normalizeTileUrls(['tile-a', 'tile-a', 'tile-b'])).toEqual(['tile-a', 'tile-b']);
  });
});

describe('countCachedTileUrls', () => {
  it('conta solo le tile presenti nella cache', () => {
    const cachedUrls = new Set(['tile-a', 'tile-c']);
    expect(countCachedTileUrls(cachedUrls, ['tile-a', 'tile-b', 'tile-c'])).toBe(2);
  });

  it('deduplica gli URL richiesti', () => {
    const cachedUrls = new Set(['tile-a']);
    expect(countCachedTileUrls(cachedUrls, ['tile-a', 'tile-a'])).toBe(1);
  });

  it('restituisce 0 se cachedUrls non è un Set', () => {
    expect(countCachedTileUrls(null, ['tile-a'])).toBe(0);
  });

  it('restituisce 0 se tileUrls è vuoto', () => {
    expect(countCachedTileUrls(new Set(['tile-a']), [])).toBe(0);
  });
});

describe('isOfflineRegionFullyCached', () => {
  it('restituisce false se cachedUrls non è un Set', () => {
    expect(isOfflineRegionFullyCached(null, ['tile-a'])).toBe(false);
  });

  it('restituisce false se tileUrls è vuoto', () => {
    expect(isOfflineRegionFullyCached(new Set(['tile-a']), [])).toBe(false);
  });

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

  it('richiede il re-download se cachedUrls non è un Set', () => {
    expect(shouldRestoreOfflineMapCache(null, ['tile-a'])).toBe(true);
  });
});
