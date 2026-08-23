// Utility functions for scoring POIs based on historical harvest data and seasonal calendars.
// Extracted to allow unit testing independently of app.js.

import { isDateWithinPeriod } from './truffle-forecast.js';

const POI_MATCH_SCORE_SAME_PERIOD = 10;
const POI_MATCH_SCORE_ADJACENT_PERIOD = 4;
const POI_MATCH_SCORE_ANY = 2;
const POI_MAX_HISTORY_SCORE = 40;
const POI_MAX_SEASON_SCORE = 30;
const POI_MAX_FRESHNESS_SCORE = 15;

export const POI_SCORE_MAX = POI_MAX_HISTORY_SCORE + POI_MAX_SEASON_SCORE + POI_MAX_FRESHNESS_SCORE;
export const POI_SCORE_HIGH_THRESHOLD = 65;
export const POI_SCORE_MID_THRESHOLD = 40;

// Maps harvest register species names to TRUFFLE_SPECIES_FORECAST ids.
export const HARVEST_SPECIES_TO_ID = {
    'Tuber magnatum Pico (Pregiato Bianco)': 0,
    'Tuber melanosporum Vitt. (Nero Pregiato)': 1,
    'Tuber macrosporum Vitt. (Nero Liscio)': 2,
    'Tuber brumale Vitt. (Moscatuto / Invernale)': 3,
    'Tuber brumale var. moschatum De Ferry (Brumale moscato - Sottospecie)': 4,
    'Tuber aestivum Vitt. (Scorzone Estivo)': 5,
    'Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)': 6,
    'Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)': 7,
    'Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)': 8
};

/**
 * Normalizes a location string for fuzzy matching (lowercase, no accents, trimmed).
 */
