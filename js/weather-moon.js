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
 */

// ── Costanti ──────────────────────────────────────────────────────────────────

const WIDGET_ID        = 'weather-moon-widget';
const CACHE_KEY_PREFIX = 'wm_cache_';
const CACHE_TTL_MS     = 30 * 60 * 1000; // 30 minuti
const MIN_MOVE_KM      = 5;              // soglia spostamento per nuovo fetch

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
let _expanded      = false;

// ── Calcolo fase lunare (astronomia di base, no API) ──────────────────────────

/**
 * Restituisce la fase lunare per una data.
 * Algoritmo: età della luna basata sul ciclo sinodico (29.53059 giorni).
 * @param {Date} date
 * @returns {{ icon: string, name: string, illumination: number, age: number }}
 */
function calcMoonPhase(date = new Date()) {
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
        'soil_temperature_0cm',
        'et0_fao_evapotranspiration',
    ].join(','));
    url.searchParams.set('forecast_days', '4');
    url.searchParams.set('timezone',      'auto');

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function wmoInfo(code) {
    return WMO_CODES[code] ?? { icon: '🌡️', label: 'Dati meteo' };
}

function renderWidget(data, label) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    const moon    = calcMoonPhase();
    const cur     = data.current;
    const daily   = data.daily;
    const curInfo = wmoInfo(cur.weather_code);

    // ── Compact bar ──────────────────────────────────────────────────────────
    const compactLabel = label ? `<span class="wm-location-label">${_esc(label)}</span>` : '';
    const compact = `
        <div id="wm-compact" role="button" aria-expanded="${_expanded}" tabindex="0" aria-label="Meteo e luna — tocca per dettagli">
            ${compactLabel}
            <span class="wm-cur-icon">${curInfo.icon}</span>
            <span class="wm-cur-temp">${Math.round(cur.temperature_2m)}°</span>
            <span class="wm-moon-icon">${moon.icon}</span>
            <span class="wm-expand-arrow">${_expanded ? '▲' : '▼'}</span>
        </div>`;

    // ── Expanded panel ───────────────────────────────────────────────────────
    let expandedHtml = '';
    if (_expanded) {
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
            <div id="wm-panel" role="region" aria-label="Dettaglio meteo">
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
                <div class="wm-source-label">Open-Meteo · aggiornato ${_timeLabel()}</div>
            </div>`;
    }

    widget.innerHTML = compact + expandedHtml;
    widget.style.display = 'block';

    // Event: toggle expanded
    const compactEl = document.getElementById('wm-compact');
    if (compactEl) {
        const toggle = () => { _expanded = !_expanded; renderWidget(data, label); };
        compactEl.addEventListener('click', toggle);
        compactEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    }
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

function renderError() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    const moon = calcMoonPhase();
    widget.innerHTML = `<div id="wm-compact" style="opacity:.6">${moon.icon} Meteo n.d.</div>`;
    widget.style.display = 'block';
}

// ── API pubblica ──────────────────────────────────────────────────────────────

let _lastData    = null;
let _lastLabel   = null;
let _fetchPromise = null;

/**
 * Aggiorna il widget meteo/luna per le coordinate fornite.
 * @param {number}      lat
 * @param {number}      lng
 * @param {string|null} [label]  Etichetta opzionale (es. nome POI). Se null usa posizione GPS.
 * @param {boolean}     [force]  Se true ignora la soglia di spostamento.
 */
export async function updateWeatherMoon(lat, lng, label = null, force = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Spostamento minimo per GPS (evita fetch continue camminando)
    if (!force && label === null && _lastFetchLat !== null) {
        const km = haversineKm(lat, lng, _lastFetchLat, _lastFetchLng);
        if (km < MIN_MOVE_KM) {
            // Ri-renderizza con eventuale nuovo label senza refetch
            if (_lastData) renderWidget(_lastData, label);
            else renderError();
            return;
        }
    }

    const cached = loadCache(lat, lng);
    if (cached) {
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _lastData  = cached;
        _lastLabel = label;
        renderWidget(cached, label);
        return;
    }

    // Evita fetch paralleli sulle stesse coordinate; se il label è cambiato
    // aggiorna comunque il widget con i dati già disponibili
    if (_fetchPromise) {
        if (_lastData) renderWidget(_lastData, label);
        return;
    }

    try {
        _fetchPromise = fetchWeather(lat, lng);
        const data    = await _fetchPromise;
        _lastFetchLat = lat;
        _lastFetchLng = lng;
        _lastData     = data;
        _lastLabel    = label;
        saveCache(lat, lng, data);
        renderWidget(data, label);
    } catch (err) {
        console.warn('[WeatherMoon] Fetch fallito:', err.message);
        if (_lastData) {
            renderWidget(_lastData, label); // mostra dati vecchi
        } else {
            renderError();
        }
    } finally {
        _fetchPromise = null;
    }
}

/**
 * Aggiorna solo la fase lunare (es. al cambio di data senza nuovo GPS).
 * Non fa chiamate di rete.
 */
export function refreshMoonOnly() {
    if (_lastData) renderWidget(_lastData, _lastLabel);
}
