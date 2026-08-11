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

export { normalizeBackupEntry };
