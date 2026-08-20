import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function extractMatch(source, regex, label) {
  const match = source.match(regex);
  expect(match, `${label} should be present`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('cache version sync', () => {
  it('defines cache version suffix only in sw.js', () => {
    const swSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

    const swVersion = extractMatch(
      swSource,
      /const CACHE_NAME = 'smarttruffle-path-' \+ '([^']+)'/,
      'sw.js cache version'
    );

    expect(swVersion).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]+$/);
    expect(appSource).not.toMatch(/const APP_CACHE_NAME_CURRENT =/);
  });
});
