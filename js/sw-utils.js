/**
 * Normalizza un URL OSM con sottodominio (a/b/c.tile.openstreetmap.org)
 * nella forma canonica senza sottodominio (tile.openstreetmap.org).
 * Utile per trovare tile in cache indipendentemente dal sottodominio
 * usato da Leaflet al momento della richiesta.
 *
 * NOTA: questa funzione è anche inlined direttamente in sw.js per evitare
 * l'uso di import ES Module nel Service Worker, garantendo compatibilità
 * massima con tutti i browser. Mantenere le due copie sincronizzate.
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
