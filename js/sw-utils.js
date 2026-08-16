/**
 * Normalizza un URL OSM con sottodominio (a/b/c.tile.openstreetmap.org)
 * nella forma canonica senza sottodominio (tile.openstreetmap.org).
 * Utile per trovare tile in cache indipendentemente dal sottodominio
 * usato da Leaflet al momento della richiesta.
 *
 * @param {string} url
 * @returns {string}
 */
function canonicalizeOsmTileUrl(url) {
  try {
    const parsed = new URL(url);
    if (/^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname)) {
      parsed.hostname = 'tile.openstreetmap.org';
      return parsed.toString();
    }
  } catch {
    // URL non valida, restituisce invariata
  }
  return url;
}

export { canonicalizeOsmTileUrl };
