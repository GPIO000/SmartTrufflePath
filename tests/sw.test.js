import { describe, expect, it } from 'vitest';
import { canonicalizeOsmTileUrl } from '../js/sw-utils.js';

describe('canonicalizeOsmTileUrl', () => {
  it('normalizza sottodominio a → tile.openstreetmap.org', () => {
    expect(canonicalizeOsmTileUrl('https://a.tile.openstreetmap.org/12/2177/1453.png'))
      .toBe('https://tile.openstreetmap.org/12/2177/1453.png');
  });

  it('normalizza sottodominio b → tile.openstreetmap.org', () => {
    expect(canonicalizeOsmTileUrl('https://b.tile.openstreetmap.org/10/512/384.png'))
      .toBe('https://tile.openstreetmap.org/10/512/384.png');
  });

  it('normalizza sottodominio c → tile.openstreetmap.org', () => {
    expect(canonicalizeOsmTileUrl('https://c.tile.openstreetmap.org/8/100/200.png'))
      .toBe('https://tile.openstreetmap.org/8/100/200.png');
  });

  it('lascia invariato un URL già canonico', () => {
    const url = 'https://tile.openstreetmap.org/12/2177/1453.png';
    expect(canonicalizeOsmTileUrl(url)).toBe(url);
  });

  it('lascia invariato un URL di dominio diverso', () => {
    const url = 'https://example.com/tile/12/2177/1453.png';
    expect(canonicalizeOsmTileUrl(url)).toBe(url);
  });

  it('lascia invariata una stringa non URL valida', () => {
    expect(canonicalizeOsmTileUrl('not-a-url')).toBe('not-a-url');
  });

  it('preserva il path e i parametri dopo la normalizzazione', () => {
    expect(canonicalizeOsmTileUrl('https://a.tile.openstreetmap.org/13/4355/2890.png?foo=bar'))
      .toBe('https://tile.openstreetmap.org/13/4355/2890.png?foo=bar');
  });
});
