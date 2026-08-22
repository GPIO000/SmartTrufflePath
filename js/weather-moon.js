/**
 * weather-moon.js — Widget meteo + fase lunare per SmartTruffle Path
 *
 * Dipendenze esterne: nessuna (Open-Meteo non richiede API key)
 * Dipendenze interne: nessuna (modulo completamente isolato)
 *
 * Uso:
 *   import { updateWeatherMoon } from './weather-moon.js';
 *   updateWeatherMoon(lat, lng);                  // posizione GPS / POI
 *   updateWeatherMoon(lat, lng, 'Nome Luogo');    // con etichetta opzionale
 *   updateWeatherMoonComparison(                  // confronto posizione/destinazione
 *     { lat, lng, label: 'Sei qui' },
 *     { lat, lng, label: 'Destinazione' }
 *   );
 */

// ── Costanti ──────────────────────────────────────────────────────────────────

const CURRENT_WIDGET_ID = 'weather-moon-widget';
const DESTINATION_WIDGET_ID = 'weather-destination-widget';
const CACHE_KEY_PREFIX = 'wm_cache_';
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
    55: { icon: '🌦️', label: 'Pioggerella intensa' },
    61: { icon: '🌧️', label: 'Pioggia leggera' },
    63: { icon: '🌧️', label: 'Pioggia moderata' },
    65: { icon: '🌧️', label: 'Pioggia intensa' },
    71: { icon: '🌨️', label: 'Neve leggera' },
    73: { icon: '🌨️', label: 'Neve moderata' },
    75: { icon: '🌨️', label: 'Neve intensa' },
    77: { icon: '🌨️', label: 'Granuli di neve' },
    80: { icon: '🌦️', label: 'Rovesci leggeri' },
    81: { icon: '🌦️', label: 'Rovesci moderati' },
    82: { icon: '🌦️', label: 'Rovesci violenti' },
    85: { icon: '🌨️', label: 'Rovesci di neve' },
    86: { icon: '🌨️', label: 'Rovesci di neve intensi' },
    95: { icon: '⛈️',  label: 'Temporale' },
    96: { icon: '⛈️',  label: 'Temporale con grandine' },
    99: { icon: '⛈️',  label: 'Temporale con grandine intensa' },
};

// Nomi italiani dei giorni
const GIORNI_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// ── Stato interno ─────────────────────────────────────────────────────────────

let _lastFetchLat  = null;
let _lastFetchLng  = null;
let _singleExpanded = false;
let _destinationExpanded = false;

// ── Calcolo fase lunare (astronomia di base, no API) ──────────────────────────

/**
 * Restituisce la fase lunare per una data.
 * Algoritmo: età della luna basata sul ciclo sinodico (29.53059 giorni).
 * @param {Date} date
 * @returns {{ icon: string, name: string, illumination: number, age: number }}
 */
export function calcMoonPhase(date = new Date()) {
    // Riferimento: luna nuova del 6 gennaio 2000
    const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z');
    const SYNODIC_MONTH  = 29.53059;

    const diffMs   = date.getTime() - KNOWN_NEW_MOON.getTime();
    const diffDays = diffMs / 86400000;
    const cycles   = diffDays / SYNODIC_MONTH;
    const age      = (cycles - Math.floor(cycles)) * SYNODIC_MONTH; // 0..29.53

    // Illuminazione approssimata (0..1)
    const illumination = Math.round((1 - Math.cos((age / SYNODIC_MONTH) * 2 * Math.PI)) / 2 * 100);

    let icon, name;
    if      (age < 1.85)                    { icon = '🌑'; name = 'Luna nuova'; }
    else if (age < 7.38)                    { icon = '🌒'; name = 'Luna crescente'; }
    else if (age < 9.22)                    { icon = '🌓'; name = 'Quarto crescente'; }
    else if (age < 14.77)                   { icon = '🌔'; name = 'Gibbosa crescente'; }
    else if (age < 16.61)                   { icon = '🌕'; name = 'Luna piena'; }
    else if (age < 22.15)                   { icon = '🌖'; name = 'Gibbosa calante'; }
    else if (age < 23.99)                   { icon = '🌗'; name = 'Quarto calante'; }
    else if (age < 29.53)                   { icon = '🌘'; name = 'Luna calante'; }
    else                                    { icon = '🌑'; name = 'Luna nuova'; }

    return { icon, name, illumination, age };
}

// ── Cache localStorage ────────────────────────────────────────────────────────

function cacheKey(lat, lng) {
    return CACHE_KEY_PREFIX + lat.toFixed(2) + '_' + lng.toFixed(2);
}

