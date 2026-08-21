import { describe, expect, it } from 'vitest';
import {
    CUSTOM_POI_MARKERS,
    DEFAULT_GENERIC_POI_MARKER,
    DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS,
    DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX,
    DEFAULT_SHARED_POI_MARKER,
    extractPointerClientPoint,
    formatPoiDisplayDate,
    getDefaultMarkerForPoiType,
    hasMapLongPressExceededTolerance,
    isDuplicateMapLongPress,
    normalizePoiList,
    normalizePoiMarker,
    parseLegacyDateToTimestamp,
    resolvePoiCoords,
    shouldConfirmMapLongPressOnTimeout,
    toMapContainerPoint,
} from '../js/poi-utils.js';

// ---------------------------------------------------------------------------
// resolvePoiCoords — the function updated in the previous branch
// ---------------------------------------------------------------------------

describe('resolvePoiCoords', () => {
    it('restituisce le coordinate forzate quando forceLat e forceLng sono entrambi forniti', () => {
        const result = resolvePoiCoords(44.123456, 11.654321, null);
        expect(result).toEqual({ lat: 44.123456, lng: 11.654321 });
    });

    it('usa la posizione del marker GPS quando non ci sono coordinate forzate', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(undefined, undefined, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('restituisce null quando non ci sono coordinate forzate e nessun marker GPS', () => {
        expect(resolvePoiCoords(undefined, undefined, null)).toBeNull();
        expect(resolvePoiCoords(undefined, undefined, undefined)).toBeNull();
    });

    it('usa le coordinate forzate anche quando il marker GPS è presente (long-press ha la priorità)', () => {
        const userMarker = { getLatLng: () => ({ lat: 99.0, lng: 99.0 }) };
        const result = resolvePoiCoords(44.0, 11.0, userMarker);
        expect(result).toEqual({ lat: 44.0, lng: 11.0 });
    });

    it('gestisce correttamente le coordinate 0,0 (equatore/meridiano) come coordinate valide', () => {
        expect(resolvePoiCoords(0, 0, null)).toEqual({ lat: 0, lng: 0 });
    });

    it('cade sul marker GPS quando solo forceLat è definito (forceLng mancante)', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(44.0, undefined, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('cade sul marker GPS quando solo forceLng è definito (forceLat mancante)', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(undefined, 11.0, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('cade sul marker GPS quando forceLat è NaN (coordinata non valida)', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(NaN, 11.0, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('cade sul marker GPS quando forceLng è NaN (coordinata non valida)', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(44.0, NaN, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('cade sul marker GPS quando forceLat è null', () => {
        const userMarker = { getLatLng: () => ({ lat: 43.5, lng: 10.2 }) };
        const result = resolvePoiCoords(null, 11.0, userMarker);
        expect(result).toEqual({ lat: 43.5, lng: 10.2 });
    });

    it('restituisce null quando forceLat è Infinity e non c\'è marker GPS', () => {
        expect(resolvePoiCoords(Infinity, 11.0, null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// map long-press helpers
// ---------------------------------------------------------------------------

describe('extractPointerClientPoint', () => {
    it('estrae le coordinate da un evento mouse/pointer', () => {
        expect(extractPointerClientPoint({ clientX: 120, clientY: 45 })).toEqual({ x: 120, y: 45 });
    });

    it('estrae le coordinate dal primo touch disponibile', () => {
        expect(extractPointerClientPoint({
            touches: [{ clientX: 33, clientY: 44 }],
            changedTouches: [{ clientX: 99, clientY: 88 }]
        })).toEqual({ x: 33, y: 44 });
    });

    it('usa changedTouches quando touches non è disponibile', () => {
        expect(extractPointerClientPoint({
            changedTouches: [{ clientX: 77, clientY: 55 }]
        })).toEqual({ x: 77, y: 55 });
    });

    it('restituisce null quando le coordinate non sono disponibili', () => {
        expect(extractPointerClientPoint(null)).toBeNull();
        expect(extractPointerClientPoint({})).toBeNull();
    });
});

describe('shouldConfirmMapLongPressOnTimeout', () => {
    it('conferma subito la pressione lunga per eventi touch', () => {
        expect(shouldConfirmMapLongPressOnTimeout({
            type: 'touchstart',
            touches: [{ clientX: 33, clientY: 44 }]
        })).toBe(true);
    });

    it('conferma subito la pressione lunga per pointer event touch', () => {
        expect(shouldConfirmMapLongPressOnTimeout({ pointerType: 'touch' })).toBe(true);
    });

    it('attende il rilascio per eventi mouse', () => {
        expect(shouldConfirmMapLongPressOnTimeout({
            type: 'mousedown',
            clientX: 120,
            clientY: 45
        })).toBe(false);
    });

    it('restituisce false quando l\'evento non è disponibile', () => {
        expect(shouldConfirmMapLongPressOnTimeout(null)).toBe(false);
    });
});

describe('hasMapLongPressExceededTolerance', () => {
    it('non annulla la pressione lunga per micro-spostamenti entro la soglia', () => {
        expect(hasMapLongPressExceededTolerance(
            { x: 100, y: 100 },
            { x: 108, y: 107 },
            DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX
        )).toBe(false);
    });

    it('annulla la pressione lunga quando il trascinamento supera la soglia', () => {
        expect(hasMapLongPressExceededTolerance(
            { x: 100, y: 100 },
            { x: 120, y: 120 },
            DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX
        )).toBe(true);
    });

    it('restituisce false quando i punti non sono disponibili o la soglia non è valida', () => {
        expect(hasMapLongPressExceededTolerance(null, { x: 1, y: 1 })).toBe(false);
        expect(hasMapLongPressExceededTolerance({ x: 1, y: 1 }, null)).toBe(false);
        expect(hasMapLongPressExceededTolerance({ x: 1, y: 1 }, { x: 5, y: 5 }, -1)).toBe(false);
    });
});

describe('toMapContainerPoint', () => {
    it('converte un clientPoint nelle coordinate relative al contenitore', () => {
        expect(toMapContainerPoint(
            { x: 150, y: 90 },
            { left: 100, top: 40 }
        )).toEqual({ x: 50, y: 50 });
    });

    it('restituisce null quando i dati in ingresso non sono validi', () => {
        expect(toMapContainerPoint(null, { left: 0, top: 0 })).toBeNull();
        expect(toMapContainerPoint({ x: 10, y: 10 }, null)).toBeNull();
        expect(toMapContainerPoint({ x: 'a', y: 10 }, { left: 0, top: 0 })).toBeNull();
    });
});

describe('isDuplicateMapLongPress', () => {
    it('riconosce come duplicato un secondo evento ravvicinato sulle stesse coordinate', () => {
        expect(isDuplicateMapLongPress(
            { lat: 44.123456, lng: 11.654321, timestamp: 1000 },
            { lat: 44.123459, lng: 11.654319 },
            1000 + DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS - 1
        )).toBe(true);
    });

    it('non tratta come duplicato un evento fuori dalla finestra temporale', () => {
        expect(isDuplicateMapLongPress(
            { lat: 44.123456, lng: 11.654321, timestamp: 1000 },
            { lat: 44.123456, lng: 11.654321 },
            1000 + DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS + 1
        )).toBe(false);
    });

    it('non tratta come duplicato un evento con coordinate diverse', () => {
        expect(isDuplicateMapLongPress(
            { lat: 44.123456, lng: 11.654321, timestamp: 1000 },
            { lat: 44.223456, lng: 11.754321 },
            1200
        )).toBe(false);
    });

    it('restituisce false quando i dati in ingresso non sono validi', () => {
        expect(isDuplicateMapLongPress(null, { lat: 44, lng: 11 }, 1200)).toBe(false);
        expect(isDuplicateMapLongPress({ lat: 44, lng: 11, timestamp: 1000 }, null, 1200)).toBe(false);
        expect(isDuplicateMapLongPress({ lat: 'x', lng: 11, timestamp: 1000 }, { lat: 44, lng: 11 }, 1200)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// normalizePoiMarker
// ---------------------------------------------------------------------------

describe('normalizePoiMarker', () => {
    it('restituisce 🚗 per il tipo auto indipendentemente dal marker', () => {
        expect(normalizePoiMarker('📍', 'auto')).toBe('🚗');
        expect(normalizePoiMarker(undefined, 'auto')).toBe('🚗');
    });

    it('restituisce 🆘 per il tipo sos indipendentemente dal marker', () => {
        expect(normalizePoiMarker('📍', 'sos')).toBe('🆘');
        expect(normalizePoiMarker(undefined, 'sos')).toBe('🆘');
    });

    it('restituisce DEFAULT_SHARED_POI_MARKER per il tipo shared quando il marker non è valido', () => {
        expect(normalizePoiMarker(undefined, 'shared')).toBe(DEFAULT_SHARED_POI_MARKER);
    });

    it('restituisce il marker custom valido quando è nella lista CUSTOM_POI_MARKERS', () => {
        for (const marker of CUSTOM_POI_MARKERS) {
            expect(normalizePoiMarker(marker, undefined)).toBe(marker);
        }
    });

    it('restituisce DEFAULT_GENERIC_POI_MARKER per marker non riconosciuti', () => {
        expect(normalizePoiMarker('🍄', undefined)).toBe(DEFAULT_GENERIC_POI_MARKER);
        expect(normalizePoiMarker(null, undefined)).toBe(DEFAULT_GENERIC_POI_MARKER);
        expect(normalizePoiMarker('', undefined)).toBe(DEFAULT_GENERIC_POI_MARKER);
    });

    it('rimuove gli spazi attorno al marker prima di validarlo', () => {
        expect(normalizePoiMarker(' 📍 ', undefined)).toBe('📍');
    });
});

// ---------------------------------------------------------------------------
// getDefaultMarkerForPoiType
// ---------------------------------------------------------------------------

describe('getDefaultMarkerForPoiType', () => {
    it('restituisce 🚗 per auto', () => expect(getDefaultMarkerForPoiType('auto')).toBe('🚗'));
    it('restituisce 🆘 per sos', () => expect(getDefaultMarkerForPoiType('sos')).toBe('🆘'));
    it('restituisce DEFAULT_SHARED_POI_MARKER per shared', () => {
        expect(getDefaultMarkerForPoiType('shared')).toBe(DEFAULT_SHARED_POI_MARKER);
    });
    it('restituisce DEFAULT_GENERIC_POI_MARKER per tipo generico', () => {
        expect(getDefaultMarkerForPoiType(undefined)).toBe(DEFAULT_GENERIC_POI_MARKER);
        expect(getDefaultMarkerForPoiType('custom')).toBe(DEFAULT_GENERIC_POI_MARKER);
    });
});

// ---------------------------------------------------------------------------
// normalizePoiList
// ---------------------------------------------------------------------------

describe('normalizePoiList', () => {
    it('restituisce array vuoto per input non array', () => {
        expect(normalizePoiList(null)).toEqual([]);
        expect(normalizePoiList(undefined)).toEqual([]);
        expect(normalizePoiList('stringa')).toEqual([]);
    });

    it('filtra le voci con coordinate non valide', () => {
        const result = normalizePoiList([
            { lat: 'non-numero', lng: 10.0, note: 'test', savedAt: new Date().toISOString() },
            { lat: 44.0, lng: 11.0, note: 'valido', savedAt: new Date().toISOString() },
            null,
            { lat: 44.0, lng: NaN, note: 'lng NaN', savedAt: new Date().toISOString() },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].note).toBe('valido');
    });

    it('imposta la nota predefinita quando manca', () => {
        const result = normalizePoiList([
            { lat: 44.0, lng: 11.0, savedAt: new Date().toISOString() },
        ]);
        expect(result[0].note).toBe('Punto di interesse');
    });

    it('genera un id quando manca', () => {
        const result = normalizePoiList([
            { lat: 44.0, lng: 11.0, note: 'test', savedAt: new Date().toISOString() },
        ]);
        expect(typeof result[0].id).toBe('string');
        expect(result[0].id.length).toBeGreaterThan(0);
    });

    it('preserva l\'id esistente', () => {
        const id = 'poi-2026-01-01T00:00:00.000Z-abc123';
        const result = normalizePoiList([
            { id, lat: 44.0, lng: 11.0, note: 'test', savedAt: '2026-01-01T00:00:00.000Z' },
        ]);
        expect(result[0].id).toBe(id);
    });

    it('normalizza il marker in base al tipo', () => {
        const result = normalizePoiList([
            { lat: 44.0, lng: 11.0, note: 'auto', savedAt: new Date().toISOString(), type: 'auto', marker: '📍' },
        ]);
        expect(result[0].marker).toBe('🚗');
    });

    it('ordina i punti per data salvAt crescente', () => {
        const result = normalizePoiList([
            { lat: 44.0, lng: 11.0, note: 'secondo', savedAt: '2026-06-02T10:00:00.000Z' },
            { lat: 44.0, lng: 11.0, note: 'primo', savedAt: '2026-06-01T10:00:00.000Z' },
        ]);
        expect(result[0].note).toBe('primo');
        expect(result[1].note).toBe('secondo');
    });
});

// ---------------------------------------------------------------------------
// parseLegacyDateToTimestamp
// ---------------------------------------------------------------------------

describe('parseLegacyDateToTimestamp', () => {
    it('analizza correttamente un formato ISO', () => {
        const iso = '2026-06-01T10:00:00.000Z';
        const result = parseLegacyDateToTimestamp(iso);
        expect(result).toBe(new Date(iso).toISOString());
    });

    it('analizza il formato legacy gg/mm/aaaa', () => {
        const result = parseLegacyDateToTimestamp('01/06/2026');
        expect(result).toBeTruthy();
        expect(result).toContain('2026');
    });

    it('analizza il formato legacy gg/mm/aaaa hh:mm', () => {
        const result = parseLegacyDateToTimestamp('01/06/2026 10:30');
        expect(result).toBeTruthy();
    });

    it('restituisce null per input non stringa', () => {
        expect(parseLegacyDateToTimestamp(null)).toBeNull();
        expect(parseLegacyDateToTimestamp(12345)).toBeNull();
    });

    it('restituisce null per stringa vuota', () => {
        expect(parseLegacyDateToTimestamp('')).toBeNull();
        expect(parseLegacyDateToTimestamp('   ')).toBeNull();
    });

    it('restituisce null per formato non riconosciuto', () => {
        expect(parseLegacyDateToTimestamp('non-una-data')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// formatPoiDisplayDate
// ---------------------------------------------------------------------------

describe('formatPoiDisplayDate', () => {
    it('restituisce una stringa non vuota per una data ISO valida', () => {
        const result = formatPoiDisplayDate('2026-06-01T10:00:00.000Z');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('restituisce stringa vuota per input non valido', () => {
        expect(formatPoiDisplayDate('non-una-data')).toBe('');
        expect(formatPoiDisplayDate('')).toBe('');
    });
});
