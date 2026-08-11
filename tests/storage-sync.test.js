// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAutomaticBackupStatus,
  getLatestAutomaticBackupSnapshot,
  getLatestAutomaticBackupSnapshotAsync,
  saveAutomaticBackupSnapshot,
  setDataChangeListener,
  notifyDataChange,
} from '../js/storage-sync.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('saveAutomaticBackupSnapshot', () => {
  it('salva uno snapshot valido e restituisce ok: true', async () => {
    const data = { vendite: [{ data: '01/01/2026', importo: '100' }] };
    const result = await saveAutomaticBackupSnapshot(data, 'test');
    expect(result.ok).toBe(true);
    expect(result.snapshot).toBeDefined();
  });

  it('lo snapshot salvato include schemaVersion, savedAt, reason e data', async () => {
    const data = { foo: 'bar' };
    const result = await saveAutomaticBackupSnapshot(data, 'periodic');
    expect(result.snapshot.schemaVersion).toBe(1);
    expect(typeof result.snapshot.savedAt).toBe('string');
    expect(result.snapshot.reason).toBe('periodic');
    expect(result.snapshot.data).toEqual(data);
  });

  it('restituisce ok: false per dati non validi (null)', async () => {
    const result = await saveAutomaticBackupSnapshot(null);
    expect(result.ok).toBe(false);
  });

  it('restituisce ok: false per dati non validi (array)', async () => {
    const result = await saveAutomaticBackupSnapshot([1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it('restituisce ok: false per dati non validi (stringa)', async () => {
    const result = await saveAutomaticBackupSnapshot('non un oggetto');
    expect(result.ok).toBe(false);
  });
});

describe('getLatestAutomaticBackupSnapshot', () => {
  it('restituisce null quando non è stato salvato alcuno snapshot', () => {
    expect(getLatestAutomaticBackupSnapshot()).toBeNull();
  });

  it('restituisce lo snapshot dopo il salvataggio', async () => {
    const data = { test: 42 };
    await saveAutomaticBackupSnapshot(data, 'manual');
    const snapshot = getLatestAutomaticBackupSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot.data).toEqual(data);
    expect(snapshot.reason).toBe('manual');
  });

  it('l\'ultimo snapshot sovrascrive il precedente', async () => {
    await saveAutomaticBackupSnapshot({ first: true }, 'manual');
    await saveAutomaticBackupSnapshot({ second: true }, 'periodic');
    const snapshot = getLatestAutomaticBackupSnapshot();
    expect(snapshot.data).toEqual({ second: true });
    expect(snapshot.reason).toBe('periodic');
  });
});

describe('getLatestAutomaticBackupSnapshotAsync', () => {
  it('restituisce null quando non è stato salvato alcuno snapshot', async () => {
    expect(await getLatestAutomaticBackupSnapshotAsync()).toBeNull();
  });

  it('restituisce lo snapshot dopo il salvataggio', async () => {
    const data = { async: true };
    await saveAutomaticBackupSnapshot(data, 'manual');
    const snapshot = await getLatestAutomaticBackupSnapshotAsync();
    expect(snapshot).not.toBeNull();
    expect(snapshot.data).toEqual(data);
    expect(snapshot.reason).toBe('manual');
  });

  it('restituisce lo snapshot da localStorage quando disponibile', async () => {
    const data = { fromLS: 42 };
    await saveAutomaticBackupSnapshot(data, 'periodic');
    const snapshot = await getLatestAutomaticBackupSnapshotAsync();
    expect(snapshot).not.toBeNull();
    expect(snapshot.data).toEqual(data);
  });
});

describe('getAutomaticBackupStatus', () => {
  it('restituisce null quando non è ancora stato eseguito un backup', () => {
    expect(getAutomaticBackupStatus()).toBeNull();
  });

  it('restituisce ok: true dopo un backup riuscito', async () => {
    await saveAutomaticBackupSnapshot({ x: 1 }, 'app-exit');
    const status = getAutomaticBackupStatus();
    expect(status).not.toBeNull();
    expect(status.ok).toBe(true);
    expect(typeof status.updatedAt).toBe('string');
    expect(typeof status.savedAt).toBe('string');
    expect(status.reason).toBe('app-exit');
  });

  it('restituisce ok: false dopo un backup fallito', async () => {
    await saveAutomaticBackupSnapshot(null);
    const status = getAutomaticBackupStatus();
    expect(status).not.toBeNull();
    expect(status.ok).toBe(false);
    expect(typeof status.message).toBe('string');
  });
});

describe('setDataChangeListener', () => {
  afterEach(() => {
    setDataChangeListener(null);
  });

  it('chiama il listener per una chiave dato normale', () => {
    const listener = vi.fn();
    setDataChangeListener(listener);
    notifyDataChange('storico_vendite');
    expect(listener).toHaveBeenCalledWith('storico_vendite');
  });

  it('non chiama il listener per la chiave snapshot del backup', () => {
    const listener = vi.fn();
    setDataChangeListener(listener);
    notifyDataChange('local_auto_backup_snapshot');
    expect(listener).not.toHaveBeenCalled();
  });

  it('non chiama il listener per la chiave status del backup', () => {
    const listener = vi.fn();
    setDataChangeListener(listener);
    notifyDataChange('local_auto_backup_status');
    expect(listener).not.toHaveBeenCalled();
  });

  it('non chiama il listener se rimosso con null', () => {
    const listener = vi.fn();
    setDataChangeListener(listener);
    setDataChangeListener(null);
    notifyDataChange('rubrica_clienti');
    expect(listener).not.toHaveBeenCalled();
  });

  it('non chiama il listener se impostato con valore non funzione', () => {
    const listener = vi.fn();
    setDataChangeListener(listener);
    setDataChangeListener('non-una-funzione');
    notifyDataChange('dogs_list');
    expect(listener).not.toHaveBeenCalled();
  });
});
