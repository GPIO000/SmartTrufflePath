import { onConnectivityChange, fetchWithOfflineCheck, getStatusString } from './offline-api-manager.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_MOVE_KM = 20;
const FETCH_TIMEOUT_MS = 8000;
const CURRENT_WIDGET_ID = 'weather-moon-widget';
const DESTINATION_WIDGET_ID = 'weather-destination-widget';
const CURRENT_COMPARISON_LABEL = 'Meteo posizione';
const DESTINATION_COMPARISON_LABEL = 'Meteo destinazione';
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
let _lastFetchTs = 0;
let _lastComparisonCurrentLat = null;
let _lastComparisonCurrentLng = null;
let _lastComparisonDestinationLat = null;
let _lastComparisonDestinationLng = null;
let _lastComparisonFetchTs = 0;
let _requestSeq = 0;
const _inFlightFetches = new Map();
const WEATHER_PLACEHOLDER = {
    current: { temperature_2m: 0, weather_code: 3, wind_speed_10m: 0, relative_humidity_2m: 0 },
    daily: {}
};

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
        return parsed;
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
    const rawDate = daily.time?.[index];
    const computedDate = rawDate ? new Date(`${rawDate}T12:00:00`) : new Date(Date.now() + index * 24 * 60 * 60 * 1000);
    const dayLabel = Number.isNaN(computedDate.getTime())
        ? ''
        : `${['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][computedDate.getDay()]} ${String(computedDate.getDate()).padStart(2, '0')}/${String(computedDate.getMonth() + 1).padStart(2, '0')}`;

    return `
        <li class="wm-day-item">
            <div class="wm-day-main">${dayLabel ? `${esc(dayLabel)} · ` : ''}${icon} ${Number.isFinite(tMax) ? Math.round(tMax) : '–'}° / ${Number.isFinite(tMin) ? Math.round(tMin) : '–'}° · 🌧️ ${Number.isFinite(rain) ? rain : 0}mm · 💨 ${Number.isFinite(wind) ? Math.round(wind) : '–'}km/h</div>
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

function buildFallbackState(previousState, cachedEntry, label, status) {
    if (cachedEntry?.payload) {
        return cloneState(cachedEntry.payload, label, status, 'stale', previousState?.expanded ?? false);
    }
    if (previousState?.data) {
        return cloneState(previousState.data, label, status, 'stale', previousState.expanded);
    }
    return cloneState(WEATHER_PLACEHOLDER, label, status, 'error', previousState?.expanded ?? false);
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

function clearDestinationWeather() {
    _destinationState = null;
    const destinationWidget = document.getElementById(DESTINATION_WIDGET_ID);
    if (destinationWidget) {
        destinationWidget.innerHTML = '';
        destinationWidget.style.display = 'none';
    }
    hidePanel(DESTINATION_WIDGET_ID);
}

export async function updateWeatherMoon(lat, lng, label = null, force = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    clearDestinationWeather();

    if (!force && label === null && _lastFetchLat !== null && _lastFetchLng !== null) {
        const km = haversineKm(lat, lng, _lastFetchLat, _lastFetchLng);
        const elapsed = Date.now() - _lastFetchTs;
        if (km < MIN_MOVE_KM && elapsed < CACHE_TTL_MS) {
            renderCurrent();
            return;
        }
    }

    const requestSeq = ++_requestSeq;

    const cached = loadCache(lat, lng);
    if (cached) {
        _lastData = cached.payload;
        _lastLabel = label;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _lastFetchTs = Number.isFinite(cached.ts) ? cached.ts : Date.now();
        _currentState = cloneState(cached.payload, label, null, 'cache', _currentState?.expanded ?? false);
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
        _lastFetchTs = Date.now();
        _currentState = cloneState(data, label, null, 'live', _currentState?.expanded ?? false);
        renderCurrent();
    } catch (error) {
        if (requestSeq !== _requestSeq) return;
        const status = normalizeError(error);
        if (_lastData) {
            _lastLabel = label;
            _lastFetchLat = lat;
            _lastFetchLng = lng;
            _currentState = cloneState(_lastData, label, status, 'stale', _currentState?.expanded ?? false);
            renderCurrent();
        } else {
            _currentState = cloneState(WEATHER_PLACEHOLDER, label, status, 'error', _currentState?.expanded ?? false);
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

    const currentCached = loadCache(currentLat, currentLng);
    const destinationCached = loadCache(destinationLat, destinationLng);
    const elapsed = Date.now() - _lastComparisonFetchTs;
    const currentMoved = _lastComparisonCurrentLat === null || _lastComparisonCurrentLng === null
        ? true
        : haversineKm(currentLat, currentLng, _lastComparisonCurrentLat, _lastComparisonCurrentLng) >= MIN_MOVE_KM;
    const destinationMoved = _lastComparisonDestinationLat === null || _lastComparisonDestinationLng === null
        ? true
        : haversineKm(destinationLat, destinationLng, _lastComparisonDestinationLat, _lastComparisonDestinationLng) >= MIN_MOVE_KM;
    const shouldRefreshCurrent = !currentCached || currentMoved || elapsed >= CACHE_TTL_MS;
    const shouldRefreshDestination = !destinationCached || destinationMoved || elapsed >= CACHE_TTL_MS;
    const requestSeq = ++_requestSeq;

    if (!shouldRefreshCurrent && !shouldRefreshDestination) {
        _lastData = currentCached.payload;
        _lastLabel = currentLocation?.label || null;
        _lastFetchLat = currentLat;
        _lastFetchLng = currentLng;
        _lastFetchTs = Number.isFinite(currentCached.ts) ? currentCached.ts : Date.now();
        _currentState = cloneState(currentCached.payload, CURRENT_COMPARISON_LABEL, null, 'cache', _currentState?.expanded ?? false);
        _destinationState = cloneState(destinationCached.payload, DESTINATION_COMPARISON_LABEL, null, 'cache', _destinationState?.expanded ?? false);
        renderCurrent();
        renderDestination();
        return;
    }

    const [currentResult, destinationResult] = await Promise.allSettled([
        shouldRefreshCurrent ? getWeatherFetch(currentLat, currentLng) : Promise.resolve(currentCached.payload),
        shouldRefreshDestination ? getWeatherFetch(destinationLat, destinationLng) : Promise.resolve(destinationCached.payload)
    ]);

    if (requestSeq !== _requestSeq) return;

    const currentLabel = CURRENT_COMPARISON_LABEL;
    const destinationLabel = DESTINATION_COMPARISON_LABEL;

    if (currentResult.status === 'fulfilled') {
        if (shouldRefreshCurrent) saveCache(currentLat, currentLng, currentResult.value);
        _lastData = currentResult.value;
        _lastLabel = currentLabel;
        _lastFetchLat = currentLat;
        _lastFetchLng = currentLng;
        _lastFetchTs = Date.now();
        _currentState = cloneState(currentResult.value, currentLabel, null, shouldRefreshCurrent ? 'live' : 'cache', _currentState?.expanded ?? false);
    } else {
        _currentState = buildFallbackState(_currentState, currentCached, currentLabel, normalizeError(currentResult.reason));
    }

    if (destinationResult.status === 'fulfilled') {
        if (shouldRefreshDestination) saveCache(destinationLat, destinationLng, destinationResult.value);
        _destinationState = cloneState(destinationResult.value, destinationLabel, null, shouldRefreshDestination ? 'live' : 'cache', _destinationState?.expanded ?? false);
    } else {
        _destinationState = buildFallbackState(_destinationState, destinationCached, destinationLabel, normalizeError(destinationResult.reason));
    }

    if (currentResult.status === 'fulfilled' || destinationResult.status === 'fulfilled') {
        _lastComparisonCurrentLat = currentLat;
        _lastComparisonCurrentLng = currentLng;
        _lastComparisonDestinationLat = destinationLat;
        _lastComparisonDestinationLng = destinationLng;
        _lastComparisonFetchTs = Date.now();
    }

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
