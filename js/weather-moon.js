import { onConnectivityChange, fetchWithOfflineCheck, getStatusString } from './offline-api-manager.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const MIN_MOVE_KM = 5;
const FETCH_TIMEOUT_MS = 8000;
const CURRENT_WIDGET_ID = 'weather-moon-widget';
const DESTINATION_WIDGET_ID = 'weather-destination-widget';
const DAILY_FIELDS = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'wind_speed_10m_max'
];

const WMO_CODES = {
    0: { icon: '☀️', label: 'Sereno' },
    1: { icon: '🌤️', label: 'Prevalentemente sereno' },
    2: { icon: '⛅', label: 'Parzialmente nuvoloso' },
    3: { icon: '☁️', label: 'Coperto' },
    45: { icon: '🌫️', label: 'Nebbia' },
    48: { icon: '🌫️', label: 'Nebbia con brina' },
    51: { icon: '🌦️', label: 'Pioggerella leggera' },
    53: { icon: '🌦️', label: 'Pioggerella moderata' },
    55: { icon: '🌧️', label: 'Pioggerella densa' },
    61: { icon: '🌧️', label: 'Pioggia leggera' },
    63: { icon: '🌧️', label: 'Pioggia moderata' },
    65: { icon: '⛈️', label: 'Pioggia intensa' },
    71: { icon: '❄️', label: 'Neve leggera' },
    73: { icon: '❄️', label: 'Neve moderata' },
    75: { icon: '❄️', label: 'Neve intensa' },
    80: { icon: '🌧️', label: 'Rovescio leggero' },
    81: { icon: '⛈️', label: 'Rovescio moderato' },
    82: { icon: '⛈️', label: 'Rovescio violento' },
    95: { icon: '⛈️', label: 'Temporale' },
    96: { icon: '⛈️', label: 'Temporale con grandine' },
    99: { icon: '⛈️', label: 'Temporale violento' }
};

let _lastData = null;
let _lastLabel = null;
let _lastFetchLat = null;
let _lastFetchLng = null;
let _requestSeq = 0;
const _inFlightFetches = new Map();

