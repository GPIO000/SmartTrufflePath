import { describe, expect, it } from 'vitest';
import {
  normalizeBackupEntry,
  extractValidBackupEntries,
  buildBackupRestorePlan,
  AUTOMATIC_BACKUP_APP_FOLDER_NAME,
  AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
  buildAutomaticBackupPathLabel,
  BACKUP_USER_DATA_KEYS,
  isBackupDataMeaningful,
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

  it('ripristina una stringa semplice se la chiave è esplicitamente consentita', () => {
    const content = { backupDirLabel: 'Download/SmartTrufflePath/file backup' };
    const map = { backupDirLabel: 'backup_dir_label' };
    expect(extractValidBackupEntries(content, map, new Set(['backupDirLabel']))).toEqual([
      ['backup_dir_label', '"Download/SmartTrufflePath/file backup"'],
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

  it('accetta backupDirLabel come stringa semplice quando configurato', () => {
    const content = {
      backupDirLabel: 'Download/SmartTrufflePath/file backup',
    };

    expect(buildBackupRestorePlan(content, backupMap, ['backupDirLabel'])).toEqual({
      entries: [['backup_dir_label', '"Download/SmartTrufflePath/file backup"']],
      keysToRemove: ['storico_vendite', 'poi_list'],
    });
  });

  it('deduplica le chiavi storage duplicate mantenendo la prima voce valida', () => {
    const duplicateMap = {
      luoghiRaccolta: 'luoghi_raccolta',
      archivioLuoghiRaccolta: 'luoghi_raccolta',
    };
    const content = {
      luoghiRaccolta: '["A"]',
      archivioLuoghiRaccolta: '["B"]',
    };

    expect(buildBackupRestorePlan(content, duplicateMap)).toEqual({
      entries: [['luoghi_raccolta', '["A"]']],
      keysToRemove: [],
    });
  });
});

describe('isBackupDataMeaningful', () => {
  it('restituisce false per un oggetto senza dati utente (tutti null)', () => {
    const data = BACKUP_USER_DATA_KEYS.reduce((acc, k) => { acc[k] = null; return acc; }, {});
    expect(isBackupDataMeaningful(data)).toBe(false);
  });

  it('restituisce false per un oggetto vuoto', () => {
    expect(isBackupDataMeaningful({})).toBe(false);
  });

  it('restituisce false per valori non-oggetto', () => {
    expect(isBackupDataMeaningful(null)).toBe(false);
    expect(isBackupDataMeaningful(undefined)).toBe(false);
    expect(isBackupDataMeaningful([])).toBe(false);
    expect(isBackupDataMeaningful('stringa')).toBe(false);
  });

  it('restituisce true se almeno un campo dati utente è non-null', () => {
    expect(isBackupDataMeaningful({ storicoVendite: '[1,2,3]' })).toBe(true);
    expect(isBackupDataMeaningful({ poiList: '[]' })).toBe(true);
    expect(isBackupDataMeaningful({ dogsList: '[{"nome":"Rex"}]' })).toBe(true);
  });

  it('restituisce false se solo backupDirLabel è presente (non è un dato utente)', () => {
    expect(isBackupDataMeaningful({ backupDirLabel: 'Download/SmartTrufflePath/file backup' })).toBe(false);
  });

  it('restituisce true con solo una chiave dati utente valorizzata e le altre null', () => {
    const data = { ...BACKUP_USER_DATA_KEYS.reduce((acc, k) => { acc[k] = null; return acc; }, {}), tesserino: '{"nome":"Mario"}' };
    expect(isBackupDataMeaningful(data)).toBe(true);
  });
});