function loadCache(lat, lng) {
    try {
        const raw  = localStorage.getItem(cacheKey(lat, lng));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Date.now() - data.ts > CACHE_TTL_MS) return null;
        return data.payload;
    } catch { return null; }
}

function saveCache(lat, lng, payload) {
    try {
        localStorage.setItem(cacheKey(lat, lng), JSON.stringify({ ts: Date.now(), payload }));
    } catch { /* quota exceeded: ignora */ }
}

// ── Haversine distance ────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
    const R  = 6371;
    const dL = (lat2 - lat1) * Math.PI / 180;
    const dG = (lng2 - lng1) * Math.PI / 180;
    const a  = Math.sin(dL / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Fetch Open-Meteo ──────────────────────────────────────────────────────────

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

    const resp = await fetchWithTimeout(url.toString(), REQUEST_TIMEOUT_MS);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
}

function fetchWithTimeout(url, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;

    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            if (controller) controller.abort();
            reject(createWeatherError('TIMEOUT', 'Timeout richiesta meteo'));
        }, timeoutMs);

        const options = controller ? { signal: controller.signal } : undefined;
        fetch(url, options)
            .then((response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(response);
            })
            .catch((error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error?.name === 'AbortError') {
                    reject(createWeatherError('TIMEOUT', 'Timeout richiesta meteo', error));
                    return;
                }
                reject(error);
            });
    });
}

function createWeatherError(code, message, cause = null) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function describeWeatherError(error) {
    if (error?.code === 'TIMEOUT') {
        return {
            compactMessage: 'Meteo timeout',
            detailMessage: 'Timeout dati meteo',
            logMessage: 'timeout richiesta Open-Meteo',
        };
    }

    if (typeof error?.message === 'string' && error.message.startsWith('HTTP ')) {
        return {
            compactMessage: 'Meteo non disp.',
            detailMessage: `Errore API ${error.message.slice(5)}`,
            logMessage: `errore API ${error.message.slice(5)}`,
        };
    }

    return {
        compactMessage: 'Meteo offline',
        detailMessage: 'Rete non disponibile',
        logMessage: error?.message || 'errore di rete',
    };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function wmoInfo(code) {
    return WMO_CODES[code] ?? { icon: '🌡️', label: 'Dati meteo' };
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
                badge:  '✅ Aggiornato',
                detail: `✅ Dati aggiornati per questo punto · Open-Meteo · ${_timeLabel()}`,
            };
        case 'cache':
            return {
                badge:  '⏱ Cache',
                detail: `⏱ Dati dalla cache locale (&lt; 30 min) · Open-Meteo · ${_timeLabel()}`,
            };
        case 'stale':
            return {
                badge:  '⚠️ Dati precedenti',
                detail: `⚠️ Rete non raggiunta — mostrati ultimi dati noti · ${_esc(errorStatus?.detailMessage ?? 'Errore di rete')}`,
            };
        case 'error':
        default:
            return {
                badge:  '❌ Meteo n.d.',
                detail: _esc(errorStatus?.detailMessage ?? 'Dati meteo non disponibili'),
            };
    }
}

