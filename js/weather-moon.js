import { isOnline, canFetchAPI, onConnectivityChange, fetchWithOfflineCheck, getStatusString } from './offline-api-manager.js';
import { calcMoonPhase } from './weather-moon.js';

const CACHE_TTL_MS     = 30 * 60 * 1000; // 30 minuti
const MIN_MOVE_KM      = 5;              // soglia spostamento per nuovo fetch
const REQUEST_TIMEOUT_MS = 8000;

// Codici WMO → emoji + descrizione italiana
const WMO_CODES = {
    0:  { icon: '☀️',  label: 'Sereno' },
    1:  { icon: '🌤️', label: 'Prevalentemente sereno' },
    2:  { icon: '⛅',  label: 'Parzialmente nuvoloso' },
    3:  { icon: '☁️',  label: 'Coperto' },
    45: { icon: '🌫️', label: 'Nebbia' },
    48: { icon: '🌫️', label: 'Nebbia con brina' },
    51: { icon: '🌦️', label: 'Pioggerella leggera' },
    53: { icon: '🌦️', label: 'Pioggerella moderata' },
    55: { icon: '🌧️', label: 'Pioggerella densa' },
    61: { icon: '🌧️', label: 'Pioggia leggera' },
    63: { icon: '🌧️', label: 'Pioggia moderata' },
    65: { icon: '⛈️', label: 'Pioggia pesante' },
    71: { icon: '❄️',  label: 'Neve leggera' },
    73: { icon: '❄️',  label: 'Neve moderata' },
    75: { icon: '❄️',  label: 'Neve pesante' },
    80: { icon: '🌧️', label: 'Rovescio leggero' },
    81: { icon: '⛈️', label: 'Rovescio moderato' },
    82: { icon: '⛈️', label: 'Rovescio violento' },
    85: { icon: '❄️',  label: 'Rovescio di neve leggero' },
    86: { icon: '❄️',  label: 'Rovescio di neve pesante' },
    95: { icon: '⛈️', label: 'Temporale' },
    96: { icon: '⛈️', label: 'Temporale con grandine leggera' },
    99: { icon: '⛈️', label: 'Temporale con grandine pesante' }
};

// ── Cache locale ───────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'weather_cache_';
const _cache = new Map();

