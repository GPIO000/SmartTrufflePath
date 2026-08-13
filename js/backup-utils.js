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

export {
    normalizeBackupEntry,
    AUTOMATIC_BACKUP_APP_FOLDER_NAME,
    AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
    buildAutomaticBackupPathLabel
};
