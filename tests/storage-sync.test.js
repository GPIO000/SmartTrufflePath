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

describe('saveDirectoryHandle / loadDirectoryHandle', () => {
  let storage;

  beforeEach(async () => {
    vi.resetModules();

    const store = new Map();
    const fakeDb = {
      transaction: (_storeName, _mode) => {
        const tx = {
          objectStore: () => ({
            put: (record) => {
              store.set(record.key, record);
              return { result: undefined };
            },
            get: (key) => ({ result: store.get(key) }),
          }),
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        Promise.resolve().then(() => { if (typeof tx.oncomplete === 'function') tx.oncomplete(); });
        return tx;
      },
    };

    vi.stubGlobal('indexedDB', {
      open: () => {
        const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: fakeDb };
        Promise.resolve().then(() => {
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({ target: { result: { objectStoreNames: { contains: () => true }, createObjectStore: () => {} } } });
          }
          if (typeof req.onsuccess === 'function') req.onsuccess();
        });
        return req;
      },
    });

    storage = await import('../js/storage-sync.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveDirectoryHandle e loadDirectoryHandle eseguono round-trip correttamente', async () => {
    const fakeHandle = { kind: 'directory', name: 'SmartTrufflePath' };
    await storage.saveDirectoryHandle('backup_dir_handle', fakeHandle);
    const loaded = await storage.loadDirectoryHandle('backup_dir_handle');
    expect(loaded).toEqual(fakeHandle);
  });

  it('loadDirectoryHandle restituisce null per una chiave inesistente', async () => {
    const loaded = await storage.loadDirectoryHandle('chiave_inesistente');
    expect(loaded).toBeNull();
  });
});

describe('init con localStorage aggiornato', () => {
  function createIndexedDbStub() {
    const kvStore = new Map();
    const handlesStore = new Map();
    let failWrites = false;

    function setFailWrites(value) {
      failWrites = Boolean(value);
    }

    function makeRequest(executor) {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      Promise.resolve().then(() => {
        try {
          request.result = executor();
          if (typeof request.onsuccess === 'function') request.onsuccess();
        } catch (error) {
          request.error = error;
          if (typeof request.onerror === 'function') request.onerror();
        }
      });
      return request;
    }

    return {
      open: () => {
        const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
        const fakeDb = {
          transaction: (storeName) => {
            const targetStore = storeName === 'handles' ? handlesStore : kvStore;
            const tx = {
              objectStore: () => ({
                getAll: () => makeRequest(() => Array.from(targetStore.values())),
                put: (record) => makeRequest(() => {
                  if (failWrites && storeName === 'kv') throw new Error('indexedDB write failed');
                  targetStore.set(record.key, record);
                  return record.key;
                }),
                delete: (key) => makeRequest(() => targetStore.delete(key)),
                clear: () => makeRequest(() => targetStore.clear()),
              }),
              oncomplete: null,
              onerror: null,
              onabort: null,
            };

            Promise.resolve().then(() => {
              if (failWrites && storeName === 'kv') {
                tx.error = new Error('indexedDB write failed');
                if (typeof tx.onerror === 'function') tx.onerror();
                return;
              }
              if (typeof tx.oncomplete === 'function') tx.oncomplete();
            });

            return tx;
          },
        };

        req.result = fakeDb;
        Promise.resolve().then(() => {
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({
              target: {
                result: {
                  objectStoreNames: { contains: () => true },
                  createObjectStore: () => {},
                },
              },
            });
          }
          if (typeof req.onsuccess === 'function') req.onsuccess();
        });
        return req;
      },
      setFailWrites,
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('non genera errori quando un nuovo salvataggio fallisce su IndexedDB', async () => {
    vi.resetModules();
    const indexedDbStub = createIndexedDbStub();
    vi.stubGlobal('indexedDB', indexedDbStub);

    const storage = await import('../js/storage-sync.js');
    await storage.init();
    indexedDbStub.setFailWrites(true);

    expect(() => {
      localStorage.setItem('storico_vendite', '[]');
    }).not.toThrow();

    expect(localStorage.getItem('storico_vendite')).toBe('[]');
  });
});