function getCacheKey(lat, lng) {
    return `${CACHE_KEY_PREFIX}${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

function loadCache(lat, lng) {
    const key = getCacheKey(lat, lng);
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
        return cached.data;
    }
    _cache.delete(key);
    return null;
}

function saveCache(lat, lng, data) {
    const key = getCacheKey(lat, lng);
    _cache.set(key, { data, savedAt: Date.now() });
}

// ── Fetch Open-Meteo con offline check ─────────────────────────────────────

async function fetchWeather(lat, lng) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',   lat.toFixed(4));
    url.searchParams.set('longitude',  lng.toFixed(4));
    url.searchParams.set('current',    'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m');
    url.searchParams.set('daily',      [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'wind_speed_10m_max',
    ].join(','));
    url.searchParams.set('forecast_days', '4');
    url.searchParams.set('timezone',      'auto');

    // 🔑 Usa fetchWithOfflineCheck invece di fetch diretto
    const resp = await fetchWithOfflineCheck(url.toString(), {}, 'weather-api');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
}

function createWeatherError(code, message, cause = null) {
    const error = new Error(message);
    error.code = code;
    error.cause = cause;
    return error;
}

function describeWeatherError(error) {
    if (error?.code === 'OFFLINE') {
        return {
            logMessage: 'Dispositivo offline - usando dati in cache',
            shortMessage: 'Offline',
            detail: 'La connessione è offline. Viene visualizzata l\'ultima previsione meteo disponibile.'
        };
    }
    if (error?.code === 'TIMEOUT') {
        return {
            logMessage: 'Timeout richiesta meteo',
            shortMessage: 'Timeout',
            detail: 'Il server meteo ha impiegato troppo tempo a rispondere.'
        };
    }
    if (error?.code === 'API_UNAVAILABLE') {
        return {
            logMessage: `API meteo temporaneamente non disponibile: ${error.apiName}`,
            shortMessage: 'API non disponibile',
            detail: `${error.apiName} è temporaneamente non disponibile.`
        };
    }
    if (error?.code === 'NETWORK_ERROR') {
        return {
            logMessage: 'Errore di rete generale',
            shortMessage: 'Errore rete',
            detail: 'Si è verificato un errore di rete. Controlla la tua connessione.'
        };
    }
    return {
        logMessage: `Errore meteo: ${error?.message || 'sconosciuto'}`,
        shortMessage: 'Errore',
        detail: error?.message || 'Errore sconosciuto nel caricamento del meteo.'
    };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function wmoInfo(code) {
    return WMO_CODES[Number(code)] || { icon: '❓', label: 'Sconosciuto' };
}

/**
 * Descrizione testuale dello stato dei dati meteo visualizzati.
 * @param {'live'|'cache'|'stale'|'error'} dataSource
 * @param {object|null} errorStatus  Oggetto da describeWeatherError, solo per 'stale'/'error'
 * @returns {{ badge: string, detail: string }}
 *   badge  — testo breve per la compact bar
 *   detail — testo esteso per il pannello espanso
 */
function dataSourceLabel(dataSource, errorStatus = null) {
    switch (dataSource) {
        case 'live':
            return {
                badge: '🟢 In tempo reale',
                detail: `Ultimo aggiornamento meteo: ora. ${getStatusString()}`
            };
        case 'cache':
            return {
                badge: '🟡 Dalla cache',
                detail: `Dati meteo caricati dalla cache locale (ultimi 30 min). ${getStatusString()}`
            };
        case 'stale':
            return {
                badge: '🟠 Dati obsoleti',
                detail: `Dati meteo dalla cache, ma recente tentativo di aggiornamento non riuscito. ${errorStatus?.detail || ''}`
            };
        case 'error':
            return {
                badge: '🔴 Errore',
                detail: `Impossibile caricare i dati meteo. ${errorStatus?.detail || 'Riprova più tardi.'}`
            };
        default:
            return { badge: '❓', detail: 'Stato sconosciuto' };
    }
}

function renderWidget(widgetId, data, label, status = null, dataSource = 'live', expanded = false, setExpanded = () => {}) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;

    const current = data?.current || {};
    const daily = Array.isArray(data?.daily) ? data.daily : [];
    const { icon: wmoIcon } = wmoInfo(current.weather_code);
    const temp = Math.round(current.temperature_2m || 0);
    const wind = Math.round(current.wind_speed_10m || 0);
    const humidity = Math.round(current.relative_humidity_2m || 0);

    const { badge, detail } = dataSourceLabel(dataSource, status);

    const compactHtml = `
        <div class="wm-compact">
            <span class="wm-emoji">${wmoIcon}</span>
            <span class="wm-temp">${temp}°C</span>
            <span class="wm-badge">${badge}</span>
        </div>
    `;

    const nextDay = daily?.[1];
    const tempMax = nextDay?.temperature_2m_max || '–';
    const tempMin = nextDay?.temperature_2m_min || '–';
    const precipSum = nextDay?.precipitation_sum || 0;
    const precipLabel = precipSum > 0 ? `${precipSum}mm` : 'asciutto';
    const windMax = nextDay?.wind_speed_10m_max || '–';

    const panelHtml = `
        <div class="wm-panel">
            <div class="wm-header">
                <span class="wm-title">${label || 'Meteo'}</span>
                <span class="wm-close" aria-label="Chiudi">×</span>
            </div>
            <div class="wm-current">
                <span class="wm-emoji-large">${wmoIcon}</span>
                <div class="wm-current-details">
                    <div>${temp}°C, Vento ${wind}km/h, Umidità ${humidity}%</div>
                    <div class="wm-data-source">${detail}</div>
                </div>
            </div>
            <div class="wm-forecast">
                <strong>Domani:</strong> ${tempMax}°–${tempMin}°C, ${precipLabel}, Vento ${windMax}km/h
            </div>
        </div>
    `;

    widget.innerHTML = compactHtml + panelHtml;
    const compactBar = widget.querySelector('.wm-compact');
    const closeBtn = widget.querySelector('.wm-close');

    if (compactBar) {
        compactBar.addEventListener('click', () => setExpanded(!expanded));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => setExpanded(false));
    }

    if (expanded) {
        widget.classList.add('expanded');
    } else {
        widget.classList.remove('expanded');
    }
}

function hideWidget(widgetId) {
    const widget = document.getElementById(widgetId);
    if (widget) {
        widget.innerHTML = '';
        widget.style.display = 'none';
    }
}

function renderWeatherState(widgetId, state, expanded, setExpanded) {
    if (!state?.data) {
        renderError(widgetId, state?.status, null);
        return;
    }
    renderWidget(widgetId, state.data, null, state.status, state.dataSource, expanded, setExpanded);
}

function renderComparisonWidget(currentLocation, destinationLocation) {
    // Implementazione per il widget di comparazione (mantieni come era)
}

function _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function _timeLabel() {
    const now = new Date();
    return now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function renderError(widgetId, status = null, label = null) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;

    const message = status?.shortMessage || 'Errore sconosciuto';
    const detail = status?.detail || 'Impossibile caricare i dati.';

    widget.innerHTML = `
        <div class="wm-compact error">
            <span>🔴 ${message}</span>
        </div>
        <div class="wm-panel">
            <div class="wm-header">
                <span class="wm-title">Errore</span>
                <span class="wm-close" aria-label="Chiudi">×</span>
            </div>
            <div class="wm-error-message">${_esc(detail)}</div>
        </div>
    `;

    const closeBtn = widget.querySelector('.wm-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => hideWidget(widgetId));
    }
}

// ── API pubblica ──────────────────────────────────────────────────────────────

let _lastData       = null;
let _lastLabel      = null;
let _lastStatus     = null;
let _lastDataSource = null;
let _lastRenderMode = 'single';
let _lastComparisonState = null;
let _requestSeq     = 0;
let _lastFetchLat   = null;
let _lastFetchLng   = null;
const _inFlightFetches = new Map();

function requestKey(lat, lng) {
    return `${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

function getWeatherFetch(lat, lng) {
    const key = requestKey(lat, lng);
    let promise = _inFlightFetches.get(key);
    if (!promise) {
        promise = fetchWeather(lat, lng).finally(() => {
            _inFlightFetches.delete(key);
        });
        _inFlightFetches.set(key, promise);
    }
    return promise;
}

async function resolveWeatherState(lat, lng, fallbackState = null) {
    const cached = loadCache(lat, lng);
    if (cached) {
        return {
            data: cached,
            status: null,
            dataSource: 'cache',
        };
    }

    try {
        const data = await getWeatherFetch(lat, lng);
        saveCache(lat, lng, data);
        return {
            data,
            status: null,
            dataSource: 'live',
        };
    } catch (err) {
        const errorStatus = describeWeatherError(err);
        console.warn('[WeatherMoon] Fetch fallito:', errorStatus.logMessage);
        if (fallbackState?.data) {
            return {
                data: fallbackState.data,
                status: errorStatus,
                dataSource: 'stale',
            };
        }
        return {
            data: null,
            status: errorStatus,
            dataSource: 'error',
        };
    }
}

/**
 * Aggiorna il widget meteo/luna per le coordinate fornite.
 * @param {number}      lat
 * @param {number}      lng
 * @param {string|null} [label]  Etichetta opzionale (es. nome POI). Se null usa posizione GPS.
 * @param {boolean}     [force]  Se true ignora la soglia di spostamento.
 */
export async function updateWeatherMoon(lat, lng, label = null, force = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const requestSeq = ++_requestSeq;
    hideWidget('weather-destination-widget');
    _lastRenderMode = 'single';
    _lastComparisonState = null;

    // Spostamento minimo per GPS (evita fetch continue camminando)
    if (!force && label === null && _lastFetchLat !== null) {
        const km = haversineKm(lat, lng, _lastFetchLat, _lastFetchLng);
        if (km < MIN_MOVE_KM) {
            refreshUI();
            return;
        }
    }

    const widget = document.getElementById('weather-moon-widget');
    if (widget) {
        widget.style.display = 'flex';
        widget.innerHTML = '<div class="wm-loading">⏳ Caricamento...</div>';
    }

    try {
        const state = await resolveWeatherState(lat, lng, { data: _lastData, status: _lastStatus });
        if (requestSeq !== _requestSeq) return; // Cancella se richiesta più recente

        _lastData = state.data;
        _lastStatus = state.status;
        _lastDataSource = state.dataSource;
        _lastLabel = label;
        _lastFetchLat = lat;
        _lastFetchLng = lng;

        refreshUI();
    } catch (err) {
        console.error('[WeatherMoon] Errore inaspettato:', err);
        if (requestSeq !== _requestSeq) return;
        renderError('weather-moon-widget', describeWeatherError(err), label);
    }
}

export function refreshMoonOnly() {
    refreshUI(true);
}

function refreshUI(moonOnly = false) {
    const widget = document.getElementById('weather-moon-widget');
    if (!widget) return;

    if (!_lastData) {
        renderError('weather-moon-widget', { shortMessage: 'Nessun dato', detail: 'Carica una posizione per visualizzare il meteo.' }, _lastLabel);
        return;
    }

    if (!moonOnly) {
        let expanded = false;
        const setExpanded = (value) => {
            expanded = value;
            renderWeatherState('weather-moon-widget', {
                data: _lastData,
                status: _lastStatus,
                dataSource: _lastDataSource
            }, expanded, setExpanded);
        };
        renderWeatherState('weather-moon-widget', {
            data: _lastData,
            status: _lastStatus,
            dataSource: _lastDataSource
        }, expanded, setExpanded);
    }
}

// 🔔 Registra callback per cambi di connettività
onConnectivityChange((isOnline) => {
    console.log(`[WeatherMoon] Connettività cambiata: ${isOnline ? 'online' : 'offline'}`);
    if (isOnline && _lastFetchLat !== null && _lastFetchLng !== null) {
        // Quando torna online, ricarica il meteo
        updateWeatherMoon(_lastFetchLat, _lastFetchLng, _lastLabel, true);
    }
});

// ── Utilities ──────────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
