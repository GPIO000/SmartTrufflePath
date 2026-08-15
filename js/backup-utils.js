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
 * @returns {Array<[string, string]>} Valid [storageKey, value] pairs to restore.
 */
function extractValidBackupEntries(content, backupMap) {
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
                // skip entries that are not valid JSON strings
            }
        }
    }
    return entries;
}

export {
    normalizeBackupEntry,
    extractValidBackupEntries,
    AUTOMATIC_BACKUP_APP_FOLDER_NAME,
    AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
    buildAutomaticBackupPathLabel
};
