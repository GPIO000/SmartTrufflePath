function normalizeBackupEntry(entryValue, fallbackValue) {
    if (entryValue === null || entryValue === undefined) {
        return JSON.stringify(fallbackValue);
    }

    let parsedValue = entryValue;
    if (typeof entryValue === 'string') {
        try {
            parsedValue = JSON.parse(entryValue);
        } catch {
            return JSON.stringify(fallbackValue);
        }
    }

    if (Array.isArray(fallbackValue) && !Array.isArray(parsedValue)) {
        return JSON.stringify(fallbackValue);
    }

    if (fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)) {
        if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
            return JSON.stringify(fallbackValue);
        }
    }

    return JSON.stringify(parsedValue);
}

const AUTOMATIC_BACKUP_APP_FOLDER_NAME = 'SmartTrufflePath';
const AUTOMATIC_BACKUP_FILES_FOLDER_NAME = 'file backup';

function buildAutomaticBackupPathLabel(rootFolderName = 'Download') {
    const safeRootFolderName = String(rootFolderName || 'Download').trim() || 'Download';
    return `${safeRootFolderName}/${AUTOMATIC_BACKUP_APP_FOLDER_NAME}/${AUTOMATIC_BACKUP_FILES_FOLDER_NAME}`;
}

/**
 * Validates a backup content object and returns an array of [storageKey, jsonString] pairs
 * that are safe to write to localStorage. Entries with null/undefined values or
 * invalid JSON strings are silently skipped.
 *
 * @param {unknown} content - Parsed backup JSON object.
 * @param {Record<string, string>} backupMap - Mapping from backup field names to localStorage keys.
 * @param {Set<string>} plainStringKeys - Backup fields allowed as plain strings.
 * @returns {Array<[string, string]>} Valid [storageKey, value] pairs to restore.
 */
function extractValidBackupEntries(content, backupMap, plainStringKeys = new Set()) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
        throw new Error('Formato backup non valido');
    }
    const entries = [];
    for (const [backupKey, storageKey] of Object.entries(backupMap)) {
        const value = content[backupKey];
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') {
            try {
                JSON.parse(value);
                entries.push([storageKey, value]);
            } catch {
                if (plainStringKeys.has(backupKey)) {
                    entries.push([storageKey, JSON.stringify(value)]);
                }
            }
        }
    }
    return entries;
}

/**
 * Builds a restore plan from a backup object.
 * - `entries` contains valid [storageKey, jsonString] pairs to write.
 * - `keysToRemove` contains managed storage keys that are missing or invalid in the backup
 *   and therefore must be cleared before restore to avoid stale data remaining visible.
 *
 * @param {unknown} content - Parsed backup JSON object.
 * @param {Record<string, string>} backupMap - Mapping from backup field names to localStorage keys.
 * @param {string[]} plainStringBackupKeys - Backup field names allowed as plain strings.
 * @returns {{ entries: Array<[string, string]>, keysToRemove: string[] }}
 */
function buildBackupRestorePlan(content, backupMap, plainStringBackupKeys = []) {
    const rawEntries = extractValidBackupEntries(content, backupMap, new Set(plainStringBackupKeys));
    const seenStorageKeys = new Set();
    const entries = rawEntries.filter(([storageKey]) => {
        if (seenStorageKeys.has(storageKey)) return false;
        seenStorageKeys.add(storageKey);
        return true;
    });
    const restoredStorageKeys = new Set(entries.map(([storageKey]) => storageKey));
    const managedStorageKeys = [...new Set(Object.values(backupMap))];

    return {
        entries,
        keysToRemove: managedStorageKeys.filter((storageKey) => !restoredStorageKeys.has(storageKey))
    };
}

const BACKUP_USER_DATA_KEYS = [
    'tesserino', 'pagopa', 'archivioDocumentiList', 'f24', 'storicoVendite',
    'luoghiRaccolta', 'poiList', 'dogsList', 'caneData', 'polizzeList',
    'storicoRaccolta', 'rubricaClienti', 'speseList', 'vetHistoryList',
    'heatDiaryList', 'vetClinicsList', 'calendariTartufiCustom',
    'noteRegionaliTartufi', 'truffleForecastFeedback', 'offlineRegioniPreferite'
];

function isBackupDataMeaningful(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    return BACKUP_USER_DATA_KEYS.some((key) => data[key] != null);
}

export {
    normalizeBackupEntry,
    extractValidBackupEntries,
    buildBackupRestorePlan,
    AUTOMATIC_BACKUP_APP_FOLDER_NAME,
    AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
    buildAutomaticBackupPathLabel,
    BACKUP_USER_DATA_KEYS,
    isBackupDataMeaningful
};
