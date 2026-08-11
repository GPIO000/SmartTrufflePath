  const DB_NAME = 'truffle-storage-db';
  const DB_VERSION = 1;
  const STORE_KV = 'kv';
  const AUTO_BACKUP_SNAPSHOT_KEY = 'local_auto_backup_snapshot';
  const AUTO_BACKUP_STATUS_KEY = 'local_auto_backup_status';

  let dbPromise = null;
  let localStorageOriginals = null;
  const rawLocalStorageApi = {
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
    clear: localStorage.clear.bind(localStorage)
  };
  let initialized = false;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function withStore(mode, worker) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, mode);
      const store = tx.objectStore(STORE_KV);
      let workerResult;
      try {
        workerResult = worker(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(workerResult);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAllEntries() {
    return withStore('readonly', (store) => requestToPromise(store.getAll()));
  }

  async function putEntry(key, value) {
    return withStore('readwrite', (store) => requestToPromise(store.put({ key, value })));
  }

  async function deleteEntry(key) {
    return withStore('readwrite', (store) => requestToPromise(store.delete(key)));
  }

  async function clearEntries() {
    return withStore('readwrite', (store) => requestToPromise(store.clear()));
  }

  function safeParseJSON(value, fallbackValue) {
    if (!value) return fallbackValue;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  function setAutomaticBackupStatus(statusValue) {
    const payload = JSON.stringify({
      ...statusValue,
      updatedAt: new Date().toISOString()
    });
    if (localStorageOriginals) {
      localStorageOriginals.setItem(AUTO_BACKUP_STATUS_KEY, payload);
      putEntry(AUTO_BACKUP_STATUS_KEY, payload).catch(() => {});
    } else {
      localStorage.setItem(AUTO_BACKUP_STATUS_KEY, payload);
    }
  }

  function getAutomaticBackupStatus() {
    return safeParseJSON(localStorage.getItem(AUTO_BACKUP_STATUS_KEY), null);
  }

  function getLatestAutomaticBackupSnapshot() {
    return safeParseJSON(localStorage.getItem(AUTO_BACKUP_SNAPSHOT_KEY), null);
  }

  async function saveAutomaticBackupSnapshot(data, reason = 'manual') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Dati da salvare non validi');
    }
    try {
      const snapshot = {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        reason,
        data
      };
      const serialized = JSON.stringify(snapshot);
      if (localStorageOriginals) {
        localStorageOriginals.setItem(AUTO_BACKUP_SNAPSHOT_KEY, serialized);
        await putEntry(AUTO_BACKUP_SNAPSHOT_KEY, serialized);
      } else {
        localStorage.setItem(AUTO_BACKUP_SNAPSHOT_KEY, serialized);
      }
      setAutomaticBackupStatus({
        ok: true,
        message: 'Backup automatico locale aggiornato',
        savedAt: snapshot.savedAt,
        reason
      });
      return { ok: true, snapshot };
    } catch (error) {
      setAutomaticBackupStatus({
        ok: false,
        message: error.message || 'Backup automatico locale fallito'
      });
      return { ok: false, error };
    }
  }

  function patchLocalStorage() {
    if (localStorageOriginals) return;
    localStorageOriginals = {
      setItem: localStorage.setItem.bind(localStorage),
      removeItem: localStorage.removeItem.bind(localStorage),
      clear: localStorage.clear.bind(localStorage)
    };

    localStorage.setItem = (key, value) => {
      const normalizedValue = String(value);
      localStorageOriginals.setItem(key, normalizedValue);
      putEntry(key, normalizedValue).catch(() => {});
    };

    localStorage.removeItem = (key) => {
      localStorageOriginals.removeItem(key);
      deleteEntry(key).catch(() => {});
    };

    localStorage.clear = () => {
      localStorageOriginals.clear();
      clearEntries().catch(() => {});
    };
  }

  async function hydrateLocalStorageFromDb() {
    const entries = await getAllEntries();
    if (!entries || entries.length === 0) return false;
    entries.forEach((entry) => {
      if (!entry || typeof entry.key !== 'string') return;
      rawLocalStorageApi.setItem(entry.key, String(entry.value ?? ''));
    });
    return true;
  }

  async function migrateLocalStorageToDb() {
    const writes = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      writes.push(putEntry(key, String(localStorage.getItem(key) ?? '')));
    }
    await Promise.all(writes);
  }

  async function init() {
    if (initialized || !('indexedDB' in window)) return;
    await openDb();
    const hydrated = await hydrateLocalStorageFromDb();
    if (!hydrated) {
      await migrateLocalStorageToDb();
    }
    patchLocalStorage();
    initialized = true;
  }

export { init, saveAutomaticBackupSnapshot, getLatestAutomaticBackupSnapshot, getAutomaticBackupStatus };