function renderWidget(widgetId, data, label, status = null, dataSource = 'live', expanded = false, setExpanded = () => {}) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;

    const moon    = calcMoonPhase();
    const cur     = data.current;
    const daily   = data.daily;
    const curInfo = wmoInfo(cur.weather_code);
    const srcLbl  = dataSourceLabel(dataSource, status);

    // ── Compact bar ──────────────────────────────────────────────────────────
    const compactLabel = label ? `<span class="wm-location-label">${_esc(label)}</span>` : '';
    const compact = `
        <div class="wm-compact" role="button" aria-expanded="${expanded ? 'true' : 'false'}" tabindex="0" aria-label="Meteo e luna — tocca per dettagli">
            ${compactLabel}
            <span class="wm-cur-icon">${curInfo.icon}</span>
            <span class="wm-cur-temp">${Math.round(cur.temperature_2m)}°</span>
            <span class="wm-moon-icon">${moon.icon}</span>
            <span class="wm-data-badge wm-data-badge--${_esc(dataSource)}">${srcLbl.badge}</span>
            <span class="wm-expand-arrow">${expanded ? '▲' : '▼'}</span>
        </div>`;

    // ── Expanded panel ───────────────────────────────────────────────────────
    let expandedHtml = '';
    if (expanded) {
        // Previsioni 4 giorni
        const today   = new Date();
        let daysHtml  = '';
        for (let i = 0; i < 4; i++) {
            const d          = new Date(today);
            d.setDate(today.getDate() + i);
            const dayLabel   = i === 0 ? 'Oggi' : i === 1 ? 'Domani' : GIORNI_IT[d.getDay()];
            const info       = wmoInfo(daily.weather_code[i]);
            const tMax       = Math.round(daily.temperature_2m_max[i]);
            const tMin       = Math.round(daily.temperature_2m_min[i]);
            const precip     = (daily.precipitation_sum[i] ?? 0).toFixed(1);
            const wind       = Math.round(daily.wind_speed_10m_max[i] ?? 0);
            const soilT      = daily.soil_temperature_0cm?.[i] != null
                               ? `<span class="wm-extra-pill">🪱 ${Math.round(daily.soil_temperature_0cm[i])}°</span>` : '';
            const et0        = daily.et0_fao_evapotranspiration?.[i] != null
                               ? `<span class="wm-extra-pill">💧ET₀ ${(daily.et0_fao_evapotranspiration[i]).toFixed(1)}mm</span>` : '';

            daysHtml += `
                <div class="wm-day-row${i === 0 ? ' wm-today' : ''}">
                    <span class="wm-day-name">${dayLabel}</span>
                    <span class="wm-day-icon">${info.icon}</span>
                    <span class="wm-day-desc">${info.label}</span>
                    <span class="wm-day-temps">${tMax}° / ${tMin}°</span>
                    <div class="wm-day-details">
                        <span class="wm-extra-pill">💧${precip}mm</span>
                        <span class="wm-extra-pill">💨${wind}km/h</span>
                        ${soilT}${et0}
                    </div>
                </div>`;
        }

        // Ora corrente
        const curHumidity = cur.relative_humidity_2m != null
            ? `<span class="wm-cur-pill">💧${cur.relative_humidity_2m}%</span>` : '';
        const curWind = cur.wind_speed_10m != null
            ? `<span class="wm-cur-pill">💨${Math.round(cur.wind_speed_10m)}km/h</span>` : '';

        expandedHtml = `
            <div class="wm-panel" role="region" aria-label="Dettaglio meteo">
                <div class="wm-cur-row">
                    <span class="wm-cur-big">${curInfo.icon} ${curInfo.label}</span>
                    ${curHumidity}${curWind}
                </div>
                <div class="wm-days-list">${daysHtml}</div>
                <div class="wm-moon-row">
                    <span>${moon.icon} ${moon.name}</span>
                    <span class="wm-moon-pct">${moon.illumination}% illuminata</span>
                </div>
                ${label ? `<div class="wm-source-label">📍 ${_esc(label)}</div>` : ''}
                <div class="wm-source-label wm-source-label--${_esc(dataSource)}">${srcLbl.detail}</div>
            </div>`;
    }

    widget.innerHTML = compact + expandedHtml;
    widget.style.display = 'block';

    // Event: toggle expanded
    const compactEl = widget.querySelector('.wm-compact');
    if (compactEl) {
        const toggle = () => {
            setExpanded(!expanded);
            renderWidget(widgetId, data, label, status, dataSource, !expanded, setExpanded);
        };
        compactEl.addEventListener('click', toggle);
        compactEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    }
}

function hideWidget(widgetId) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;
    widget.innerHTML = '';
    widget.style.display = 'none';
}

function renderWeatherState(widgetId, state, expanded, setExpanded) {
    if (state?.data) {
        renderWidget(widgetId, state.data, state.label, state.status, state.dataSource, expanded, setExpanded);
        return;
    }
    renderError(widgetId, state?.status ?? null, state?.label ?? null);
}

function renderComparisonWidget(currentLocation, destinationLocation) {
    renderWeatherState(
        CURRENT_WIDGET_ID,
        currentLocation,
        _singleExpanded,
        (value) => { _singleExpanded = value; }
    );
    renderWeatherState(
        DESTINATION_WIDGET_ID,
        destinationLocation,
        _destinationExpanded,
        (value) => { _destinationExpanded = value; }
    );
}

function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _timeLabel() {
    return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function renderError(widgetId, status = null, label = null) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;
    const moon = calcMoonPhase();
    const srcLbl = dataSourceLabel('error', status);
    const details = [
        label ? `<div class="wm-source-label">📍 ${_esc(label)}</div>` : '',
        `<div class="wm-source-label wm-source-label--error">${srcLbl.detail}</div>`,
    ].filter(Boolean).join('');

    widget.innerHTML = `
        <div class="wm-compact" style="opacity:.6">${moon.icon} <span class="wm-data-badge wm-data-badge--error">${srcLbl.badge}</span></div>
        ${details}
    `;
    widget.style.display = 'block';
}

// ── API pubblica ──────────────────────────────────────────────────────────────

