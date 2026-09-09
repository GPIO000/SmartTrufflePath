import { fetchWithOfflineCheck } from './offline-api-manager.js';
import { calcMoonPhase } from './weather-moon.js';

const ARCHIVE_API_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_LOOKBACK_DAYS = 15;
const DEFAULT_FORECAST_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_MAP = {
    gen: 0, gennaio: 0,
    feb: 1, febbraio: 1,
    mar: 2, marzo: 2,
    apr: 3, aprile: 3,
    mag: 4, maggio: 4,
    giu: 5, giugno: 5,
    lug: 6, luglio: 6,
    ago: 7, agosto: 7,
    set: 8, settembre: 8,
    ott: 9, ottobre: 9,
    nov: 10, novembre: 10,
    dic: 11, dicembre: 11
};

const WEEKDAY_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

const FEEDBACK_CLASSES_MAGNATUM = [
    { id: 'none', label: 'Nessun ritrovamento', found: false, emoji: '➖', score: -8 },
    { id: 'lt100', label: '< 100g', found: true, emoji: '🟡', score: 2 },
    { id: 'gte100_lt300', label: '100g - 299g', found: true, emoji: '🟢', score: 6 },
    { id: 'gte300', label: '≥ 300g', found: true, emoji: '🏆', score: 10 }
];

const FEEDBACK_CLASSES_DEFAULT = [
    { id: 'none', label: 'Nessun ritrovamento', found: false, emoji: '➖', score: -8 },
    { id: 'lt500', label: '< 500g', found: true, emoji: '🟡', score: 4 },
    { id: 'gte500', label: '≥ 500g', found: true, emoji: '🏆', score: 10 }
];

const AREA_PROFILES = [
    { id: 'umido', label: 'Umido / fondovalle', humidityBoost: 1.06, windPenaltyFactor: 0.9 },
    { id: 'equilibrato', label: 'Equilibrato', humidityBoost: 1, windPenaltyFactor: 1 },
    { id: 'fresco', label: 'Fresco / collina', humidityBoost: 0.98, windPenaltyFactor: 1.05 },
    { id: 'ventilato', label: 'Ventilato / quota', humidityBoost: 0.95, windPenaltyFactor: 1.12 }
];

export const TRUFFLE_SPECIES_FORECAST = [
    { id: 0, name: 'Tuber magnatum Pico (Tartufo bianco pregiato)', shortName: 'Bianco pregiato' },
    { id: 1, name: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)', shortName: 'Nero pregiato' },
    { id: 2, name: 'Tuber macrosporum Vitt. (Tartufo nero liscio)', shortName: 'Nero liscio' },
    { id: 3, name: 'Tuber brumale Vitt. (Tartufo invernale)', shortName: 'Brumale' },
    { id: 4, name: 'Tuber brumale var. moschatum (Tartufo moscato)', shortName: 'Brumale moscato' },
    { id: 5, name: 'Tuber aestivum Vitt. (Tartufo scorzone estivo)', shortName: 'Scorzone estivo' },
    { id: 6, name: 'Tuber uncinatum Chatin (Tartufo uncinato)', shortName: 'Scorzone invernale' },
    { id: 7, name: 'Tuber borchii Vitt. / albidum Pico (Bianchetto)', shortName: 'Bianchetto' },
    { id: 8, name: 'Tuber mesentericum Vitt. (Tartufo nero ordinario)', shortName: 'Nero ordinario' }
];

