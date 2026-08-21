// Utility functions for POI (Point of Interest) management.
// Extracted from app.js to allow unit testing.

export const CUSTOM_POI_MARKERS = ['📩', '🥔', '📍', '🚫', '🛃', '🍄'];
export const DEFAULT_GENERIC_POI_MARKER = '🥔';
export const DEFAULT_SHARED_POI_MARKER = '📩';
export const DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX = 12;
export const DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS = 1500;
export const DEFAULT_MAP_LONG_PRESS_DUPLICATE_COORD_TOLERANCE = 0.00001;
const MAP_LINK_COORD_DECIMALS = 6;

export function parseLegacyDateToTimestamp(dateText) {
    if (typeof dateText !== 'string') return null;
    const normalized = dateText.trim();
    if (!normalized) return null;
    const direct = Date.parse(normalized);
    if (!Number.isNaN(direct)) return new Date(direct).toISOString();

    const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const yearRaw = Number(match[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const parsed = new Date(year, month, day, hour, minute, second);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

export function formatPoiDisplayDate(savedAtIso) {
    const parsed = new Date(savedAtIso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString() + ' ' + parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getDefaultMarkerForPoiType(type) {
    if (type === 'auto') return '🚗';
    if (type === 'sos') return '🆘';
    if (type === 'shared') return DEFAULT_SHARED_POI_MARKER;
    return DEFAULT_GENERIC_POI_MARKER;
}

export function normalizePoiMarker(marker, type) {
    if (type === 'auto' || type === 'sos') return getDefaultMarkerForPoiType(type);
    if (typeof marker === 'string' && CUSTOM_POI_MARKERS.includes(marker.trim())) return marker.trim();
    return getDefaultMarkerForPoiType(type);
}

function formatMapLinkCoordinate(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '';
    return numericValue.toFixed(MAP_LINK_COORD_DECIMALS);
}

function buildMapCoordinatePair(lat, lng) {
    const formattedLat = formatMapLinkCoordinate(lat);
    const formattedLng = formatMapLinkCoordinate(lng);
    if (!formattedLat || !formattedLng) return '';
    return `${formattedLat},${formattedLng}`;
}

export function buildGoogleMapsUrl(lat, lng) {
    const coords = buildMapCoordinatePair(lat, lng);
    return coords ? `https://maps.google.com/?q=${coords}` : '';
}

export function buildAppleMapsUrl(lat, lng, label = '') {
    const coords = buildMapCoordinatePair(lat, lng);
    if (!coords) return '';
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    return `https://maps.apple.com/?ll=${coords}${trimmedLabel ? `&q=${encodeURIComponent(trimmedLabel)}` : ''}`;
}

export function buildMapsLinksText(lat, lng, label = '') {
    const googleMapsUrl = buildGoogleMapsUrl(lat, lng);
    const appleMapsUrl = buildAppleMapsUrl(lat, lng, label);
    return [
        googleMapsUrl ? `Google Maps: ${googleMapsUrl}` : '',
        appleMapsUrl ? `Apple Maps: ${appleMapsUrl}` : ''
    ].filter(Boolean).join('\n');
}

export function buildSharedPoiMessage(poi, senderName = '') {
    if (!poi) return '';
    const note = typeof poi.note === 'string' && poi.note.trim() ? poi.note.trim() : 'Punto di interesse';
    const date = typeof poi.date === 'string' ? poi.date.trim() : '';
    const sender = typeof senderName === 'string' ? senderName.trim() : '';
    const senderLine = sender ? `\nDa: ${sender}` : '';
    const dateLine = date ? `\nData: ${date}` : '';
    const mapLinks = buildMapsLinksText(poi.lat, poi.lng, note);
    return `📍 TARTUFAIA CONDIVISA${senderLine}\nNota: ${note}${dateLine}${mapLinks ? `\n${mapLinks}` : ''}`;
}

export function buildEmergencyLocationMessage(title, lat, lng, senderName = '', label = '') {
    const heading = typeof title === 'string' && title.trim() ? title.trim() : 'EMERGENZA!';
    const sender = typeof senderName === 'string' ? senderName.trim() : '';
    const formattedLat = formatMapLinkCoordinate(lat);
    const formattedLng = formatMapLinkCoordinate(lng);
    const intro = sender ? `${heading} Da: ${sender}.` : heading;
    const mapLinks = buildMapsLinksText(lat, lng, label || heading);
    return `${intro} Coordinate GPS: Lat: ${formattedLat}, Lng: ${formattedLng}.${mapLinks ? `\n${mapLinks}` : ''}`;
}

export function normalizePoiList(rawPoiList) {
    const baseTimestamp = Date.now();
    const normalized = Array.isArray(rawPoiList) ? rawPoiList : [];
    const result = normalized
        .map((poi, index) => {
            if (!poi || typeof poi !== 'object') return null;
            const lat = Number(poi.lat);
            const lng = Number(poi.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

            const savedAt = parseLegacyDateToTimestamp(poi.savedAt)
                || parseLegacyDateToTimestamp(poi.date)
                || new Date(baseTimestamp + index).toISOString();

            const note = typeof poi.note === 'string' && poi.note.trim() ? poi.note.trim() : 'Punto di interesse';
            const id = typeof poi.id === 'string' && poi.id.trim() ? poi.id.trim() : `poi-${savedAt}-${index}`;
            const type = typeof poi.type === 'string' && poi.type.trim() ? poi.type.trim() : undefined;
            const from = typeof poi.from === 'string' && poi.from.trim() ? poi.from.trim() : undefined;
            const marker = normalizePoiMarker(poi.marker, type);
            const entry = { id, lat, lng, note, savedAt, date: formatPoiDisplayDate(savedAt), marker };
            if (type) entry.type = type;
            if (from) entry.from = from;
            return entry;
        })
        .filter(Boolean);

    result.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
    return result;
}

/**
 * Resolves the coordinates to use for a new POI.
 * When forceLat and forceLng are provided (e.g. from a long-press on the map),
 * those coordinates are used directly. Otherwise, the position of the GPS user
 * marker is used. Returns null when no position is available.
 *
 * @param {number|undefined} forceLat
 * @param {number|undefined} forceLng
 * @param {{ getLatLng: () => { lat: number, lng: number } }|null} userMarker
 * @returns {{ lat: number, lng: number }|null}
 */
export function resolvePoiCoords(forceLat, forceLng, userMarker) {
    const hasForced = Number.isFinite(forceLat) && Number.isFinite(forceLng);
    if (hasForced) return { lat: forceLat, lng: forceLng };
    if (userMarker) {
        const latlng = userMarker.getLatLng();
        return { lat: latlng.lat, lng: latlng.lng };
    }
    return null;
}

export function extractPointerClientPoint(event) {
    const source = event?.touches?.[0]
        || event?.changedTouches?.[0]
        || event;
    const clientX = Number(source?.clientX);
    const clientY = Number(source?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return { x: clientX, y: clientY };
}

export function shouldConfirmMapLongPressOnTimeout(event) {
    if (!event) return false;
    if (event.pointerType) return event.pointerType === 'touch';
    if (event.sourceCapabilities?.firesTouchEvents) return true;
    if (typeof event.type === 'string' && event.type.startsWith('touch')) return true;
    return Array.isArray(event.touches) || Array.isArray(event.changedTouches);
}

export function toMapContainerPoint(clientPoint, containerRect) {
    if (!clientPoint || !containerRect) return null;
    const left = Number(containerRect.left);
    const top = Number(containerRect.top);
    const x = Number(clientPoint.x) - left;
    const y = Number(clientPoint.y) - top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

export function hasMapLongPressExceededTolerance(startPoint, currentPoint, tolerancePx = DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX) {
    if (!startPoint || !currentPoint) return false;
    const tolerance = Number(tolerancePx);
    if (!Number.isFinite(tolerance) || tolerance < 0) return false;
    const deltaX = currentPoint.x - startPoint.x;
    const deltaY = currentPoint.y - startPoint.y;
    return (deltaX * deltaX) + (deltaY * deltaY) > tolerance * tolerance;
}

export function isDuplicateMapLongPress(lastHandled, latlng, now = Date.now(), duplicateWindowMs = DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS, coordTolerance = DEFAULT_MAP_LONG_PRESS_DUPLICATE_COORD_TOLERANCE) {
    if (!lastHandled || !latlng) return false;
    const timestamp = Number(lastHandled.timestamp);
    const currentTimestamp = Number(now);
    const windowMs = Number(duplicateWindowMs);
    const tolerance = Number(coordTolerance);
    const lastLat = Number(lastHandled.lat);
    const lastLng = Number(lastHandled.lng);
    const nextLat = Number(latlng.lat);
    const nextLng = Number(latlng.lng);

    if (!Number.isFinite(timestamp)
        || !Number.isFinite(currentTimestamp)
        || !Number.isFinite(windowMs)
        || windowMs < 0
        || !Number.isFinite(tolerance)
        || tolerance < 0
        || !Number.isFinite(lastLat)
        || !Number.isFinite(lastLng)
        || !Number.isFinite(nextLat)
        || !Number.isFinite(nextLng)) {
        return false;
    }

    const elapsed = currentTimestamp - timestamp;
    if (elapsed < 0 || elapsed >= windowMs) return false;
    return Math.abs(lastLat - nextLat) <= tolerance && Math.abs(lastLng - nextLng) <= tolerance;
}

export function extractCoordsFromSharedMessage(text) {
    if (typeof text !== 'string') return null;
    let match;
    match = text.match(/[?&](?:q|ll|sll)=(-?\d+\.?\d*)(?:,|%2C)(-?\d+\.?\d*)/i);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    match = text.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    match = text.match(/lat(?:itudine)?[:\s]+(-?\d+[.,]\d*)[,\s]+l(?:on|ng|ong)(?:itudine)?[:\s]+(-?\d+[.,]\d*)/i);
    if (match) return { lat: parseFloat(match[1].replace(',', '.')), lng: parseFloat(match[2].replace(',', '.')) };
    const dmsToDecimal = (deg, min, sec, dir) => {
        let decimal = parseFloat(deg) + parseFloat(min || 0) / 60 + parseFloat(sec || 0) / 3600;
        if (/[SW]/i.test(dir)) decimal = -decimal;
        return decimal;
    };
    match = text.match(/(\d{1,3})[°º]\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["""″]\s*([NS])[,\s]+(\d{1,3})[°º]\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["""″]\s*([EWO])/i);
    if (match) return { lat: dmsToDecimal(match[1], match[2], match[3], match[4]), lng: dmsToDecimal(match[5], match[6], match[7], match[8]) };
    match = text.match(/(\d{1,3})[°º]\s*(\d{1,2}(?:[.,]\d+)?)[′']?\s*([NS])[,\s]+(\d{1,3})[°º]\s*(\d{1,2}(?:[.,]\d+)?)[′']?\s*([EWO])/i);
    if (match) return { lat: dmsToDecimal(match[1], match[2].replace(',', '.'), 0, match[3]), lng: dmsToDecimal(match[4], match[5].replace(',', '.'), 0, match[6]) };
    match = text.match(/([NS])\s*(\d{1,3})[°º\s]\s*(\d{1,2}(?:[.,]\d+)?)[,\s]+([EWO])\s*(\d{1,3})[°º\s]\s*(\d{1,2}(?:[.,]\d+)?)/i);
    if (match) return { lat: dmsToDecimal(match[2], match[3].replace(',', '.'), 0, match[1]), lng: dmsToDecimal(match[5], match[6].replace(',', '.'), 0, match[4]) };
    match = text.match(/(-?\d{1,3},\d{4,})\s*[,;]\s*(-?\d{1,3},\d{4,})/);
    if (match) return { lat: parseFloat(match[1].replace(/,/g, '.')), lng: parseFloat(match[2].replace(/,/g, '.')) };
    match = text.match(/(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    return null;
}
