import { describe, expect, it } from 'vitest';
import {
    buildPoiScoreList,
    computePoiCompositeScore,
    computePoiFreshnessScore,
    computePoiHistoryScore,
    computePoiSeasonScore,
    cyclicMonthDistance,
    getScoreEmoji,
    getScoreLevel,
    getSpeciesAtPoi,
    HARVEST_SPECIES_TO_ID,
    normalizeLocationText,
    poiMatchesLuogo,
    POI_SCORE_HIGH_THRESHOLD,
    POI_SCORE_MID_THRESHOLD
} from '../js/poi-forecast.js';

const SAMPLE_POI = { id: 'poi-1', lat: 43.1, lng: 11.5, note: 'Querceta del Colle' };

describe('normalizeLocationText', () => {
    it('lowercase e rimozione accenti', () => {
        expect(normalizeLocationText('Quèrcia')).toBe('quercia');
        expect(normalizeLocationText('  BOSCO SECCO  ')).toBe('bosco secco');
    });
    it('restituisce stringa vuota per valori nulli', () => {
        expect(normalizeLocationText(null)).toBe('');
        expect(normalizeLocationText(undefined)).toBe('');
    });
});

describe('poiMatchesLuogo', () => {
    it('match esatto', () => {
        expect(poiMatchesLuogo('Querceta', 'Querceta')).toBe(true);
    });
    it('match parziale inclusione', () => {
        expect(poiMatchesLuogo('Querceta del Colle', 'Querceta')).toBe(true);
        expect(poiMatchesLuogo('Querceta', 'Querceta del Colle')).toBe(true);
    });
    it('no match con stringhe diverse', () => {
        expect(poiMatchesLuogo('Bosco Secco', 'Fosso del Rio')).toBe(false);
    });
    it('no match con valori vuoti', () => {
        expect(poiMatchesLuogo('', 'Querceta')).toBe(false);
        expect(poiMatchesLuogo('Querceta', '')).toBe(false);
        expect(poiMatchesLuogo(null, 'Querceta')).toBe(false);
    });
    it('match case-insensitive con accenti', () => {
        expect(poiMatchesLuogo('Quercia Grande', 'quercia grande')).toBe(true);
        expect(poiMatchesLuogo('Forêt', 'foret')).toBe(true);
    });
});

describe('cyclicMonthDistance', () => {
    it('distanza diretta', () => {
        expect(cyclicMonthDistance(0, 3)).toBe(3);
        expect(cyclicMonthDistance(3, 0)).toBe(3);
    });
    it('distanza ciclica dicembre–gennaio', () => {
        expect(cyclicMonthDistance(11, 0)).toBe(1);
        expect(cyclicMonthDistance(0, 11)).toBe(1);
    });
    it('stesso mese', () => {
        expect(cyclicMonthDistance(5, 5)).toBe(0);
    });
    it('mesi opposti (massimo 6)', () => {
        expect(cyclicMonthDistance(0, 6)).toBe(6);
    });
});

describe('computePoiHistoryScore', () => {
    it('score zero senza storico', () => {
        const result = computePoiHistoryScore('Querceta', [], []);
        expect(result.score).toBe(0);
        expect(result.positives).toBe(0);
        expect(result.negatives).toBe(0);
    });

    it('aumenta con ritrovamenti nello stesso mese', () => {
        const today = new Date('2026-10-15');
        const history = [
            { data: '2025-10-10', luogo: 'Querceta', specie: 'Tuber melanosporum Vitt. (Nero Pregiato)', peso: '300' },
            { data: '2024-10-20', luogo: 'Querceta', specie: 'Tuber melanosporum Vitt. (Nero Pregiato)', peso: '200' }
        ];
        const result = computePoiHistoryScore('Querceta', history, [], today);
        expect(result.positives).toBe(2);
        expect(result.score).toBeGreaterThan(0);
    });

    it('non conta ritrovamenti in luoghi diversi', () => {
        const today = new Date('2026-10-15');
        const history = [{ data: '2025-10-10', luogo: 'Fosso del Rio', specie: 'Tuber aestivum', peso: '100' }];
        const result = computePoiHistoryScore('Querceta', history, [], today);
        expect(result.positives).toBe(0);
        expect(result.score).toBe(0);
    });

    it('penalizza feedback negativo nello stesso periodo', () => {
        const today = new Date('2026-10-15');
        const feedbackHistory = [
            { date: '2025-10-05', found: false, locationLabel: 'Querceta', speciesName: 'Tuber melanosporum Vitt.', areaProfile: 'equilibrato' }
        ];
        const result = computePoiHistoryScore('Querceta', [], feedbackHistory, today);
        expect(result.negatives).toBe(1);
        expect(result.score).toBe(0);
    });

    it('non va sotto zero', () => {
        const today = new Date('2026-10-15');
        const feedbackHistory = Array.from({ length: 10 }, (_, i) => ({
            date: `2025-10-${String(i + 1).padStart(2, '0')}`,
            found: false,
            locationLabel: 'Querceta'
        }));
        const result = computePoiHistoryScore('Querceta', [], feedbackHistory, today);
        expect(result.score).toBe(0);
    });

    it('è limitato a 40', () => {
        const today = new Date('2026-10-15');
        const history = Array.from({ length: 10 }, (_, i) => ({
            data: `2025-10-${String(i + 1).padStart(2, '0')}`,
            luogo: 'Querceta',
            specie: 'Tuber aestivum',
            peso: '200'
        }));
        const result = computePoiHistoryScore('Querceta', history, [], today);
        expect(result.score).toBe(40);
    });
});