export function normalizeLocationText(str) {
    return String(str ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Returns true if the POI note and a harvest entry location label refer to the same place.
 */
export function poiMatchesLuogo(poiNote, luogo) {
    const n1 = normalizeLocationText(poiNote);
    const n2 = normalizeLocationText(luogo);
    if (!n1 || !n2) return false;
    return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

/**
 * Returns the minimum cyclic month distance (0–6) between two month indices.
 */
export function cyclicMonthDistance(m1, m2) {
    const diff = Math.abs(Number(m1) - Number(m2));
    return Math.min(diff, 12 - diff);
}

/**
 * Computes the historical productivity score for a POI (0–40).
 * Scores harvest entries near the current calendar period higher than out-of-period ones.
 * Negative feedback (uscite senza risultati) reduces the score.
 *
 * @param {string} poiNote - The POI note/name used for matching
 * @param {Array} harvestHistory - Entries from `storico_raccolta_giornaliera`
 * @param {Array} feedbackHistory - Entries from `truffle_forecast_feedback`
 * @param {Date} today
 * @returns {{ score: number, positives: number, negatives: number }}
 */
export function computePoiHistoryScore(poiNote, harvestHistory = [], feedbackHistory = [], today = new Date()) {
    const todayMonth = today.getMonth();
    let points = 0;
    let positives = 0;
    let negatives = 0;

    for (const entry of harvestHistory) {
        if (!poiMatchesLuogo(poiNote, entry?.luogo)) continue;
        const entryDate = entry?.data ? new Date(`${entry.data}T12:00:00`) : null;
        if (!(entryDate instanceof Date) || Number.isNaN(entryDate.getTime())) continue;
        const monthDist = cyclicMonthDistance(entryDate.getMonth(), todayMonth);
        if (monthDist <= 1) {
            points += POI_MATCH_SCORE_SAME_PERIOD;
            positives++;
        } else if (monthDist <= 2) {
            points += POI_MATCH_SCORE_ADJACENT_PERIOD;
            positives++;
        } else {
            points += POI_MATCH_SCORE_ANY;
        }
    }

    for (const entry of feedbackHistory) {
        if (!poiMatchesLuogo(poiNote, entry?.locationLabel)) continue;
        const entryDate = entry?.date ? new Date(`${entry.date}T12:00:00`) : null;
        if (!(entryDate instanceof Date) || Number.isNaN(entryDate.getTime())) continue;
        if (cyclicMonthDistance(entryDate.getMonth(), todayMonth) > 2) continue;
        if (entry?.found === false) {
            negatives++;
            points -= 6;
        }
    }

    return {
        score: Math.max(0, Math.min(POI_MAX_HISTORY_SCORE, points)),
        positives,
        negatives
    };
}

/**
 * Returns the set of distinct species names historically found at a POI location.
 *
 * @param {string} poiNote
 * @param {Array} harvestHistory
 * @returns {string[]}
 */
export function getSpeciesAtPoi(poiNote, harvestHistory = []) {
    const found = new Set();
    for (const entry of harvestHistory) {
        if (poiMatchesLuogo(poiNote, entry?.luogo) && entry?.specie) {
            found.add(entry.specie);
        }
    }
    return [...found];
}

/**
 * Returns a short human-readable species label extracted from the full scientific name.
 */
function shortSpeciesLabel(fullName) {
    const match = String(fullName).match(/\(([^)]+)\)/);
    return match ? match[1].trim() : fullName;
}

/**
 * Computes the seasonal score for a POI (0–30).
 * 30 pts if at least one historically-found species is in season today.
 * 5 pts if species were found but none are in season.
 * 12 pts if no history or calendar data (neutral).
 *
 * @param {string} poiNote
 * @param {Array} harvestHistory
 * @param {object|null} regionCalendar - Calendar object keyed by species id (e.g. `{ 0: '1 nov - 31 dic', ... }`)
 * @param {Date} today
 * @returns {{ score: number, reason: string }}
 */
export function computePoiSeasonScore(poiNote, harvestHistory = [], regionCalendar = null, today = new Date()) {
    const speciesAtPoi = getSpeciesAtPoi(poiNote, harvestHistory);
    if (speciesAtPoi.length === 0) {
        return { score: 12, reason: 'nessuno storico di specie per questo punto' };
    }
    if (!regionCalendar || typeof regionCalendar !== 'object' || Array.isArray(regionCalendar)) {
        return { score: 12, reason: 'calendario regionale non disponibile' };
    }

    const inSeason = [];
    const outSeason = [];

    for (const speciesName of speciesAtPoi) {
        const speciesId = HARVEST_SPECIES_TO_ID[speciesName];
        if (speciesId === undefined) continue;
        const period = regionCalendar[speciesId];
        if (!period) continue;
        if (isDateWithinPeriod(period, today)) {
            inSeason.push(shortSpeciesLabel(speciesName));
        } else {
            outSeason.push(shortSpeciesLabel(speciesName));
        }
    }

    if (inSeason.length > 0) {
        return { score: POI_MAX_SEASON_SCORE, reason: `in stagione: ${inSeason.slice(0, 2).join(', ')}` };
    }
    if (outSeason.length > 0) {
        return { score: 5, reason: `fuori stagione (${outSeason.slice(0, 1).join(', ')})` };
    }
    return { score: 12, reason: 'stagionalità non verificabile (calendario mancante)' };
}

/**
 * Computes the freshness score for a POI (0–15).
 * Spots rested for longer score higher, very recent visits score lower.
 *
 * @param {string} poiNote
 * @param {Array} harvestHistory
 * @param {Date} today
 * @returns {{ score: number, reason: string }}
 */
export function computePoiFreshnessScore(poiNote, harvestHistory = [], today = new Date()) {
    const entriesAtPoi = harvestHistory.filter((entry) =>
        poiMatchesLuogo(poiNote, entry?.luogo) && entry?.data
    );
    if (entriesAtPoi.length === 0) {
        return { score: 10, reason: 'mai visitato in questo storico' };
    }

    const latestDate = entriesAtPoi.reduce((latest, entry) => {
        const d = new Date(`${entry.data}T12:00:00`);
        return d > latest ? d : latest;
    }, new Date(0));

    const daysSince = Math.floor((today.getTime() - latestDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince >= 14) return { score: 15, reason: `ultima visita ${daysSince} giorni fa` };
    if (daysSince >= 8) return { score: 12, reason: `ultima visita ${daysSince} giorni fa` };
    if (daysSince >= 3) return { score: 8, reason: `ultima visita ${daysSince} giorni fa` };
    if (daysSince >= 1) return { score: 3, reason: `visitato ${daysSince} giorno/i fa, lascia riposare` };
    return { score: 1, reason: 'visitato oggi, lascia riposare' };
}

/**
 * Builds a composite score entry for a single POI.
 * `weatherScore` is null until populated asynchronously.
 *
 * @param {object} poi
 * @param {Array} harvestHistory
 * @param {Array} feedbackHistory
 * @param {object|null} regionCalendar
 * @param {Date} today
 * @returns {object|null}
 */
export function computePoiCompositeScore(poi, harvestHistory = [], feedbackHistory = [], regionCalendar = null, today = new Date()) {
    if (!poi || !Number.isFinite(Number(poi.lat)) || !Number.isFinite(Number(poi.lng))) return null;
    const poiNote = poi.note || '';

    const history = computePoiHistoryScore(poiNote, harvestHistory, feedbackHistory, today);
    const season = computePoiSeasonScore(poiNote, harvestHistory, regionCalendar, today);
    const freshness = computePoiFreshnessScore(poiNote, harvestHistory, today);

    const baseScore = Math.min(100, history.score + season.score + freshness.score);
    const reasons = [];
    if (history.positives > 0) {
        reasons.push(`${history.positives} ritrovament${history.positives === 1 ? 'o' : 'i'} in questo periodo dell'anno`);
    }
    if (history.negatives > 0) {
        reasons.push(`${history.negatives} uscit${history.negatives === 1 ? 'a' : 'e'} senza risultati recenti`);
    }
    reasons.push(season.reason);
    reasons.push(freshness.reason);

    return {
        poi,
        baseScore,
        weatherScore: null,
        totalScore: baseScore,
        reasons,
        speciesAtPoi: getSpeciesAtPoi(poiNote, harvestHistory)
    };
}

/**
 * Builds the sorted list of scored POIs (generic types only, excluding 'auto' and 'sos').
 *
 * @param {Array} poiList
 * @param {Array} harvestHistory
 * @param {Array} feedbackHistory
 * @param {object|null} regionCalendar
 * @param {Date} today
 * @returns {Array}
 */
export function buildPoiScoreList(poiList = [], harvestHistory = [], feedbackHistory = [], regionCalendar = null, today = new Date()) {
    return poiList
        .filter((poi) => !poi?.type || (poi.type !== 'auto' && poi.type !== 'sos'))
        .map((poi) => computePoiCompositeScore(poi, harvestHistory, feedbackHistory, regionCalendar, today))
        .filter(Boolean)
        .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Returns the score level label for display.
 */
export function getScoreLevel(score) {
    if (score >= POI_SCORE_HIGH_THRESHOLD) return 'alta';
    if (score >= POI_SCORE_MID_THRESHOLD) return 'media';
    return 'bassa';
}

/**
 * Returns the coloured circle emoji for a score.
 */
export function getScoreEmoji(score) {
    if (score >= POI_SCORE_HIGH_THRESHOLD) return '🟢';
    if (score >= POI_SCORE_MID_THRESHOLD) return '🟡';
    return '⚫';
}
