// Utility functions for POI (Point of Interest) management.
// Extracted from app.js to allow unit testing.

export const CUSTOM_POI_MARKERS = ['📩', '🥔', '📍', '🚫', '🛃'];
export const DEFAULT_GENERIC_POI_MARKER = '🥔';
export const DEFAULT_SHARED_POI_MARKER = '📩';
export const DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX = 12;
export const DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS = 1500;
export const DEFAULT_MAP_LONG_PRESS_DUPLICATE_COORD_TOLERANCE = 0.00001;

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

    if (currentTimestamp - timestamp > windowMs) return false;
    return Math.abs(lastLat - nextLat) <= tolerance && Math.abs(lastLng - nextLng) <= tolerance;
}
