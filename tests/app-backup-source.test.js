import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

describe('buildCompleteBackupData source', () => {
  it('mantiene la chiave canonica dei luoghi di raccolta nel payload backup', () => {
    expect(appSource).toMatch(/luoghiRaccolta:\s*localStorage\.getItem\('luoghi_raccolta'\)/);
  });

  it('non mantiene alias legacy ridondanti per luoghi/aree di raccolta', () => {
    expect(appSource).not.toContain('archivioLuoghiRaccolta:');
    expect(appSource).not.toContain('archivioAreeLuoghiRaccolta:');
  });
});
