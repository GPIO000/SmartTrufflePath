import { describe, expect, it } from 'vitest';
import {
  normalizeBackupEntry,
  extractValidBackupEntries,
  buildBackupRestorePlan,
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

describe('extractValidBackupEntries', () => {
  const backupMap = { storicoVendite: 'storico_vendite', poiList: 'poi_list' };

  it('restituisce le coppie [storageKey, valore] per le voci valide', () => {
    const content = { storicoVendite: '[1,2,3]', poiList: '[]' };
    expect(extractValidBackupEntries(content, backupMap)).toEqual([
      ['storico_vendite', '[1,2,3]'],
      ['poi_list', '[]'],
    ]);
  });

  it('salta le voci null o undefined', () => {
    const content = { storicoVendite: null, poiList: undefined };
    expect(extractValidBackupEntries(content, backupMap)).toEqual([]);
  });

  it('salta le voci con stringhe JSON non valide', () => {
    const content = { storicoVendite: 'not-json', poiList: '[]' };
    expect(extractValidBackupEntries(content, backupMap)).toEqual([
      ['poi_list', '[]'],
    ]);
  });

  it('lancia un errore se il contenuto non è un oggetto valido', () => {
    expect(() => extractValidBackupEntries(null, backupMap)).toThrow();
    expect(() => extractValidBackupEntries([], backupMap)).toThrow();
    expect(() => extractValidBackupEntries('stringa', backupMap)).toThrow();
  });
});

describe('buildBackupRestorePlan', () => {
  const backupMap = {
    storicoVendite: 'storico_vendite',
    poiList: 'poi_list',
    backupDirLabel: 'backup_dir_label',
  };

  it('restituisce le entry valide e le chiavi da rimuovere se mancanti nel backup', () => {
    const content = {
      storicoVendite: '[1,2,3]',
      poiList: null,
    };

    expect(buildBackupRestorePlan(content, backupMap)).toEqual({
      entries: [['storico_vendite', '[1,2,3]']],
      keysToRemove: ['poi_list', 'backup_dir_label'],
    });
  });

  it('tratta le voci JSON non valide come chiavi da rimuovere', () => {
    const content = {
      storicoVendite: 'not-json',
      poiList: '[]',
      backupDirLabel: '"Download/SmartTrufflePath/file backup"',
    };

    expect(buildBackupRestorePlan(content, backupMap)).toEqual({
      entries: [
        ['poi_list', '[]'],
        ['backup_dir_label', '"Download/SmartTrufflePath/file backup"'],
      ],
      keysToRemove: ['storico_vendite'],
    });
  });
});
