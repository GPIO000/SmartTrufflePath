// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAutomaticBackupStatus,
  getLatestAutomaticBackupSnapshot,
  saveAutomaticBackupSnapshot,
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
