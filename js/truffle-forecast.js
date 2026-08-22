import { calcMoonPhase } from './weather-moon.js';

const ARCHIVE_API_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_CACHE_PREFIX = 'truffle_forecast_cache_';
const FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 15;
const DEFAULT_FORECAST_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const AREA_PROFILES = [
    {
        id: 'equilibrato',
        label: 'Bosco equilibrato',
        description: 'Condizioni standard senza correzioni aggiuntive.',
        rainAdjustment: 0,
        soilMoistureAdjustment: 0,
        windPenaltyBoost: 0,
        temperatureShift: 0
    },
    {
        id: 'umido',
        label: 'Fondovalle / area umida',
        description: 'Trattiene più umidità e soffre meno la siccità breve.',
        rainAdjustment: -6,
        soilMoistureAdjustment: 0.03,
        windPenaltyBoost: -0.05,
        temperatureShift: -1
    },
    {
        id: 'ventilato',
        label: 'Collina esposta / ventilata',
        description: 'Asciuga più rapidamente e patisce il vento.',
        rainAdjustment: 8,
        soilMoistureAdjustment: -0.02,
        windPenaltyBoost: 0.12,
        temperatureShift: 1
    },
    {
        id: 'fresco',
        label: 'Bosco fresco / quota media',
        description: 'Più tollerante al fresco e alle escursioni moderate.',
        rainAdjustment: 2,
        soilMoistureAdjustment: 0.01,
        windPenaltyBoost: 0,
        temperatureShift: -2
    }
];

