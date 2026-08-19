import { describe, expect, it } from 'vitest';
import {
    CUSTOM_POI_MARKERS,
    DEFAULT_GENERIC_POI_MARKER,
    DEFAULT_SHARED_POI_MARKER,
    formatPoiDisplayDate,
    getDefaultMarkerForPoiType,
    normalizePoiList,
    normalizePoiMarker,
    parseLegacyDateToTimestamp,
    resolvePoiCoords,
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
