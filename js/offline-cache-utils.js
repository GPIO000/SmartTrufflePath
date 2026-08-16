function normalizeTileUrls(tileUrls) {
    if (!Array.isArray(tileUrls)) return [];
    return [...new Set(tileUrls.filter((url) => typeof url === 'string' && url.length > 0))];
}

function countCachedTileUrls(cachedUrls, tileUrls) {
    if (!(cachedUrls instanceof Set)) return 0;
    const normalizedUrls = normalizeTileUrls(tileUrls);
    let cachedCount = 0;
    for (const url of normalizedUrls) {
        if (cachedUrls.has(url)) cachedCount++;
    }
    return cachedCount;
}

function isOfflineRegionFullyCached(cachedUrls, tileUrls) {
    if (!(cachedUrls instanceof Set)) return false;
    const normalizedUrls = normalizeTileUrls(tileUrls);
    if (normalizedUrls.length === 0) return false;
    return countCachedTileUrls(cachedUrls, normalizedUrls) === normalizedUrls.length;
}

function shouldRestoreOfflineMapCache(cachedUrls, preferredTileUrls) {
    if (!(cachedUrls instanceof Set)) return true;
    const normalizedPreferredTileUrls = normalizeTileUrls(preferredTileUrls);
    if (normalizedPreferredTileUrls.length === 0) return false;
    return countCachedTileUrls(cachedUrls, normalizedPreferredTileUrls) < normalizedPreferredTileUrls.length;
}

function getMissingTileUrls(cachedUrls, tileUrls) {
    const normalizedUrls = normalizeTileUrls(tileUrls);
    if (!(cachedUrls instanceof Set)) return normalizedUrls;
    return normalizedUrls.filter((url) => !cachedUrls.has(url));
}

function summarizeTileCoverage(cachedUrls, tileUrls) {
    const normalizedUrls = normalizeTileUrls(tileUrls);
    const missingUrls = getMissingTileUrls(cachedUrls, normalizedUrls);
    const total = normalizedUrls.length;
    const missing = missingUrls.length;
    const cached = Math.max(0, total - missing);
    return {
        tileUrls: normalizedUrls,
        missingUrls,
        total,
        cached,
        missing,
        isFullyCached: total > 0 && missing === 0
    };
}

export {
    normalizeTileUrls,
    countCachedTileUrls,
    isOfflineRegionFullyCached,
    shouldRestoreOfflineMapCache,
    getMissingTileUrls,
    summarizeTileCoverage
};
