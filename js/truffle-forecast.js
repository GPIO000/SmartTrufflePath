import { fetchWithOfflineCheck } from './offline-api-manager.js';
import { calcMoonPhase } from './weather-moon.js';

const ARCHIVE_API_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_CACHE_PREFIX = 'truffle_forecast_cache_';
const FORECAST_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 15;
const DEFAULT_FORECAST_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// [... resto del file rimane uguale fino a fetchJson ...]

async function fetchJson(url) {
    // 🔑 Usa fetchWithOfflineCheck con gestione offline
    try {
        const response = await fetchWithOfflineCheck(url, {}, 'truffle-forecast-api');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    } catch (err) {
        // Se offline, rilanciare l'errore per gestione nel caller
        console.error('[TruffleForecast] Fetch fallito:', err.message || err.code);
        throw err;
    }
}

// [Resto del file rimane identico]