export const TRUFFLE_SPECIES_FORECAST = [
    {
        id: 0,
        name: 'Tuber magnatum Pico (Tartufo bianco pregiato)',
        shortName: 'Bianco pregiato',
        tempMin: 9,
        tempMax: 18,
        rainMin: 22,
        rainMax: 60,
        usefulRainMin: 7,
        usefulRainMax: 20,
        soilMoistureMin: 0.22,
        soilMoistureMax: 0.4,
        humidityMin: 64,
        humidityMax: 92,
        maxWind: 27,
        maxDryDays: 4,
        moonBoostPhases: ['Luna crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 1,
        name: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)',
        shortName: 'Nero pregiato',
        tempMin: 8,
        tempMax: 19,
        rainMin: 18,
        rainMax: 52,
        usefulRainMin: 6,
        usefulRainMax: 18,
        soilMoistureMin: 0.18,
        soilMoistureMax: 0.34,
        humidityMin: 58,
        humidityMax: 86,
        maxWind: 29,
        maxDryDays: 5,
        moonBoostPhases: ['Quarto crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 2,
        name: 'Tuber macrosporum Vitt. (Tartufo nero liscio)',
        shortName: 'Macrosporum',
        tempMin: 7,
        tempMax: 18,
        rainMin: 18,
        rainMax: 48,
        usefulRainMin: 6,
        usefulRainMax: 16,
        soilMoistureMin: 0.19,
        soilMoistureMax: 0.35,
        humidityMin: 60,
        humidityMax: 88,
        maxWind: 28,
        maxDryDays: 5,
        moonBoostPhases: ['Luna crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 3,
        name: 'Tuber brumale Vitt. (Tartufo nero d\'inverno)',
        shortName: 'Brumale',
        tempMin: 5,
        tempMax: 16,
        rainMin: 16,
        rainMax: 44,
        usefulRainMin: 5,
        usefulRainMax: 14,
        soilMoistureMin: 0.18,
        soilMoistureMax: 0.33,
        humidityMin: 58,
        humidityMax: 86,
        maxWind: 30,
        maxDryDays: 5,
        moonBoostPhases: ['Quarto crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 4,
        name: 'Tuber brumale var. moschatum De Ferry (Tartufo moscato)',
        shortName: 'Moscato',
        tempMin: 5,
        tempMax: 16,
        rainMin: 16,
        rainMax: 42,
        usefulRainMin: 5,
        usefulRainMax: 14,
        soilMoistureMin: 0.18,
        soilMoistureMax: 0.32,
        humidityMin: 58,
        humidityMax: 86,
        maxWind: 30,
        maxDryDays: 5,
        moonBoostPhases: ['Quarto crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 5,
        name: 'Tuber aestivum Vitt. (Tartufo estivo o scorzone)',
        shortName: 'Scorzone',
        tempMin: 14,
        tempMax: 28,
        rainMin: 10,
        rainMax: 34,
        usefulRainMin: 4,
        usefulRainMax: 12,
        soilMoistureMin: 0.14,
        soilMoistureMax: 0.28,
        humidityMin: 44,
        humidityMax: 76,
        maxWind: 32,
        maxDryDays: 6,
        moonBoostPhases: ['Luna crescente', 'Quarto crescente']
    },
    {
        id: 6,
        name: 'Tuber uncinatum Chatin (Tartufo uncinato)',
        shortName: 'Uncinato',
        tempMin: 10,
        tempMax: 22,
        rainMin: 15,
        rainMax: 44,
        usefulRainMin: 5,
        usefulRainMax: 15,
        soilMoistureMin: 0.18,
        soilMoistureMax: 0.33,
        humidityMin: 54,
        humidityMax: 82,
        maxWind: 30,
        maxDryDays: 5,
        moonBoostPhases: ['Luna crescente', 'Gibbosa crescente', 'Luna piena']
    },
    {
        id: 7,
        name: 'Tuber borchii Vitt. / T. albidum Pico (Bianchetto o marzuolo)',
        shortName: 'Bianchetto',
        tempMin: 8,
        tempMax: 18,
        rainMin: 12,
        rainMax: 40,
        usefulRainMin: 4,
        usefulRainMax: 14,
        soilMoistureMin: 0.16,
        soilMoistureMax: 0.31,
        humidityMin: 52,
        humidityMax: 80,
        maxWind: 28,
        maxDryDays: 5,
        moonBoostPhases: ['Quarto crescente', 'Gibbosa crescente']
    },
    {
        id: 8,
        name: 'Tuber mesentericum Vitt. (Tartufo nero di Bagnoli Irpino)',
        shortName: 'Mesentericum',
        tempMin: 8,
        tempMax: 20,
        rainMin: 18,
        rainMax: 54,
        usefulRainMin: 6,
        usefulRainMax: 18,
        soilMoistureMin: 0.18,
        soilMoistureMax: 0.35,
        humidityMin: 58,
        humidityMax: 86,
        maxWind: 29,
        maxDryDays: 5,
        moonBoostPhases: ['Luna crescente', 'Gibbosa crescente', 'Luna piena']
    }
];

const MESI_MAP = {
    gennaio: 0, gen: 0,
    febbraio: 1, feb: 1,
    marzo: 2, mar: 2,
    aprile: 3, apr: 3,
    maggio: 4, mag: 4,
    giugno: 5, giu: 5,
    luglio: 6, lug: 6,
    agosto: 7, ago: 7,
    settembre: 8, set: 8, sett: 8,
    ottobre: 9, ott: 9,
    novembre: 10, nov: 10,
    dicembre: 11, dic: 11
};

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
}

function parseDateKey(dateKey) {
    return new Date(`${dateKey}T12:00:00`);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals = 1) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function safeNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase();
}

function getSpeciesProfile(speciesId) {
    return TRUFFLE_SPECIES_FORECAST.find((item) => item.id === Number(speciesId)) ?? null;
}

export function getAreaProfiles() {
    return AREA_PROFILES.map((profile) => ({ ...profile }));
}

function getAreaProfile(areaProfileId) {
    return AREA_PROFILES.find((profile) => profile.id === areaProfileId) ?? AREA_PROFILES[0];
}

function scoreBand(value, minIdeal, maxIdeal, toleranceBelow, toleranceAbove) {
    if (!Number.isFinite(value)) return 0;
    if (value >= minIdeal && value <= maxIdeal) return 1;
    if (value < minIdeal) {
        return clamp((value - (minIdeal - toleranceBelow)) / toleranceBelow, 0, 1);
    }
    return clamp(((maxIdeal + toleranceAbove) - value) / toleranceAbove, 0, 1);
}

function scoreCeiling(value, idealMax, hardMax) {
    if (!Number.isFinite(value)) return 0;
    if (value <= idealMax) return 1;
    return clamp((hardMax - value) / Math.max(1, hardMax - idealMax), 0, 1);
}

function sum(values) {
    return values.reduce((acc, value) => acc + safeNumber(value), 0);
}

function mean(values) {
    if (!values.length) return 0;
    return sum(values) / values.length;
}

function parsePeriodDate(rawValue, year) {
    const source = String(rawValue ?? '').toLowerCase().trim();
    if (!source) return null;

    const numericMatch = source.match(/(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{4}))?/);
    if (numericMatch) {
        const day = Number.parseInt(numericMatch[1], 10);
        const month = Number.parseInt(numericMatch[2], 10) - 1;
        const targetYear = numericMatch[3] ? Number.parseInt(numericMatch[3], 10) : year;
        return new Date(targetYear, month, day, 12, 0, 0, 0);
    }

    let monthIndex = null;
    let day = 1;
    for (const [monthLabel, index] of Object.entries(MESI_MAP)) {
        if (source.includes(monthLabel)) {
            monthIndex = index;
            break;
        }
    }
    if (monthIndex === null) return null;

    const dayMatch = source.match(/(\d{1,2})/);
    if (dayMatch) {
        day = Number.parseInt(dayMatch[1], 10);
    }
    return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

export function isDateWithinPeriod(periodStr, date = new Date()) {
    if (!periodStr) return false;

    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    const year = targetDate.getFullYear();
    const cleaned = String(periodStr)
        .toLowerCase()
        .replace(/\bdal\b/g, '')
        .replace(/\bal\b/g, '-')
        .replace(/\bdel\b/g, '')
        .trim();
    const parts = cleaned.split(/\s*-\s*/);
    if (parts.length < 2) return false;

    let start = parsePeriodDate(parts[0], year);
    let end = parsePeriodDate(parts[1], year);
    if (!start || !end) return false;

    if (start > end) {
        if (targetDate.getMonth() <= end.getMonth()) {
            start.setFullYear(year - 1);
        } else {
            end.setFullYear(year + 1);
        }
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return targetDate >= start && targetDate <= end;
}

function buildHourlyUrl(baseUrl, lat, lng, extraParams = {}) {
    const url = new URL(baseUrl);
    url.searchParams.set('latitude', Number(lat).toFixed(4));
    url.searchParams.set('longitude', Number(lng).toFixed(4));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set(
        'hourly',
        [
            'temperature_2m',
            'relative_humidity_2m',
            'precipitation',
            'wind_speed_10m',
            'soil_moisture_0_to_1cm'
        ].join(',')
    );
    Object.entries(extraParams).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function makeCacheKey(lat, lng, lookbackDays, forecastDays) {
    return `${FORECAST_CACHE_PREFIX}${Number(lat).toFixed(3)}_${Number(lng).toFixed(3)}_${lookbackDays}_${forecastDays}`;
}

function readForecastCache(lat, lng, lookbackDays, forecastDays) {
    try {
        const raw = localStorage.getItem(makeCacheKey(lat, lng, lookbackDays, forecastDays));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.savedAt || !parsed?.payload) return null;
        if (Date.now() - parsed.savedAt > FORECAST_CACHE_TTL_MS) return null;
        return parsed.payload;
    } catch {
        return null;
    }
}

function writeForecastCache(lat, lng, lookbackDays, forecastDays, payload) {
    try {
        localStorage.setItem(
            makeCacheKey(lat, lng, lookbackDays, forecastDays),
            JSON.stringify({ savedAt: Date.now(), payload })
        );
    } catch {
        // Ignora localStorage pieno.
    }
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

export function aggregateHourlyToDaily(hourly = {}) {
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    const grouped = new Map();

    times.forEach((timestamp, index) => {
        const dateKey = String(timestamp).slice(0, 10);
        if (!grouped.has(dateKey)) {
            grouped.set(dateKey, {
                date: dateKey,
                temperatureValues: [],
                humidityValues: [],
                precipitationValues: [],
                windValues: [],
                soilMoistureValues: []
            });
        }
        const bucket = grouped.get(dateKey);
        bucket.temperatureValues.push(hourly.temperature_2m?.[index]);
        bucket.humidityValues.push(hourly.relative_humidity_2m?.[index]);
        bucket.precipitationValues.push(hourly.precipitation?.[index]);
        bucket.windValues.push(hourly.wind_speed_10m?.[index]);
        bucket.soilMoistureValues.push(hourly.soil_moisture_0_to_1cm?.[index]);
    });

    return [...grouped.values()].map((bucket) => {
        const temperatureValues = bucket.temperatureValues.filter(Number.isFinite);
        const humidityValues = bucket.humidityValues.filter(Number.isFinite);
        const precipitationValues = bucket.precipitationValues.filter(Number.isFinite);
        const windValues = bucket.windValues.filter(Number.isFinite);
        const soilMoistureValues = bucket.soilMoistureValues.filter(Number.isFinite);
        const tempMax = temperatureValues.length ? Math.max(...temperatureValues) : 0;
        const tempMin = temperatureValues.length ? Math.min(...temperatureValues) : 0;
        return {
            date: bucket.date,
            temperatureMean: roundTo(mean(temperatureValues), 1),
            temperatureMin: roundTo(tempMin, 1),
            temperatureMax: roundTo(tempMax, 1),
            temperatureSwing: roundTo(tempMax - tempMin, 1),
            humidityMean: roundTo(mean(humidityValues), 1),
            precipitationSum: roundTo(sum(precipitationValues), 1),
            windMax: roundTo(windValues.length ? Math.max(...windValues) : 0, 1),
            soilMoistureMean: roundTo(mean(soilMoistureValues), 3)
        };
    }).sort((left, right) => left.date.localeCompare(right.date));
}

function mergeDailySeries(archiveDaily, forecastDaily, startDateKey) {
    const merged = new Map();
    [...archiveDaily, ...forecastDaily].forEach((day) => {
        merged.set(day.date, day);
    });

    return [...merged.values()]
        .filter((day) => day.date >= startDateKey)
        .sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchTruffleForecastDataset(lat, lng, options = {}) {
    const lookbackDays = Math.max(7, Number(options.lookbackDays) || DEFAULT_LOOKBACK_DAYS);
    const forecastDays = Math.max(3, Number(options.forecastDays) || DEFAULT_FORECAST_DAYS);
    const referenceDate = options.referenceDate instanceof Date ? options.referenceDate : new Date();
    const cache = readForecastCache(lat, lng, lookbackDays, forecastDays);
    if (cache) return cache;

    const startArchiveDate = addDays(referenceDate, -(lookbackDays - 1));
    const endArchiveDate = addDays(referenceDate, -1);
    const endForecastDate = addDays(referenceDate, forecastDays - 1);
    const startDateKey = formatDateKey(startArchiveDate);

    const archiveUrl = buildHourlyUrl(ARCHIVE_API_URL, lat, lng, {
        start_date: formatDateKey(startArchiveDate),
        end_date: formatDateKey(endArchiveDate)
    });
    const forecastUrl = buildHourlyUrl(FORECAST_API_URL, lat, lng, {
        start_date: formatDateKey(referenceDate),
        end_date: formatDateKey(endForecastDate)
    });

    const [archivePayload, forecastPayload] = await Promise.all([
        fetchJson(archiveUrl),
        fetchJson(forecastUrl)
    ]);

    const payload = {
        latitude: safeNumber(forecastPayload?.latitude, lat),
        longitude: safeNumber(forecastPayload?.longitude, lng),
        generatedAt: new Date().toISOString(),
        days: mergeDailySeries(
            aggregateHourlyToDaily(archivePayload?.hourly),
            aggregateHourlyToDaily(forecastPayload?.hourly),
            startDateKey
        )
    };

    writeForecastCache(lat, lng, lookbackDays, forecastDays, payload);
    return payload;
}

function collectWindow(series, endIndex, length) {
    const startIndex = Math.max(0, endIndex - length + 1);
    return series.slice(startIndex, endIndex + 1);
}

function countRecentDryDays(windowDays, threshold) {
    let counter = 0;
    for (let index = windowDays.length - 1; index >= 0; index -= 1) {
        const day = windowDays[index];
        if (safeNumber(day.precipitationSum) <= 0.4 && safeNumber(day.soilMoistureMean) < threshold) {
            counter += 1;
            continue;
        }
        break;
    }
    return counter;
}

function getMoonAdjustment(phaseName, preferredPhases) {
    if (!phaseName) return { score: 0, reason: 'fase lunare neutra' };
    if (preferredPhases.includes(phaseName)) {
        return { score: 6, reason: `fase lunare favorevole (${phaseName.toLowerCase()})` };
    }
    if (phaseName === 'Luna nuova' || phaseName === 'Luna calante') {
        return { score: -3, reason: `fase lunare meno favorevole (${phaseName.toLowerCase()})` };
    }
    return { score: 1, reason: `fase lunare neutra (${phaseName.toLowerCase()})` };
}

function summarizeHistorySignals({
    speciesName,
    locationLabel,
    targetDate,
    harvestHistory = [],
    feedbackHistory = []
}) {
    const normalizedSpecies = normalizeText(speciesName);
    const normalizedLocation = normalizeText(locationLabel);
    const targetMonth = targetDate.getMonth();
    let positives = 0;
    let negatives = 0;

    harvestHistory.forEach((entry) => {
        if (normalizeText(entry?.specie) !== normalizedSpecies) return;
        const entryDate = entry?.data ? new Date(`${entry.data}T12:00:00`) : null;
        if (!(entryDate instanceof Date) || Number.isNaN(entryDate?.getTime?.())) return;
        const monthDistance = Math.abs(entryDate.getMonth() - targetMonth);
        if (monthDistance > 1 && monthDistance < 11) return;
        const entryLocation = normalizeText(entry?.luogo);
        positives += normalizedLocation && entryLocation && (entryLocation.includes(normalizedLocation) || normalizedLocation.includes(entryLocation))
            ? 1.4
            : 0.45;
    });

    feedbackHistory.forEach((entry) => {
        if (normalizeText(entry?.speciesName) !== normalizedSpecies) return;
        const entryDate = entry?.date ? new Date(`${entry.date}T12:00:00`) : null;
        if (!(entryDate instanceof Date) || Number.isNaN(entryDate?.getTime?.())) return;
        const monthDistance = Math.abs(entryDate.getMonth() - targetMonth);
        if (monthDistance > 1 && monthDistance < 11) return;
        const entryLocation = normalizeText(entry?.locationLabel);
        const weight = normalizedLocation && entryLocation && (entryLocation.includes(normalizedLocation) || normalizedLocation.includes(entryLocation))
            ? 1.2
            : 0.6;
        if (entry?.found) positives += weight;
        else negatives += weight;
    });

    const rawScore = clamp(Math.round((positives - negatives) * 3), -10, 10);
    const reason = rawScore > 0
        ? `storico personale favorevole (${positives.toFixed(1)} segnali positivi)`
        : rawScore < 0
            ? `storico recente prudente (${negatives.toFixed(1)} segnali negativi)`
            : 'storico personale ancora neutro';

    return {
        score: rawScore,
        positives: roundTo(positives, 1),
        negatives: roundTo(negatives, 1),
        reason
    };
}

function pickReasons(items, fallback) {
    const positive = items.filter((item) => item && item.weight >= 0).sort((left, right) => right.weight - left.weight);
    const negative = items.filter((item) => item && item.weight < 0).sort((left, right) => left.weight - right.weight);
    const reasons = [];
    positive.slice(0, 2).forEach((item) => reasons.push(item.text));
    negative.slice(0, 2).forEach((item) => reasons.push(item.text));
    return reasons.length ? reasons : [fallback];
}

export function buildTruffleForecastCalendar({
    speciesId,
    legalPeriod,
    weatherSeries = [],
    harvestHistory = [],
    feedbackHistory = [],
    locationLabel = '',
    areaProfile = 'equilibrato',
    referenceDate = new Date(),
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    forecastDays = DEFAULT_FORECAST_DAYS
}) {
    const speciesProfile = getSpeciesProfile(speciesId);
    if (!speciesProfile) {
        throw new Error('Specie tartufo non supportata.');
    }

    const area = getAreaProfile(areaProfile);
    const referenceDateKey = formatDateKey(referenceDate);
    const firstForecastIndex = weatherSeries.findIndex((day) => day.date >= referenceDateKey);
    if (firstForecastIndex === -1) {
        return {
            species: speciesProfile,
            areaProfile: area,
            locationLabel,
            legalPeriod,
            days: [],
            bestDay: null
        };
    }

    const days = [];
    for (let offset = 0; offset < forecastDays; offset += 1) {
        const currentIndex = firstForecastIndex + offset;
        const targetDay = weatherSeries[currentIndex];
        if (!targetDay) break;
        const targetDate = parseDateKey(targetDay.date);
        const legalOpen = isDateWithinPeriod(legalPeriod, targetDate);
        const moon = calcMoonPhase(targetDate);
        const trailingWindow = collectWindow(weatherSeries, currentIndex, lookbackDays);
        const recent7Days = trailingWindow.slice(-7);
        const usefulRainWindow = trailingWindow.slice(Math.max(0, trailingWindow.length - 9), Math.max(0, trailingWindow.length - 2));
        const rain15 = roundTo(sum(trailingWindow.map((item) => item.precipitationSum)), 1);
        const usefulRain = roundTo(sum(usefulRainWindow.map((item) => item.precipitationSum)), 1);
        const soilMoisture7 = roundTo(mean(recent7Days.map((item) => item.soilMoistureMean)), 3);
        const humidity7 = roundTo(mean(recent7Days.map((item) => item.humidityMean)), 1);
        const temperature7 = roundTo(mean(recent7Days.map((item) => item.temperatureMean)), 1);
        const swing7 = roundTo(mean(recent7Days.map((item) => item.temperatureSwing)), 1);
        const maxWind5 = roundTo(Math.max(...trailingWindow.slice(-5).map((item) => safeNumber(item.windMax))), 1);
        const dryDays = countRecentDryDays(trailingWindow, speciesProfile.soilMoistureMin - 0.02 + area.soilMoistureAdjustment);

        if (!legalOpen) {
            days.push({
                date: targetDay.date,
                dayLabel: targetDate.toLocaleDateString('it-IT', { weekday: 'short' }),
                moon,
                score: 0,
                level: 'bassa',
                legalOpen: false,
                reasons: ['Fuori dal periodo regionale di raccolta.'],
                metrics: {
                    rain15,
                    usefulRain,
                    soilMoisture7,
                    humidity7,
                    temperature7,
                    swing7,
                    maxWind5,
                    dryDays
                },
                components: {}
            });
            continue;
        }

        const rainScore = scoreBand(
            rain15,
            speciesProfile.rainMin + area.rainAdjustment,
            speciesProfile.rainMax + area.rainAdjustment,
            18,
            22
        );
        const usefulRainScore = scoreBand(
            usefulRain,
            speciesProfile.usefulRainMin + Math.round(area.rainAdjustment / 3),
            speciesProfile.usefulRainMax + Math.round(area.rainAdjustment / 3),
            5,
            7
        );
        const soilMoistureScore = scoreBand(
            soilMoisture7,
            speciesProfile.soilMoistureMin + area.soilMoistureAdjustment,
            speciesProfile.soilMoistureMax + area.soilMoistureAdjustment,
            0.08,
            0.1
        );
        const humidityScore = scoreBand(
            humidity7,
            speciesProfile.humidityMin,
            speciesProfile.humidityMax,
            18,
            12
        );
        const temperatureScore = scoreBand(
            temperature7,
            speciesProfile.tempMin + area.temperatureShift,
            speciesProfile.tempMax + area.temperatureShift,
            6,
            7
        );
        const stabilityScore = scoreCeiling(swing7, 11, 20);
        const windScore = scoreCeiling(maxWind5, speciesProfile.maxWind + area.windPenaltyBoost * 10, 48);
        const dryPenaltyScore = clamp(1 - Math.max(0, dryDays - speciesProfile.maxDryDays) / 5, 0, 1);
        const moonAdjustment = getMoonAdjustment(moon.name, speciesProfile.moonBoostPhases);
        const historySignal = summarizeHistorySignals({
            speciesName: speciesProfile.name,
            locationLabel,
            targetDate,
            harvestHistory,
            feedbackHistory
        });

        const score = clamp(Math.round(
            rainScore * 18 +
            usefulRainScore * 10 +
            soilMoistureScore * 22 +
            humidityScore * 10 +
            temperatureScore * 16 +
            stabilityScore * 8 +
            windScore * 8 +
            dryPenaltyScore * 2 +
            moonAdjustment.score +
            historySignal.score
        ), 0, 100);

        const reasons = pickReasons([
            usefulRainScore >= 0.72 ? { weight: 4, text: 'Piogge utili concentrate 3–8 giorni prima.' } : null,
            rainScore >= 0.72 ? { weight: 3, text: 'Accumulo pioggia degli ultimi 15 giorni ben distribuito.' } : null,
            soilMoistureScore >= 0.72 ? { weight: 3, text: 'Suolo umido ma non saturo.' } : null,
            temperatureScore >= 0.72 && stabilityScore >= 0.65 ? { weight: 2, text: 'Temperature coerenti e abbastanza stabili per la specie.' } : null,
            humidityScore >= 0.7 ? { weight: 2, text: 'Umidità dell’aria favorevole.' } : null,
            moonAdjustment.score > 0 ? { weight: 1, text: `Lieve bonus lunare: ${moonAdjustment.reason}.` } : null,
            historySignal.score > 0 ? { weight: 1, text: `Apprendimento locale: ${historySignal.reason}.` } : null,
            dryPenaltyScore < 0.45 ? { weight: -4, text: 'Terreno secco da troppi giorni.' } : null,
            soilMoistureScore < 0.45 ? { weight: -3, text: 'Umidità del suolo fuori equilibrio.' } : null,
            temperatureScore < 0.45 ? { weight: -3, text: 'Temperature poco adatte alla specie selezionata.' } : null,
            windScore < 0.45 ? { weight: -2, text: 'Vento recente elevato con possibile asciugatura del suolo.' } : null,
            usefulRainScore < 0.35 ? { weight: -2, text: 'Manca una pioggia utile nella finestra 3–8 giorni.' } : null,
            historySignal.score < 0 ? { weight: -1, text: `Storico personale prudente: ${historySignal.reason}.` } : null
        ], 'Condizioni intermedie: serve conferma sul campo.');

        days.push({
            date: targetDay.date,
            dayLabel: targetDate.toLocaleDateString('it-IT', { weekday: 'short' }),
            moon,
            score,
            level: score >= 70 ? 'alta' : score >= 45 ? 'media' : 'bassa',
            legalOpen: true,
            reasons,
            metrics: {
                rain15,
                usefulRain,
                soilMoisture7,
                humidity7,
                temperature7,
                swing7,
                maxWind5,
                dryDays
            },
            components: {
                moonReason: moonAdjustment.reason,
                historyReason: historySignal.reason,
                positives: historySignal.positives,
                negatives: historySignal.negatives
            }
        });
    }

    const bestDay = days
        .filter((day) => day.legalOpen)
        .sort((left, right) => right.score - left.score)[0] ?? null;

    return {
        species: speciesProfile,
        areaProfile: area,
        locationLabel,
        legalPeriod,
        days,
        bestDay
    };
}
