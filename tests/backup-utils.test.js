import { describe, expect, it } from 'vitest';
import { normalizeBackupEntry } from '../js/backup-utils.js';

describe('normalizeBackupEntry', () => {
  it('usa il fallback quando il valore è null', () => {
    expect(normalizeBackupEntry(null, {})).toBe('{}');
  });

  it('usa il fallback quando il valore stringa non è JSON valido', () => {
    expect(normalizeBackupEntry('not-json', [])).toBe('[]');
  });

  it('usa il fallback oggetto quando trova "null" serializzato', () => {
    expect(normalizeBackupEntry('null', { a: 1 })).toBe('{"a":1}');
  });

  it('mantiene il valore quando il tipo è valido', () => {
    expect(normalizeBackupEntry('{"a":1}', {})).toBe('{"a":1}');
    expect(normalizeBackupEntry('[1,2]', [])).toBe('[1,2]');
  });
});