function toDateOnly(date) {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateISO(date) {
    return toDateOnly(date).toISOString().slice(0, 10);
}

function safeAvg(values) {
    const filtered = values.filter((value) => Number.isFinite(value));
    if (!filtered.length) return null;
    return filtered.reduce((acc, value) => acc + value, 0) / filtered.length;
}

function parseMonthToken(rawMonth) {
    const normalized = String(rawMonth ?? '').trim().toLowerCase().replace(/[.]/g, '');
    return MONTH_MAP[normalized];
}

function parsePeriodEndpoint(raw) {
    const match = String(raw ?? '').trim().toLowerCase().match(/(\d{1,2})\s+([a-zàèéìòù.]+)/i);
    if (!match) return null;
    const day = Number.parseInt(match[1], 10);
    const month = parseMonthToken(match[2]);
    if (!Number.isFinite(day) || day < 1 || day > 31 || !Number.isInteger(month)) return null;
    return { day, month };
}

function compareMonthDay(a, b) {
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
}

function scoreToLevel(score) {
    if (score >= 70) return 'alta';
    if (score >= 45) return 'media';
    return 'bassa';
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProfile(areaProfile) {
    if (areaProfile && typeof areaProfile === 'object' && typeof areaProfile.id === 'string') {
        const fromObj = AREA_PROFILES.find((p) => p.id === areaProfile.id);
        if (fromObj) return fromObj;
    }
    if (typeof areaProfile === 'string') {
        const fromId = AREA_PROFILES.find((p) => p.id === areaProfile);
        if (fromId) return fromId;
    }
    return AREA_PROFILES[1];
}

function getSpeciesProfile(speciesId) {
    return TRUFFLE_SPECIES_FORECAST.find((species) => Number(species.id) === Number(speciesId)) || TRUFFLE_SPECIES_FORECAST[0];
}

function getFeedbackClassScore(speciesId, feedbackEntry) {
    const resolved = resolveFeedbackEntryClass(speciesId, feedbackEntry);
    return resolved?.score ?? 0;
}

function filterMatchingFeedback(feedbackHistory, speciesName, locationLabel, date) {
    return (Array.isArray(feedbackHistory) ? feedbackHistory : []).filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.speciesName && entry.speciesName !== speciesName) return false;
        if (entry.locationLabel && entry.locationLabel !== locationLabel) return false;
        if (!entry.date) return true;
        const entryDate = toDateOnly(`${entry.date}T12:00:00`);
        const dayDiff = Math.abs((toDateOnly(date).getTime() - entryDate.getTime()) / DAY_MS);
        return dayDiff <= 365;
    });
}

function sum(series, selector) {
    return series.reduce((acc, item) => {
        const value = selector(item);
        return acc + (Number.isFinite(value) ? value : 0);
    }, 0);
}

function lastN(days, endIndex, size) {
    const start = Math.max(0, endIndex - size + 1);
    return days.slice(start, endIndex + 1);
}

function findDayByDate(days, targetDate) {
    return days.find((day) => day.date === targetDate) || null;
}

function buildDayMetrics(series, index) {
    const rain15Window = lastN(series, index, 15);
    const rain5Window = lastN(series, index, 5);
    const moisture7Window = lastN(series, index, 7);
    const humidity7Window = lastN(series, index, 7);
    const temp7Window = lastN(series, index, 7);
    const wind5Window = lastN(series, index, 5);

    const rain15 = sum(rain15Window, (d) => d.precipitationSum);
    const usefulRain = sum(rain5Window, (d) => {
        const mm = toNumber(d.precipitationSum);
        if (!Number.isFinite(mm)) return 0;
        return mm >= 1 && mm <= 12 ? mm : 0;
    });
    const soilMoisture7 = safeAvg(moisture7Window.map((d) => toNumber(d.soilMoistureMean)));
    const humidity7 = safeAvg(humidity7Window.map((d) => toNumber(d.humidityMean)));
    const temperature7 = safeAvg(temp7Window.map((d) => toNumber(d.temperatureMean)));
    const maxWind5 = Math.max(0, ...wind5Window.map((d) => toNumber(d.windMax) ?? 0));

    return {
        rain15,
        usefulRain,
        soilMoisture7,
        humidity7,
        temperature7,
        maxWind5,
    };
}

