  const DB_NAME = 'truffle-storage-db';
  const DB_VERSION = 1;
  const STORE_KV = 'kv';
  const DRIVE_CONFIG_KEY = 'drive_backup_config';
  const DRIVE_TOKEN_SESSION_KEY = 'drive_backup_token_session';
  const DRIVE_STATUS_KEY = 'drive_backup_status';
  const BACKUP_DEBOUNCE_MS = 15000;
  const DEFAULT_DRIVE_CONFIG = {
    enabled: false,
    minIntervalMinutes: 60
  };

  let dbPromise = null;
  let localStorageOriginals = null;
  const rawLocalStorageApi = {
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
    clear: localStorage.clear.bind(localStorage)
  };
  let initialized = false;
  let backupTimer = null;
  let lastBackupAt = 0;
  let lastBackupFingerprint = '';

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

  function getDriveBackupConfig() {
    const saved = safeParseJSON(localStorage.getItem(DRIVE_CONFIG_KEY), {});
    const sessionToken = (sessionStorage.getItem(DRIVE_TOKEN_SESSION_KEY) || '').trim();
    const legacyToken = typeof saved.accessToken === 'string' ? saved.accessToken.trim() : '';
    const accessToken = sessionToken || legacyToken;
    if (!sessionToken && legacyToken) {
      sessionStorage.setItem(DRIVE_TOKEN_SESSION_KEY, legacyToken);
      const migrated = {
        enabled: Boolean(saved.enabled),
        minIntervalMinutes: Number(saved.minIntervalMinutes) > 0 ? Number(saved.minIntervalMinutes) : DEFAULT_DRIVE_CONFIG.minIntervalMinutes
      };
      rawLocalStorageApi.setItem(DRIVE_CONFIG_KEY, JSON.stringify(migrated));
      putEntry(DRIVE_CONFIG_KEY, JSON.stringify(migrated)).catch(() => {});
    }
    return {
      enabled: Boolean(saved.enabled),
      accessToken,
      minIntervalMinutes: Number(saved.minIntervalMinutes) > 0 ? Number(saved.minIntervalMinutes) : DEFAULT_DRIVE_CONFIG.minIntervalMinutes
    };
  }

  function setDriveBackupConfig(partialConfig = {}) {
    const current = getDriveBackupConfig();
    const merged = {
      ...current,
      ...partialConfig
    };
    const normalized = {
      enabled: Boolean(merged.enabled),
      minIntervalMinutes: Number(merged.minIntervalMinutes) > 0 ? Number(merged.minIntervalMinutes) : DEFAULT_DRIVE_CONFIG.minIntervalMinutes
    };
    const normalizedToken = typeof merged.accessToken === 'string' ? merged.accessToken.trim() : '';
    if (normalizedToken) sessionStorage.setItem(DRIVE_TOKEN_SESSION_KEY, normalizedToken);
    else sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY);

    const save = JSON.stringify(normalized);
    if (localStorageOriginals) {
      localStorageOriginals.setItem(DRIVE_CONFIG_KEY, save);
      putEntry(DRIVE_CONFIG_KEY, save).catch(() => {});
    } else {
      localStorage.setItem(DRIVE_CONFIG_KEY, save);
    }
    return normalized;
  }

  function setDriveBackupStatus(statusValue) {
    const payload = JSON.stringify({
      ...statusValue,
      updatedAt: new Date().toISOString()
    });
    if (localStorageOriginals) {
      localStorageOriginals.setItem(DRIVE_STATUS_KEY, payload);
      putEntry(DRIVE_STATUS_KEY, payload).catch(() => {});
    } else {
      localStorage.setItem(DRIVE_STATUS_KEY, payload);
    }
  }

  function collectBackupPayload() {
    const entries = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key === DRIVE_CONFIG_KEY || key === DRIVE_STATUS_KEY) continue;
      entries[key] = localStorage.getItem(key);
    }
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: entries
    };
  }

  async function uploadBackupToDrive(accessToken, payload) {
    const fileName = `truffle_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      parents: ['appDataFolder']
    };

    const boundary = `truffle_boundary_${Date.now()}`;
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(payload)}\r\n` +
      `--${boundary}--`;

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'Errore sconosciuto');
      throw new Error(`Drive upload fallito (${response.status}): ${responseText}`);
    }
  }

  async function triggerDriveBackupNow(force = false) {
    const config = getDriveBackupConfig();
    if (!config.enabled || !config.accessToken) return { skipped: true, reason: 'disabled-or-missing-token' };

    const minIntervalMs = config.minIntervalMinutes * 60 * 1000;
    const now = Date.now();
    if (!force && now - lastBackupAt < minIntervalMs) return { skipped: true, reason: 'interval-not-reached' };

    const payload = collectBackupPayload();
    const fingerprint = JSON.stringify(payload.data);
    if (!force && fingerprint === lastBackupFingerprint) return { skipped: true, reason: 'no-data-change' };

    try {
      await uploadBackupToDrive(config.accessToken, payload);
      lastBackupAt = now;
      lastBackupFingerprint = fingerprint;
      setDriveBackupStatus({ ok: true, message: 'Backup Drive completato' });
      return { ok: true };
    } catch (error) {
      setDriveBackupStatus({ ok: false, message: error.message || 'Backup Drive fallito' });
      return { ok: false, error };
    }
  }

  function scheduleDriveBackup() {
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      triggerDriveBackupNow(false).catch(() => {});
    }, BACKUP_DEBOUNCE_MS);
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
      if (key !== DRIVE_CONFIG_KEY && key !== DRIVE_STATUS_KEY) scheduleDriveBackup();
    };

    localStorage.removeItem = (key) => {
      localStorageOriginals.removeItem(key);
      deleteEntry(key).catch(() => {});
      if (key !== DRIVE_CONFIG_KEY && key !== DRIVE_STATUS_KEY) scheduleDriveBackup();
    };

    localStorage.clear = () => {
      localStorageOriginals.clear();
      clearEntries().catch(() => {});
      scheduleDriveBackup();
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
    if (!localStorage.getItem(DRIVE_CONFIG_KEY)) {
      setDriveBackupConfig(DEFAULT_DRIVE_CONFIG);
    }
    initialized = true;
  }

export { init, getDriveBackupConfig, setDriveBackupConfig, collectBackupPayload };

export function triggerDriveBackupNowImmediate() {
  return triggerDriveBackupNow(true);
}
