import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  bumpCacheVersionFile,
  computeNextCacheVersion,
  incrementAlphabeticSuffix,
  updateCacheVersionSource
} from '../scripts/bump-cache-version.mjs';

describe('bump cache version script', () => {
  it('increments the suffix when the cache version already uses today date', () => {
    expect(computeNextCacheVersion('2026-08-21a', new Date('2026-08-21T10:00:00Z'))).toBe('2026-08-21b');
    expect(computeNextCacheVersion('2026-08-21z', new Date('2026-08-21T10:00:00Z'))).toBe('2026-08-21aa');
  });

  it('resets the suffix to a when the date changes', () => {
    expect(computeNextCacheVersion('2026-08-20k', new Date('2026-08-21T10:00:00Z'))).toBe('2026-08-21a');
  });

  it('updates the shared cache version declaration', () => {
    const result = updateCacheVersionSource(
      "globalThis.SMARTTRUFFLE_CACHE_VERSION = '2026-08-20k';\n",
      new Date('2026-08-21T10:00:00Z')
    );

    expect(result.previousVersion).toBe('2026-08-20k');
    expect(result.nextVersion).toBe('2026-08-21a');
    expect(result.source).toBe("globalThis.SMARTTRUFFLE_CACHE_VERSION = '2026-08-21a';\n");
  });

  it('can bump the cache version file on disk', async () => {
    const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tempDir = await mkdtemp(join(tmpdir(), 'smarttruffle-cache-version-'));
    const tempFile = join(tempDir, 'cache-version.js');
    await writeFile(tempFile, "globalThis.SMARTTRUFFLE_CACHE_VERSION = '2026-08-20k';\n");

    const result = bumpCacheVersionFile(tempFile, new Date('2026-08-21T10:00:00Z'));

    expect(result.nextVersion).toBe('2026-08-21a');
    expect(await readFile(tempFile, 'utf8')).toBe("globalThis.SMARTTRUFFLE_CACHE_VERSION = '2026-08-21a';\n");
  });

  it('configures npm preversion to bump the cache before package version changes', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );

    expect(packageJson.scripts.preversion).toBe('node ./scripts/bump-cache-version.mjs');
  });

  it('increments alphabetic suffixes correctly', () => {
    expect(incrementAlphabeticSuffix('a')).toBe('b');
    expect(incrementAlphabeticSuffix('az')).toBe('ba');
    expect(incrementAlphabeticSuffix('zz')).toBe('aaa');
  });
});