describe('getSpeciesAtPoi', () => {
    it('raccoglie specie distinte', () => {
        const history = [
            { luogo: 'Querceta', specie: 'Tuber melanosporum Vitt. (Nero Pregiato)' },
            { luogo: 'Querceta', specie: 'Tuber aestivum Vitt. (Scorzone Estivo)' },
            { luogo: 'Querceta', specie: 'Tuber melanosporum Vitt. (Nero Pregiato)' }
        ];
        const species = getSpeciesAtPoi('Querceta', history);
        expect(species).toHaveLength(2);
        expect(species).toContain('Tuber melanosporum Vitt. (Nero Pregiato)');
        expect(species).toContain('Tuber aestivum Vitt. (Scorzone Estivo)');
    });

    it('restituisce array vuoto senza storico', () => {
        expect(getSpeciesAtPoi('Querceta', [])).toEqual([]);
    });
});

describe('computePoiSeasonScore', () => {
    const speciesName = 'Tuber melanosporum Vitt. (Nero Pregiato)';
    const history = [{ luogo: 'Querceta', specie: speciesName }];

    it('score neutro senza storico', () => {
        const result = computePoiSeasonScore('Querceta', [], null, new Date('2026-10-15'));
        expect(result.score).toBe(12);
    });

    it('score massimo se in stagione', () => {
        const regionCalendar = { [HARVEST_SPECIES_TO_ID[speciesName]]: '1 dic - 31 mar' };
        const result = computePoiSeasonScore('Querceta', history, regionCalendar, new Date('2026-12-20'));
        expect(result.score).toBe(30);
        expect(result.reason).toMatch(/in stagione/i);
    });

    it('score basso se fuori stagione', () => {
        const regionCalendar = { [HARVEST_SPECIES_TO_ID[speciesName]]: '1 dic - 31 mar' };
        const result = computePoiSeasonScore('Querceta', history, regionCalendar, new Date('2026-08-15'));
        expect(result.score).toBe(5);
        expect(result.reason).toMatch(/fuori stagione/i);
    });

    it('score neutro senza calendario', () => {
        const result = computePoiSeasonScore('Querceta', history, null, new Date('2026-10-15'));
        expect(result.score).toBe(12);
    });
});

describe('computePoiFreshnessScore', () => {
    it('score 10 senza storico (mai visitato)', () => {
        const result = computePoiFreshnessScore('Querceta', [], new Date('2026-10-15'));
        expect(result.score).toBe(10);
    });

    it('score 15 per ultima visita 14+ giorni fa', () => {
        const today = new Date('2026-10-15');
        const history = [{ data: '2026-09-20', luogo: 'Querceta', peso: '200' }];
        const result = computePoiFreshnessScore('Querceta', history, today);
        expect(result.score).toBe(15);
    });

    it('score 12 per ultima visita 8-13 giorni fa', () => {
        const today = new Date('2026-10-15');
        const history = [{ data: '2026-10-06', luogo: 'Querceta', peso: '200' }];
        const result = computePoiFreshnessScore('Querceta', history, today);
        expect(result.score).toBe(12);
    });

    it('score 8 per ultima visita 3-7 giorni fa', () => {
        const today = new Date('2026-10-15');
        const history = [{ data: '2026-10-11', luogo: 'Querceta', peso: '200' }];
        const result = computePoiFreshnessScore('Querceta', history, today);
        expect(result.score).toBe(8);
    });

    it('score 3 per ultima visita 1-2 giorni fa', () => {
        const today = new Date('2026-10-15T12:00:00');
        const history = [{ data: '2026-10-14', luogo: 'Querceta', peso: '200' }];
        const result = computePoiFreshnessScore('Querceta', history, today);
        expect(result.score).toBe(3);
    });

    it('score 1 per ultima visita oggi', () => {
        const today = new Date('2026-10-15');
        const history = [{ data: '2026-10-15', luogo: 'Querceta', peso: '200' }];
        const result = computePoiFreshnessScore('Querceta', history, today);
        expect(result.score).toBe(1);
    });
});

