import { describe, expect, it } from 'vitest';
import {
  normalizeBackupEntry,
  AUTOMATIC_BACKUP_APP_FOLDER_NAME,
  AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
  buildAutomaticBackupPathLabel,
} from '../js/backup-utils.js';

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

describe('buildAutomaticBackupPathLabel', () => {
  it('costruisce il percorso guidato del backup automatico', () => {
    expect(buildAutomaticBackupPathLabel('Download')).toBe(
      `Download/${AUTOMATIC_BACKUP_APP_FOLDER_NAME}/${AUTOMATIC_BACKUP_FILES_FOLDER_NAME}`,
    );
  });

  it('usa Download come fallback quando il nome radice è vuoto', () => {
    expect(buildAutomaticBackupPathLabel('')).toBe(
      `Download/${AUTOMATIC_BACKUP_APP_FOLDER_NAME}/${AUTOMATIC_BACKUP_FILES_FOLDER_NAME}`,
    );
  });
});
