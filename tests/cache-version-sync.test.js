import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function extractMatch(source, regex, label) {
  const match = source.match(regex);
  expect(match, `${label} should be present`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('cache version sync', () => {
  it('loads cache version from the shared version file', () => {
    const swSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    const versionSource = readFileSync(new URL('../js/cache-version.js', import.meta.url), 'utf8');

    const sharedVersion = extractMatch(
      versionSource,
      /globalThis\.SMARTTRUFFLE_CACHE_VERSION = '([^']+)'/,
      'shared cache version'
    );

    expect(sharedVersion).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]+$/);
    expect(swSource).toMatch(/importScripts\('\.\/js\/cache-version\.js'\)/);
    expect(swSource).toMatch(/const CACHE_NAME = 'smarttruffle-path-' \+ CACHE_VERSION/);
  });
});