describe('computePoiCompositeScore', () => {
    it('restituisce null per POI con coordinate non finite', () => {
        expect(computePoiCompositeScore({ lat: NaN, lng: 11.5, note: 'Test' })).toBeNull();
        expect(computePoiCompositeScore(null)).toBeNull();
    });

    it('restituisce oggetto score per POI valido', () => {
        const result = computePoiCompositeScore(SAMPLE_POI, [], [], null, new Date('2026-10-15'));
        expect(result).not.toBeNull();
        expect(result.totalScore).toBeGreaterThanOrEqual(0);
        expect(result.totalScore).toBeLessThanOrEqual(100);
        expect(Array.isArray(result.reasons)).toBe(true);
        expect(result.weatherScore).toBeNull();
    });

    it('score aumenta con storico positivo e stagione aperta', () => {
        const today = new Date('2026-10-15');
        const speciesName = 'Tuber melanosporum Vitt. (Nero Pregiato)';
        const history = [
            { data: '2025-10-10', luogo: 'Querceta del Colle', specie: speciesName, peso: '300' },
            { data: '2024-10-20', luogo: 'Querceta del Colle', specie: speciesName, peso: '200' },
            { data: '2026-09-01', luogo: 'Querceta del Colle', specie: speciesName, peso: '100' }
        ];
        const regionCalendar = { [HARVEST_SPECIES_TO_ID[speciesName]]: '1 set - 31 dic' };
        const result = computePoiCompositeScore(SAMPLE_POI, history, [], regionCalendar, today);
        expect(result.totalScore).toBeGreaterThan(40);
    });
});

describe('buildPoiScoreList', () => {
    it('esclude POI di tipo auto e sos', () => {
        const pois = [
            { id: '1', lat: 43.1, lng: 11.5, note: 'Spot', type: undefined },
            { id: '2', lat: 43.2, lng: 11.6, note: 'Auto', type: 'auto' },
            { id: '3', lat: 43.3, lng: 11.7, note: 'SOS', type: 'sos' }
        ];
        const result = buildPoiScoreList(pois, [], [], null, new Date());
        expect(result).toHaveLength(1);
        expect(result[0].poi.id).toBe('1');
    });

    it('ordina per totalScore decrescente', () => {
        const today = new Date('2026-10-15');
        const speciesName = 'Tuber melanosporum Vitt. (Nero Pregiato)';
        const pois = [
            { id: 'spot-a', lat: 43.1, lng: 11.5, note: 'Spot A' },
            { id: 'spot-b', lat: 43.2, lng: 11.6, note: 'Querceta' }
        ];
        const history = [
            { data: '2025-10-10', luogo: 'Querceta', specie: speciesName, peso: '300' },
            { data: '2024-10-05', luogo: 'Querceta', specie: speciesName, peso: '200' }
        ];
        const regionCalendar = { [HARVEST_SPECIES_TO_ID[speciesName]]: '1 set - 31 dic' };
        const result = buildPoiScoreList(pois, history, [], regionCalendar, today);
        expect(result[0].poi.id).toBe('spot-b');
        expect(result[0].totalScore).toBeGreaterThanOrEqual(result[1].totalScore);
    });

    it('restituisce array vuoto senza POI', () => {
        expect(buildPoiScoreList([], [], [], null, new Date())).toEqual([]);
    });
});

describe('getScoreEmoji', () => {
    it('verde per score alto', () => {
        expect(getScoreEmoji(POI_SCORE_HIGH_THRESHOLD)).toBe('🟢');
        expect(getScoreEmoji(100)).toBe('🟢');
    });
    it('giallo per score medio', () => {
        expect(getScoreEmoji(POI_SCORE_MID_THRESHOLD)).toBe('🟡');
        expect(getScoreEmoji(POI_SCORE_HIGH_THRESHOLD - 1)).toBe('🟡');
    });
    it('nero per score basso', () => {
        expect(getScoreEmoji(0)).toBe('⚫');
        expect(getScoreEmoji(POI_SCORE_MID_THRESHOLD - 1)).toBe('⚫');
    });
});

describe('getScoreLevel', () => {
    it('livelli corretti', () => {
        expect(getScoreLevel(100)).toBe('alta');
        expect(getScoreLevel(POI_SCORE_HIGH_THRESHOLD)).toBe('alta');
        expect(getScoreLevel(POI_SCORE_MID_THRESHOLD)).toBe('media');
        expect(getScoreLevel(POI_SCORE_HIGH_THRESHOLD - 1)).toBe('media');
        expect(getScoreLevel(0)).toBe('bassa');
        expect(getScoreLevel(POI_SCORE_MID_THRESHOLD - 1)).toBe('bassa');
    });
});