function scoreDay(metrics, profile, feedbackAdjustment = 0, historyBoost = 0) {
    let score = 40;
    const reasons = [];

    if (Number.isFinite(metrics.soilMoisture7)) {
        if (metrics.soilMoisture7 >= 0.22) {
            score += 18;
            reasons.push('Suolo umido favorevole');
        } else if (metrics.soilMoisture7 <= 0.14) {
            score -= 24;
            reasons.push('Terreno secco');
        } else {
            reasons.push('Umidità del suolo moderata');
        }
    }

    if (metrics.usefulRain >= 8) {
        score += 10;
        reasons.push('Piogge utili recenti');
    } else if (metrics.usefulRain < 3) {
        score -= 10;
        reasons.push('Piogge utili insufficienti');
    }

    const adjustedHumidity = Number.isFinite(metrics.humidity7) ? metrics.humidity7 * profile.humidityBoost : null;
    if (Number.isFinite(adjustedHumidity)) {
        if (adjustedHumidity >= 68) {
            score += 8;
            reasons.push('Umidità aria favorevole');
        } else if (adjustedHumidity < 50) {
            score -= 9;
            reasons.push('Aria troppo secca');
        }
    }

    if (Number.isFinite(metrics.temperature7)) {
        if (metrics.temperature7 >= 8 && metrics.temperature7 <= 21) {
            score += 8;
            reasons.push('Temperatura nella fascia ottimale');
        } else {
            score -= 7;
            reasons.push('Temperatura poco favorevole');
        }
    }

    const effectiveWind = metrics.maxWind5 * profile.windPenaltyFactor;
    if (effectiveWind > 32) {
        score -= 16;
        reasons.push('Vento forte persistente');
    } else if (effectiveWind <= 20) {
        score += 4;
        reasons.push('Vento contenuto');
    }

    if (historyBoost > 0) {
        score += historyBoost;
        reasons.push('Storico locale positivo');
    }

    if (feedbackAdjustment !== 0) {
        score += feedbackAdjustment;
        if (feedbackAdjustment > 0) reasons.push('Feedback recente positivo');
        else reasons.push('Feedback recente negativo');
    }

    return {
        score: clamp(Math.round(score), 0, 100),
        reasons,
    };
}

function computeHistoryBoost(harvestHistory, speciesName, locationLabel, dayDate) {
    let boost = 0;
    const todayMonth = toDateOnly(dayDate).getUTCMonth();
    for (const entry of Array.isArray(harvestHistory) ? harvestHistory : []) {
        if (!entry || entry.specie !== speciesName) continue;
        if (entry.luogo && locationLabel && entry.luogo !== locationLabel) continue;
        if (!entry.data) continue;
        const entryMonth = toDateOnly(`${entry.data}T12:00:00`).getUTCMonth();
        const monthDiff = Math.abs(entryMonth - todayMonth);
        const cyclicDist = Math.min(monthDiff, 12 - monthDiff);
        if (cyclicDist <= 1) boost += 4;
        else if (cyclicDist <= 2) boost += 2;
    }
    return clamp(boost, 0, 10);
}

export function getFeedbackClassesForSpecies(speciesId) {
    return Number(speciesId) === 0 ? FEEDBACK_CLASSES_MAGNATUM : FEEDBACK_CLASSES_DEFAULT;
}

export function resolveFeedbackEntryClass(speciesId, feedbackEntry) {
    const classes = getFeedbackClassesForSpecies(speciesId);
    if (!feedbackEntry || typeof feedbackEntry !== 'object') return classes[0];

    const byClassId = classes.find((entry) => entry.id === feedbackEntry.outcomeClassId);
    if (byClassId) return byClassId;

    if (feedbackEntry.found === true) {
        return classes[classes.length - 1];
    }
    if (feedbackEntry.found === false) {
        return classes.find((entry) => entry.id === 'none') || classes[0];
    }

    return classes[0];
}

export function getAreaProfiles() {
    return AREA_PROFILES.map((profile) => ({ ...profile }));
}

export function isDateWithinPeriod(periodStr, date = new Date()) {
    if (typeof periodStr !== 'string' || !periodStr.includes('-')) return false;
    const [rawStart, rawEnd] = periodStr.split('-').map((part) => part.trim());
    const start = parsePeriodEndpoint(rawStart);
    const end = parsePeriodEndpoint(rawEnd);
    if (!start || !end) return false;

    const current = {
        day: date.getDate(),
        month: date.getMonth()
    };

    const normalRange = compareMonthDay(start, end) <= 0;
    if (normalRange) {
        return compareMonthDay(current, start) >= 0 && compareMonthDay(current, end) <= 0;
    }

    return compareMonthDay(current, start) >= 0 || compareMonthDay(current, end) <= 0;
}

export function getOpenSpeciesForRegion(regionCalendar = {}, date = new Date()) {
    if (!regionCalendar || typeof regionCalendar !== 'object' || Array.isArray(regionCalendar)) return [];
    return TRUFFLE_SPECIES_FORECAST.filter((species) => {
        const period = regionCalendar[species.id];
        return period && isDateWithinPeriod(period, date);
    });
}