function esc(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function wmoInfo(code) {
    return WMO_CODES[Number(code)] || { icon: '❓', label: 'Sconosciuto' };
}

function requestKey(lat, lng) {
    return `${lat.toFixed(4)}_${lng.toFixed(4)}`;
}

function cacheKey(lat, lng) {
    return `wm_cache_${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

function loadCache(lat, lng) {
    try {
        const raw = localStorage.getItem(cacheKey(lat, lng));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.ts || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
        if (!parsed.payload || typeof parsed.payload !== 'object') return null;
        return parsed.payload;
    } catch {
        return null;
    }
}

function saveCache(lat, lng, payload) {
    try {
        localStorage.setItem(cacheKey(lat, lng), JSON.stringify({ ts: Date.now(), payload }));
    } catch {
        // ignore quota/private mode
    }
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            const error = new Error('Timeout richiesta API');
            error.code = 'TIMEOUT';
            reject(error);
        }, ms);
        promise
            .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

async function fetchWeather(lat, lng) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lng.toFixed(4));
    url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m');
    url.searchParams.set('daily', DAILY_FIELDS.join(','));
    url.searchParams.set('forecast_days', '4');
    url.searchParams.set('timezone', 'auto');

    const response = await withTimeout(fetchWithOfflineCheck(url.toString(), {}, 'weather-api'), FETCH_TIMEOUT_MS);
    if (!response?.ok) {
        const httpError = new Error(`HTTP ${response?.status ?? '0'}`);
        httpError.code = 'HTTP_ERROR';
        httpError.status = response?.status;
        throw httpError;
    }
    return response.json();
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

function normalizeError(error) {
    const rawMessage = String(error?.message || '');
    if (error?.code === 'TIMEOUT') {
        return { short: 'Timeout', detail: 'Timeout richiesta meteo' };
    }
    if (error?.code === 'HTTP_ERROR') {
        return { short: 'Errore API', detail: `Errore API ${error.status ?? ''}`.trim() };
    }
    if (error?.code === 'OFFLINE' || error?.code === 'NETWORK_ERROR' || /network|fetch/i.test(String(error?.message ?? ''))) {
        return { short: 'Offline', detail: 'Rete non disponibile' };
    }
    if (error?.code === 'API_UNAVAILABLE') {
        return { short: 'API non disponibile', detail: `${error.apiName || 'API'} non disponibile` };
    }
    const httpMatch = rawMessage.match(/HTTP\s*(\d{3})/i);
    if (httpMatch) {
        return { short: 'Errore API', detail: `Errore API ${httpMatch[1]}` };
    }
    if (rawMessage.toUpperCase().includes('HTTP')) {
        return { short: 'Errore API', detail: rawMessage.replace(/HTTP\s*/i, 'Errore API ') };
    }
    return { short: 'Errore', detail: rawMessage || 'Errore sconosciuto' };
}

function buildCompactHtml(data, label, dataSource) {
    const current = data?.current || {};
    const icon = wmoInfo(current.weather_code).icon;
    const temperature = Math.round(Number(current.temperature_2m) || 0);

    let badgeClass = 'wm-data-badge--live';
    let badgeText = 'Aggiornato';
    if (dataSource === 'cache') {
        badgeClass = 'wm-data-badge--cache';
        badgeText = 'Cache';
    } else if (dataSource === 'stale') {
        badgeClass = 'wm-data-badge--stale';
        badgeText = 'Dati precedenti';
    } else if (dataSource === 'error') {
        badgeClass = 'wm-data-badge--error';
        badgeText = 'Meteo n.d.';
    }

    return `
        <div class="wm-compact">
            <span class="wm-emoji">${icon}</span>
            <span class="wm-temp">${temperature}°</span>
            <span class="wm-title-inline">${esc(label || 'Meteo')}</span>
            <span class="wm-data-badge ${badgeClass}">${badgeText}</span>
        </div>
    `;
}

function dayItem(data, index) {
    const daily = data?.daily || {};
    const code = daily.weather_code?.[index] ?? data?.current?.weather_code ?? 0;
    const icon = wmoInfo(code).icon;
    const tMax = daily.temperature_2m_max?.[index];
    const tMin = daily.temperature_2m_min?.[index];
    const rain = daily.precipitation_sum?.[index];
    const wind = daily.wind_speed_10m_max?.[index];
    const moon = calcMoonPhase(new Date(Date.now() + index * 24 * 60 * 60 * 1000));

    const extra = [];
    if (Number.isFinite(daily.soil_temperature_0cm?.[index])) {
        extra.push(`🪱 Suolo ${Math.round(daily.soil_temperature_0cm[index])}°C`);
    }
    if (Number.isFinite(daily.et0_fao_evapotranspiration?.[index])) {
        extra.push(`ET₀ ${daily.et0_fao_evapotranspiration[index].toFixed(1)}`);
    }

    return `
        <li class="wm-day-item">
            <div class="wm-day-main">${icon} ${Number.isFinite(tMax) ? Math.round(tMax) : '–'}° / ${Number.isFinite(tMin) ? Math.round(tMin) : '–'}° · 🌧️ ${Number.isFinite(rain) ? rain : 0}mm · 💨 ${Number.isFinite(wind) ? Math.round(wind) : '–'}km/h</div>
            <div class="wm-moon-row">${moon.icon} ${esc(moon.name)}</div>
            ${extra.length ? `<div class="wm-extra-row">${extra.map(esc).join(' · ')}</div>` : ''}
        </li>
    `;
}

function buildPanelHtml(data, label, status = null, dataSource = 'live') {
    const current = data?.current || {};
    const icon = wmoInfo(current.weather_code).icon;
    const temp = Math.round(Number(current.temperature_2m) || 0);
    const wind = Math.round(Number(current.wind_speed_10m) || 0);
    const humidity = Math.round(Number(current.relative_humidity_2m) || 0);

    let detail = `Ultimo aggiornamento: ${getStatusString()}`;
    if (dataSource === 'cache') detail = `Dati da cache locale. ${getStatusString()}`;
    if (dataSource === 'stale') detail = `Dati precedenti. ${status?.detail || ''}`;
    if (dataSource === 'error') detail = status?.detail || 'Errore caricamento meteo';

    const days = [0, 1, 2, 3].map((idx) => dayItem(data, idx)).join('');

    return `
        <div class="wm-panel">
            <div class="wm-header">
                <span class="wm-title">${esc(label || 'Meteo')}</span>
                <span class="wm-close" aria-label="Chiudi">×</span>
            </div>
            <div class="wm-current">
                <span class="wm-emoji-large">${icon}</span>
                <div class="wm-current-details">
                    <div>${temp}°C, Vento ${wind}km/h, Umidità ${humidity}%</div>
                    <div class="wm-data-source">${esc(detail)}</div>
                </div>
            </div>
            <ul class="wm-days-list">${days}</ul>
        </div>
    `;
}

function renderCollapsed(widgetId, data, label, dataSource) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;
    widget.style.display = 'block';
    widget.innerHTML = buildCompactHtml(data, label, dataSource);
}

function hidePanel(widgetId) {
    const panel = document.getElementById(`${widgetId}-panel`);
    if (panel) panel.innerHTML = '';
}

function showPanel(widgetId, data, label, status, dataSource) {
    const panel = document.getElementById(`${widgetId}-panel`);
    if (!panel) return;
    panel.innerHTML = buildPanelHtml(data, label, status, dataSource);
}

function bindPanelClose(widgetId, stateGetter) {
    const close = document.getElementById(`${widgetId}-panel`)?.querySelector('.wm-close');
    if (!close) return;
    close.onclick = (event) => {
        event.stopPropagation();
        const state = stateGetter();
        if (!state) return;
        state.expanded = false;
        hidePanel(widgetId);
    };
}

function attachToggle(widgetId, stateGetter) {
    const widget = document.getElementById(widgetId);
    if (!widget) return;
    const compact = widget.querySelector('.wm-compact');
    if (!compact) return;
    compact.onclick = () => {
        const state = stateGetter();
        if (!state) return;
        state.expanded = !state.expanded;
        if (state.expanded) {
            showPanel(widgetId, state.data, state.label, state.status, state.dataSource);
            bindPanelClose(widgetId, stateGetter);
        } else {
            hidePanel(widgetId);
        }
    };
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function cloneState(data, label, status, dataSource, expanded = false) {
    return { data, label, status, dataSource, expanded };
}

let _currentState = null;
let _destinationState = null;

function renderCurrent() {
    if (!_currentState?.data) return;
    renderCollapsed(CURRENT_WIDGET_ID, _currentState.data, _currentState.label, _currentState.dataSource);
    if (_currentState.expanded) {
        showPanel(CURRENT_WIDGET_ID, _currentState.data, _currentState.label, _currentState.status, _currentState.dataSource);
        bindPanelClose(CURRENT_WIDGET_ID, () => _currentState);
    }
    else hidePanel(CURRENT_WIDGET_ID);
    attachToggle(CURRENT_WIDGET_ID, () => _currentState);
}

function renderDestination() {
    if (!_destinationState?.data) return;
    renderCollapsed(DESTINATION_WIDGET_ID, _destinationState.data, _destinationState.label, _destinationState.dataSource);
    if (_destinationState.expanded) {
        showPanel(DESTINATION_WIDGET_ID, _destinationState.data, _destinationState.label, _destinationState.status, _destinationState.dataSource);
        bindPanelClose(DESTINATION_WIDGET_ID, () => _destinationState);
    }
    else hidePanel(DESTINATION_WIDGET_ID);
    attachToggle(DESTINATION_WIDGET_ID, () => _destinationState);
}

export async function updateWeatherMoon(lat, lng, label = null, force = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!force && label === null && _lastFetchLat !== null && _lastFetchLng !== null) {
        const km = haversineKm(lat, lng, _lastFetchLat, _lastFetchLng);
        if (km < MIN_MOVE_KM) {
            renderCurrent();
            return;
        }
    }

    const requestSeq = ++_requestSeq;
    _destinationState = null;
    const destinationWidget = document.getElementById(DESTINATION_WIDGET_ID);
    if (destinationWidget) {
        destinationWidget.innerHTML = '';
        destinationWidget.style.display = 'none';
    }
    hidePanel(DESTINATION_WIDGET_ID);

    const cached = loadCache(lat, lng);
    if (cached) {
        _lastData = cached;
        _lastLabel = label;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _currentState = cloneState(cached, label, null, 'cache');
        renderCurrent();
        return;
    }

    try {
        const data = await getWeatherFetch(lat, lng);
        if (requestSeq !== _requestSeq) return;
        saveCache(lat, lng, data);

        _lastData = data;
        _lastLabel = label;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _currentState = cloneState(data, label, null, 'live');
        renderCurrent();
    } catch (error) {
        if (requestSeq !== _requestSeq) return;
        const status = normalizeError(error);
        if (_lastData) {
            _lastLabel = label;
            _lastFetchLat = lat;
            _lastFetchLng = lng;
            _currentState = cloneState(_lastData, label, status, 'stale');
            renderCurrent();
        } else {
            const placeholder = { current: { temperature_2m: 0, weather_code: 3, wind_speed_10m: 0, relative_humidity_2m: 0 }, daily: {} };
            _currentState = cloneState(placeholder, label, status, 'error', true);
            renderCurrent();
        }
    }
}

export async function updateWeatherMoonComparison(currentLocation, destinationLocation) {
    const currentLat = Number(currentLocation?.lat);
    const currentLng = Number(currentLocation?.lng);
    const destinationLat = Number(destinationLocation?.lat);
    const destinationLng = Number(destinationLocation?.lng);
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng) || !Number.isFinite(destinationLat) || !Number.isFinite(destinationLng)) return;

    const [currentData, destinationData] = await Promise.all([
        getWeatherFetch(currentLat, currentLng),
        getWeatherFetch(destinationLat, destinationLng)
    ]);

    saveCache(currentLat, currentLng, currentData);
    saveCache(destinationLat, destinationLng, destinationData);

    _lastData = currentData;
    _lastLabel = currentLocation?.label || null;
    _lastFetchLat = currentLat;
    _lastFetchLng = currentLng;

    _currentState = cloneState(currentData, currentLocation?.label || null, null, 'live');
    _destinationState = cloneState(destinationData, destinationLocation?.label || null, null, 'live');
    renderCurrent();
    renderDestination();
}

export function refreshMoonOnly() {
    if (_currentState?.data) {
        renderCurrent();
    }
}

export function calcMoonPhase(date = new Date()) {
    const ref = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
    const current = date instanceof Date ? date : new Date(date);
    const cycle = 29.53058867;
    const days = (current.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000);
    const phase = ((days % cycle) + cycle) % cycle / cycle;

    if (phase < 0.03 || phase >= 0.97) return { icon: '🌑', name: 'Luna nuova' };
    if (phase < 0.22) return { icon: '🌒', name: 'Luna crescente' };
    if (phase < 0.28) return { icon: '🌓', name: 'Quarto crescente' };
    if (phase < 0.47) return { icon: '🌔', name: 'Gibbosa crescente' };
    if (phase < 0.53) return { icon: '🌕', name: 'Luna piena' };
    if (phase < 0.72) return { icon: '🌖', name: 'Gibbosa calante' };
    if (phase < 0.78) return { icon: '🌗', name: 'Quarto calante' };
    return { icon: '🌘', name: 'Luna calante' };
}

onConnectivityChange((online) => {
    if (online && Number.isFinite(_lastFetchLat) && Number.isFinite(_lastFetchLng)) {
        updateWeatherMoon(_lastFetchLat, _lastFetchLng, _lastLabel, true).catch(() => {});
    }
});