let _lastData       = null;
let _lastLabel      = null;
let _lastStatus     = null;
let _lastDataSource = null;
let _lastRenderMode = 'single';
let _lastComparisonState = null;
let _requestSeq     = 0;
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
    hideWidget(DESTINATION_WIDGET_ID);
    _destinationExpanded = false;

    // Spostamento minimo per GPS (evita fetch continue camminando)
    if (!force && label === null && _lastFetchLat !== null) {
        const km = haversineKm(lat, lng, _lastFetchLat, _lastFetchLng);
        if (km < MIN_MOVE_KM) {
            // Ri-renderizza con eventuale nuovo label senza refetch
            if (_lastData) renderWidget(CURRENT_WIDGET_ID, _lastData, label, _lastStatus, _lastDataSource ?? 'live', _singleExpanded, (value) => { _singleExpanded = value; });
            else renderError(CURRENT_WIDGET_ID, _lastStatus, label);
            return;
        }
    }

    const cached = loadCache(lat, lng);
    if (cached) {
        if (requestSeq !== _requestSeq) return;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _lastData       = cached;
        _lastLabel      = label;
        _lastStatus     = null;
        _lastDataSource = 'cache';
        _lastRenderMode = 'single';
        _lastComparisonState = null;
        renderWidget(CURRENT_WIDGET_ID, cached, label, null, 'cache', _singleExpanded, (value) => { _singleExpanded = value; });
        return;
    }

    try {
        const data = await getWeatherFetch(lat, lng);
        if (requestSeq !== _requestSeq) return;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _lastData       = data;
        _lastLabel      = label;
        _lastStatus     = null;
        _lastDataSource = 'live';
        _lastRenderMode = 'single';
        _lastComparisonState = null;
        saveCache(lat, lng, data);
        renderWidget(CURRENT_WIDGET_ID, data, label, null, 'live', _singleExpanded, (value) => { _singleExpanded = value; });
    } catch (err) {
        const errorStatus = describeWeatherError(err);
        console.warn('[WeatherMoon] Fetch fallito:', errorStatus.logMessage);
        if (requestSeq !== _requestSeq) return;
        _lastLabel = label;
        if (_lastData) {
            _lastStatus     = errorStatus;
            _lastDataSource = 'stale';
            _lastRenderMode = 'single';
            _lastComparisonState = null;
            renderWidget(CURRENT_WIDGET_ID, _lastData, label, errorStatus, 'stale', _singleExpanded, (value) => { _singleExpanded = value; }); // mostra dati vecchi
        } else {
            _lastStatus     = errorStatus;
            _lastDataSource = 'error';
            _lastRenderMode = 'single';
            _lastComparisonState = null;
            renderError(CURRENT_WIDGET_ID, errorStatus, label);
        }
    }
}

export async function updateWeatherMoonComparison(currentLocation, destinationLocation) {
    const currentLat = Number(currentLocation?.lat);
    const currentLng = Number(currentLocation?.lng);
    const destinationLat = Number(destinationLocation?.lat);
    const destinationLng = Number(destinationLocation?.lng);
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng)) return;
    if (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLng)) return;

    const requestSeq = ++_requestSeq;
    const previousState = _lastComparisonState;
    const [currentState, destinationState] = await Promise.all([
        resolveWeatherState(currentLat, currentLng, previousState?.current ?? null),
        resolveWeatherState(destinationLat, destinationLng, previousState?.destination ?? null),
    ]);
    if (requestSeq !== _requestSeq) return;

    _lastRenderMode = 'comparison';
    _lastComparisonState = {
        current: {
            ...currentState,
            label: typeof currentLocation?.label === 'string' && currentLocation.label.trim()
                ? currentLocation.label.trim()
                : 'Sei qui',
        },
        destination: {
            ...destinationState,
            label: typeof destinationLocation?.label === 'string' && destinationLocation.label.trim()
                ? destinationLocation.label.trim()
                : 'Destinazione',
        }
    };
    renderComparisonWidget(_lastComparisonState.current, _lastComparisonState.destination);
}

/**
 * Aggiorna solo la fase lunare (es. al cambio di data senza nuovo GPS).
 * Non fa chiamate di rete.
 */
export function refreshMoonOnly() {
    if (_lastRenderMode === 'comparison' && _lastComparisonState) {
        renderComparisonWidget(_lastComparisonState.current, _lastComparisonState.destination);
        return;
    }
    hideWidget(DESTINATION_WIDGET_ID);
    if (_lastData) renderWidget(CURRENT_WIDGET_ID, _lastData, _lastLabel, _lastStatus, _lastDataSource ?? 'live', _singleExpanded, (value) => { _singleExpanded = value; });
}