export function aggregateHourlyToDaily(hourly = {}) {
    const time = Array.isArray(hourly.time) ? hourly.time : [];
    const grouped = new Map();

    time.forEach((timeValue, index) => {
        const iso = String(timeValue);
        const date = iso.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const bucket = grouped.get(date) || {
            date,
            temps: [],
            humidity: [],
            precipitation: [],
            wind: [],
            soil: []
        };

        bucket.temps.push(toNumber(hourly.temperature_2m?.[index]));
        bucket.humidity.push(toNumber(hourly.relative_humidity_2m?.[index]));
        bucket.precipitation.push(toNumber(hourly.precipitation?.[index]));
        bucket.wind.push(toNumber(hourly.wind_speed_10m?.[index]));
        bucket.soil.push(toNumber(hourly.soil_moisture_0_to_1cm?.[index]));
        grouped.set(date, bucket);
    });

    return [...grouped.values()].map((bucket) => {
        const validTemps = bucket.temps.filter((value) => Number.isFinite(value));
        const validHumidity = bucket.humidity.filter((value) => Number.isFinite(value));
        const validPrecip = bucket.precipitation.filter((value) => Number.isFinite(value));
        const validWind = bucket.wind.filter((value) => Number.isFinite(value));
        const validSoil = bucket.soil.filter((value) => Number.isFinite(value));

        const temperatureMean = safeAvg(validTemps) ?? 0;
        const temperatureMin = validTemps.length ? Math.min(...validTemps) : temperatureMean;
        const temperatureMax = validTemps.length ? Math.max(...validTemps) : temperatureMean;

        return {
            date: bucket.date,
            temperatureMean: Number(temperatureMean.toFixed(2)),
            temperatureMin: Number(temperatureMin.toFixed(2)),
            temperatureMax: Number(temperatureMax.toFixed(2)),
            temperatureSwing: Number((temperatureMax - temperatureMin).toFixed(2)),
            humidityMean: Number((safeAvg(validHumidity) ?? 0).toFixed(2)),
            precipitationSum: Number(validPrecip.reduce((acc, value) => acc + value, 0).toFixed(2)),
            windMax: Number((validWind.length ? Math.max(...validWind) : 0).toFixed(2)),
            soilMoistureMean: Number((safeAvg(validSoil) ?? 0).toFixed(3))
        };
    }).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeHourlySeries(primary = {}, secondary = {}) {
    const rows = new Map();

    const ingest = (source) => {
        const times = Array.isArray(source.time) ? source.time : [];
        times.forEach((time, index) => {
            const key = String(time);
            const row = rows.get(key) || { time: key };
            const assign = (field, target) => {
                const value = toNumber(source[field]?.[index]);
                if (Number.isFinite(value)) row[target] = value;
            };
            assign('temperature_2m', 'temperature_2m');
            assign('relative_humidity_2m', 'relative_humidity_2m');
            assign('precipitation', 'precipitation');
            assign('wind_speed_10m', 'wind_speed_10m');
            assign('soil_moisture_0_to_1cm', 'soil_moisture_0_to_1cm');
            rows.set(key, row);
        });
    };

    ingest(primary);
    ingest(secondary);

    const sorted = [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
    return {
        time: sorted.map((row) => row.time),
        temperature_2m: sorted.map((row) => row.temperature_2m ?? null),
        relative_humidity_2m: sorted.map((row) => row.relative_humidity_2m ?? null),
        precipitation: sorted.map((row) => row.precipitation ?? null),
        wind_speed_10m: sorted.map((row) => row.wind_speed_10m ?? null),
        soil_moisture_0_to_1cm: sorted.map((row) => row.soil_moisture_0_to_1cm ?? null)
    };
}

async function fetchJson(url, apiName) {
    const response = await fetchWithOfflineCheck(url, {}, apiName);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

export async function fetchTruffleForecastDataset(lat, lng, options = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Coordinate non valide');
    }

    const lookbackDays = Number.isFinite(options.lookbackDays) ? Number(options.lookbackDays) : DEFAULT_LOOKBACK_DAYS;
    const forecastDays = Number.isFinite(options.forecastDays) ? Number(options.forecastDays) : DEFAULT_FORECAST_DAYS;

    const now = new Date();
    const today = toDateOnly(now);
    const start = new Date(today.getTime() - lookbackDays * DAY_MS);

    const commonParams = new URLSearchParams({
        latitude: lat.toFixed(4),
        longitude: lng.toFixed(4),
        hourly: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_moisture_0_to_1cm',
        timezone: 'auto'
    });

    const archiveParams = new URLSearchParams(commonParams);
    archiveParams.set('start_date', formatDateISO(start));
    archiveParams.set('end_date', formatDateISO(today));

    const forecastParams = new URLSearchParams(commonParams);
    forecastParams.set('forecast_days', String(Math.max(1, forecastDays + 1)));

    const [archive, forecast] = await Promise.all([
        fetchJson(`${ARCHIVE_API_URL}?${archiveParams.toString()}`, 'truffle-forecast-archive-api'),
        fetchJson(`${FORECAST_API_URL}?${forecastParams.toString()}`, 'truffle-forecast-forecast-api')
    ]);

    const mergedHourly = mergeHourlySeries(archive?.hourly, forecast?.hourly);
    const days = aggregateHourlyToDaily(mergedHourly);

    return {
        hourly: mergedHourly,
        days
    };
}

export function buildTruffleForecastCalendar({
    speciesId,
    legalPeriod,
    weatherSeries,
    locationLabel = 'Posizione',
    harvestHistory = [],
    feedbackHistory = [],
    referenceDate = new Date(),
    forecastDays = DEFAULT_FORECAST_DAYS,
    areaProfile = 'equilibrato'
} = {}) {
    const species = getSpeciesProfile(speciesId);
    const area = normalizeProfile(areaProfile);
    const series = Array.isArray(weatherSeries) ? weatherSeries : [];

    const startDate = toDateOnly(referenceDate);
    const days = [];

    for (let offset = 0; offset < Math.max(0, forecastDays); offset++) {
        const targetDate = new Date(startDate.getTime() + offset * DAY_MS);
        const targetIso = formatDateISO(targetDate);
        const seriesIndex = series.findIndex((entry) => entry?.date === targetIso);
        const currentDay = seriesIndex >= 0 ? series[seriesIndex] : findDayByDate(series, targetIso);

        if (!currentDay) {
            days.push({
                date: targetIso,
                dayLabel: WEEKDAY_IT[targetDate.getDay()],
                legalOpen: false,
                score: 0,
                level: 'bassa',
                reasons: ['Dati meteo mancanti'],
                moon: calcMoonPhase(targetDate),
                metrics: {
                    rain15: '0.0',
                    usefulRain: '0.0',
                    soilMoisture7: 'n/d',
                    humidity7: 'n/d',
                    temperature7: 'n/d',
                    maxWind5: '0'
                }
            });
            continue;
        }

        const metrics = buildDayMetrics(series, seriesIndex);
        const matchingFeedback = filterMatchingFeedback(feedbackHistory, species.name, locationLabel, targetDate);
        const feedbackAdjustment = clamp(sum(matchingFeedback, (entry) => getFeedbackClassScore(species.id, entry)), -12, 12);
        const historyBoost = computeHistoryBoost(harvestHistory, species.name, locationLabel, targetDate);

        const legalOpen = isDateWithinPeriod(legalPeriod, targetDate);

        let score = 0;
        let reasons = ['Fuori periodo regionale'];
        if (legalOpen) {
            const scored = scoreDay(metrics, area, feedbackAdjustment, historyBoost);
            score = scored.score;
            reasons = scored.reasons;
        }

        days.push({
            date: targetIso,
            dayLabel: WEEKDAY_IT[targetDate.getDay()],
            legalOpen,
            score,
            level: scoreToLevel(score),
            reasons,
            moon: calcMoonPhase(targetDate),
            metrics: {
                rain15: metrics.rain15.toFixed(1),
                usefulRain: metrics.usefulRain.toFixed(1),
                soilMoisture7: Number.isFinite(metrics.soilMoisture7) ? metrics.soilMoisture7.toFixed(3) : 'n/d',
                humidity7: Number.isFinite(metrics.humidity7) ? metrics.humidity7.toFixed(0) : 'n/d',
                temperature7: Number.isFinite(metrics.temperature7) ? metrics.temperature7.toFixed(1) : 'n/d',
                maxWind5: metrics.maxWind5.toFixed(0)
            }
        });
    }

    let bestDay = null;
    for (const day of days) {
        if (!day.legalOpen) continue;
        if (!bestDay || day.score > bestDay.score) bestDay = day;
    }

    return {
        species,
        legalPeriod,
        locationLabel,
        areaProfile: area,
        days,
        bestDay
    };
}
