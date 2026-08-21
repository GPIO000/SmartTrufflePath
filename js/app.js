import * as TruffleStorage from './storage-sync.js';
import {
    AUTOMATIC_BACKUP_APP_FOLDER_NAME,
    AUTOMATIC_BACKUP_FILES_FOLDER_NAME,
    buildAutomaticBackupPathLabel,
    buildBackupRestorePlan
} from './backup-utils.js';
import {
    countCachedTileUrls,
    isOfflineRegionFullyCached,
    summarizeTileCoverage
} from './offline-cache-utils.js';
import { downloadTileBatchesWithRecovery, downloadTileWithRetry, isValidCachedTileResponse } from './offline-map-download-utils.js';
import { calcolaDettaglioRitenuta, calcolaImportoTotale, calcolaStatoSogliaVendite, riepilogaAcquistiCliente } from './fiscal-utils.js';
import {
    CUSTOM_POI_MARKERS,
    DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS,
    extractPointerClientPoint,
    hasMapLongPressExceededTolerance,
    isDuplicateMapLongPress,
    DEFAULT_GENERIC_POI_MARKER,
    DEFAULT_SHARED_POI_MARKER,
    formatPoiDisplayDate,
    getDefaultMarkerForPoiType,
    normalizePoiList,
    normalizePoiMarker,
    parseLegacyDateToTimestamp,
    resolvePoiCoords,
    shouldConfirmMapLongPressOnTimeout,
    toMapContainerPoint,
} from './poi-utils.js';

window.TruffleStorage = TruffleStorage;

const SERVICE_WORKER_SCOPE = new URL('./', window.location.href).pathname;
const SERVICE_WORKER_URL = `${SERVICE_WORKER_SCOPE}sw.js`;
const APP_CACHE_NAME_PREFIX = 'smarttruffle-path-';
let lastServiceWorkerRegistrationError = null;
let shouldReloadOnNextServiceWorkerControllerChange = false;

function monitorInstallingServiceWorker(worker) {
    if (!worker || typeof worker.addEventListener !== 'function') return;
    worker.addEventListener('statechange', () => {
        const state = worker.state;
        // Controlla sia 'installed' che 'activating': quando skipWaiting() è chiamato
        // nell'evento install, la transizione installed→activating può avvenire così
        // rapidamente che l'handler riceve il statechange già con state='activating'.
        // Verificare entrambi gli stati garantisce che il flag venga impostato prima
        // che clients.claim() nell'evento activate faccia scattare 'controllerchange'.
        if ((state === 'installed' || state === 'activating') && navigator.serviceWorker.controller) {
            shouldReloadOnNextServiceWorkerControllerChange = true;
        }
    });
}

async function forceAppServiceWorkerUpdateCheck() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
        if (!registration) return null;
        await registration.update();
        return registration;
    } catch (error) {
        console.warn('Service Worker update check failed:', error);
        return null;
    }
}

async function registerAppServiceWorker() {
    try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
            scope: SERVICE_WORKER_SCOPE,
            updateViaCache: 'none'
        });
        monitorInstallingServiceWorker(registration.installing);
        registration.addEventListener('updatefound', () => {
            monitorInstallingServiceWorker(registration.installing);
        });
        void registration.update().catch((error) => {
            console.warn('Initial Service Worker update check failed:', error);
        });
        lastServiceWorkerRegistrationError = null;
        console.log('Service Worker registered:', registration.scope);
        return registration;
    } catch (error) {
        lastServiceWorkerRegistrationError = error;
        console.error('Service Worker registration failed:', error);
        return null;
    }
}

if ('serviceWorker' in navigator) {
    void registerAppServiceWorker();
    window.addEventListener('focus', () => {
        void forceAppServiceWorkerUpdateCheck();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            void forceAppServiceWorkerUpdateCheck();
        }
    });
}

try {
    if (window.TruffleStorage && typeof window.TruffleStorage.init === 'function') {
        await window.TruffleStorage.init();
    }
} catch (error) {
    console.warn('Inizializzazione storage avanzato non riuscita.', error);
}

// Inizializzazione Mappa corretta (ordine invertito per evitare ReferenceError)
const MAP_TILE_LAYER_MAX_ZOOM = 19;
const MAP_TILE_LAYER_MIN_ZOOM = 0;
const map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
const mapContainer = map.getContainer();
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: MAP_TILE_LAYER_MAX_ZOOM, attribution: '© OpenStreetMap' }).addTo(map);
const OFFLINE_REGIONI_PREFERITE_KEY = 'offline_regioni_preferite';
const OFFLINE_MAP_CACHE_NAME = 'smarttruffle-map-offline';
const OFFLINE_MAP_MIN_ZOOM = 6;
const OFFLINE_MAP_DEFAULT_MAX_ZOOM = 13;
const OFFLINE_CACHE_STATUS_KEY = 'offline_cache_status';
const OFFLINE_RECOVERY_STATE_KEY = 'offline_map_recovery_state';
const OFFLINE_STATUS_COLOR_OK = '#22c55e';
const OFFLINE_STATUS_COLOR_WARNING = '#f59e0b';
const OFFLINE_STATUS_COLOR_ERROR = '#ef4444';
let isApplyingMapConnectivityZoomCap = false;
let isTileNetworkUnavailable = false;
let offlineMapRecoveryResumeTimerId = null;
let isOfflineMapRecoveryRunning = false;
let offlineMapStatusRenderRequestId = 0;

function isOfflineMapModeActive() {
    return !navigator.onLine || isTileNetworkUnavailable;
}

function getOfflinePreferences() {
    return readStorageJSON(OFFLINE_REGIONI_PREFERITE_KEY, { regioni: [], maxZoom: OFFLINE_MAP_DEFAULT_MAX_ZOOM });
}

function getOfflinePreferredMaxZoom() {
    const pref = readStorageJSON(OFFLINE_REGIONI_PREFERITE_KEY, null);
    if (!pref) return null;
    const parsedMaxZoom = Number(pref.maxZoom);
    if (!Number.isFinite(parsedMaxZoom)) return null;
    return parsedMaxZoom;
}

function getAdaptiveFocusZoom(defaultZoom) {
    const offlineMaxZoom = getOfflinePreferredMaxZoom();
    if (isOfflineMapModeActive() && Number.isFinite(offlineMaxZoom)) {
        return Math.min(defaultZoom, offlineMaxZoom);
    }
    return defaultZoom;
}

function updateZoomIndicator() {
    const zoomEl = document.getElementById('zoom-level-indicator');
    if (!zoomEl) return;
    const connectivitySymbol = isOfflineMapModeActive() ? '📵' : '📡';
    zoomEl.textContent = `🗺️🔍${map.getZoom()} ${connectivitySymbol}`;
}

function applyMapConnectivityZoomCap({ notify = false, enforceBounds = true } = {}) {
    if (isApplyingMapConnectivityZoomCap) return;
    isApplyingMapConnectivityZoomCap = true;
    const zoomInButton = document.querySelector('.leaflet-control-zoom-in');
    const zoomOutButton = document.querySelector('.leaflet-control-zoom-out');
    const toggleOfflineZoomButtonState = (button, disabled) => {
        if (!button) return;
        if (disabled) {
            button.classList.add('offline-zoom-disabled');
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('tabindex', '-1');
            return;
        }
        button.classList.remove('offline-zoom-disabled');
        button.removeAttribute('aria-disabled');
        button.removeAttribute('tabindex');
    };

    const offlineMaxZoom = getOfflinePreferredMaxZoom();
    const hasOfflineCap = isOfflineMapModeActive() && Number.isFinite(offlineMaxZoom);
    const maxZoomCap = hasOfflineCap
        ? Math.min(MAP_TILE_LAYER_MAX_ZOOM, offlineMaxZoom)
        : MAP_TILE_LAYER_MAX_ZOOM;
    const minZoomCap = hasOfflineCap ? OFFLINE_MAP_MIN_ZOOM : MAP_TILE_LAYER_MIN_ZOOM;
    try {
        map.setMinZoom(minZoomCap);
        map.setMaxZoom(maxZoomCap);
        if (enforceBounds && hasOfflineCap && map.getZoom() > maxZoomCap) {
            map.setZoom(maxZoomCap);
            if (notify) {
                showToast(`📉 Zoom ridotto a ${maxZoomCap} per usare le mappe offline disponibili.`, 'info');
            }
        } else if (enforceBounds && hasOfflineCap && map.getZoom() < minZoomCap) {
            map.setZoom(minZoomCap);
            if (notify) {
                showToast(`📈 Zoom aumentato a ${minZoomCap} per usare le mappe offline disponibili.`, 'info');
            }
        }
        const updatedZoom = map.getZoom();
        toggleOfflineZoomButtonState(zoomInButton, hasOfflineCap && updatedZoom >= maxZoomCap);
        toggleOfflineZoomButtonState(zoomOutButton, hasOfflineCap && updatedZoom <= minZoomCap);
    } finally {
        isApplyingMapConnectivityZoomCap = false;
    }
}

function clampMapZoomForOffline() {
    applyMapConnectivityZoomCap({ notify: true });
}

async function updateOfflineMapRuntimeStatusIndicator() {
    const statusEl = document.getElementById('offline-runtime-status');
    if (!statusEl) return;
    const requestId = ++offlineMapStatusRenderRequestId;
    const renderStatus = (text, color) => {
        const messageEl = document.createElement('p');
        messageEl.style.margin = '0';
        messageEl.style.color = color;
        messageEl.style.fontSize = '0.8rem';
        messageEl.textContent = text;
        statusEl.replaceChildren(messageEl);
    };

    if (!('serviceWorker' in navigator)) {
        renderStatus('❌ Offline non disponibile: browser senza Service Worker.', OFFLINE_STATUS_COLOR_ERROR);
        return;
    }

    let registration = null;
    try {
        registration = await navigator.serviceWorker.getRegistration();
    } catch {
        registration = null;
    }

    const hasController = !!navigator.serviceWorker.controller;
    let cachedTileCount = 0;
    try {
        const cachedUrls = await getOfflineMapCachedUrlsSet({ includeLegacy: true, validateSize: false });
        cachedTileCount = cachedUrls.size;
    } catch {
        cachedTileCount = 0;
    }
    if (requestId !== offlineMapStatusRenderRequestId) return;

    if (!registration) {
        if (lastServiceWorkerRegistrationError?.message) {
            renderStatus(`❌ Service Worker non registrato: ${lastServiceWorkerRegistrationError.message}.`, OFFLINE_STATUS_COLOR_ERROR);
            return;
        }
        renderStatus("⚠️ Service Worker non ancora registrato: ricarica l’app con connessione attiva per abilitare l’offline.", OFFLINE_STATUS_COLOR_WARNING);
        return;
    }

    if (!hasController) {
        const isServiceWorkerPending = registration.installing?.state === 'installing'
            || registration.waiting?.state === 'installed';
        if (isServiceWorkerPending) {
            renderStatus('⚠️ Service Worker in preparazione: attendi qualche secondo e poi riapri questa schermata.', OFFLINE_STATUS_COLOR_WARNING);
            return;
        }
        renderStatus("⚠️ Service Worker pronto ma non ancora collegato a questa schermata: ricarica/riapri l’app una volta per attivare l’offline.", OFFLINE_STATUS_COLOR_WARNING);
        return;
    }

    const networkText = navigator.onLine ? 'Online' : 'Offline';
    if (cachedTileCount > 0) {
        renderStatus(`✅ Mappe offline attive. Tile disponibili in cache: ${cachedTileCount}. Stato rete: ${networkText}.`, OFFLINE_STATUS_COLOR_OK);
        return;
    }

    renderStatus(`⚠️ Service Worker attivo ma nessuna tile in cache: scarica almeno una regione per usare la mappa offline. Stato rete: ${networkText}.`, OFFLINE_STATUS_COLOR_WARNING);
}

// ── Regioni italiane per download mappa offline ───────────────────────────────
const REGIONI_ITALIA_OFFLINE = [
    { id: 'piemonte',            nome: "Piemonte",             bbox: [43.516, 6.627, 46.464, 9.217] },
    { id: 'valle_daosta',         nome: "Valle d'Aosta",        bbox: [45.461, 6.804, 45.988, 7.952] },
    { id: 'lombardia',           nome: "Lombardia",            bbox: [44.676, 8.498, 46.634, 11.360] },
    { id: 'trentino',            nome: "Trentino-Alto Adige",  bbox: [45.671, 10.381, 47.098, 12.479] },
    { id: 'veneto',              nome: "Veneto",               bbox: [44.793, 10.629, 46.830, 13.102] },
    { id: 'friuli',              nome: "Friuli-Venezia Giulia",bbox: [45.581, 12.326, 46.654, 14.103] },
    { id: 'liguria',             nome: "Liguria",              bbox: [43.780, 7.491, 44.676, 10.076] },
    { id: 'emilia_romagna',      nome: "Emilia-Romagna",       bbox: [43.726, 9.196, 45.143, 12.767] },
    { id: 'toscana',             nome: "Toscana",              bbox: [42.236, 9.686, 44.473, 12.368] },
    { id: 'umbria',              nome: "Umbria",               bbox: [42.362, 11.892, 43.619, 13.267] },
    { id: 'marche',              nome: "Marche",               bbox: [42.689, 12.357, 43.975, 13.922] },
    { id: 'lazio',               nome: "Lazio",                bbox: [41.141, 11.449, 42.844, 13.942] },
    { id: 'abruzzo',             nome: "Abruzzo",              bbox: [41.684, 13.019, 42.895, 14.790] },
    { id: 'molise',              nome: "Molise",               bbox: [41.330, 13.919, 42.069, 15.171] },
    { id: 'campania',            nome: "Campania",             bbox: [39.993, 14.029, 41.499, 16.013] },
    { id: 'puglia',              nome: "Puglia",               bbox: [39.789, 15.043, 41.880, 18.519] },
    { id: 'basilicata',          nome: "Basilicata",           bbox: [39.906, 15.337, 41.139, 16.664] },
    { id: 'calabria',            nome: "Calabria",             bbox: [37.915, 15.621, 40.149, 16.996] },
    { id: 'sicilia',             nome: "Sicilia",              bbox: [36.646, 12.428, 38.323, 15.645] },
    { id: 'sardegna',            nome: "Sardegna",             bbox: [38.862, 8.137, 41.315, 9.831] },
];

// ── Dialog / Toast personalizzati ────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('app-toast-visible'));
    const TRANSITION_MS = 300;
    setTimeout(() => {
        toast.classList.remove('app-toast-visible');
        const fallback = setTimeout(() => toast.remove(), TRANSITION_MS + 100);
        toast.addEventListener('transitionend', () => { clearTimeout(fallback); toast.remove(); }, { once: true });
    }, 3500);
}

function appAlert(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog) { window.alert(message); resolve(); return; }
        msg.textContent = message;
        inputField.style.display = 'none';
        cancelBtn.style.display = 'none';
        okBtn.textContent = 'OK';
        const onOk = () => { dialog.close(); okBtn.removeEventListener('click', onOk); resolve(); };
        okBtn.addEventListener('click', onOk);
        dialog.showModal();
    });
}

async function appConfirm(message) {
    const dialog = document.getElementById('app-dialog');
    const msg = document.getElementById('app-dialog-message');
    const inputField = document.getElementById('app-dialog-input');
    const cancelBtn = document.getElementById('app-dialog-cancel');
    const okBtn = document.getElementById('app-dialog-ok');
    if (!dialog || !msg || !inputField || !cancelBtn || !okBtn) { return window.confirm(message); }

    // Yield to the event loop so any deferred 'close' event queued by the browser
    // from a previously closed dialog fires before we attach new listeners.
    await new Promise(r => setTimeout(r, 0));

    msg.textContent = message;
    inputField.style.display = 'none';
    cancelBtn.style.display = '';
    cancelBtn.textContent = 'Annulla';
    okBtn.textContent = 'OK';

    return new Promise((resolve) => {
        let resolved = false;
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onDialogClose);
        };
        const settle = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };
        const onOk = () => { settle(true); dialog.close(); };
        const onCancel = () => { settle(false); dialog.close(); };
        const onDialogClose = () => { settle(false); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('close', onDialogClose);
        dialog.showModal();
    });
}

function appPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog) { resolve(window.prompt(message, defaultValue)); return; }
        if (dialog.open) { resolve(null); return; }
        msg.textContent = message;
        inputField.style.display = 'block';
        inputField.value = defaultValue;
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        okBtn.textContent = 'OK';
        let resolved = false;
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onDialogClose);
            inputField.style.display = 'none';
        };
        const settle = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };
        let pendingValue = null;
        const onOk = () => { pendingValue = inputField.value; dialog.close(); };
        const onCancel = () => { pendingValue = null; dialog.close(); };
        const onDialogClose = () => { settle(pendingValue); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('close', onDialogClose);
        dialog.showModal();
        requestAnimationFrame(() => inputField.focus());
    });
}

function waitForNextUiFrame() {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(resolve, 0);
    });
}

const MAX_DIALOG_SETTLE_FRAMES = 12; // ~200ms at 60fps to let the browser finish closing the previous dialog.

async function waitForDialogToSettle(dialog) {
    if (!dialog) return;
    let remainingFrames = MAX_DIALOG_SETTLE_FRAMES;
    while (dialog.open && remainingFrames > 0) {
        await waitForNextUiFrame();
        remainingFrames -= 1;
    }
}

function appSelect(message, options = [], defaultValue = '') {
    return new Promise((resolve) => {
        if (!Array.isArray(options) || options.length === 0) {
            resolve(null);
            return;
        }
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog) {
            const fallbackMessage = `${message}\n${options.join(' ')}`;
            resolve(window.prompt(fallbackMessage, defaultValue));
            return;
        }
        if (dialog.open) {
            resolve(null);
            return;
        }

        msg.textContent = message;
        const previousInputDisplay = inputField.style.display;
        inputField.style.display = 'none';

        const selectField = document.createElement('select');
        selectField.className = inputField.className;
        selectField.style.display = '';
        options.forEach((option) => {
            const optionEl = document.createElement('option');
            optionEl.value = option;
            optionEl.textContent = option;
            selectField.appendChild(optionEl);
        });
        const normalizedDefault = options.includes(defaultValue) ? defaultValue : options[0];
        if (normalizedDefault) selectField.value = normalizedDefault;
        inputField.insertAdjacentElement('afterend', selectField);

        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        okBtn.textContent = 'OK';

        let resolved = false;
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onDialogClose);
            inputField.style.display = previousInputDisplay;
            selectField.remove();
        };
        const settle = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };
        let pendingValue = null;
        const onOk = () => { pendingValue = selectField.value; dialog.close(); };
        const onCancel = () => { pendingValue = null; dialog.close(); };
        const onDialogClose = () => { settle(pendingValue); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('close', onDialogClose);
        dialog.showModal();
        requestAnimationFrame(() => selectField.focus());
    });
}

function appChoosePoiSaveSource(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const altBtn = document.getElementById('app-dialog-alt');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog || !altBtn) {
            const fallback = window.prompt(`${message}\nScrivi "mappa" per scegliere un punto sulla mappa, altrimenti "gps".`, 'gps');
            const normalized = String(fallback || '').trim().toLowerCase();
            if (normalized === 'gps') resolve('gps');
            else if (normalized === 'mappa') resolve('map');
            else resolve(null);
            return;
        }
        if (dialog.open) {
            resolve(null);
            return;
        }
        msg.textContent = message;
        inputField.style.display = 'none';
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        altBtn.style.display = '';
        altBtn.textContent = '🗺️ Tocca mappa';
        okBtn.textContent = '📡 Posizione GPS';
        let resolved = false;
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            altBtn.removeEventListener('click', onAlt);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onDialogClose);
            altBtn.style.display = 'none';
        };
        const settle = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };
        let pendingValue = null;
        const onOk = () => { pendingValue = 'gps'; dialog.close(); };
        const onAlt = () => { pendingValue = 'map'; dialog.close(); };
        const onCancel = () => { pendingValue = null; dialog.close(); };
        const onDialogClose = () => { settle(pendingValue); };
        okBtn.addEventListener('click', onOk);
        altBtn.addEventListener('click', onAlt);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('close', onDialogClose);
        dialog.showModal();
    });
}

function appChooseSendMethod(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const altBtn = document.getElementById('app-dialog-alt');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog || !altBtn) { resolve(null); return; }
        msg.textContent = message;
        inputField.style.display = 'none';
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        altBtn.style.display = '';
        altBtn.textContent = '💬 WhatsApp';
        okBtn.textContent = '✉️ SMS';
        const cleanup = () => {
            dialog.close();
            okBtn.removeEventListener('click', onSms);
            altBtn.removeEventListener('click', onWhatsApp);
            cancelBtn.removeEventListener('click', onCancel);
            altBtn.style.display = 'none';
        };
        const onSms = () => { cleanup(); resolve('sms'); };
        const onWhatsApp = () => { cleanup(); resolve('whatsapp'); };
        const onCancel = () => { cleanup(); resolve(null); };
        okBtn.addEventListener('click', onSms);
        altBtn.addEventListener('click', onWhatsApp);
        cancelBtn.addEventListener('click', onCancel);
        dialog.showModal();
    });
}

function appChooseCallMethod(message, hasTel, hasCell) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const altBtn = document.getElementById('app-dialog-alt');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog) { resolve(null); return; }
        msg.textContent = message;
        inputField.style.display = 'none';
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        if (hasTel && hasCell) {
            altBtn.style.display = '';
            altBtn.textContent = '📞 Fisso';
            okBtn.textContent = '📱 Cellulare';
        } else if (hasTel) {
            altBtn.style.display = 'none';
            okBtn.textContent = '📞 Chiama Fisso';
        } else {
            altBtn.style.display = 'none';
            okBtn.textContent = '📱 Chiama Cellulare';
        }
        const cleanup = () => {
            dialog.close();
            okBtn.removeEventListener('click', onOk);
            altBtn.removeEventListener('click', onAlt);
            cancelBtn.removeEventListener('click', onCancel);
            altBtn.style.display = 'none';
        };
        const onOk = () => { cleanup(); resolve(hasTel && hasCell ? 'cell' : hasTel ? 'tel' : 'cell'); };
        const onAlt = () => { cleanup(); resolve('tel'); };
        const onCancel = () => { cleanup(); resolve(null); };
        okBtn.addEventListener('click', onOk);
        altBtn.addEventListener('click', onAlt);
        cancelBtn.addEventListener('click', onCancel);
        dialog.showModal();
    });
}

// ─────────────────────────────────────────────────────────────────────────────

function cloneFallbackValue(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === 'object') return { ...value };
    return value;
}

function readStorageJSON(key, fallbackValue) {
    const rawValue = localStorage.getItem(key);
    if (rawValue === null || rawValue === '') return cloneFallbackValue(fallbackValue);

    try {
        const parsedValue = JSON.parse(rawValue);
        if (Array.isArray(fallbackValue)) return Array.isArray(parsedValue) ? parsedValue : cloneFallbackValue(fallbackValue);
        if (fallbackValue && typeof fallbackValue === 'object') {
            return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
                ? parsedValue
                : cloneFallbackValue(fallbackValue);
        }
        return parsedValue ?? cloneFallbackValue(fallbackValue);
    } catch (error) {
        console.warn(`Dati non validi ignorati per ${key}`, error);
        return cloneFallbackValue(fallbackValue);
    }
}

let editingDogIndex = null;
let editingArchivioDocumentoIndex = null;
let editingPoiIndex = null;

function formatDogAge(birthDate) {
    if (!birthDate) return 'Non disponibile';

    const birth = new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return 'Non disponibile';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (birth > today) return 'Non disponibile';

    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();

    if (today.getDate() < birth.getDate()) {
        months -= 1;
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    if (years < 0) return 'Non disponibile';
    if (years === 0 && months === 0) return 'Meno di 1 mese';
    if (years === 0) return `${months} ${months === 1 ? 'mese' : 'mesi'}`;

    const yearsLabel = `${years} ${years === 1 ? 'anno' : 'anni'}`;
    if (months === 0) return yearsLabel;

    return `${yearsLabel} e ${months} ${months === 1 ? 'mese' : 'mesi'}`;
}

function areDogsEquivalent(firstDog, secondDog) {
    if (!firstDog || !secondDog) return false;

    return ['nome', 'razza', 'sesso', 'nascita', 'microchip']
        .every((field) => (firstDog[field] || '') === (secondDog[field] || ''));
}

function syncCurrentDogData(dogsList, { preferredDog = null, replacedDog = null, removedDog = null } = {}) {
    if (!Array.isArray(dogsList) || dogsList.length === 0) {
        localStorage.removeItem('cane_data');
        return;
    }

    const currentDogData = readStorageJSON('cane_data', {});
    const hasCurrentDogData = currentDogData && Object.keys(currentDogData).length > 0;

    if (!hasCurrentDogData) {
        localStorage.setItem('cane_data', JSON.stringify(preferredDog || dogsList[dogsList.length - 1]));
        return;
    }

    if (replacedDog && areDogsEquivalent(currentDogData, replacedDog)) {
        localStorage.setItem('cane_data', JSON.stringify(preferredDog || dogsList[dogsList.length - 1]));
        return;
    }

    if (removedDog && areDogsEquivalent(currentDogData, removedDog)) {
        localStorage.setItem('cane_data', JSON.stringify(dogsList[dogsList.length - 1]));
        return;
    }

    const matchingDog = dogsList.find((dog) => areDogsEquivalent(dog, currentDogData));
    if (matchingDog) {
        localStorage.setItem('cane_data', JSON.stringify(matchingDog));
        return;
    }

    localStorage.setItem('cane_data', JSON.stringify(preferredDog || dogsList[dogsList.length - 1]));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function sanitizeRenderable(value) {
    if (Array.isArray(value)) return value.map(sanitizeRenderable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeRenderable(nestedValue)]));
    }
    return typeof value === 'string' ? escapeHtml(value) : value;
}

function getRenderableStorageJSON(key, fallbackValue) {
    return sanitizeRenderable(readStorageJSON(key, fallbackValue));
}

function buildLuoghiSelectOptions(selectedValue = '') {
    const luoghi = readStorageJSON('luoghi_raccolta', []);
    const hasSelected = selectedValue && !luoghi.includes(selectedValue);
    let opts = `<option value="">-- Seleziona Luogo --</option>`;
    if (hasSelected) {
        opts += `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`;
    }
    opts += luoghi.map(l => `<option value="${escapeHtml(l)}"${l === selectedValue ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
    opts += `<option value="__altro__">✏️ Altro (inserisci nuovo)...</option>`;
    return opts;
}

function aggiungiLuogoRaccolta(luogo) {
    if (!luogo || typeof luogo !== 'string') return;
    const trimmed = luogo.trim();
    if (!trimmed) return;
    const lista = readStorageJSON('luoghi_raccolta', []);
    if (!lista.includes(trimmed)) {
        lista.push(trimmed);
        lista.sort((a, b) => a.localeCompare(b, 'it'));
        localStorage.setItem('luoghi_raccolta', JSON.stringify(lista));
    }
}

function encodeActionArgs(args = []) {
    return escapeHtml(JSON.stringify(args));
}

function actionAttrs(actionName, args = []) {
    return `data-action="${escapeHtml(actionName)}" data-action-args="${encodeActionArgs(args)}"`;
}

function eventActionAttrs(eventName, actionName, args = []) {
    const safeEventName = escapeHtml(eventName);
    return `data-${safeEventName}-action="${escapeHtml(actionName)}" data-${safeEventName}-args="${encodeActionArgs(args)}"`;
}

function parseActionArgs(rawArgs) {
    if (!rawArgs) return [];
    try {
        const parsed = JSON.parse(rawArgs);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
        console.warn('Argomenti azione non validi ignorati.', error);
        return [];
    }
}

function printPage() {
    const activeView = document.getElementById('active-module-view');
    const activeModule = activeView?.dataset?.activeModule;
    const shouldPrintSummaryOnly = activeModule === 'registro_giornaliero' || activeModule === 'spese';
    let cleanupSummaryPrintMode = null;
    let cleanupOnFocus = null;
    if (shouldPrintSummaryOnly && activeView?.querySelector('.print-only')) {
        cleanupSummaryPrintMode = () => {
            document.body.classList.remove('summary-print-mode');
            if (cleanupOnFocus) window.removeEventListener('focus', cleanupOnFocus);
            window.removeEventListener('afterprint', cleanupSummaryPrintMode);
        };
        cleanupOnFocus = () => cleanupSummaryPrintMode();
        window.addEventListener('focus', cleanupOnFocus, { once: true });
        window.addEventListener('afterprint', cleanupSummaryPrintMode, { once: true });
        document.body.classList.add('summary-print-mode');
    }
    try {
        window.print();
    } catch (error) {
        if (cleanupSummaryPrintMode) {
            window.removeEventListener('afterprint', cleanupSummaryPrintMode);
            if (cleanupOnFocus) window.removeEventListener('focus', cleanupOnFocus);
            cleanupSummaryPrintMode();
        }
        throw error;
    }
}

const ACTION_HANDLERS = {
    toggleDrawer: () => toggleDrawer(),
    centerOnUser: () => centerOnUser(),
    saveCarPosition: () => saveCarPosition(),
    savePoiPosition: () => savePoiPosition(),
    triggerSOS: () => triggerSOS(),
    shareAppUrl: () => shareAppUrl(),
    installApp: () => installApp(),
    openModule: (_event, moduleName, editMode = false) => openModule(moduleName, editMode),
    closeActiveModule: () => closeActiveModule(),
    mostraInfoModulo: (_event, moduleName) => mostraInfoModulo(moduleName),
    navigateToPoi: (_event, index) => navigateToPoi(index),
    stopNavigation: () => stopNavigation(),
    sharePoi: (_event, index) => sharePoi(index),
    deletePoi: (_event, index) => deletePoi(index),
    editPoi: (_event, index) => editPoi(index),
    savePoiEdit: (_event, index) => savePoiEdit(index),
    cancelPoiEdit: () => { editingPoiIndex = null; openModule('poilist'); },
    importSharedPoint: () => importSharedPoint(),
    viewStoredDocument: (_event, storageKey, title, moduleName) => viewStoredDocument(storageKey, title, moduleName),
    clearData: (_event, storageKey, moduleName) => clearData(storageKey, moduleName),
    saveTesserino: () => saveTesserino(),
    savePagoPAWithFile: () => savePagoPAWithFile(),
    saveArchivioDocumenti: () => saveArchivioDocumenti(),
    editArchivioDocumento: (_event, index) => editArchivioDocumento(index),
    cancelArchivioDocumentoEdit: () => cancelArchivioDocumentoEdit(),
    deleteArchivioDocumento: (_event, index) => deleteArchivioDocumento(index),
    viewArchivioDocumentoImage: (_event, index, imageType) => viewArchivioDocumentoImage(index, imageType),
    saveF24WithFile: () => saveF24WithFile(),
    saveNewCane: () => saveNewCane(),
    cancelDogEdit: () => cancelDogEdit(),
    editDog: (_event, index) => editDog(index),
    updateDog: () => updateDog(),
    deleteDog: (_event, index) => deleteDog(index),
    savePolizza: () => savePolizza(),
    deletePolizza: (_event, index) => deletePolizza(index),
    saveVetUnifiedEntry: () => saveVetUnifiedEntry(),
    syncVetUnifiedInputForm: () => syncVetUnifiedInputForm(),
    refreshVetBookletFilter: (event) => refreshVetBookletFilter(event),
    printVetFilteredBooklet: () => printVetFilteredBooklet(),
    deleteVetHistoryItem: (_event, index) => deleteVetHistoryItem(index),
    deleteHeatEntry: (_event, index) => deleteHeatEntry(index),
    saveRaccoltaGiornaliera: () => saveRaccoltaGiornaliera(),
    deleteRaccoltaGiornaliera: (_event, index) => deleteRaccoltaGiornaliera(index),
    saveSpesa: () => saveSpesa(),
    deleteSpesa: (_event, index) => deleteSpesa(index),
    esportaDatiCSV: () => esportaDatiCSV(),
    configureAutomaticBackupFolder: () => chooseAutomaticBackupFolder(),
    forceLocalBackupNow: () => forceLocalBackupNow(),
    ripristinaBackupDaFile: (event) => ripristinaBackupDaFile(event),
    saveVetClinic: () => saveVetClinic(),
    callVetClinicByIndex: (_event, index) => callVetClinicByIndex(index),
    whatsappVetClinicByIndex: (_event, index) => whatsappVetClinicByIndex(index),
    shareLocationToVetByIndex: (_event, index) => shareLocationToVetByIndex(index),
    deleteVetClinic: (_event, index) => deleteVetClinic(index),
    salvaNotaClienteDaInput: (_event, index) => salvaNotaClienteDaInput(index),
    addClienteInRubrica: (_event) => addClienteInRubrica(),
    editCliente: (_event, index) => editCliente(index),
    creaRicevutaPerCliente: (_event, index) => creaRicevutaPerCliente(index),
    mostraRicevuteClienteByIndex: (_event, index) => mostraRicevuteClienteByIndex(index),
    deleteCliente: (_event, index) => deleteCliente(index),
    estraiDateTartufiDaTesto: () => estraiDateTartufiDaTesto(),
    esportaCalendariJSON: () => esportaCalendariJSON(),
    importaCalendariJSON: (event) => importaCalendariJSON(event),
    chiudiDettaglioRicevuta: () => chiudiDettaglioRicevuta(),
    condividiRicevuta: (_event, index) => condividiRicevuta(index),
    condividiRicevutaEmail: (_event, index) => condividiRicevutaEmail(index),
    visualizzaRicevutaSalvata: (_event, index) => visualizzaRicevutaSalvata(index),
    modificaRicevuta: (_event, index) => modificaRicevuta(index),
    salvaModificaRicevuta: (_event, index) => salvaModificaRicevuta(index),
    eliminaRicevutaConDoppiaConferma: (_event, index) => eliminaRicevutaConDoppiaConferma(index),
    salvaLuogoRaccoltaNuovo: () => salvaLuogoRaccoltaNuovo(),
    eliminaLuogoRaccoltaDaArchivio: (_event, index) => eliminaLuogoRaccoltaDaArchivio(index),
    aggiornaLuogoRaccoltaInArchivio: (_event, index) => aggiornaLuogoRaccoltaInArchivio(index),
    calcolaTotale: () => calcolaTotale(),
    calcolaRitenutaAcconto: () => calcolaRitenutaAcconto(),
    toggleCoordinateBancarie: () => toggleCoordinateBancarie(),
    autocompilaDatiCliente: (event) => autocompilaDatiCliente(event.target.value),
    archiviaAnnoPrecedente: () => archiviaAnnoPrecedente(),
    setArchivioRegione: (event) => {
        window.currentArchivioRegione = event.target.value;
        openModule('archivio');
    },
    handleLuogoSelectChange: async (event, selectId) => {
        const sel = document.getElementById(selectId);
        if (!sel || sel.value !== '__altro__') return;
        const nuovo = await appPrompt('Inserisci il nuovo luogo / area di raccolta:', '');
        if (nuovo && nuovo.trim()) {
            aggiungiLuogoRaccolta(nuovo.trim());
            // Rebuild options and select the new value
            sel.innerHTML = buildLuoghiSelectOptions(nuovo.trim());
            sel.value = nuovo.trim();
        } else {
            sel.value = '';
        }
    },
    refreshRegistroGiornaliero: () => openModule('registro_giornaliero'),
    refreshSpese: () => openModule('spese'),
    registerRicevutaSafe: async () => {
        try {
            await registraVenditaConPrezzoKg();
        } catch (error) {
            showToast('Errore: ' + error.message, 'error');
            console.error(error);
        }
    },
    showAllStoricoRicevute: () => {
        localStorage.removeItem('filtro_storico_cliente');
        openModule('storico_ricevute');
    },
    saveArchivioRegionaleTartufiSelected: () => salvaArchivioRegionaleTartufi((document.getElementById('seleziona-regione-archivio') || {}).value),
    printPage: () => printPage(),
    closeDrawerAndModule: () => {
        toggleDrawer();
        closeActiveModule();
    },
    scaricaRegioniOffline: () => scaricaRegioniOffline(),
    verificaCoperturaMappaOffline: () => verificaCoperturaMappaOffline(),
    salvaPreferenzeMappaOffline: () => salvaPreferenzeMappaOffline(),
    eliminaCacheMappaOffline: () => eliminaCacheMappaOffline(),
    selezionaTutteRegioni: () => {
        document.querySelectorAll('.offline-region-cb').forEach(cb => { cb.checked = true; });
    },
    deselezionaTutteRegioni: () => {
        document.querySelectorAll('.offline-region-cb').forEach(cb => { cb.checked = false; });
    }
};

function invokeActionHandler(actionName, event, args = []) {
    const handler = ACTION_HANDLERS[actionName];
    if (typeof handler !== 'function') return;
    Promise.resolve(handler(event, ...args)).catch((error) => {
        console.error('Errore azione UI:', actionName, error);
        showToast("Errore durante l'azione richiesta.", 'error');
    });
}

function bindDelegatedActions() {
    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        event.preventDefault();
        invokeActionHandler(target.dataset.action, event, parseActionArgs(target.dataset.actionArgs));
    });

    document.addEventListener('input', (event) => {
        const target = event.target.closest('[data-input-action]');
        if (!target) return;
        invokeActionHandler(target.dataset.inputAction, event, parseActionArgs(target.dataset.inputArgs));
    });

    document.addEventListener('change', (event) => {
        const target = event.target.closest('[data-change-action]');
        if (!target) return;
        invokeActionHandler(target.dataset.changeAction, event, parseActionArgs(target.dataset.changeArgs));
    });
}

bindDelegatedActions();

function sanitizePhoneHref(phoneNumber) {
    return String(phoneNumber ?? '').replace(/[^0-9+]/g, '');
}

function isSafeDataUrl(value) {
    return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(String(value ?? ''));
}

function isImageFile(file) {
    return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

const MAX_IMAGE_SIZE_BYTES = 1.5 * 1024 * 1024;

function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Errore lettura file immagine.'));
        reader.readAsDataURL(file);
    });
}

function getStoredDocumentData(storageKey) {
    const data = readStorageJSON(storageKey, {});
    return isSafeDataUrl(data.contenutoBase64) ? data.contenutoBase64 : '';
}

function viewStoredDocument(storageKey, title, moduleName) {
    const base64Data = getStoredDocumentData(storageKey);
    if (!base64Data) {
        showToast("Documento non disponibile.", 'error');
        return;
    }
    visualizzaImmagineSalvata(base64Data, title, moduleName);
}

setTimeout(() => {
    map.invalidateSize();
    applyMapConnectivityZoomCap();
    mostraDisclaimerIniziale(); // <-- Mostra il disclaimer subito dopo l'avvio/GPS
    // Avvia il re-download automatico delle mappe offline se le preferenze esistono
    // ma la cache è assente (es. se l'app parte già connessa dopo una reinstallazione).
    autoRiscaricaRegioniOfflineSeNecessario();
    // Improvement 4: rimuove in background le tile corrotte o troncate presenti in cache.
    setTimeout(() => cleanupInvalidCachedTiles().catch(() => {}), 5000);
    updateZoomIndicator();
}, 400);
map.on('zoomend', () => {
    if (isOfflineMapModeActive()) applyMapConnectivityZoomCap({ enforceBounds: false });
    updateZoomIndicator();
});

// Long-press on map: ask user if they want to report a new POI at that location
let _mapLongPressTimer = null;
let _mapLongPressMoved = false;
let _mapLongPressStartPoint = null;
let _pendingMapLongPressLatLng = null;
const MAP_LONG_PRESS_MS = 600;
let _lastHandledMapLongPress = null;
let _isPoiMapPickModeActive = false;

function updatePoiMapPickButtonState() {
    const button = document.querySelector('#map-overlays [data-action="savePoiPosition"]');
    if (!button) return;
    button.classList.toggle('btn-info', _isPoiMapPickModeActive);
    button.setAttribute('aria-pressed', _isPoiMapPickModeActive ? 'true' : 'false');
    button.textContent = _isPoiMapPickModeActive ? '✕ Annulla punto' : '📍 Segna punto';
}

function setPoiMapPickMode(active) {
    _isPoiMapPickModeActive = Boolean(active);
    updatePoiMapPickButtonState();
}

function cancelPoiMapPickMode(showFeedback = false) {
    if (!_isPoiMapPickModeActive) return false;
    setPoiMapPickMode(false);
    if (showFeedback) showToast('Selezione punto annullata.', 'info');
    return true;
}

function activatePoiMapPickMode() {
    setPoiMapPickMode(true);
    showToast('🗺️ Tocca un punto sulla mappa per salvarlo.', 'info');
}

function clearMapLongPressTimer() {
    clearTimeout(_mapLongPressTimer);
    _mapLongPressTimer = null;
}

function resetMapLongPressState() {
    clearMapLongPressTimer();
    _mapLongPressStartPoint = null;
    _mapLongPressMoved = false;
    _pendingMapLongPressLatLng = null;
}

function scheduleMapLongPress(latlng, originalEvent) {
    _pendingMapLongPressLatLng = null;
    clearMapLongPressTimer();
    _mapLongPressTimer = setTimeout(() => {
        if (_mapLongPressMoved) return;
        if (shouldConfirmMapLongPressOnTimeout(originalEvent)) {
            resetMapLongPressState();
            void confirmPoiFromMapLongPress(latlng);
            return;
        }
        _pendingMapLongPressLatLng = latlng;
    }, MAP_LONG_PRESS_MS);
}

function beginMapLongPress(latlng, originalEvent) {
    if (!latlng) return;
    if (originalEvent?.touches && originalEvent.touches.length > 1) {
        resetMapLongPressState();
        return;
    }
    if (_mapLongPressTimer && _mapLongPressStartPoint && !_mapLongPressMoved) return;
    _mapLongPressMoved = false;
    _mapLongPressStartPoint = extractPointerClientPoint(originalEvent);
    scheduleMapLongPress(latlng, originalEvent);
}

function updateMapLongPressMovement(originalEvent) {
    if (originalEvent?.touches && originalEvent.touches.length > 1) {
        resetMapLongPressState();
        return;
    }
    const currentPoint = extractPointerClientPoint(originalEvent);
    if (!hasMapLongPressExceededTolerance(_mapLongPressStartPoint, currentPoint)) return;
    _mapLongPressMoved = true;
    _pendingMapLongPressLatLng = null;
    clearMapLongPressTimer();
}

function finalizeMapLongPress() {
    clearMapLongPressTimer();
    _mapLongPressStartPoint = null;
    const latlng = _pendingMapLongPressLatLng;
    _pendingMapLongPressLatLng = null;
    const shouldConfirmLongPress = !_mapLongPressMoved && latlng;
    _mapLongPressMoved = false;
    if (shouldConfirmLongPress) void confirmPoiFromMapLongPress(latlng);
}

function getMapLatLngFromPointerEvent(originalEvent) {
    const clientPoint = extractPointerClientPoint(originalEvent);
    const containerPoint = toMapContainerPoint(clientPoint, mapContainer?.getBoundingClientRect?.());
    if (!containerPoint) return null;
    const latlng = map.containerPointToLatLng([containerPoint.x, containerPoint.y]);
    if (!latlng) return null;
    return { lat: latlng.lat, lng: latlng.lng };
}

function isMouseLongPressEvent(originalEvent) {
    if (!originalEvent) return false;
    if (originalEvent.pointerType) return originalEvent.pointerType === 'mouse';
    if (originalEvent.sourceCapabilities?.firesTouchEvents) return false;
    return originalEvent.type === 'mousedown';
}

async function confirmPoiFromMapLongPress(latlng) {
    if (!latlng) return;
    const handledAt = Date.now();
    if (isDuplicateMapLongPress(_lastHandledMapLongPress, latlng, handledAt, DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS)) return;
    _lastHandledMapLongPress = { lat: latlng.lat, lng: latlng.lng, timestamp: handledAt };
    if (_isPoiMapPickModeActive) {
        cancelPoiMapPickMode();
        await savePoiPosition(latlng.lat, latlng.lng);
        return;
    }
    const ok = await appConfirm(`📍 Vuoi segnalare un nuovo punto in questa posizione?\n(${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)})`);
    if (!ok) return;
    await waitForDialogToSettle(document.getElementById('app-dialog'));
    await savePoiPosition(latlng.lat, latlng.lng);
}

map.on('mousedown', (e) => {
    if (!isMouseLongPressEvent(e.originalEvent)) return;
    beginMapLongPress({ lat: e.latlng.lat, lng: e.latlng.lng }, e.originalEvent);
});

map.on('mousemove', (e) => {
    if (!isMouseLongPressEvent(e.originalEvent)) return;
    updateMapLongPressMovement(e.originalEvent);
});

map.on('mouseup', () => {
    finalizeMapLongPress();
});

map.on('dragstart zoomstart movestart', () => resetMapLongPressState());

mapContainer?.addEventListener('touchstart', (event) => {
    const latlng = getMapLatLngFromPointerEvent(event);
    beginMapLongPress(latlng, event);
}, { passive: true });

mapContainer?.addEventListener('touchmove', (event) => {
    updateMapLongPressMovement(event);
}, { passive: true });

mapContainer?.addEventListener('touchend', () => {
    finalizeMapLongPress();
});

mapContainer?.addEventListener('touchcancel', () => {
    resetMapLongPressState();
});

mapContainer?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});

map.on('contextmenu', (e) => {
    e.originalEvent?.preventDefault?.();
    resetMapLongPressState();
    void confirmPoiFromMapLongPress({ lat: e.latlng.lat, lng: e.latlng.lng });
});

map.on('click', (e) => {
    if (!_isPoiMapPickModeActive || !e?.latlng) return;
    cancelPoiMapPickMode();
    void savePoiPosition(e.latlng.lat, e.latlng.lng);
});

let userMarker = null;
let poiMapMarkers = {}; 
let targetNavigation = null;
const GPS_NAVIGATION_EXPLANATION_SEEN_KEY = 'gps_navigation_explanation_seen';
const GPS_NAVIGATION_EXPLANATION_TEXT = "La navigazione di SmartTruffle Path usa il GPS per calcolare distanza e direzione geografica del punto rispetto al Nord.\nNon usa il magnetometro / la bussola hardware del telefono, quindi non rileva dove stai guardando con il dispositivo.\n\nCome orientarti con i movimenti:\n1. Seleziona il punto di destinazione dall'elenco.\n2. Inizia a camminare per qualche metro in una direzione qualsiasi.\n3. Guarda la freccia: se punta davanti a te, stai andando nella direzione giusta. Se punta a destra o sinistra, ruotati fino a farla puntare dritto davanti.\n4. Continua ad avanzare: la distanza diminuisce? Stai andando verso il punto. Aumenta? Stai allontanandoti — gira di 180°.\n5. Più ti avvicini, più la freccia è precisa. Negli ultimi metri affidati agli occhi e alla mappa.";
const legacyCarCoordinates = readStorageJSON('car_coords', null);

const POI_MARKER_PREFERENCE_KEY = 'poi_marker_preference';

function getPreferredPoiMarker() {
    return normalizePoiMarker(localStorage.getItem(POI_MARKER_PREFERENCE_KEY), undefined);
}

function savePreferredPoiMarker(marker) {
    const normalizedMarker = normalizePoiMarker(marker, undefined);
    localStorage.setItem(POI_MARKER_PREFERENCE_KEY, normalizedMarker);
    return normalizedMarker;
}

async function choosePoiMarker(defaultMarker = getPreferredPoiMarker()) {
    const selectedMarker = await appSelect(
        'Scegli il marker per il punto:',
        CUSTOM_POI_MARKERS,
        normalizePoiMarker(defaultMarker, undefined),
    );
    if (selectedMarker === null) return null;
    return savePreferredPoiMarker(selectedMarker);
}

function buildPoiMarkerOptionsHtml(selectedMarker, type) {
    const normalizedSelectedMarker = normalizePoiMarker(selectedMarker, type);
    return CUSTOM_POI_MARKERS
        .map((marker) => `<option value="${escapeHtml(marker)}" ${marker === normalizedSelectedMarker ? 'selected' : ''}>${escapeHtml(marker)}</option>`)
        .join('');
}

function getPoiMarkerAndTitle(poi) {
    const type = poi && typeof poi.type === 'string' ? poi.type : undefined;
    const marker = normalizePoiMarker(poi?.marker, type);
    if (type === 'auto') return { marker, popupTitle: `${marker} Auto` };
    if (type === 'sos') return { marker, popupTitle: `${marker} SOS` };
    if (type === 'shared') return { marker, popupTitle: `${marker} Punto Condiviso` };
    return { marker, popupTitle: `${marker} Tartufo / Punto` };
}


const rawPoiList = readStorageJSON('poi_list', []);
let poiList = normalizePoiList(rawPoiList);
let poiListChanged = JSON.stringify(rawPoiList) !== JSON.stringify(poiList);
if (legacyCarCoordinates && Number.isFinite(Number(legacyCarCoordinates.lat)) && Number.isFinite(Number(legacyCarCoordinates.lng))) {
    const migratedAt = new Date().toISOString();
    poiList.push({
        id: `poi-${migratedAt}-auto`,
        lat: Number(legacyCarCoordinates.lat),
        lng: Number(legacyCarCoordinates.lng),
        note: 'Auto',
        type: 'auto',
        marker: '🚗',
        savedAt: migratedAt,
        date: formatPoiDisplayDate(migratedAt)
    });
    poiList = normalizePoiList(poiList);
    localStorage.removeItem('car_coords');
    poiListChanged = true;
}
if (poiListChanged) {
    localStorage.setItem('poi_list', JSON.stringify(poiList));
}
const REVERSE_GEOCODE_MIN_INTERVAL_MS = 30000;
const REVERSE_GEOCODE_GRID_DECIMALS = 3;
const REVERSE_GEOCODE_MAX_CACHE_ENTRIES = 200;
const reverseGeocodeCache = new Map();
let reverseGeocodeInFlight = false;
let lastReverseGeocodeAt = 0;

function getReverseGeocodeCacheKey(lat, lng) {
    return `${Number(lat).toFixed(REVERSE_GEOCODE_GRID_DECIMALS)},${Number(lng).toFixed(REVERSE_GEOCODE_GRID_DECIMALS)}`;
}

function updateGpsStatusTextFromLocation(locationData, lat, lng) {
    const gpsText = document.getElementById('gps-status-text');
    if (!gpsText) return;

    const regione = locationData && typeof locationData.regione === 'string' ? locationData.regione : '';
    const provincia = locationData && typeof locationData.provincia === 'string' ? locationData.provincia : '';
    const comune = locationData && typeof locationData.comune === 'string' ? locationData.comune : '';
    const parti = [];
    if (regione) parti.push(`<b>${escapeHtml(regione)}</b>`);
    if (provincia) parti.push(`<b>${escapeHtml(provincia)}</b>`);
    if (comune) parti.push(`<b>${escapeHtml(comune)}</b>`);
    gpsText.innerHTML = parti.length > 0 ? `GPS: ${parti.join(' > ')}` : `GPS Attivo: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

async function reverseGeocodePosition(lat, lng) {
    const cacheKey = getReverseGeocodeCacheKey(lat, lng);
    const cachedLocation = reverseGeocodeCache.get(cacheKey);
    if (cachedLocation) {
        updateGpsStatusTextFromLocation(cachedLocation, lat, lng);
        return;
    }

    if (reverseGeocodeInFlight) return;

    const now = Date.now();
    if ((now - lastReverseGeocodeAt) < REVERSE_GEOCODE_MIN_INTERVAL_MS) return;

    reverseGeocodeInFlight = true;
    lastReverseGeocodeAt = now;

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`,
            { headers: { 'Accept-Language': 'it' } }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const address = data && data.address ? data.address : {};
        const locationData = {
            regione: address.region || address.state || '',
            provincia: address.province || address.county || '',
            comune: address.city || address.town || address.village || address.municipality || ''
        };
        reverseGeocodeCache.set(cacheKey, locationData);
        if (reverseGeocodeCache.size > REVERSE_GEOCODE_MAX_CACHE_ENTRIES) {
            const firstKey = reverseGeocodeCache.keys().next().value;
            if (firstKey !== undefined) reverseGeocodeCache.delete(firstKey);
        }
        updateGpsStatusTextFromLocation(locationData, lat, lng);
    } catch (error) {
        console.log("Errore geocodifica:", error);
    } finally {
        reverseGeocodeInFlight = false;
    }
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const dot = document.getElementById('gps-status-dot');
        if (dot) { dot.style.backgroundColor = '#22c55e'; dot.title = "GPS Attivo: " + lat.toFixed(4) + ", " + lng.toFixed(4); }
        reverseGeocodePosition(lat, lng);
        if (!userMarker) {
            userMarker = L.marker([lat, lng]).addTo(map).bindPopup("<b>Sei qui</b>").openPopup();
            map.setView([lat, lng], getAdaptiveFocusZoom(18));
            renderAllPoiMarkers();
        } else { userMarker.setLatLng([lat, lng]); }
        updateCompass(lat, lng);
    }, (error) => {
        console.warn("Errore GPS: " + error.message);
        const dot = document.getElementById('gps-status-dot');
        if (dot) dot.style.backgroundColor = '#ef4444';
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });
}
function renderAllPoiMarkers() {
    Object.values(poiMapMarkers).forEach(marker => map.removeLayer(marker));
    poiMapMarkers = {};
    poiList.forEach((poi, index) => {
        const safePoi = sanitizeRenderable(poi);
        const { marker, popupTitle } = getPoiMarkerAndTitle(poi);
        const icon = L.divIcon({ className: '', html: `<div style="font-size:28px;line-height:1;">${escapeHtml(marker)}</div>`, iconAnchor: [14, 14] });
        const fromInfo = poi.from ? `<br><small>Da: ${escapeHtml(safePoi.from || '')}</small>` : '';
        const poiMarker = L.marker([poi.lat, poi.lng], { icon }).addTo(map)
            .bindPopup(`<b>${popupTitle}</b><br>Nota: ${safePoi.note || 'Nessuna nota'}<br><small>${safePoi.date || ''}</small>${fromInfo}`);
        poiMapMarkers[index] = poiMarker;
    });
}
function calculateDistanceAndBearing(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180, Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    brng = (brng + 360) % 360;
    const arrows = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
    const directions = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ovest', 'Ovest', 'Nord-Ovest'];
    const index = Math.round((brng / 45)) % 8;
    return {
        distance: distance > 1000 ? (distance / 1000).toFixed(2) + ' km' : Math.round(distance) + ' m',
        arrow: arrows[index],
        direction: directions[index]
    };
}
function updateCompass(currentLat, currentLng) {
    const compassText = document.getElementById('compass-box');
    if (!compassText) return;
    let target = null, label = '';
    if (typeof targetNavigation === 'string' && targetNavigation.startsWith('poi_')) {
        const index = parseInt(targetNavigation.split('_')[1]);
        if (poiList[index]) {
            target = poiList[index];
            const marker = normalizePoiMarker(poiList[index].marker, poiList[index].type);
            label = `${marker} ${poiList[index].note || 'Punto'}`;
        }
    }
    if (target) {
        const res = calculateDistanceAndBearing(currentLat, currentLng, target.lat, target.lng);
        compassText.innerHTML = `🧭 <b>${escapeHtml(label)}:</b> ${res.arrow} ${res.distance} (${res.direction})`;
        const stopBtn = document.getElementById('stop-nav-btn');
        if (stopBtn) stopBtn.style.display = '';
    } else {
        compassText.innerHTML = `🧭 Seleziona una destinazione dall'elenco punti`;
    }
}

function getSavedSenderName() {
    const tData = readStorageJSON('tesserino_data', {});
    return typeof tData.nome === 'string' ? tData.nome.trim() : '';
}

function buildSharedPoiMessage(poi) {
    const senderName = getSavedSenderName();
    const senderLine = senderName ? `\nDa: ${senderName}` : '';
    return `📍 TARTUFAIA CONDIVISA${senderLine}\nNota: ${poi.note}\nData: ${poi.date}\nGoogle Maps: https://maps.google.com/?q=${poi.lat},${poi.lng}`;
}

function addPoi(lat, lng, note, type, from, marker) {
    const savedAt = new Date().toISOString();
    const id = `poi-${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
        id,
        lat: Number(lat),
        lng: Number(lng),
        note: String(note || 'Punto di interesse').trim() || 'Punto di interesse',
        savedAt,
        date: formatPoiDisplayDate(savedAt),
        marker: normalizePoiMarker(marker, type)
    };
    if (type) entry.type = type;
    if (from) entry.from = from;
    poiList.push(entry);
    poiList = normalizePoiList(poiList);
    localStorage.setItem('poi_list', JSON.stringify(poiList));
    return poiList.findIndex((poi) => poi.id === id);
}

function saveCarPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        addPoi(pos.lat, pos.lng, 'Auto', 'auto');
        renderAllPoiMarkers();
        showToast("🚗 Posizione auto aggiunta nell'elenco punti!", 'success');
    } else { showToast("Segnale GPS non ancora disponibile.", 'error'); }
}
async function savePoiPosition(forceLat, forceLng) {
    const hasForcedCoords = forceLat !== undefined && forceLng !== undefined;
    if (!hasForcedCoords) {
        if (_isPoiMapPickModeActive) {
            cancelPoiMapPickMode(true);
            return;
        }
        const saveSource = await appChoosePoiSaveSource('Come vuoi aggiungere il nuovo punto di interesse?');
        await waitForDialogToSettle(document.getElementById('app-dialog'));
        if (saveSource === 'map') {
            activatePoiMapPickMode();
            return;
        }
        if (saveSource !== 'gps') return;
    }
    const pos = resolvePoiCoords(forceLat, forceLng, userMarker);
    if (pos) {
        const note = await appPrompt("Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):", "");
        if (note === null) return;
        await waitForDialogToSettle(document.getElementById('app-dialog'));
        const marker = await choosePoiMarker();
        if (marker === null) return;
        const newIndex = addPoi(pos.lat, pos.lng, note, undefined, undefined, marker);
        renderAllPoiMarkers();
        targetNavigation = `poi_${newIndex}`;
        map.setView([pos.lat, pos.lng], getAdaptiveFocusZoom(18));
        if (poiMapMarkers[newIndex]) poiMapMarkers[newIndex].openPopup();
        showToast(`${marker} Punto salvato!`, 'success');
    } else { showToast("Segnale GPS non ancora disponibile.", 'error'); }
}
async function navigateToPoi(index) {
    if (poiList[index]) {
        await showGpsNavigationExplanationIfNeeded(poiList[index].note);
        targetNavigation = `poi_${index}`;
        map.setView([poiList[index].lat, poiList[index].lng], getAdaptiveFocusZoom(18));
        if (poiMapMarkers[index]) poiMapMarkers[index].openPopup();
        closeActiveModule();
        showToast(`🧭 Destinazione: ${poiList[index].note}`, 'success');
    }
}
function stopNavigation() {
    targetNavigation = null;
    const compassText = document.getElementById('compass-box');
    if (compassText) compassText.innerHTML = `🧭 Seleziona una destinazione dall'elenco punti`;
    const stopBtn = document.getElementById('stop-nav-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    showToast('🧭 Navigazione annullata', 'info');
}
function sharePoi(index) {
    if (poiList[index]) {
        const p = poiList[index];
        const msg = buildSharedPoiMessage(p);
        if (navigator.share) { navigator.share({ title: 'Tartufaia', text: msg }).catch(() => {}); }
        else { window.location.href = `whatsapp://send?text=${encodeURIComponent(msg)}`; }
    }
}

async function deletePoi(index) {
    if (await appConfirm("Vuoi davvero eliminare questo punto salvato?")) {
        if (poiMapMarkers[index]) { map.removeLayer(poiMapMarkers[index]); delete poiMapMarkers[index]; }
        poiList.splice(index, 1);
        localStorage.setItem('poi_list', JSON.stringify(poiList));
        renderAllPoiMarkers();
        openModule('poilist');
    }
}
function editPoi(index) {
    editingPoiIndex = index;
    openModule('poilist');
}
function savePoiEdit(index) {
    const noteEl = document.getElementById(`poi-edit-note-${index}`);
    const latEl = document.getElementById(`poi-edit-lat-${index}`);
    const lngEl = document.getElementById(`poi-edit-lng-${index}`);
    const markerEl = document.getElementById(`poi-edit-marker-${index}`);
    const poiType = poiList[index]?.type;
    const markerRequired = poiType !== 'auto' && poiType !== 'sos';
    if (!noteEl || !latEl || !lngEl || (markerRequired && !markerEl)) return;
    const note = noteEl.value.trim();
    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);
    if (!note) { showToast("La nota non può essere vuota.", 'error'); return; }
    if (isNaN(lat) || isNaN(lng)) { showToast("Coordinate non valide.", 'error'); return; }
    poiList[index].note = note;
    poiList[index].lat = lat;
    poiList[index].lng = lng;
    const updatedMarker = normalizePoiMarker(markerEl ? markerEl.value : poiList[index].marker, poiType);
    poiList[index].marker = updatedMarker;
    poiList = normalizePoiList(poiList);
    localStorage.setItem('poi_list', JSON.stringify(poiList));
    renderAllPoiMarkers();
    editingPoiIndex = null;
    showToast(`${updatedMarker} Punto aggiornato!`, 'success');
    openModule('poilist');
}
function extractCoordsFromMessage(text) {
    let m;
    // Try Google Maps URL: ?q=lat,lng or @lat,lng
    m = text.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = text.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // Try "Lat: X, Lng: Y" or "Lat: X Lng: Y" (with dot or comma decimals)
    m = text.match(/lat(?:itudine)?[:\s]+(-?\d+[.,]\d*)[,\s]+l(?:on|ng|ong)(?:itudine)?[:\s]+(-?\d+[.,]\d*)/i);
    if (m) return { lat: parseFloat(m[1].replace(',', '.')), lng: parseFloat(m[2].replace(',', '.')) };
    // Try "N 43° 12.345' E 11° 34.567'" or "43°12'34.5"N 11°34'56.7"E" (DMS)
    const dmsToDecimal = (deg, min, sec, dir) => {
        let d = parseFloat(deg) + parseFloat(min || 0) / 60 + parseFloat(sec || 0) / 3600;
        if (/[SW]/i.test(dir)) d = -d;
        return d;
    };
    // DMS with symbols: 43°12'34.5"N 11°34'56.7"E (seconds required)
    m = text.match(/(\d{1,3})[°º]\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["""″]\s*([NS])[,\s]+(\d{1,3})[°º]\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["""″]\s*([EWO])/i);
    if (m) return { lat: dmsToDecimal(m[1], m[2], m[3], m[4]), lng: dmsToDecimal(m[5], m[6], m[7], m[8]) };
    // Degrees and decimal minutes: 43°12.345'N 11°34.567'E
    m = text.match(/(\d{1,3})[°º]\s*(\d{1,2}(?:[.,]\d+)?)[′']?\s*([NS])[,\s]+(\d{1,3})[°º]\s*(\d{1,2}(?:[.,]\d+)?)[′']?\s*([EWO])/i);
    if (m) return { lat: dmsToDecimal(m[1], m[2].replace(',', '.'), 0, m[3]), lng: dmsToDecimal(m[4], m[5].replace(',', '.'), 0, m[6]) };
    // N 43 12.345 E 11 34.567 (no symbols)
    m = text.match(/([NS])\s*(\d{1,3})[°º\s]\s*(\d{1,2}(?:[.,]\d+)?)[,\s]+([EWO])\s*(\d{1,3})[°º\s]\s*(\d{1,2}(?:[.,]\d+)?)/i);
    if (m) return { lat: dmsToDecimal(m[2], m[3].replace(',', '.'), 0, m[1]), lng: dmsToDecimal(m[5], m[6].replace(',', '.'), 0, m[4]) };
    // Decimal comma format like "41,0290515, 14,6805400"
    m = text.match(/(-?\d{1,3},\d{4,})\s*[,;]\s*(-?\d{1,3},\d{4,})/);
    if (m) return { lat: parseFloat(m[1].replace(/,/g, '.')), lng: parseFloat(m[2].replace(/,/g, '.')) };
    // GPS coordinate pairs like "43.1234, 11.5678" or "43.1234,11.5678"
    m = text.match(/(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
}

function extractSenderNameFromMessage(text) {
    const match = text.match(/(?:^|[\n\r]|[.!?]\s)(?:da|mittente)[:\s]+([^\n\r.]+)/i);
    return match ? match[1].trim().slice(0, 80) : '';
}

function importSharedPoint() {
    const msgEl = document.getElementById('condiviso-msg-input');
    const fromEl = document.getElementById('condiviso-from-input');
    const markerEl = document.getElementById('condiviso-marker-select');
    if (!msgEl) return;
    const text = msgEl.value.trim();
    if (!text) { showToast("Incolla prima il messaggio ricevuto.", 'error'); return; }
    const coords = extractCoordsFromMessage(text);
    if (!coords) {
        showToast("Nessuna coordinata GPS trovata nel messaggio.", 'error');
        return;
    }
    const from = (fromEl ? fromEl.value.trim() : '') || extractSenderNameFromMessage(text);
    // Determine type: SOS if message contains emergency keywords
    const isSOS = /sos|emergenz|soccors|urgenz|aiuto/i.test(text);
    const type = isSOS ? 'sos' : 'shared';
    const defaultNote = isSOS ? 'SOS ricevuto' : 'Punto condiviso';
    // Build note from the message text, stripping numbers and coordinate-like tokens
    let note = defaultNote;
    const cleanedText = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[-+]?\d+(?:[.,]\d+)?[°º′'"EWONSns]*/g, '')
        .replace(/[°º′'"@#&=?]/g, ' ')
        .replace(/[,;:]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    if (cleanedText.replace(/\s/g, '').length >= 3) note = cleanedText;
    const marker = normalizePoiMarker(markerEl ? markerEl.value : DEFAULT_SHARED_POI_MARKER, type);
    addPoi(coords.lat, coords.lng, note, type, from || undefined, marker);
    renderAllPoiMarkers();
    showToast(`${marker} Punto importato con successo!`, 'success');
    msgEl.value = '';
    if (fromEl) fromEl.value = '';
    openModule('poilist');
}

async function triggerSOS() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const senderName = getSavedSenderName();
        const senderLine = senderName ? ` Da: ${senderName}.` : '';
        const msg = `EMERGENZA SONO IN DIFFICOLTÀ HO BISOGNO DI AIUTO.${senderLine} Coordinate GPS: Lat: ${pos.lat}, Lng: ${pos.lng}.`;
        const method = await appChooseSendMethod('Come vuoi inviare il messaggio di emergenza?');
        if (method === 'sms') { window.location.href = `sms:?body=${encodeURIComponent(msg)}`; }
        else if (method === 'whatsapp') { window.location.href = `whatsapp://send?text=${encodeURIComponent(msg)}`; }
    } else { showToast("Impossibile rilevare le coordinate GPS.", 'error'); }
}
function openModule(moduleName, editMode = false) {
    const drawer = document.getElementById('app-drawer');
    if (drawer && drawer.classList.contains('drawer-open')) toggleDrawer();
    if (moduleName !== 'canidiary') editingDogIndex = null;
    if (moduleName !== 'archivio_documenti') editingArchivioDocumentoIndex = null;
    if (moduleName !== 'poilist') editingPoiIndex = null;
    let activeView = document.getElementById('active-module-view');
    if (!activeView) {
        activeView = document.createElement('div');
        activeView.id = 'active-module-view';
        document.getElementById('app-container').appendChild(activeView);
    }
    let contentHTML = '';
    switch(moduleName) {
        case 'poilist':
            let poiHtml = `<h2>Elenco Punti & Tartufaie</h2><p>I tuoi punti di ricerca salvati con note:</p>
                <div class="module-card card-gap">
                    <strong class="text-accent">ℹ️ Come funziona la navigazione</strong>
                    <p class="text-muted small-text" style="margin-top:8px;">La bussola dell'app calcola via GPS la direzione geografica del punto rispetto al Nord e la distanza.</p>
                    <p class="text-subtle small-text" style="margin-top:6px;">Non usa il magnetometro / la bussola hardware del telefono, quindi non indica dove stai guardando: per orientarti usa i tuoi movimenti.</p>
                    <p class="text-subtle small-text" style="margin-top:6px;"><strong>Come orientarti:</strong></p>
                    <ol class="text-subtle small-text" style="margin:4px 0 0 16px; padding:0; line-height:1.7;">
                        <li>Seleziona il punto dall'elenco.</li>
                        <li>Cammina qualche metro in una direzione qualsiasi.</li>
                        <li>Se la freccia punta davanti a te, stai andando bene. Se punta di lato, ruotati finché non ti punta dritto davanti.</li>
                        <li>La distanza diminuisce? Stai avanzando. Aumenta? Gira di 180°.</li>
                        <li>Negli ultimi metri affidati alla mappa e agli occhi.</li>
                    </ol>
                </div>`;
            if (poiList.length === 0) {
                poiHtml += '<div class="module-card"><p>Nessun punto salvato. Usa i tasti "Segna Auto" o "Segna Punto" sulla mappa.</p></div>';
            } else {
                poiList.forEach((poi, idx) => {
                    const safePoi = sanitizeRenderable(poi);
                    const isAuto = poi.type === 'auto';
                    const isSos = poi.type === 'sos';
                    const poiIcon = normalizePoiMarker(poi.marker, poi.type);
                    const fromLine = safePoi.from ? `<p class="text-muted small-text" style="margin:2px 0;">Da: ${safePoi.from}</p>` : '';
                    const isEditing = editingPoiIndex === idx;
                    if (isEditing) {
                        const markerField = (isAuto || isSos)
                            ? `<input type="text" class="mod-input" value="${escapeHtml(poiIcon)}" readonly>`
                            : `<select id="poi-edit-marker-${idx}" class="mod-input">${buildPoiMarkerOptionsHtml(poiIcon, poi.type)}</select>`;
                        poiHtml += `
                        <div class="module-card card-gap" style="border-left:4px solid #2563eb;">
                            <strong class="text-accent">✏️ Modifica Punto</strong>
                            <label style="margin-top:8px;">Nota:</label>
                            <input type="text" id="poi-edit-note-${idx}" class="mod-input" value="${safePoi.note}">
                            <label>Latitudine:</label>
                            <input type="number" step="0.000001" id="poi-edit-lat-${idx}" class="mod-input" value="${poi.lat}">
                            <label>Longitudine:</label>
                            <input type="number" step="0.000001" id="poi-edit-lng-${idx}" class="mod-input" value="${poi.lng}">
                            <label>Marker:</label>
                            ${markerField}
                            <div class="btn-row" style="margin-top:10px;">
                                <button class="overlay-btn btn-primary" ${actionAttrs('savePoiEdit', [idx])}>💾 Salva</button>
                                <button class="overlay-btn btn-neutral" ${actionAttrs('cancelPoiEdit')}>✕ Annulla</button>
                            </div>
                        </div>`;
                    } else {
                        poiHtml += `
                        <div class="module-card card-gap">
                            <strong class="text-accent">${poiIcon} ${safePoi.note}</strong>
                            <p class="text-muted small-text" style="margin:4px 0;">Data: ${safePoi.date}</p>
                            <p class="text-subtle small-text">Lat: ${poi.lat.toFixed(4)}, Lng: ${poi.lng.toFixed(4)}</p>
                            ${fromLine}
                            <div class="btn-row">
                                <button class="overlay-btn btn-success" ${actionAttrs('navigateToPoi', [idx])}>🧭 Vai</button>
                                <button class="overlay-btn btn-info" ${actionAttrs('sharePoi', [idx])}>📤 Condividi</button>
                                <button class="overlay-btn" style="background:#4b5563;" ${actionAttrs('editPoi', [idx])}>✏️ Modifica</button>
                                <button class="overlay-btn btn-danger" ${actionAttrs('deletePoi', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                    }
                });
            }
            contentHTML = poiHtml;
            break;
        case 'punti_condivisi':
            contentHTML = `
                <h2>📩 Importa Punti Condivisi / SOS</h2>
                <p>Incolla qui il messaggio ricevuto da un altro utente (punto condiviso o SOS). Il sistema estrarrà automaticamente le coordinate e, se presente, anche il nome del mittente.</p>
                <div class="module-card">
                    <label for="condiviso-msg-input" style="display:block; margin-bottom:8px; font-weight:bold;">Messaggio ricevuto:</label>
                    <textarea id="condiviso-msg-input" class="mod-input" rows="6" placeholder="Incolla qui il messaggio ricevuto...&#10;&#10;Esempio:&#10;📍 TARTUFAIA CONDIVISA&#10;Da: Mario Rossi&#10;Nota: Quercia grande&#10;Google Maps: https://maps.google.com/?q=43.1234,11.5678&#10;&#10;oppure:&#10;EMERGENZA SONO IN DIFFICOLTÀ HO BISOGNO DI AIUTO. Da: Mario Rossi. Coordinate GPS: Lat: 43.1234, Lng: 11.5678." style="width:100%; box-sizing:border-box; font-family:inherit; resize:vertical;"></textarea>
                    <label for="condiviso-from-input" style="display:block; margin:12px 0 6px; font-weight:bold;">Da (mittente, opzionale solo per messaggi vecchi):</label>
                    <input type="text" id="condiviso-from-input" class="mod-input" placeholder="Es. Mario Rossi" style="width:100%; box-sizing:border-box;">
                    <label for="condiviso-marker-select" style="display:block; margin:12px 0 6px; font-weight:bold;">Marker (solo punti non SOS):</label>
                    <select id="condiviso-marker-select" class="mod-input" style="width:100%; box-sizing:border-box;">${buildPoiMarkerOptionsHtml(DEFAULT_SHARED_POI_MARKER, 'shared')}</select>
                    <button class="overlay-btn btn-primary" style="margin-top:14px; width:100%;" ${actionAttrs('importSharedPoint', [])}>📥 Importa Punto</button>
                </div>`;
            break;
        case 'tesserino':
            const tData = getRenderableStorageJSON('tesserino_data', {});
            if (tData.nome && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (getStoredDocumentData('tesserino_data')) {
                    if (tData.tipoFile && tData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${tData.nomeFile || 'Immagine'}</p><img src="${getStoredDocumentData('tesserino_data')}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="Tesserino"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn btn-info" ${actionAttrs('viewStoredDocument', ['tesserino_data', 'Tesserino Digitale', 'tesserino'])}>👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;"><strong>Allegato non visualizzabile:</strong> carica un'immagine per visualizzarla nell'app.</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>Dati Personali & Tesserino Digitale</h2>
                    <p><strong>Normativa:</strong> Legge 145/2018</p>
                    <div class="module-card card-green-border">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Dati Personali Registrati</p>
                        <p><strong>Nome:</strong> ${tData.nome}</p>
                        <p><strong>Codice Fiscale:</strong> ${tData.cf}</p>
                        <p><strong>Indirizzo:</strong> ${tData.indirizzo || 'Non inserito'}</p>
                        <p><strong>Regione / Prov:</strong> ${tData.regione}</p>
                        <p><strong>N. Tesserino:</strong> ${tData.num}</p>
                        ${tData.iban ? `<p style="margin-top:8px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.07);"><strong>IBAN:</strong> ${tData.iban}</p>` : ''}
                        ${tData.banca ? `<p><strong>Banca:</strong> ${tData.banca}</p>` : ''}
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn btn-primary" ${actionAttrs('openModule', ['tesserino', true])}>✏️ Modifica</button>
                            <button class="overlay-btn btn-danger" ${actionAttrs('clearData', ['tesserino_data', 'tesserino'])}>🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Dati Personali & Tesserino Digitale</h2>
                    <p>Inserisci i tuoi dati personali e gli estremi del tesserino regionale per la raccolta dei tartufi:</p>
                    <div class="module-card">
                        <label>Nome e Cognome:</label>
                        <input type="text" id="t-nome" class="mod-input" value="${tData.nome || ''}" placeholder="Es. Mario Rossi">
                        <label>Codice Fiscale:</label>
                        <input type="text" id="t-cf" class="mod-input" value="${tData.cf || ''}" placeholder="Es. RSSMRA80A01H501W">
                        <label>Indirizzo (Via, Città, CAP):</label>
                        <input type="text" id="t-indirizzo" class="mod-input" value="${tData.indirizzo || ''}" placeholder="Es. Via Roma 1, 00100 Roma (RM)">
                        <label>Regione / Provincia di Rilascio:</label>
                        <input type="text" id="t-regione" class="mod-input" value="${tData.regione || ''}" placeholder="Es. Molise / Abruzzo">
                        <label>Numero Tesserino:</label>
                        <input type="text" id="t-num" class="mod-input" value="${tData.num || ''}" placeholder="Numero autorizzazione">
                        <label style="margin-top:10px;">Carica Tesserino (solo immagine - Max 1.5MB):</label>
                        <input type="file" id="t-file" accept="image/*" class="mod-input" style="padding:8px;">
                        <p style="margin-top:6px; color:#b8b0a0; font-size:0.8rem;">Consiglio: usa immagini leggere per un salvataggio più veloce.</p>
                        <p style="margin-top:14px; margin-bottom:6px; color:#b8b0a0; font-size:0.8rem; text-transform:uppercase; border-top:1px dashed rgba(255,255,255,0.07); padding-top:10px;">💳 Coordinate Bancarie (per bonifico)</p>
                        <label>IBAN:</label>
                        <input type="text" id="t-iban" class="mod-input" value="${tData.iban || ''}" placeholder="Es. IT60 X054 2811 1010 0000 0123 456">
                        <label>Banca / Istituto di Credito (facoltativo):</label>
                        <input type="text" id="t-banca" class="mod-input" value="${tData.banca || ''}" placeholder="Es. Banca Intesa Sanpaolo">
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('saveTesserino')}>Salva Dati Personali</button>
                    </div>`;
            }
            break;
        case 'pagopa':
            const pData = getRenderableStorageJSON('pagopa_data', {});
            if (pData.id && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (getStoredDocumentData('pagopa_data')) {
                    if (pData.tipoFile && pData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${pData.nomeFile || 'Immagine'}</p><img src="${getStoredDocumentData('pagopa_data')}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="Quietanza PagoPA"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn btn-info" ${actionAttrs('viewStoredDocument', ['pagopa_data', 'Quietanza PagoPA', 'pagopa'])}>👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;"><strong>Allegato non visualizzabile:</strong> carica un'immagine per visualizzarla nell'app.</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>Ricevuta PagoPA</h2>
                    <div class="module-card card-green-border">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Quietanza Attiva</p>
                        <p><strong>ID Transazione:</strong> ${pData.id}</p>
                        <p><strong>Data Pagamento:</strong> ${pData.data}</p>
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn btn-primary" ${actionAttrs('openModule', ['pagopa', true])}>✏️ Modifica</button>
                            <button class="overlay-btn btn-danger" ${actionAttrs('clearData', ['pagopa_data', 'pagopa'])}>🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Ricevuta PagoPA</h2>
                    <p>Registra la quietanza di pagamento della tassa regionale:</p>
                    <div class="module-card">
                        <label>ID Transazione / Codice Avviso:</label>
                        <input type="text" id="p-id" class="mod-input" value="${pData.id || ''}" placeholder="Es. TRN123456789">
                        <label>Data Pagamento:</label>
                        <input type="date" id="p-data" class="mod-input" value="${pData.data || new Date().toISOString().slice(0,10)}">
                        <label>Carica Ricevuta (solo immagine - Obbligatorio):</label>
                        <input type="file" id="p-file" accept="image/*" class="mod-input" style="padding:8px;">
                        <p style="margin-top:6px; color:#b8b0a0; font-size:0.8rem;">Consiglio: carica immagini di piccole dimensioni.</p>
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('savePagoPAWithFile')}>Archivia Ricevuta PagoPA</button>
                    </div>`;
            }
            break;
        case 'ricevute':
            const f24SavedData = readStorageJSON('f24_data', {});
            const defaultProtocollo = f24SavedData.protocollo || '';
            
            const storicoRicevutePreview = readStorageJSON('storico_vendite', []);
            const prossimaNumerazione = storicoRicevutePreview.length + 1;
            
            const annoCorrenteReg = new Date().getFullYear();
            let f24ValidoPreview = false;
            if (f24SavedData.protocollo && f24SavedData.dataPagamento) {
                const dataP = new Date(f24SavedData.dataPagamento);
                const scadenzaF24 = new Date(annoCorrenteReg, 1, 16, 23, 59, 59);
                if (dataP <= scadenzaF24) f24ValidoPreview = true;
            }
            const dataOdiernaCausale = new Date().toLocaleDateString('it-IT');
            const riferimentoNormativoCausale = f24ValidoPreview
                ? "ai sensi della Legge 145/2018 - Regime Imposta Sostitutiva"
                : "ai sensi dell'art. 34, comma 6, del DPR n. 633/1972 - Regime Ritenuta d'Acconto";
            const causaleDefault = `Pagamento della ricevuta n. ${prossimaNumerazione} per la vendita occasionale di tartufi (${riferimentoNormativoCausale}) emessa in data ${dataOdiernaCausale}.`;
            const regimeRilevatoTesto = f24ValidoPreview 
                ? '<span style="color:#22c55e; font-weight:bold;">Imposta Sostitutiva (F24 ELIDE valido)</span>' 
                : '<span style="color:#38bdf8; font-weight:bold;">Ritenuta d\'Acconto (23% - F24 assente o non valido)</span>';

            contentHTML = `
                <h2>Ricevuta di Vendita Occasionale</h2>
                <p>Conforme a Legge 145/2018, Reg. CE 178/02 & DPR 633/1972</p>
                <div class="module-card">
                    <div style="background:#0f172a; padding:12px; border-radius:6px; margin-bottom:15px; border:1px solid #334155;">
                        <p style="font-size:0.8rem; color:#94a3b8; margin-bottom:4px; text-transform:uppercase;">Regime Fiscale (Selezione Automatica):</p>
                        <p style="font-size:0.9rem; margin:0;">${regimeRilevatoTesto}</p>
                    </div>

                    <input type="hidden" id="r-regime" value="${f24ValidoPreview ? 'sostitutiva' : 'ritenuta'}">

                    <label>Acquirente (Privato o Ristorante / Ragione Sociale):</label>
                    <input type="text" id="r-acquirente" class="mod-input" placeholder="Nome o Ristorante" ${eventActionAttrs('input', 'autocompilaDatiCliente')}>
                    
                    <label>P.IVA / Codice Fiscale Acquirente:</label>
                    <input type="text" id="r-cf-acquirente" class="mod-input" placeholder="P.IVA o CF acquirente">

                    <label>Indirizzo Acquirente:</label>
                    <input type="text" id="r-indirizzo-acquirente" class="mod-input" placeholder="Via, Città, CAP">

                    <label>Email Acquirente:</label>
                    <input type="email" id="r-email-acquirente" class="mod-input" placeholder="email@esempio.it">
                    
                    <label>Specie Tartufo:</label>
                    <select id="r-specie" class="mod-input">
                        <option value="Tuber magnatum Pico (Pregiato Bianco)">Tuber magnatum Pico (Pregiato Bianco)</option>
                        <option value="Tuber melanosporum Vitt. (Nero Pregiato)">Tuber melanosporum Vitt. (Nero Pregiato)</option>
                        <option value="Tuber macrosporum Vitt. (Nero Liscio)">Tuber macrosporum Vitt. (Nero Liscio)</option>
                        <option value="Tuber brumale Vitt. (Moscatuto / Invernale)">Tuber brumale Vitt. (Moscatuto / Invernale)</option>
                        <option value="Tuber brumale var. moschatum De Ferry (Brumale moscato)">Tuber brumale var. moschatum De Ferry (Brumale moscato)</option>
                        <option value="Tuber aestivum Vitt. (Scorzone Estivo)">Tuber aestivum Vitt. (Scorzone Estivo)</option>
                        <option value="Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)">Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)</option>
                        <option value="Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)">Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)</option>
                        <option value="Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)">Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)</option>
                    </select>
                    
                    <label>Classificazione Qualità:</label>
                    <select id="r-qualita" class="mod-input">
                        <option value="Prima Scelta">Prima Scelta</option>
                        <option value="Seconda Scelta">Seconda Scelta</option>
                        <option value="Terza Scelta">Terza Scelta</option>
                    </select>
                    
                    <label>Peso (grammi):</label>
                    <input type="number" id="pesoGrammi" class="mod-input" placeholder="Es. 150" ${eventActionAttrs('input', 'calcolaTotale')}>

                    <label>Prezzo al kg (€):</label>
                    <input type="number" id="prezzoKg" class="mod-input" placeholder="Es. 1500.00" ${eventActionAttrs('input', 'calcolaTotale')}>

                    <label>Importo Complessivo / Corrispettivo (€):</label>
                    <input type="number" id="importoTotale" class="mod-input" placeholder="Es. 200.00" ${eventActionAttrs('input', 'calcolaRitenutaAcconto')}>

                    <div id="container-ritenuta" style="display:${f24ValidoPreview ? 'none' : 'block'}; background:#0f172a; padding:10px; border-radius:6px; margin:10px 0; border:1px solid #334155;">
                        <p style="font-size:0.85rem; color:#38bdf8; margin-bottom:6px;"><b>Calcolo Ritenuta d'Acconto (23%):</b></p>
                        <label>Importo Ritenuta d'Acconto (€):</label>
                        <input type="number" id="r-importo-ritenuta" class="mod-input" readonly style="background:#1e293b; color:#22c55e; font-weight:bold;">
                        <label style="margin-top:6px;">Netto a Pagare percepito dal raccoglitore (€):</label>
                        <input type="number" id="r-netto-pagare" class="mod-input" readonly style="background:#1e293b; color:#22c55e; font-weight:bold;">
                    </div>

                    <label>Luogo / Area di Raccolta e Provincia <span style="color:#ef4444;">*</span>:</label>
                    <select id="r-comune" class="mod-input" ${eventActionAttrs('change', 'handleLuogoSelectChange', ['r-comune'])}>${buildLuoghiSelectOptions()}</select>
                    
                    <label>Codice Lotto / Tracciabilità:</label>
                    <input type="text" id="r-lotto" class="mod-input" value="LOTTO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-01" placeholder="Codice lotto">
                    
                    <div id="container-f24-field" style="display:${f24ValidoPreview ? 'block' : 'none'};">
                        <label>N. Protocollo F24 ELIDE collegato:</label>
                        <input type="text" id="r-f24" class="mod-input" value="${defaultProtocollo}" placeholder="Protocollo F24">
                    </div>

                    <!-- Nuova Sezione: Note Cliente per la Rubrica -->
                    <label style="margin-top: 10px;">📝 Note Cliente (Rubrica):</label>
                    <textarea id="r-nota-cliente" class="mod-input" placeholder="Scrivi una nota per questo cliente..." rows="2" style="resize: vertical; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 6px; font-size: 0.8rem;"></textarea>

                    <label style="margin-top:12px;">💳 Metodo di Pagamento:</label>
                    <select id="r-metodo-pagamento" class="mod-input" ${eventActionAttrs('change', 'toggleCoordinateBancarie')}>
                        <option value="contanti">💵 Contanti</option>
                        <option value="bonifico">🏦 Bonifico Bancario</option>
                    </select>

                    <div id="container-coordinate-bancarie" style="display:none; background:#0f172a; padding:10px; border-radius:6px; margin:8px 0; border:1px solid #334155;">
                        <p style="font-size:0.82rem; color:#38bdf8; margin-bottom:8px;"><b>🏦 Coordinate Bancarie del Venditore (da Dati Personali):</b></p>
                        <label>IBAN:</label>
                        <input type="text" id="r-iban" class="mod-input" placeholder="Es. IT60 X054 2811 1010 0000 0123 456">
                        <label>Banca / Istituto di Credito (facoltativo):</label>
                        <input type="text" id="r-banca" class="mod-input" placeholder="Es. Intesa Sanpaolo">
                        <label style="margin-top:6px;">Causale Bonifico:</label>
                        <input type="text" id="r-causale" class="mod-input" value="${causaleDefault}" placeholder="Es. Pagamento tartufi freschi - Ricevuta N. ...">
                    </div>
                    
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" ${actionAttrs('registerRicevutaSafe')}>Registra e Genera Ricevuta Conforme</button>
                </div>`;
            setTimeout(() => { toggleRegimeFiscaleFields(); toggleCoordinateBancarie(); }, 50);
            break;

        case 'archivio_documenti':
            const archivioDocumenti = getRenderableStorageJSON('archivio_documenti_list', []);
            const isArchivioDocumentoEditMode = Number.isInteger(editingArchivioDocumentoIndex)
                && editingArchivioDocumentoIndex >= 0
                && editingArchivioDocumentoIndex < archivioDocumenti.length;
            const archivioDocumentoInModifica = isArchivioDocumentoEditMode
                ? archivioDocumenti[editingArchivioDocumentoIndex]
                : null;
            let archivioDocumentiHtml = `
                <h2>Archivio Altri Documenti</h2>
                <p>Archivia carta d'identità, autorizzazioni funghi e altri documenti con numero, scadenza e immagini.</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">${isArchivioDocumentoEditMode ? '✏️ Modifica Documento' : '➕ Aggiungi Documento'}</h3>
                    <label>Tipo documento:</label>
                    <input type="text" id="ad-tipo" class="mod-input" placeholder="Es. Carta d'identità / Autorizzazione funghi" value="${escapeHtml(archivioDocumentoInModifica?.tipo || '')}">
                    <label>Numero documento:</label>
                    <input type="text" id="ad-numero" class="mod-input" placeholder="Es. AZ-123456" value="${escapeHtml(archivioDocumentoInModifica?.numero || '')}">
                    <label>Data scadenza:</label>
                    <input type="date" id="ad-scadenza" class="mod-input" value="${escapeHtml(archivioDocumentoInModifica?.scadenza || '')}">
                    <label>Immagine documento (${isArchivioDocumentoEditMode ? 'facoltativa se già presente' : 'obbligatoria'} - max 1.5MB):</label>
                    <input type="file" id="ad-doc-file" accept="image/*" class="mod-input" style="padding:8px;">
                    ${isArchivioDocumentoEditMode && archivioDocumentoInModifica?.nomeFileDocumento ? `<p style="margin-top:6px; color:#b8b0a0; font-size:0.8rem;">File attuale documento: <strong>${escapeHtml(archivioDocumentoInModifica.nomeFileDocumento)}</strong></p>` : ''}
                    <label style="margin-top:8px;">Immagine ricevuta rinnovo (facoltativa - max 1.5MB):</label>
                    <input type="file" id="ad-rinnovo-file" accept="image/*" class="mod-input" style="padding:8px;">
                    ${isArchivioDocumentoEditMode && archivioDocumentoInModifica?.nomeFileRinnovo ? `<p style="margin-top:6px; color:#b8b0a0; font-size:0.8rem;">File attuale rinnovo: <strong>${escapeHtml(archivioDocumentoInModifica.nomeFileRinnovo)}</strong></p>` : ''}
                    ${isArchivioDocumentoEditMode && archivioDocumentoInModifica?.contenutoBase64Rinnovo ? `
                        <label style="display:flex; align-items:center; gap:8px; margin-top:8px; color:#ddd6c8;">
                            <input type="checkbox" id="ad-remove-rinnovo">
                            Rimuovi ricevuta rinnovo attuale
                        </label>
                    ` : ''}
                    <div class="btn-row">
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('saveArchivioDocumenti')}>${isArchivioDocumentoEditMode ? 'Aggiorna Documento' : 'Salva Documento'}</button>
                        <button class="overlay-btn btn-neutral btn-full mt-15" style="${isArchivioDocumentoEditMode ? '' : 'display:none;'}" ${actionAttrs('cancelArchivioDocumentoEdit')}>Annulla Modifica</button>
                    </div>
                </div>
            `;

            if (archivioDocumenti.length === 0) {
                archivioDocumentiHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun documento archiviato.</p></div>`;
            } else {
                archivioDocumentiHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Documenti archiviati:</h3>`;
                archivioDocumenti.forEach((doc, idx) => {
                    const safeDoc = sanitizeRenderable(doc);
                    archivioDocumentiHtml += `
                        <div class="module-card" style="border-left: 4px solid #4d8a98; margin-bottom: 12px;">
                            <p><strong>Tipo:</strong> ${safeDoc.tipo || 'N/D'}</p>
                            <p><strong>Numero:</strong> ${safeDoc.numero || 'N/D'}</p>
                            <p><strong>Scadenza:</strong> ${safeDoc.scadenza || 'N/D'}</p>
                            <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
                                <button class="overlay-btn btn-info" ${actionAttrs('viewArchivioDocumentoImage', [idx, 'documento'])}>👁️ Documento</button>
                                ${safeDoc.contenutoBase64Rinnovo ? `<button class="overlay-btn btn-info" ${actionAttrs('viewArchivioDocumentoImage', [idx, 'rinnovo'])}>👁️ Ricevuta Rinnovo</button>` : ''}
                                <button class="overlay-btn btn-primary" ${actionAttrs('editArchivioDocumento', [idx])}>✏️ Modifica</button>
                                <button class="overlay-btn btn-danger" ${actionAttrs('deleteArchivioDocumento', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>
                    `;
                });
            }

            contentHTML = archivioDocumentiHtml;
            break;

        case 'archivio_luoghi': {
            const luoghi = getRenderableStorageJSON('luoghi_raccolta', []);
            let luoghiHtml = `<h2>📍 Archivio Luoghi / Aree di Raccolta</h2>
                <p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 12px 0;">Gestisci le aree di raccolta memorizzate. Vengono suggerite automaticamente nella compilazione delle ricevute.</p>
                <div class="module-card">
                    <label>Aggiungi nuovo luogo:</label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="text" id="nuovo-luogo-input" class="mod-input" placeholder="Es. Norcia (PG)" style="flex:1; margin:0;">
                        <button class="overlay-btn btn-success" style="white-space:nowrap;" ${actionAttrs('salvaLuogoRaccoltaNuovo')}>➕ Aggiungi</button>
                    </div>
                </div>`;
            if (luoghi.length === 0) {
                luoghiHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun luogo salvato. Verrà popolato automaticamente alla prima emissione di ricevuta.</p></div>`;
            } else {
                luoghi.forEach((luogo, idx) => {
                    luoghiHtml += `
                        <div class="module-card" style="border-left:4px solid #16a34a; margin-bottom:10px;">
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                <input type="text" id="luogo-edit-${idx}" class="mod-input" value="${escapeHtml(luogo)}" style="flex:1; margin:0; min-width:180px;">
                                <button class="overlay-btn btn-success" style="padding:6px 10px; font-size:0.8rem;" ${actionAttrs('aggiornaLuogoRaccoltaInArchivio', [idx])}>💾 Salva</button>
                                <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.8rem;" ${actionAttrs('eliminaLuogoRaccoltaDaArchivio', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = luoghiHtml;
            break;
        }

           case 'storico_ricevute':
    let storicoVendite = readStorageJSON('storico_vendite', []);
    const filtroCliente = localStorage.getItem('filtro_storico_cliente') || '';
    const filtroClienteRender = escapeHtml(filtroCliente);

    let storicoHtml = `<h2>Archivio Storico Ricevute</h2>`;
    storicoHtml += `<p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 10px 0;">Nota importante: anche se l'app salva i dati in memoria e crea backup automatici, è vivamente consigliato conservare una copia cartacea di ogni ricevuta.</p>`;

    // Se c'è un filtro attivo dalla rubrica, mostra il banner e filtra l'array
    if (filtroCliente) {
        storicoHtml += `
            <div style="background: rgba(2, 132, 199, 0.2); border: 1px solid #0284c7; padding: 10px; border-radius: 8px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <span style="color: #4d8a98; font-size: 0.9rem;">🔍 Filtrato per cliente: <strong>${filtroClienteRender}</strong></span>
                <button class="overlay-btn" style="background: #556152; padding: 4px 8px; font-size: 0.75rem;" ${actionAttrs('showAllStoricoRicevute')}>Mostra Tutte</button>
            </div>`;
        
        // Filtra le ricevute in base al nome dell'acquirente (mantenendo il legame con il loro indice originale)
        storicoVendite = storicoVendite
            .map((item, realIndex) => ({ item, realIndex }))
            .filter(obj => obj.item.acquirente && obj.item.acquirente.toLowerCase() === filtroCliente.toLowerCase());
    } else {
        // Mappa normale senza filtro
        storicoVendite = storicoVendite.map((item, realIndex) => ({ item, realIndex }));
    }

    storicoHtml += `<p>Elenco cronologico delle ricevute di vendita emesse${filtroCliente ? ' per questo cliente' : ''}:</p>`;

    if (storicoVendite.length === 0) {
        storicoHtml += `<div class="module-card"><p>Nessuna ricevuta emessa finora${filtroCliente ? ' per questo cliente' : ''}.</p></div>`;
    } else {
        // Inverte l'ordine per mostrare prima le più recenti
        storicoVendite.slice().reverse().forEach((obj, index) => {
            const item = obj.item;
            const safeItem = sanitizeRenderable(item);
            const originalIndex = obj.realIndex;
            
            const regimeLabel = item.regime === 'ritenuta' ? '<span style="color:#4d8a98; font-size:0.75rem;">[Ritenuta d\'Acconto]</span>' : '<span style="color:#22c55e; font-size:0.75rem;">[Imposta Sostitutiva]</span>';
            
            let dettaglioImporto = `Importo: € ${escapeHtml(item.importo)}`;
            if (item.regime === 'ritenuta') {
                const nettoVisibile = item.netto ? item.netto : calcolaDettaglioRitenuta(item.importo).netto.toFixed(2);
                dettaglioImporto = `Lordo: € ${escapeHtml(item.importo)} | <span style="color:#4d8a98;">Netto: € ${escapeHtml(nettoVisibile)}</span>`;
            }

            storicoHtml += `
                <div class="module-card" style="margin-bottom:12px; border-left: 4px solid #627d54;">
                    <strong style="color:#d3a45f; font-size:0.95rem;">📄 Ricevuta #${originalIndex + 1} - ${safeItem.data} ${regimeLabel}</strong>
                    <p style="font-size:0.85rem; color:#f6f1e6; margin:4px 0;">Acquirente: <b>${safeItem.acquirente}</b></p>
                    <p style="font-size:0.8rem; color:#b8b0a0; margin:2px 0;">Specie: ${safeItem.specie} (${safeItem.peso}g)</p>
                    <p style="font-size:0.9rem; color:#22c55e; font-weight:bold; margin-top:4px;">${dettaglioImporto}</p>
                    <div class="btn-row">
                        <button class="overlay-btn btn-primary" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('visualizzaRicevutaSalvata', [originalIndex])}>👁️ Visualizza</button>
                        <button class="overlay-btn btn-info" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('modificaRicevuta', [originalIndex])}>✏️ Modifica</button>
                        <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('eliminaRicevutaConDoppiaConferma', [originalIndex])}>🗑️ Elimina</button>
                    </div>
                </div>`;
        });
    }
    contentHTML = storicoHtml;
    break;

        case 'f24':
            const fData = getRenderableStorageJSON('f24_data', {});
            if (fData.protocollo && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (getStoredDocumentData('f24_data')) {
                    if (fData.tipoFile && fData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${fData.nomeFile || 'Immagine'}</p><img src="${getStoredDocumentData('f24_data')}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="F24 ELIDE"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn btn-info" ${actionAttrs('viewStoredDocument', ['f24_data', 'F24 ELIDE', 'f24'])}>👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;"><strong>Allegato non visualizzabile:</strong> carica un'immagine per visualizzarla nell'app.</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <div class="module-card card-green-border">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ F24 Registrato</p>
                        <p><strong>Anno Fiscale:</strong> ${fData.anno}</p>
                        <p><strong>Protocollo:</strong> ${fData.protocollo}</p>
                        <p><strong>Data Versamento:</strong> ${fData.dataPagamento || 'Non specificata'}</p>
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn btn-primary" ${actionAttrs('openModule', ['f24', true])}>✏️ Modifica</button>
                            <button class="overlay-btn btn-danger" ${actionAttrs('clearData', ['f24_data', 'f24'])}>🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <p>Registra il versamento dell'imposta sostitutiva (100€ annui - Legge 145/2018):</p>
                    <div class="module-card" style="border-left:4px solid #f59e0b; background:rgba(29,40,30,0.96); margin-bottom:18px;">
                        <p style="color:#f59e0b; font-weight:bold; margin-bottom:10px;">📋 PROMEMORIA COMPILAZIONE MODELLO F24 — IMPOSTA SOSTITUTIVA TARTUFI</p>
                        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:#ddd6c8;">
                            <tbody>
                                <tr><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Modello</td><td style="padding:4px 6px;">F24 (o F24 Elide)</td></tr>
                                <tr style="background:#121610;"><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Sezione versamento</td><td style="padding:4px 6px;">Erario ed Altro</td></tr>
                                <tr><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Tipo</td><td style="padding:4px 6px;">R</td></tr>
                                <tr style="background:#121610;"><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Codice Tributo</td><td style="padding:4px 6px; font-weight:bold; color:#4d8a98;">1853</td></tr>
                                <tr><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Anno di Riferimento</td><td style="padding:4px 6px;">2026</td></tr>
                                <tr style="background:#121610;"><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Importo a debito</td><td style="padding:4px 6px; font-weight:bold; color:#22c55e;">100,00 €</td></tr>
                                <tr><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Elementi identificativi</td><td style="padding:4px 6px;">[Codice Regione] [Codice Prodotto] [N. Tesserino]</td></tr>
                                <tr style="background:#121610;"><td style="padding:4px 6px; color:#b8b0a0; white-space:nowrap;">Esempio pratico</td><td style="padding:4px 6px;">Veneto + Tartufi + N.12345 → <strong style="color:#f59e0b;">21T12345</strong></td></tr>
                            </tbody>
                        </table>
                        <details style="margin-top:12px;">
                            <summary style="cursor:pointer; color:#4d8a98; font-size:0.85rem; font-weight:bold;">🗺️ Codici Regioni e Province Autonome</summary>
                            <table style="width:100%; border-collapse:collapse; font-size:0.82rem; color:#ddd6c8; margin-top:8px;">
                                <tbody>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">01</td><td style="padding:3px 6px;">Abruzzo</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">02</td><td style="padding:3px 6px;">Basilicata</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">03</td><td style="padding:3px 6px;">Prov. autonoma di Bolzano</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">04</td><td style="padding:3px 6px;">Calabria</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">05</td><td style="padding:3px 6px;">Campania</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">06</td><td style="padding:3px 6px;">Emilia-Romagna</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">07</td><td style="padding:3px 6px;">Friuli-Venezia Giulia</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">08</td><td style="padding:3px 6px;">Lazio</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">09</td><td style="padding:3px 6px;">Liguria</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">10</td><td style="padding:3px 6px;">Lombardia</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">11</td><td style="padding:3px 6px;">Marche</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">12</td><td style="padding:3px 6px;">Molise</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">13</td><td style="padding:3px 6px;">Piemonte</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">14</td><td style="padding:3px 6px;">Puglia</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">15</td><td style="padding:3px 6px;">Sardegna</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">16</td><td style="padding:3px 6px;">Sicilia</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">17</td><td style="padding:3px 6px;">Toscana</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">18</td><td style="padding:3px 6px;">Prov. autonoma di Trento</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">19</td><td style="padding:3px 6px;">Umbria</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; color:#b8b0a0;">20</td><td style="padding:3px 6px;">Valle d'Aosta</td></tr>
                                    <tr><td style="padding:3px 6px; color:#b8b0a0;">21</td><td style="padding:3px 6px;">Veneto</td></tr>
                                </tbody>
                            </table>
                        </details>
                        <details style="margin-top:8px;">
                            <summary style="cursor:pointer; color:#4d8a98; font-size:0.85rem; font-weight:bold;">🌿 Codici Tipologia Prodotto</summary>
                            <table style="width:100%; border-collapse:collapse; font-size:0.82rem; color:#ddd6c8; margin-top:8px;">
                                <tbody>
                                    <tr><td style="padding:3px 6px; font-weight:bold; color:#f59e0b; width:30px;">T</td><td style="padding:3px 6px;">Tartufi</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">F</td><td style="padding:3px 6px;">Funghi epigei</td></tr>
                                    <tr><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">B</td><td style="padding:3px 6px;">Bacche di bosco</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">G</td><td style="padding:3px 6px;">Frutta in guscio (castagne, noci, ecc.)</td></tr>
                                    <tr><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">E</td><td style="padding:3px 6px;">Erbe officinali spontanee</td></tr>
                                    <tr style="background:#121610;"><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">M</td><td style="padding:3px 6px;">Muschi, licheni e piante ornamentali/alimentari</td></tr>
                                    <tr><td style="padding:3px 6px; font-weight:bold; color:#f59e0b;">A</td><td style="padding:3px 6px;">Altri prodotti selvatici non specificati</td></tr>
                                </tbody>
                            </table>
                        </details>
                    </div>
                    <div class="module-card">
                        <label>Anno Fiscale di Riferimento:</label>
                        <input type="text" id="f-anno" class="mod-input" value="${fData.anno || new Date().getFullYear()}" placeholder="Es. 2026">
                        
                        <label>Numero di Protocollo Telematico:</label>
                        <input type="text" id="f-protocollo" class="mod-input" value="${fData.protocollo || ''}" placeholder="Es. 24010112345678901">
                        
                        <label>Data di Versamento:</label>
                        <input type="date" id="f-data-pagamento" class="mod-input" value="${fData.dataPagamento || new Date().toISOString().slice(0,10)}">
                        
                        <label>Carica Quietanza F24 (solo immagine - Obbligatorio):</label>
                        <input type="file" id="f-file" accept="image/*" class="mod-input" style="padding:8px;">
                        <p style="margin-top:6px; color:#b8b0a0; font-size:0.8rem;">Consiglio: carica immagini di piccole dimensioni.</p>
                        
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('saveF24WithFile')}>Archivia F24 ELIDE</button>
                    </div>`;
            }
            break;
        case 'canidiary':
            const dogsList = readStorageJSON('dogs_list', []);
            const isDogEditMode = Number.isInteger(editingDogIndex) && editingDogIndex >= 0 && editingDogIndex < dogsList.length;
            const dogToEdit = isDogEditMode ? dogsList[editingDogIndex] : null;
            let dogsHtml = `
                <h2>Anagrafica Cane</h2>
                <p>Gestisci i tuoi cani da tartufo:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">${isDogEditMode ? '✏️ Modifica Cane' : '➕ Aggiungi Nuovo Cane'}</h3>
                    <label>Nome del Cane:</label>
                    <input type="text" id="c-nome" class="mod-input" placeholder="Es. Argo" value="${escapeHtml(dogToEdit?.nome || '')}">
                    <label>Razza:</label>
                    <input type="text" id="c-razza" class="mod-input" value="${escapeHtml(dogToEdit?.razza || 'Lagotto Romagnolo')}">
                    <label>Sesso:</label>
                    <select id="c-sesso" class="mod-input">
                        <option value="Maschio" ${!dogToEdit || dogToEdit.sesso === 'Maschio' ? 'selected' : ''}>🐕 Maschio</option>
                        <option value="Femmina" ${dogToEdit?.sesso === 'Femmina' ? 'selected' : ''}>🐩 Femmina</option>
                    </select>
                    <label>Data di Nascita:</label>
                    <input type="date" id="c-nascita" class="mod-input" value="${escapeHtml(dogToEdit?.nascita || '')}">
                    <label>Numero Microchip:</label>
                    <input type="text" id="c-microchip" class="mod-input" placeholder="Codice microchip" value="${escapeHtml(dogToEdit?.microchip || '')}">
                    <div class="btn-row">
                        <button id="c-save-btn" class="overlay-btn" style="background:#2563eb;" ${isDogEditMode ? actionAttrs('updateDog') : actionAttrs('saveNewCane')}>${isDogEditMode ? 'Aggiorna Cane' : 'Salva Nuovo Cane'}</button>
                        <button id="c-cancel-edit-btn" class="overlay-btn btn-neutral" style="${isDogEditMode ? '' : 'display:none;'}" ${actionAttrs('cancelDogEdit')}>Annulla Modifica</button>
                    </div>
                </div>`;
            if (dogsList.length === 0) {
                dogsHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun cane registrato.</p></div>`;
            } else {
                dogsHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">I tuoi cani registrati:</h3>`;
                dogsList.forEach((dog, idx) => {
                    const sessoIcon = dog.sesso === 'Femmina' ? '🐩' : '🐕';
                    const etaCane = formatDogAge(dog.nascita);
                    dogsHtml += `
                        <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:1rem;">${sessoIcon} ${escapeHtml(dog.nome || '')}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">Razza: ${escapeHtml(dog.razza || '')}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">⚥ Sesso: ${escapeHtml(dog.sesso || 'Non specificato')}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Nascita: ${escapeHtml(dog.nascita || 'Non specificata')}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">🎂 Età: ${etaCane}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">Microchip: ${escapeHtml(dog.microchip || 'Non inserito')}</p>
                            <div class="btn-row">
                                <button class="overlay-btn btn-info" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('editDog', [idx])}>✏️ Modifica</button>
                                <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteDog', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = dogsHtml;
            break;
        case 'polizze':
            const polizzeList = getRenderableStorageJSON('polizze_list', []);
            let polizzeHtml = `
                <h2>Polizze & Assicurazioni</h2>
                <p>Gestisci le polizze assicurative (RC Cane, Responsabilità Civile Raccolta, Infortuni):</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Nuova Polizza</h3>
                    <label>Compagnia Assicurativa:</label>
                    <input type="text" id="pol-compagnia" class="mod-input" placeholder="Es. Unipol / Generali">
                    <label>Numero Polizza:</label>
                    <input type="text" id="pol-numero" class="mod-input" placeholder="Es. IT-99887766">
                    <label>Tipologia Copertura:</label>
                    <select id="pol-tipo" class="mod-input">
                        <option value="🌐 Tutte le Coperture (RCT + Cane + Infortuni + Tutela Legale)">🌐 Tutte le Coperture (RCT + Cane + Infortuni + Tutela Legale)</option>
                        <option value="🐕 RC Cane da Tartufo / Terzi">RC Cane da Tartufo / Terzi</option>
                        <option value="🌲 Polizza Completa Tartufaio (RCT + Infortuni)">Polizza Completa Tartufaio (RCT + Infortuni)</option>
                        <option value="🐾 Cane da Tartufo - Base (Morte e Vet)">Cane da Tartufo - Base (Morte e Vet)</option>
                        <option value="⭐ Cane da Tartufo - Super (Massimali Alti)">Cane da Tartufo - Super (Massimali Alti)</option>
                        <option value="⚖️ Tutela Legale Tartufaio">Tutela Legale Tartufaio</option>
                    </select>
                    <label>Data Scadenza:</label>
                    <input type="date" id="pol-scadenza" class="mod-input">
                    <label>Note / Massimali / Contatto:</label>
                    <input type="text" id="pol-note" class="mod-input" placeholder="Es. Massimale 1.5M">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('savePolizza')}>Salva Polizza</button>
                </div>`;
            if (polizzeList.length === 0) {
                polizzeHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessuna polizza registrata.</p></div>`;
            } else {
                polizzeHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Le tue polizze attive:</h3>`;
                
                const oggi = new Date();
                
                polizzeList.forEach((pol, idx) => {
                    let statoScadenza = '';
                    let bordoColore = '#4d8a98';
                    
                    if (pol.scadenza) {
                        const dataScad = new Date(pol.scadenza);
                        const diffTime = dataScad - oggi;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        
                        if (diffDays < 0) {
                            statoScadenza = `<p style="font-size:0.8rem; color:#ef4444; font-weight:bold; margin: 2px 0;">⚠️ SCADUTA (${pol.scadenza})</p>`;
                            bordoColore = '#ef4444';
                        } else if (diffDays <= 30) {
                            statoScadenza = `<p style="font-size:0.8rem; color:#f59e0b; font-weight:bold; margin: 2px 0;">⚠️ In scadenza tra ${diffDays} giorni (${pol.scadenza})</p>`;
                            bordoColore = '#f59e0b';
                        } else {
                            statoScadenza = `<p style="font-size:0.8rem; color:#22c55e; margin: 2px 0;">⏳ Scadenza: ${pol.scadenza}</p>`;
                            bordoColore = '#22c55e';
                        }
                    } else {
                        statoScadenza = `<p style="font-size:0.8rem; color:#b8b0a0; margin: 2px 0;">⏳ Scadenza: Non specificata</p>`;
                    }

                    polizzeHtml += `
                        <div class="module-card" style="border-left: 4px solid ${bordoColore}; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:1rem;">🛡️ ${pol.compagnia}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">Tipo: ${pol.tipo}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📋 N. ${pol.numero}</p>
                            ${statoScadenza}
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${pol.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deletePolizza', [idx])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = polizzeHtml;
            break;
        case 'vet':
            const dogsListVet = getRenderableStorageJSON('dogs_list', []);
            const cDataVet = getRenderableStorageJSON('cane_data', {});
            const nomeCaneDefault = cDataVet.nome || (dogsListVet.length > 0 ? dogsListVet[0].nome : 'Il tuo cane');
            const vetHistory = getRenderableStorageJSON('vet_history_list', []);
            const heatDiary = getRenderableStorageJSON('heat_diary_list', []);
            const femmineVet = dogsListVet.filter(d => d.sesso === 'Femmina');
            const selectedVetFilterFromStorage = (localStorage.getItem('vet_filter_cane_nome') || '').trim();
            let filtroCaneVet = selectedVetFilterFromStorage;
            const isFiltroCaneValido = !filtroCaneVet || dogsListVet.some(d => d.nome === filtroCaneVet);
            if (!isFiltroCaneValido) {
                filtroCaneVet = '';
                localStorage.removeItem('vet_filter_cane_nome');
            }
            const nomeCaneSelezionatoVet = filtroCaneVet || nomeCaneDefault;
            let optionsHtml = '';
            if (dogsListVet.length > 0) {
                dogsListVet.forEach(dog => {
                    const selected = dog.nome === nomeCaneSelezionatoVet ? 'selected' : '';
                    const sessoDog = dog.sesso === 'Femmina' ? 'Femmina' : 'Maschio';
                    optionsHtml += `<option value="${escapeHtml(dog.nome)}" data-sesso="${sessoDog}" ${selected}>${escapeHtml(dog.nome)} (${escapeHtml(dog.razza || '')})</option>`;
                });
            } else { optionsHtml += `<option value="${escapeHtml(nomeCaneDefault)}" data-sesso="Maschio">${escapeHtml(nomeCaneDefault)}</option>`; }
            let filtroCaniOptionsHtml = `<option value="" ${filtroCaneVet ? '' : 'selected'}>Tutti i cani</option>`;
            dogsListVet.forEach((dog) => {
                const selected = dog.nome === filtroCaneVet ? 'selected' : '';
                filtroCaniOptionsHtml += `<option value="${escapeHtml(dog.nome)}" ${selected}>${escapeHtml(dog.nome)}</option>`;
            });

            const vetHistoryEntries = vetHistory.map((entry, originalIndex) => ({ entry, originalIndex }));
            const filteredVetHistoryEntries = filtroCaneVet
                ? vetHistoryEntries.filter(({ entry }) => entry.cane === filtroCaneVet)
                : vetHistoryEntries;

            const heatDiaryEntries = heatDiary.map((entry, originalIndex) => ({ entry, originalIndex }));
            const filteredHeatDiaryEntries = filtroCaneVet
                ? heatDiaryEntries.filter(({ entry }) => entry.cane === filtroCaneVet)
                : heatDiaryEntries;

            const hasFilteredVetData = filteredVetHistoryEntries.length > 0 || filteredHeatDiaryEntries.length > 0;
            const filteredDogProfile = dogsListVet.find((dog) => dog.nome === filtroCaneVet) || null;
            const isFilteredDogFemale = dogsListVet.some((dog) => dog.nome === filtroCaneVet && dog.sesso === 'Femmina');
            let vetHtml = `
                <h2>Libretti Sanitari Cani & Profilassi</h2>
                <p>Storico trattamenti, vaccini, visite e diario calore:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Nuova Registrazione</h3>
                    <label>Tipo Registrazione:</label>
                    <select id="vet-entry-category" class="mod-input" ${eventActionAttrs('change', 'syncVetUnifiedInputForm')}>
                        <option value="vet_history" selected>🩺 Trattamento / Visita</option>
                        ${femmineVet.length > 0 ? '<option value="heat_diary">🌸 Diario Calore (solo femmine)</option>' : ''}
                    </select>
                    <label>Seleziona Cane:</label>
                    <select id="vet-entry-cane" class="mod-input">${optionsHtml}</select>
                    <div id="vet-entry-type-row">
                        <label>Tipologia Intervento:</label>
                        <select id="vet-entry-type" class="mod-input">
                            <option value="💉 Vaccino">Vaccino</option>
                            <option value="💊 Antiparassitario Intestinale">Antiparassitario Intestinale (Pillola)</option>
                            <option value="💧 Spot-on">Spot-on (Antipulci / Zecche)</option>
                            <option value="🎗️ Collare Antiparassitario">Collare Antiparassitario</option>
                            <option value="🩺 Visita Veterinaria">Visita Veterinaria / Controllo</option>
                            <option value="🩹 Medicazione / Zecca">Medicazione / Ferita / Zecca</option>
                            <option value="🏥 Somministrazione Farmaci / Altro">Somministrazione Farmaci / Altro</option>
                        </select>
                    </div>
                    <label id="vet-entry-date-label">Data del Trattamento:</label>
                    <input type="date" id="vet-entry-date" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label id="vet-entry-note-label">Note / Dettagli:</label>
                    <input type="text" id="vet-entry-note" class="mod-input" placeholder="Es. Nome farmaco o dosaggio">
                    <button id="vet-entry-save-btn" class="overlay-btn" style="margin-top:12px; width:100%; background:#2563eb;" ${actionAttrs('saveVetUnifiedEntry')}>Registra nel Libretto</button>
                </div>
                <div class="module-card" style="margin-bottom: 16px;">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">🔎 Visualizza Libretto per Cane</h3>
                    <label for="vet-filter-cane">Filtro per nome cane:</label>
                    <select id="vet-filter-cane" class="mod-input" ${eventActionAttrs('change', 'refreshVetBookletFilter')}>
                        ${filtroCaniOptionsHtml}
                    </select>
                    <button class="overlay-btn btn-neutral" style="width:100%; margin-top:8px;" ${actionAttrs('printVetFilteredBooklet')}>
                        🖨️ Stampa Libretto Cane Selezionato
                    </button>
                </div>`;
            if (filteredVetHistoryEntries.length === 0) {
                vetHtml += `<div class="module-card"><p style="color:#b8b0a0;">${filtroCaneVet ? 'Nessun trattamento registrato per il cane selezionato.' : 'Nessun trattamento registrato.'}</p></div>`;
            } else {
                vetHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Registrazioni:</h3>`;
                filteredVetHistoryEntries.slice().reverse().forEach(({ entry: item, originalIndex }) => {
                    vetHtml += `
                        <div class="module-card vet-record-card" data-cane="${escapeHtml(item.cane || '')}" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">🐕 ${escapeHtml(item.cane || 'Cane non specificato')}</strong>
                            <p style="font-size:0.9rem; color:#4d8a98; margin: 4px 0;"><b>${escapeHtml(item.tipo || 'Tipologia non specificata')}</b></p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Data: ${escapeHtml(item.data || 'Non specificata')}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${escapeHtml(item.note || 'Nessuna nota')}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteVetHistoryItem', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            // Diario calore per cagne femmine
            if (femmineVet.length > 0) {
                vetHtml += `<h3 style="font-size:0.85rem; color:#f472b6; margin:20px 0 8px; text-transform:uppercase;">🌸 Diario Calore (Cagne Femmine)</h3>`;
                if (filteredHeatDiaryEntries.length === 0) {
                    vetHtml += `<div class="module-card"><p style="color:#b8b0a0;">${filtroCaneVet ? 'Nessun calore registrato per il cane selezionato.' : 'Nessun calore registrato.'}</p></div>`;
                } else {
                    vetHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Calori:</h3>`;
                    filteredHeatDiaryEntries.slice().reverse().forEach(({ entry, originalIndex }) => {
                        const dataInizio = new Date(entry.data);
                        const prossimoCalore = new Date(dataInizio);
                        prossimoCalore.setDate(prossimoCalore.getDate() + 180);
                        const prossimoStr = prossimoCalore.toISOString().slice(0, 10);
                        vetHtml += `
                        <div class="module-card vet-heat-card" data-cane="${escapeHtml(entry.cane || '')}" style="border-left: 4px solid #f472b6; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">🐩 ${escapeHtml(entry.cane || 'Cane non specificato')}</strong>
                            <p style="font-size:0.9rem; color:#f472b6; margin: 4px 0;"><b>🌸 Inizio Calore: ${escapeHtml(entry.data || 'Non specificata')}</b></p>
                            <p style="font-size:0.85rem; color:#fbbf24; margin: 2px 0;">📅 Prossimo calore previsto: <b>${prossimoStr}</b></p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${escapeHtml(entry.note || 'Nessuna nota')}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteHeatEntry', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                    });
                }
            }
            let printOnlyVetBooklet = '';
            if (filtroCaneVet) {
                const filteredDogBirthDate = filteredDogProfile?.nascita || '';
                const filteredDogAge = filteredDogBirthDate ? formatDogAge(filteredDogBirthDate) : 'Non disponibile';
                printOnlyVetBooklet = `
                    <div id="vet-filtered-print-only" class="print-only" data-has-data="${hasFilteredVetData ? '1' : '0'}">
                        <h2 style="margin-bottom:6px;">Libretto sanitario cane: ${escapeHtml(filtroCaneVet)}</h2>
                        <p style="margin-bottom:12px;">Stampa filtrata per il cane selezionato.</p>
                        <div style="margin:0 0 12px; padding:10px; border:1px solid #ddd;">
                            <h3 style="margin:0 0 8px;">Anagrafica cane selezionato</h3>
                            <p><b>Nome:</b> ${escapeHtml(filteredDogProfile?.nome || filtroCaneVet)}</p>
                            <p><b>Razza:</b> ${escapeHtml(filteredDogProfile?.razza || 'Non specificata')}</p>
                            <p><b>Sesso:</b> ${escapeHtml(filteredDogProfile?.sesso || 'Non specificato')}</p>
                            <p><b>Data di nascita:</b> ${escapeHtml(filteredDogBirthDate || 'Non specificata')}</p>
                            <p><b>Età:</b> ${escapeHtml(filteredDogAge)}</p>
                            <p><b>Microchip:</b> ${escapeHtml(filteredDogProfile?.microchip || 'Non specificato')}</p>
                        </div>
                        <h3 style="margin:14px 0 8px;">Trattamenti / Visite</h3>
                        ${filteredVetHistoryEntries.length === 0
                            ? '<p>Nessun trattamento registrato.</p>'
                            : filteredVetHistoryEntries.slice().reverse().map(({ entry }) => `
                                <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #ddd;">
                                    <p><b>Tipo:</b> ${escapeHtml(entry.tipo || 'Tipologia non specificata')}</p>
                                    <p><b>Data:</b> ${escapeHtml(entry.data || 'Non specificata')}</p>
                                    <p><b>Note:</b> ${escapeHtml(entry.note || 'Nessuna nota')}</p>
                                </div>
                            `).join('')}
                        ${isFilteredDogFemale
                            ? `<h3 style="margin:14px 0 8px;">Diario Calore</h3>
                               ${filteredHeatDiaryEntries.length === 0
                                   ? '<p>Nessun calore registrato.</p>'
                                   : filteredHeatDiaryEntries.slice().reverse().map(({ entry }) => `
                                       <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #ddd;">
                                           <p><b>Inizio calore:</b> ${escapeHtml(entry.data || 'Non specificata')}</p>
                                           <p><b>Note:</b> ${escapeHtml(entry.note || 'Nessuna nota')}</p>
                                       </div>
                                   `).join('')}`
                            : ''}
                    </div>`;
            }
            vetHtml += printOnlyVetBooklet;
            contentHTML = vetHtml;
            break;
        case 'registro_giornaliero':
            const storicoRaccolta = getRenderableStorageJSON('storico_raccolta_giornaliera', []);
            const elAnno = document.getElementById('filtro-anno');
            const filtroAnno = elAnno ? elAnno.value : 'tutti';
            const elSpecie = document.getElementById('filtro-specie');
            const filtroSpecie = elSpecie ? elSpecie.value : 'tutte';

            let anniDisponibili = [...new Set(storicoRaccolta.map(item => item.data ? item.data.slice(0,4) : ''))].filter(Boolean);
            if(anniDisponibili.length === 0) anniDisponibili = [new Date().getFullYear().toString()];
            let opzioniAnniHtml = `<option value="tutti">Tutti gli anni</option>`;
            anniDisponibili.forEach(a => { opzioniAnniHtml += `<option value="${a}" ${filtroAnno === a ? 'selected' : ''}>${a}</option>`; });
            const listaSpecie9 = [
                "Tuber magnatum Pico (Pregiato Bianco)", "Tuber melanosporum Vitt. (Nero Pregiato)",
                "Tuber macrosporum Vitt. (Nero Liscio)", "Tuber brumale Vitt. (Moscatuto / Invernale)",
                "Tuber brumale var. moschatum De Ferry (Brumale moscato - Sottospecie)", "Tuber aestivum Vitt. (Scorzone Estivo)",
                "Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)", "Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)",
                "Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)"
            ];
            let opzioniSpecieHtml = `<option value="">-- Nessun filtro --</option><option value="tutte">Tutte le specie</option>`;
            listaSpecie9.forEach(s => { opzioniSpecieHtml += `<option value="${s}" ${filtroSpecie === s ? 'selected' : ''}>${s}</option>`; });
            let selectSpecieFormHtml = '';
            listaSpecie9.forEach(s => { selectSpecieFormHtml += `<option value="${s}">${s}</option>`; });
            let registroHtml = `
                <h2>Registro Giornaliero Ritrovamenti</h2>
                <p>Registra i quantitativi raccolti e filtra per anno o specie</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Raccolta</h3>
                    <label>Data:</label>
                    <input type="date" id="reg-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Specie Tartufo:</label>
                    <select id="reg-specie" class="mod-input">${selectSpecieFormHtml}</select>
                    <label>Peso Totale (grammi):</label>
                    <input type="number" id="reg-peso" class="mod-input" placeholder="Es. 250">
                    <label>Luogo del Ritrovamento:</label>
                    <select id="reg-luogo" class="mod-input" ${eventActionAttrs('change', 'handleLuogoSelectChange', ['reg-luogo'])}>${buildLuoghiSelectOptions()}</select>
                    <label>Note:</label>
                    <input type="text" id="reg-note" class="mod-input" placeholder="Es. Bosco di castagni">
                    <button class="overlay-btn" style="margin-top:12px; width:100%; background:#2563eb;" ${actionAttrs('saveRaccoltaGiornaliera')}>Salva nel Registro</button>
                </div>
                <div class="module-card" style="margin-bottom: 15px; background: #121610; border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.85rem; color:#4d8a98; margin-bottom:8px;">🔍 Filtri Archivio</h3>
                    <div style="display: flex; gap: 10px;">
                        <div style="flex:1;"><label style="font-size:0.75rem;">Anno:</label><select id="filtro-anno" class="mod-input" ${eventActionAttrs('change', 'refreshRegistroGiornaliero')}>${opzioniAnniHtml}</select></div>
                        <div style="flex:2;"><label style="font-size:0.75rem;">Specie:</label><select id="filtro-specie" class="mod-input" ${eventActionAttrs('change', 'refreshRegistroGiornaliero')}>${opzioniSpecieHtml}</select></div>
                    </div>
                    <button ${actionAttrs('printPage')} style="margin-top:10px; width:100%; background:#4b5563; color:white; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.85rem;">🖨️ Stampa / Salva PDF</button>
                </div>`;
            let datiFiltrati = storicoRaccolta.filter(item => {
                const annoItem = item.data ? item.data.slice(0,4) : '';
                const nessunFiltroSpecie = filtroSpecie === '' || filtroSpecie === 'tutte';
                return (filtroAnno === 'tutti' || annoItem === filtroAnno) && (nessunFiltroSpecie || item.specie === filtroSpecie);
            });

            if (datiFiltrati.length === 0) {
                registroHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun ritrovamento trovato con i filtri selezionati.</p></div>`;
            } else {
                // Blocco riepilogo per la stampa
                const totaleGeneraleRegistro = datiFiltrati.reduce((acc, item) => acc + (parseFloat(item.peso) || 0), 0);
                let printSummaryRegistro = `<div class="print-only" style="margin-bottom:16px; border:1px solid #ccc; padding:10px;">
                    <h3 style="font-size:1rem; margin:0 0 8px 0;">Riepilogo Raccolta${filtroAnno !== 'tutti' ? ` – ${filtroAnno}` : ''}${filtroSpecie && filtroSpecie !== 'tutte' ? ` – ${filtroSpecie}` : ''}</h3>`;
                if (filtroSpecie && filtroSpecie !== 'tutte') {
                    printSummaryRegistro += `<p style="margin:2px 0;"><b>${filtroSpecie}:</b> ${totaleGeneraleRegistro.toFixed(0)} g</p>`;
                } else {
                    const totaliPerSpecie = {};
                    datiFiltrati.forEach(item => {
                        totaliPerSpecie[item.specie] = (totaliPerSpecie[item.specie] || 0) + (parseFloat(item.peso) || 0);
                    });
                    Object.keys(totaliPerSpecie).sort().forEach(sp => {
                        printSummaryRegistro += `<p style="margin:2px 0;"><b>${sp}:</b> ${totaliPerSpecie[sp].toFixed(0)} g</p>`;
                    });
                }
                printSummaryRegistro += `<p style="margin:8px 0 0 0; border-top:1px solid #ccc; padding-top:6px;"><b>Totale generale: ${totaleGeneraleRegistro.toFixed(0)} g</b></p>`;
                printSummaryRegistro += `</div>`;
                registroHtml += printSummaryRegistro;

                registroHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Filtrato (${datiFiltrati.length}):</h3>`;
                datiFiltrati.slice().reverse().forEach((item) => {
                    const originalIndex = storicoRaccolta.indexOf(item);
                    registroHtml += `
                        <div class="module-card" style="border-left: 4px solid #10b981; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">📅 ${item.data}</strong>
                            <p style="font-size:0.9rem; color:#4d8a98; margin: 4px 0;"><b>${item.specie}</b></p>
                            <p style="font-size:0.85rem; color:#22c55e; margin: 2px 0;">⚖️ Peso: <b>${item.peso} g</b></p>
                            ${item.luogo ? `<p style="font-size:0.8rem; color:#a3c4bc; margin: 2px 0;">📍 Luogo: ${escapeHtml(item.luogo)}</p>` : ''}
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteRaccoltaGiornaliera', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = registroHtml;
            break;
        case 'spese': {
            const speseList = getRenderableStorageJSON('spese_list', []);
            const annoCorrenteSpese = new Date().getFullYear();
            const elFiltroAnnoSpese = document.getElementById('filtro-anno-spese');
            const filtroAnnoSpese = elFiltroAnnoSpese ? elFiltroAnnoSpese.value : String(annoCorrenteSpese);

            let anniDisponibiliSpese = [...new Set(speseList.map(item => item.data ? item.data.slice(0,4) : ''))].filter(Boolean).sort().reverse();
            if (anniDisponibiliSpese.length === 0) anniDisponibiliSpese = [String(annoCorrenteSpese)];
            let opzioniAnniSpeseHtml = `<option value="tutti">Tutti gli anni</option>`;
            anniDisponibiliSpese.forEach(a => { opzioniAnniSpeseHtml += `<option value="${a}" ${filtroAnnoSpese === a ? 'selected' : ''}>${a}</option>`; });

            const speseFiltrate = speseList
                .map((item, idx) => ({ item, originalIndex: idx }))
                .filter(({ item }) => filtroAnnoSpese === 'tutti' || (item.data && item.data.slice(0,4) === filtroAnnoSpese));
            let totaleSpeseAnno = speseFiltrate.reduce((acc, { item }) => acc + (parseFloat(item.importo) || 0), 0);

            let speseHtml = `
                <h2>Gestione Spese Tartufaio</h2>
                <p>Traccia carburante, attrezzatura, manutenzione e spese veterinarie:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Nuova Spesa</h3>
                    <label>Data:</label>
                    <input type="date" id="spese-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Categoria:</label>
                    <select id="spese-categoria" class="mod-input">
                        <option value="⛽ Caosti Auto">⛽ Costi Auto</option>
                        <option value="🐕 Alimentazione & Cura Cane">🐕 Alimentazione & Cura Cane</option>
                        <option value="🩺 Visite & Spese Veterinarie">🩺 Visite & Spese Veterinarie</option>
                        <option value="🛠️ Attrezzatura & Abbigliamento">🛠️ Attrezzatura & Abbigliamento</option>
                        <option value="🛡️ Assicurazioni & Tasse">🛡️ Assicurazioni & Tasse</option>
                        <option value="📦 Altro">📦 Altro</option>
                    </select>
                    <label>Importo (€):</label>
                    <input type="number" step="0.01" id="spese-importo" class="mod-input" placeholder="Es. 25.00">
                    <label>Note / Descrizione:</label>
                    <input type="text" id="spese-note" class="mod-input" placeholder="Es. Benzina per uscita bosco">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('saveSpesa')}>Salva Spesa</button>
                </div>
                <div class="module-card" style="margin-bottom: 15px; background: #121610; border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.85rem; color:#4d8a98; margin-bottom:8px;">🔍 Filtro Anno</h3>
                    <div style="display:flex; gap:10px; align-items:flex-end;">
                        <div style="flex:1;"><label style="font-size:0.75rem;">Anno:</label><select id="filtro-anno-spese" class="mod-input" ${eventActionAttrs('change', 'refreshSpese')}>${opzioniAnniSpeseHtml}</select></div>
                        <button ${actionAttrs('printPage')} style="background:#4b5563; color:white; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.85rem; white-space:nowrap;">🖨️ Stampa / PDF</button>
                    </div>
                </div>`;

            if (speseFiltrate.length === 0) {
                speseHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessuna spesa registrata${filtroAnnoSpese !== 'tutti' ? ` per il ${filtroAnnoSpese}` : ''}.</p></div>`;
            } else {
                // Riepilogo per la stampa: totale per categoria + totale generale
                const totaliPerCategoria = {};
                speseFiltrate.forEach(({ item }) => {
                    totaliPerCategoria[item.categoria] = (totaliPerCategoria[item.categoria] || 0) + (parseFloat(item.importo) || 0);
                });
                let printSummarySpese = `<div class="print-only" style="margin-bottom:16px; border:1px solid #ccc; padding:10px;">
                    <h3 style="font-size:1rem; margin:0 0 8px 0;">Riepilogo Spese${filtroAnnoSpese !== 'tutti' ? ` – ${filtroAnnoSpese}` : ''}</h3>`;
                Object.keys(totaliPerCategoria).sort().forEach(cat => {
                    printSummarySpese += `<p style="margin:2px 0;"><b>${cat}:</b> € ${totaliPerCategoria[cat].toFixed(2)}</p>`;
                });
                printSummarySpese += `<p style="margin:8px 0 0 0; border-top:1px solid #ccc; padding-top:6px;"><b>Totale generale: € ${totaleSpeseAnno.toFixed(2)}</b></p>`;
                printSummarySpese += `</div>`;
                speseHtml += printSummarySpese;

                speseHtml += `
                    <div class="module-card" style="background: #121610; border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px; text-align: center;">
                        <p style="font-size: 0.8rem; color: #b8b0a0; text-transform: uppercase;">Totale Spese${filtroAnnoSpese !== 'tutti' ? ` ${filtroAnnoSpese}` : ''}</p>
                        <p style="font-size: 1.4rem; color: #f59e0b; font-weight: bold; margin: 4px 0 0 0;">€ ${totaleSpeseAnno.toFixed(2)}</p>
                    </div>`;
                speseHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Elenco Spese${filtroAnnoSpese !== 'tutti' ? ` ${filtroAnnoSpese}` : ''} (${speseFiltrate.length}):</h3>`;

                speseFiltrate.slice().reverse().forEach(({ item, originalIndex }) => {
                    speseHtml += `
                        <div class="module-card" style="border-left: 4px solid #f59e0b; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">💶 € ${parseFloat(item.importo).toFixed(2)}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;"><b>${item.categoria}</b></p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Data: ${item.data}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteSpesa', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = speseHtml;
            break;
        }
        case 'bilancio':
            const venditeSalvateBilancio = readStorageJSON('storico_vendite', []);
            const speseSalvateBilancio = readStorageJSON('spese_list', []);
            const annoCorrenteBilancio = new Date().getFullYear();
            
            // Variabili per i guadagni
            let lordoSostitutiva = 0;
            let nettoSostitutiva = 0;
            let countSostitutiva = 0;

            let lordoRitenuta = 0;
            let nettoRitenuta = 0;
            let totaleRitenuteSubite = 0;
            let countRitenuta = 0;

            venditeSalvateBilancio.forEach(item => {
                let dataVendita = new Date();
                if (item.data) {
                    const dataStr = item.data.includes('/') ? item.data.split('/').reverse().join('-') : item.data;
                    const parsedDate = new Date(dataStr);
                    if (!isNaN(parsedDate.getTime())) {
                        dataVendita = parsedDate;
                    }
                }

                if (dataVendita.getFullYear() === annoCorrenteBilancio) {
                    const lordo = parseFloat(item.importo) || 0;
                    const regime = item.regime || 'sostitutiva';

                    if (regime === 'ritenuta') {
                        const dettagliRitenuta = calcolaDettaglioRitenuta(lordo);
                        const ritenuta = item.ritenuta ? parseFloat(item.ritenuta) : dettagliRitenuta.ritenuta;
                        const netto = item.netto !== undefined ? parseFloat(item.netto) : dettagliRitenuta.netto;
                        
                        lordoRitenuta += lordo;
                        nettoRitenuta += netto;
                        totaleRitenuteSubite += ritenuta;
                        countRitenuta++;
                    } else {
                        lordoSostitutiva += lordo;
                        nettoSostitutiva += lordo;
                        countSostitutiva++;
                    }
                }
            });

            // Calcoli totali
            const totaleNettoGuadagni = nettoSostitutiva + nettoRitenuta;
            const totaleLordoGuadagni = lordoSostitutiva + lordoRitenuta;

            // Calcolo totale spese per l'anno corrente
            let sommaTotaleSpeseAnno = 0;
            speseSalvateBilancio.forEach(item => {
                const dataSpesa = item.data ? new Date(item.data) : null;
                if (dataSpesa && !isNaN(dataSpesa.getTime()) && dataSpesa.getFullYear() === annoCorrenteBilancio) {
                    sommaTotaleSpeseAnno += parseFloat(item.importo) || 0;
                }
            });

            // Utile Netto Finale (Netto Guadagni - Spese)
            const utileNettoEffettivo = totaleNettoGuadagni - sommaTotaleSpeseAnno;

            // Controllo soglia limite normativo
            const sogliaLimiteBilancio = 7000.00;
            const differenzaSoglia = sogliaLimiteBilancio - totaleLordoGuadagni;
            const isSuperato = totaleLordoGuadagni > sogliaLimiteBilancio;

            // Stile comune per le caselle a dimensione uniforme
            const boxStyleUniforme = "background: #121610; border: 1px solid rgba(255,255,255,0.07); text-align: center; padding: 15px; margin-bottom: 12px; border-radius: 8px;";

            contentHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h2 style="margin: 0;">Contabilità & Bilancio Annuo (${annoCorrenteBilancio})</h2>
                    <button ${actionAttrs('printPage')} style="background-color: #627d54; color: white; border: none; padding: 8px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85rem;">
                        🖨️ Stampa
                    </button>
                </div>
                
                <!-- Dettaglio 1: Imposta Sostitutiva -->
                <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                    <h3 style="font-size:0.9rem; color:#22c55e; margin-bottom:6px;">🟢 Regime Imposta Sostitutiva</h3>
                    <p style="font-size:0.85rem; margin:2px 0;">Ricevute: <strong>${countSostitutiva}</strong> | Netto: <strong style="color:#22c55e;">€ ${nettoSostitutiva.toFixed(2)}</strong></p>
                </div>

                <!-- Dettaglio 2: Ritenuta d'Acconto -->
                <div class="module-card" style="border-left: 4px solid #4d8a98; margin-bottom: 15px;">
                    <h3 style="font-size:0.9rem; color:#4d8a98; margin-bottom:6px;">🔹 Regime Ritenuta d'Acconto (23%)</h3>
                    <p style="font-size:0.85rem; margin:2px 0;">Ricevute: <strong>${countRitenuta}</strong> | Lordo: € ${lordoRitenuta.toFixed(2)}</p>
                    <p style="font-size:0.85rem; margin:2px 0;">Ritenute subite: <span style="color:#f87171;">- € ${totaleRitenuteSubite.toFixed(2)}</span></p>
                    <p style="font-size:0.85rem; margin:2px 0;">Netto percepito: <strong style="color:#4d8a98;">€ ${nettoRitenuta.toFixed(2)}</strong></p>
                </div>

                <!-- 1. TOTALE NETTO DEI GUADAGNI (Dimensioni uguali) -->
                <div class="module-card" style="${boxStyleUniforme} border-color: #22c55e;">
                    <p style="font-size: 0.8rem; color: #4ade80; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; margin: 0;">Totale Netto dei Guadagni</p>
                    <p style="font-size: 1.6rem; color: #22c55e; font-weight: bold; margin: 6px 0 0 0;">€ ${totaleNettoGuadagni.toFixed(2)}</p>
                </div>

                <!-- 2. TOTALE SPESE SOSENUTE (Dimensioni uguali) -->
                <div class="module-card" style="${boxStyleUniforme} border-color: #f59e0b;">
                    <p style="font-size: 0.8rem; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; margin: 0;">Totale Spese Sostenute</p>
                    <p style="font-size: 1.6rem; color: #f59e0b; font-weight: bold; margin: 6px 0 0 0;">€ ${sommaTotaleSpeseAnno.toFixed(2)}</p>
                </div>

                <!-- Utile Netto Effettivo (Dimensioni uguali) -->
                <div class="module-card" style="${boxStyleUniforme}">
                    <p style="font-size: 0.8rem; color: #b8b0a0; text-transform: uppercase; letter-spacing: 0.5px; margin: 0;">Utile Finale (Netto Guadagni - Spese)</p>
                    <p style="font-size: 1.6rem; color: ${utileNettoEffettivo >= 0 ? '#22c55e' : '#ef4444'}; font-weight: bold; margin: 6px 0 0 0;">€ ${utileNettoEffettivo.toFixed(2)}</p>
                </div>

                <!-- Controllo Soglia (In rosso come richiesto) -->
                <div class="module-card" style="background: #450a0a; border: 1px solid #ef4444; text-align: center; padding: 15px; border-radius: 8px;">
                    <p style="font-size: 0.8rem; color: #fca5a5; text-transform: uppercase; font-weight: bold; margin: 0;">Soglia Occasionalità (sul Lordo): € ${totaleLordoGuadagni.toFixed(2)} / € 7.000,00</p>
                    <p style="font-size: 1.3rem; font-weight: bold; margin-top: 6px; color: #f87171;">
                        ${isSuperato ? `SUPERATO di € ${Math.abs(differenzaSoglia).toFixed(2)}` : `Disponibile: € ${differenzaSoglia.toFixed(2)}`}
                    </p>
                </div>`;
            break;
        case 'export':
            contentHTML = `
                <h2>Report & Backup Dati</h2>
                <div class="module-card">
                    <h3 style="margin:0 0 10px 0; font-size:0.95rem; color:#4d8a98;">Report contabili</h3>
                    <p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 10px 0;">Esporta la contabilità in formato CSV per consultazione esterna.</p>
                    <button class="overlay-btn btn-primary btn-full" ${actionAttrs('esportaDatiCSV')}>Scarica Contabilità in CSV</button>
                    <hr style="border-color:rgba(255,255,255,0.07); margin:20px 0;">
                    <h3 style="margin:0 0 10px 0; font-size:0.95rem; color:#4d8a98;">Backup automatico locale</h3>
                    <p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 10px 0;">L'app ti guida a scegliere la cartella <strong>Download</strong> e poi crea/usa automaticamente il percorso <strong>Download/SmartTrufflePath/file backup</strong> per salvare <strong>backup_truffle_automatico.json</strong>. Nessun cloud.</p>
                    <p id="local-backup-destination" style="font-size:0.82rem; color:#b8b0a0; margin:0 0 10px 0;">Percorso backup registrato: non configurato</p>
                    <p id="local-backup-status" style="font-size:0.82rem; color:#b8b0a0; margin:0 0 10px 0;">Stato ultimo backup automatico: non disponibile</p>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#7c3aed;" ${actionAttrs('configureAutomaticBackupFolder')}>📁 Imposta Cartella Backup</button>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('forceLocalBackupNow')}>💾 Salva Backup Ora</button>
                    <label class="overlay-btn" style="margin-top:10px; width:100%; background:#059669; display:block; text-align:center; cursor:pointer; box-sizing:border-box;">
                        ♻️ Ripristina Backup da File
                        <input type="file" id="restore-backup-file" accept=".json" style="display:none;" ${eventActionAttrs('change', 'ripristinaBackupDaFile')}>
                    </label>
                    <hr style="border-color:rgba(255,255,255,0.07); margin:20px 0;">
                    <h3 style="margin:0 0 10px 0; font-size:0.95rem; color:#b45309;">🗂️ Archiviazione per Anno</h3>
                    <p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 10px 0;">Crea un file di backup JSON con i dati dell'anno precedente (ricevute vendita, registro raccolta, spese) e rimuove dall'app <strong>soltanto quei record</strong>, lasciando intatti tutti i dati dell'anno corrente e di qualsiasi altro anno.</p>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#b45309;" ${actionAttrs('archiviaAnnoPrecedente')}>🗂️ Archivia & Pulisci Anno Precedente</button>
                </div>`;
            break;
        case 'emergency':
            window.location.href = "tel:112";
            return;
        case 'vet-emergency':
            const vetClinics = getRenderableStorageJSON('vet_clinics_list', []);
            let clinicHtml = `
                <h2>Soccorso Veterinario & Cliniche Veterinarie</h2>
                <p>Gestisci i numeri d'emergenza dei veterinari:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Clinica H24</h3>
                    <label>Nome Clinica o Medico:</label>
                    <input type="text" id="vc-nome" class="mod-input" placeholder="Es. Clinica Centrale">
                    <label>Indirizzo:</label>
                    <input type="text" id="vc-indirizzo" class="mod-input" placeholder="Es. Via Roma 1, Campobasso">
                    <label>Numero di Telefono:</label>
                    <input type="tel" id="vc-tel" class="mod-input" placeholder="Es. 0874123456">
                    <label>Numero di Cellulare:</label>
                    <input type="tel" id="vc-cell" class="mod-input" placeholder="Es. 3931234567">
                    <label>Note:</label>
                    <input type="text" id="vc-note" class="mod-input" placeholder="Es. Aperto festivi e notturno">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('saveVetClinic')}>Salva Contatto Emergenza</button>
                </div>`;
            if (vetClinics.length === 0) {
                clinicHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessuna clinica salvata.</p></div>`;
            } else {
                clinicHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">I tuoi contatti salvati:</h3>`;
                vetClinics.forEach((clinic, idx) => {
                    const safeClinic = sanitizeRenderable(clinic);
                    clinicHtml += `
                        <div class="module-card" style="border-left: 4px solid #dc2626; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:1rem;">🏥 ${safeClinic.nome}</strong>
                            ${safeClinic.indirizzo ? `<p style="font-size:0.8rem; color:#b8b0a0; margin: 2px 0;">📍 ${safeClinic.indirizzo}</p>` : ''}
                            ${safeClinic.tel ? `<p style="font-size:0.85rem; color:#4d8a98; margin: 2px 0;">📞 ${safeClinic.tel}</p>` : ''}
                            ${safeClinic.cell ? `<p style="font-size:0.85rem; color:#4d8a98; margin: 2px 0;">📱 ${safeClinic.cell}</p>` : ''}
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 ${safeClinic.note || 'Nessuna nota'}</p>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button class="overlay-btn btn-danger" style="padding:8px 12px;" ${actionAttrs('callVetClinicByIndex', [idx])}>📞 Chiama</button>
                                ${safeClinic.cell ? `<button class="overlay-btn" style="padding:8px 12px; background:#25d366;" ${actionAttrs('whatsappVetClinicByIndex', [idx])}>💬 WhatsApp</button>` : ''}
                                <button class="overlay-btn btn-info" style="padding:8px 12px;" ${actionAttrs('shareLocationToVetByIndex', [idx])}>📍 Invia GPS</button>
                                <button class="overlay-btn btn-neutral" style="padding:8px 12px;" ${actionAttrs('deleteVetClinic', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = clinicHtml;
            break;

       case 'clienti':
    const rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const storicoVenditeRubrica = readStorageJSON('storico_vendite', []);
    const storicoVenditePerCliente = new Map();
    storicoVenditeRubrica.forEach((vendita) => {
        const nomeAcquirente = String(vendita && vendita.acquirente ? vendita.acquirente : '').trim().toLowerCase();
        if (!nomeAcquirente) return;
        if (!storicoVenditePerCliente.has(nomeAcquirente)) {
            storicoVenditePerCliente.set(nomeAcquirente, []);
        }
        storicoVenditePerCliente.get(nomeAcquirente).push(vendita);
    });
    const clientiOrdinati = rubricaClienti
        .map((cliente, originalIndex) => ({
            ...cliente,
            originalIndex,
            riepilogoAcquisti: riepilogaAcquistiCliente(
                storicoVenditePerCliente.get((cliente.nome || '').trim().toLowerCase()) || []
            )
        }))
        .sort((a, b) => (b.riepilogoAcquisti?.totaleAcquisti || 0) - (a.riepilogoAcquisti?.totaleAcquisti || 0));

    let clientiHtml = `
        <h2>Rubrica Clienti</h2>
        <p>Elenco dei clienti salvati con storico acquisti:</p>
        <button class="overlay-btn btn-primary" style="width:100%; margin-bottom: 12px;" ${actionAttrs('addClienteInRubrica')}>➕ Nuovo Cliente</button>
    `;
    if (clientiOrdinati.length === 0) {
        clientiHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun cliente salvato in rubrica.</p></div>`;
    } else {
        clientiOrdinati.forEach((clienteData) => {
            const originalIndex = Number(clienteData.originalIndex);
            if (!Number.isInteger(originalIndex) || originalIndex < 0) return;

            const safeCliente = sanitizeRenderable(clienteData);
            const riepilogoAcquisti = clienteData.riepilogoAcquisti;
            const totaleAcquistiFormattato = riepilogoAcquisti.totaleAcquisti.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
            const nettoSostitutivaFormattato = riepilogoAcquisti.nettoAcquistiImpostaSostitutiva.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
            const nettoRitenutaFormattato = riepilogoAcquisti.nettoAcquistiRitenutaAcconto.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
            const totaleRitenuteFormattato = riepilogoAcquisti.ritenuteDaVersare.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
            const numeroAcquisti = riepilogoAcquisti.numeroAcquisti;
            const ultimoAcquisto = riepilogoAcquisti.dataUltimoAcquisto || safeCliente.dataUltimoAcquisto || 'N.D.';

            clientiHtml += `
                <div class="module-card" style="border-left: 4px solid #0284c7; margin-bottom: 12px;">
                    <strong style="color:#f6f1e6; font-size:1rem;">👤 ${safeCliente.nome}</strong>
                    <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">P.IVA / CF: ${safeCliente.cf || 'Non inserito'}</p>
                    <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📍 Indirizzo: ${safeCliente.indirizzo || 'Non inserito'}</p>
                    <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📧 Email: ${safeCliente.email || 'Non specificata'}</p>
                    
                    <div style="background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 6px; margin: 8px 0;">
                        <p style="font-size:0.85rem; color:#22c55e; margin: 0; font-weight: bold;">🟢 Netto acquisti imposta sostitutiva: ${nettoSostitutivaFormattato}</p>
                        <p style="font-size:0.85rem; color:#22d3ee; margin: 4px 0 2px 0; font-weight: bold;">🔹 Netto acquisti ritenuta d'acconto: ${nettoRitenutaFormattato}</p>
                        <p style="font-size:0.85rem; color:#fbbf24; margin: 2px 0; font-weight: bold;">🪙 Ritenute da versare: ${totaleRitenuteFormattato}</p>
                        <p style="font-size:0.85rem; color:#4ade80; margin: 2px 0; font-weight: bold;">💰 Totale acquisti (imposta sostitutiva + ritenuta d'acconto): ${totaleAcquistiFormattato}</p>
                        <p style="font-size:0.75rem; color:#b8b0a0; margin: 4px 0 0 0;">📦 Ricevute emesse: ${numeroAcquisti} | Ultimo: ${ultimoAcquisto}</p>
                    </div>

                    <div style="margin: 8px 0;">
                        <label style="font-size:0.75rem; color:#b8b0a0; display:block; margin-bottom:2px;">📝 Note Cliente:</label>
                        <textarea 
                            id="nota-cliente-${originalIndex}"
                            style="width: 100%; background: #121610; color: #f6f1e6; border: 1px solid rgba(255,255,255,0.07); border-radius: 4px; padding: 6px; font-size: 0.8rem; resize: vertical;" 
                            rows="2" 
                            placeholder="Scrivi una nota per questo cliente..."
                        >${safeCliente.nota || ''}</textarea>
                        <button class="overlay-btn" style="width: 100%; background:#eab308; color:#0f172a; font-weight:bold; padding:8px; font-size:0.85rem; margin-top:6px; border-radius:4px; border:none; cursor:pointer;" ${actionAttrs('salvaNotaClienteDaInput', [originalIndex])}>💾 Salva Nota</button>
                    </div>

                    <div style="display:flex; gap:6px; margin-top:16px; flex-wrap:wrap;">
                        <button class="overlay-btn btn-success" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('creaRicevutaPerCliente', [originalIndex])}>📄 Nuova Ricevuta</button>
                        <button class="overlay-btn btn-info" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('mostraRicevuteClienteByIndex', [originalIndex])}>📜 Vedi Ricevute</button>
                        <button class="overlay-btn btn-neutral" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('editCliente', [originalIndex])}>✏️ Modifica</button>
                        <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteCliente', [originalIndex])}>🗑️ Elimina</button>
                    </div>
                </div>`;
        });
    }
    contentHTML = clientiHtml;
    break;

            case 'archivio':
            // Specie commercializzabili in Italia (Legge 752/1985 e s.m.i.) - ID da 0 a 8
            const specieTartufiArchivio = [
                "Tuber magnatum Pico (Tartufo bianco pregiato)",                   // ID 0
                "Tuber melanosporum Vitt. (Tartufo nero di Norcia)",               // ID 1
                "Tuber macrosporum Vitt. (Tartufo nero liscio)",                   // ID 2
                "Tuber brumale Vitt. (Tartufo nero d'inverno)",                    // ID 3
                "Tuber brumale var. moschatum De Ferry (Tartufo moscato)",         // ID 4
                "Tuber aestivum Vitt. (Tartufo estivo o scorzone)",                // ID 5
                "Tuber uncinatum Chatin (Tartufo uncinato)",                       // ID 6
                "Tuber borchii Vitt. / T. albidum Pico (Bianchetto o marzuolo)",  // ID 7
                "Tuber mesentericum Vitt. (Tartufo nero di Bagnoli Irpino)"        // ID 8
            ];

            // Recupera la regione selezionata nell'archivio o usa una di default
            const regioneSelezionataArchivio = window.currentArchivioRegione || "Campania";

            let calendariPersonalizzatiArchivio = getRenderableStorageJSON('calendari_tartufi_custom', {});
            let datiRegioneArchivio = calendariPersonalizzatiArchivio[regioneSelezionataArchivio] || {};

            // Recupera la nota regionale salvata (se presente)
            let noteRegionaliSalvate = getRenderableStorageJSON('note_regionali_tartufi', {});
            let notaCorrenteRegione = noteRegionaliSalvate[regioneSelezionataArchivio] || '';

            let archivioHtml = `
                <h2>📚 Archivio Date per Regione</h2>
                <p>Gestisci e memorizza i periodi autorizzati per le regioni di interesse.</p>

                <div class="module-card" style="background: #121610; border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px;">
                    <label style="font-size: 0.85rem; color: #b8b0a0; display: block; margin-bottom: 5px;">Seleziona Regione da Archiviare:</label>
                    <select id="seleziona-regione-archivio" class="mod-input" ${eventActionAttrs('change', 'setArchivioRegione')}>
                        <option value="${regioneSelezionataArchivio}" selected>${regioneSelezionataArchivio}</option>
                        <option value="Abruzzo">Abruzzo</option>
                        <option value="Calabria">Calabria</option>
                        <option value="Campania">Campania</option>
                        <option value="Emilia-Romagna">Emilia-Romagna</option>
                        <option value="Lazio">Lazio</option>
                        <option value="Liguria">Liguria</option>
                        <option value="Lombardia">Lombardia</option>
                        <option value="Marche">Marche</option>
                        <option value="Molise">Molise</option>
                        <option value="Piemonte">Piemonte</option>
                        <option value="Puglia">Puglia</option>
                        <option value="Sardegna">Sardegna</option>
                        <option value="Sicilia">Sicilia</option>
                        <option value="Toscana">Toscana</option>
                        <option value="Umbria">Umbria</option>
                        <option value="Veneto">Veneto</option>
                    </select>
                </div>

                <!-- Box di Estrazione Automatica da Testo Ufficiale -->
                <div class="module-card" style="background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px; border-radius: 8px; padding: 15px;">
                    <h3 style="font-size: 0.9rem; color: #4d8a98; margin-bottom: 8px;">📋 Estrazione Automatica Date da Testo</h3>
                    <p style="font-size: 0.8rem; color: #b8b0a0; margin-bottom: 10px;">
                        Incolla qui il testo ufficiale della Regione (es. bollettino o legge regionale) contenente le date di raccolta delle specie di tartufo:
                    </p>
                    <textarea id="testo-normativa-tartufi" class="mod-input" rows="5" placeholder="Es. Il tartufo bianco pregiato si raccoglie dal 1 ottobre al 31 dicembre. Lo scorzone dal 1 maggio al 31 agosto..." style="resize: vertical; background: #121610; color: #f6f1e6; border: 1px solid rgba(255,255,255,0.07); padding: 8px; font-size: 0.85rem; width: 100%; box-sizing: border-box;"></textarea>
                    <button class="overlay-btn" style="margin-top: 10px; width: 100%; background: #0284c7; font-weight: bold; padding: 10px; border: none; border-radius: 4px; color: white; cursor: pointer;" ${actionAttrs('estraiDateTartufiDaTesto')}>
                        🔍 Estrai e Compila Date
                    </button>
                </div>

                <!-- Box Note, Fermi Biologici e Decreti Regionali -->
                <div class="module-card" style="background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px; border-radius: 8px; padding: 15px;">
                    <h3 style="font-size: 0.9rem; color: #4d8a98; margin-bottom: 8px;">📝 Note, Fermi Biologici & Decreti Regionali</h3>
                    <p style="font-size: 0.8rem; color: #b8b0a0; margin-bottom: 10px;">
                        Annota estremi di decreti, limitazioni straordinarie o periodi di fermo biologico per la regione ${regioneSelezionataArchivio}:
                    </p>
                    <textarea id="nota-regione-speciale" class="mod-input" rows="3" placeholder="Es. Delibera straordinaria: divieto di raccolta o fermo biologico..." style="resize: vertical; background: #121610; color: #f6f1e6; border: 1px solid rgba(255,255,255,0.07); padding: 8px; font-size: 0.85rem; width: 100%; box-sizing: border-box;">${notaCorrenteRegione}</textarea>
                </div>
            `;

            specieTartufiArchivio.forEach((specie, idSpecie) => {
                let periodoSalvato = datiRegioneArchivio[idSpecie] !== undefined ? datiRegioneArchivio[idSpecie] : '';
                let borderColor = periodoSalvato ? '#f59e0b' : '#556152';
                let labelExtra = periodoSalvato ? '' : '<span style="font-size:0.75rem; color:#b8b0a0; font-style:italic; margin-left:6px;">⚠️ Nessuna data salvata</span>';

                archivioHtml += `
                    <div class="module-card" style="border-left: 4px solid ${borderColor}; margin-bottom: 10px; background: rgba(29,40,30,0.96);">
                        <strong style="color: #f6f1e6; font-size: 0.9rem; display: block; margin-bottom: 5px;">🍄 [ID Specie: ${idSpecie}] ${specie}${labelExtra}</strong>
                        <label style="font-size: 0.75rem; color: #b8b0a0;">Periodo di raccolta autorizzato:</label>
                        <input type="text" id="specie-archivio-${idSpecie}" class="mod-input" value="${periodoSalvato}" placeholder="Nessuna data salvata — inserisci il periodo" style="margin-top: 3px; font-size: 0.85rem;">
                    </div>
                `;
            });

            // INSERITO QUI IL BLOCCO DI BACKUP & RIPRISTINO CALENDARI:
            archivioHtml += `
                <div class="module-card" style="background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px; border-radius: 8px; padding: 15px; margin-top: 15px;">
                    <h3 style="font-size: 0.9rem; color: #4d8a98; margin-bottom: 8px;">💾 Backup & Ripristino Calendari</h3>
                    <p style="font-size: 0.8rem; color: #b8b0a0; margin-bottom: 10px;">
                        Esporta i tuoi calendari regionali personalizzati su file/condividili o ripristinali da un backup precedente:
                    </p>
                    <button class="overlay-btn" style="width: 100%; background: #16a34a; font-weight: bold; padding: 10px; border: none; border-radius: 4px; color: white; cursor: pointer; margin-bottom: 10px;" ${actionAttrs('esportaCalendariJSON')}>
                        📥 Scarica o Condividi Calendari (JSON)
                    </button>
                    
                    <label style="font-size: 0.75rem; color: #b8b0a0; display: block; margin-bottom: 4px;">Carica Calendari da File JSON:</label>
                    <input type="file" id="import-calendari-file" accept=".json" class="mod-input" style="padding: 6px; font-size: 0.8rem;" ${eventActionAttrs('change', 'importaCalendariJSON')}>
                </div>
            `;

            archivioHtml += `
                <div style="margin-top: 15px; margin-bottom: 25px;">
                    <button class="overlay-btn" style="width: 100%; background: #22c55e; color: #0f172a; font-weight: bold; padding: 12px; font-size: 0.95rem; border-radius: 6px; border: none; cursor: pointer;" ${actionAttrs('saveArchivioRegionaleTartufiSelected')}>
                        💾 Salva Date e Note in Archivio
                    </button>
                </div>
            `;

            contentHTML = archivioHtml;
            break;

            case 'calendario': {
    const gpsTextCal = document.getElementById('gps-status-text');
    let regioneCal = "Campania"; 
    if (gpsTextCal && gpsTextCal.innerHTML) {
        const matchReg = gpsTextCal.innerHTML.match(/<b>(.*?)<\/b>/);
        if (matchReg && matchReg[1]) regioneCal = matchReg[1];
    }

    let allCalendari = getRenderableStorageJSON('calendari_tartufi_custom', {});
    let datiRegioneCorrente = allCalendari[regioneCal] || {};

    let noteRegionaliSalvate = getRenderableStorageJSON('note_regionali_tartufi', {});
    let notaRegionaleCorrente = noteRegionaliSalvate[regioneCal] || '';

    const specieTartufiCal = [
        "Tuber magnatum Pico (Tartufo bianco pregiato)",
        "Tuber melanosporum Vitt. (Tartufo nero di Norcia)",
        "Tuber macrosporum Vitt. (Tartufo nero liscio)",
        "Tuber brumale Vitt. (Tartufo nero d'inverno)",
        "Tuber brumale var. moschatum De Ferry (Tartufo moscato)",
        "Tuber aestivum Vitt. (Tartufo estivo o scorzone)",
        "Tuber uncinatum Chatin (Tartufo uncinato)",
        "Tuber borchii Vitt. / T. albidum Pico (Bianchetto o marzuolo)",
        "Tuber mesentericum Vitt. (Tartufo nero di Bagnoli Irpino)"
    ];
    const defaultPeriodiCal = [];

    let calHtml = `
        <h2>📅 Calendario Raccolta (GPS)</h2>
        <p>Regione rilevata: <strong style="color:#4d8a98;">${regioneCal}</strong></p>
        <p style="font-size:0.85rem; color:#b8b0a0; margin-bottom:15px;">Specie con periodo di raccolta attualmente <b>aperto</b>:</p>
    `;

    let specieAperteTrovate = 0;
    let specieConDateSalvate = 0;

    specieTartufiCal.forEach((specie, id) => {
        let periodoSalvato = datiRegioneCorrente[id] !== undefined ? datiRegioneCorrente[id] : '';

        // Se non ci sono date salvate per questa specie, la saltiamo
        if (!periodoSalvato) return;
        specieConDateSalvate++;

        // Controllo di sicurezza nel caso in cui la funzione di verifica non esista
        let isOpen = typeof isSpecieApertaCorrente === 'function' ? isSpecieApertaCorrente(periodoSalvato) : false;

        if (isOpen) {
            specieAperteTrovate++;
            calHtml += `
                <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 10px; background: rgba(29,40,30,0.96); padding: 10px; border-radius: 6px;">
                    <strong style="color: #f6f1e6; font-size: 0.85rem; display: block;">🍄 [ID: ${id}] ${specie}</strong>
                    <div style="font-size: 0.75rem; color: #b8b0a0; margin-top: 4px;">🗓️ Periodo consentito: ${periodoSalvato}</div>
                    <div style="font-size: 0.75rem; margin-top: 6px;"><span style="color:#22c55e; font-weight:bold;">🟢 RACCOLTA APERTA</span></div>
                </div>
            `;
        }
    });

    if (specieConDateSalvate === 0) {
        calHtml += `
            <div class="module-card" style="background: rgba(29,40,30,0.96); border-left: 4px solid #f59e0b; padding: 12px; text-align: center; margin-bottom: 15px;">
                <p style="color: #f59e0b; font-weight: bold; margin: 0;">⚠️ Nessuna data salvata per la regione ${regioneCal}.<br><span style="font-size:0.8rem; font-weight:normal; color:#b8b0a0;">Vai su "📚 Archivio Date per Regione" per inserire i periodi di raccolta.</span></p>
            </div>
        `;
    } else if (specieAperteTrovate === 0) {
        calHtml += `
            <div class="module-card" style="background: rgba(29,40,30,0.96); border-left: 4px solid #ef4444; padding: 12px; text-align: center; margin-bottom: 15px;">
                <p style="color: #ef4444; font-weight: bold; margin: 0;">🔴 Nessuna specie aperta in questo periodo per la regione ${regioneCal}.</p>
            </div>
        `;
    }

    if (notaRegionaleCorrente && notaRegionaleCorrente.trim() !== "") {
        calHtml += `
            <div class="module-card" style="background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07); margin-top: 15px; border-radius: 8px; padding: 15px;">
                <h4 style="font-size: 0.9rem; color: #4d8a98; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    📝 Note & Fermi Biologici
                </h4>
                <p style="font-size: 0.8rem; color: #ddd6c8; margin: 0; white-space: pre-wrap; line-height: 1.4;">${notaRegionaleCorrente}</p>
            </div>
        `;
    }

    contentHTML = calHtml;
    break;
}

        case 'mappa_offline': {
            const prefOffline = readStorageJSON(OFFLINE_REGIONI_PREFERITE_KEY, { regioni: [], maxZoom: OFFLINE_MAP_DEFAULT_MAX_ZOOM });
            const regioniCheckboxes = REGIONI_ITALIA_OFFLINE.map(r => {
                const checked = prefOffline.regioni.includes(r.id) ? ' checked' : '';
                return `
                <label class="offline-region-label">
                    <input type="checkbox" class="offline-region-cb" data-region-id="${r.id}" value="${r.id}"${checked}>
                    <span>${r.nome}</span>
                </label>`;
            }).join('');

            const zoomOptions = [11, 12, 13, 14, 15].map(z => {
                const labels = {
                    11: '11 – Ultra leggero (consigliato su telefoni con poco spazio)',
                    12: '12 – Leggero',
                    13: '13 – Panoramico',
                    14: '14 – Sentieri boschivi (dettaglio medio)',
                    15: '15 – Dettaglio elevato (molto pesante)'
                };
                const sel = prefOffline.maxZoom === z ? ' selected' : '';
                return `<option value="${z}"${sel}>${labels[z]}</option>`;
            }).join('');

            contentHTML = `
                <h2>📥 Download Mappa Offline</h2>
                <div class="module-card" style="margin-bottom:14px;">
                    <p style="font-size:0.85rem; color:#ddd6c8; margin:0 0 10px 0;">Seleziona una o più regioni da scaricare per usare la mappa <strong>senza connessione internet</strong>. Il download avviene via Wi-Fi (consigliato).</p>
                    <p style="font-size:0.82rem; color:#b8b0a0; margin:0 0 14px 0;">⚠️ Se hai poco spazio, usa zoom 11–12 e scarica una regione alla volta.</p>
                    <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                        <button class="overlay-btn btn-neutral" style="font-size:0.8rem; padding:6px 10px;" ${actionAttrs('selezionaTutteRegioni')}>✅ Seleziona tutte</button>
                        <button class="overlay-btn btn-neutral" style="font-size:0.8rem; padding:6px 10px;" ${actionAttrs('deselezionaTutteRegioni')}>☐ Deseleziona tutte</button>
                    </div>
                    <div id="offline-regions-list" style="display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; margin-bottom:16px;">
                        ${regioniCheckboxes}
                    </div>
                    <div id="offline-zoom-row" style="margin-bottom:14px;">
                        <label style="font-size:0.85rem; color:#f6f1e6; font-weight:bold;">Livello di zoom massimo:</label>
                        <select id="offline-zoom-select" class="mod-input" style="margin-top:6px;">
                            ${zoomOptions}
                        </select>
                    </div>
                    <button class="overlay-btn btn-info" style="width:100%; margin-bottom:10px;" ${actionAttrs('salvaPreferenzeMappaOffline')}>💾 Salva Preferenze</button>
                    <div id="offline-progress-area" style="display:none; margin-bottom:14px;">
                        <p id="offline-progress-text" style="font-size:0.85rem; color:#4d8a98; margin:0 0 6px 0;">Download in corso…</p>
                        <div style="background:rgba(255,255,255,0.08); border-radius:6px; height:10px; overflow:hidden;">
                            <div id="offline-progress-bar" style="height:100%; width:0%; background:#22c55e; border-radius:6px; transition:width 0.3s;"></div>
                        </div>
                    </div>
                    <button class="overlay-btn btn-neutral" style="width:100%; margin-bottom:10px;" ${actionAttrs('verificaCoperturaMappaOffline')}>🔎 Verifica Tile Necessarie</button>
                    <button class="overlay-btn btn-primary" style="width:100%; margin-bottom:10px;" ${actionAttrs('scaricaRegioniOffline')}>📥 Scarica Regioni Selezionate</button>
                    <button class="overlay-btn btn-danger" style="width:100%;" ${actionAttrs('eliminaCacheMappaOffline')}>🗑️ Elimina Tutta la Cache Mappa</button>
                </div>
                <div class="module-card" style="margin-bottom:14px;">
                    <p style="font-size:0.85rem; color:#f6f1e6; font-weight:bold; margin:0 0 8px 0;">🔎 Copertura richiesta</p>
                    <div id="offline-selection-coverage" style="font-size:0.82rem; color:#b8b0a0;">
                        <p style="margin:0; color:#6b7280; font-size:0.8rem;">Seleziona regioni e zoom, poi usa “🔎 Verifica Tile Necessarie”.</p>
                    </div>
                </div>
                <div class="module-card" style="margin-bottom:14px;">
                    <p style="font-size:0.85rem; color:#f6f1e6; font-weight:bold; margin:0 0 8px 0;">📶 Stato offline mappa</p>
                    <div id="offline-runtime-status" style="font-size:0.82rem; color:#b8b0a0;">
                        <p style="margin:0; color:#6b7280; font-size:0.8rem;">Verifica in corso…</p>
                    </div>
                </div>
                <div class="module-card" style="margin-bottom:14px;">
                    <p style="font-size:0.85rem; color:#f6f1e6; font-weight:bold; margin:0 0 8px 0;">📦 Stato cache per regione</p>
                    <div id="offline-cache-status" style="font-size:0.82rem; color:#b8b0a0;">
                        <p style="margin:0; color:#6b7280; font-size:0.8rem;">Verifica in corso…</p>
                    </div>
                </div>`;
            break;
        }

    default:
            contentHTML = `<h2>Modulo</h2><p>In fase di sviluppo.</p>`;
    }
    
    activeView.innerHTML = `
        <div class="module-header-bar">
            <button ${actionAttrs('closeActiveModule')} class="back-map-btn module-nav-btn module-nav-btn-left">← Torna alla Mappa</button>
            <button ${actionAttrs('mostraInfoModulo', [moduleName])} class="back-map-btn btn-neutral btn-round text-sky border-slate module-help-btn" title="Guida modulo" aria-label="Apri la guida del modulo">❓</button>
            <button ${actionAttrs('closeDrawerAndModule')} class="back-map-btn module-nav-btn module-nav-btn-right">☰ Torna al Menu</button>
        </div>
        <div class="module-body-content">${contentHTML}</div>
    `;
    activeView.dataset.activeModule = moduleName;
    activeView.style.display = 'flex';
    if (moduleName === 'export') {
        setTimeout(syncAutomaticBackupDestinationUI, 0);
        setTimeout(syncAutomaticBackupStatusUI, 0);
    }
    if (moduleName === 'mappa_offline') {
        setTimeout(aggiornaStatoCacheRegioni, 0);
        setTimeout(updateOfflineMapRuntimeStatusIndicator, 0);
        if (isOfflineMapRecoveryRunning) {
            const progressArea = document.getElementById('offline-progress-area');
            if (progressArea) progressArea.style.display = 'block';
        }
    }
    if (moduleName === 'vet') {
        syncVetUnifiedInputForm();
    }
}

function closeActiveModule() {
    editingDogIndex = null;
    editingArchivioDocumentoIndex = null;
    editingPoiIndex = null;
    const activeView = document.getElementById('active-module-view');
    if (activeView) activeView.style.display = 'none';
}
async function clearData(storageKey, moduleName) {
    if (await appConfirm("Vuoi davvero eliminare questi dati?")) {
        localStorage.removeItem(storageKey);
        openModule(moduleName);
    }
}
function saveTesserino() {
    const nomeVal = document.getElementById('t-nome').value.trim();
    const cfVal = document.getElementById('t-cf').value.trim().toUpperCase();
    const indirizzoVal = (document.getElementById('t-indirizzo') || {}).value?.trim() || '';
    const regioneVal = document.getElementById('t-regione').value.trim();
    const numVal = document.getElementById('t-num').value.trim();
    const ibanVal = (document.getElementById('t-iban') || {}).value?.trim() || '';
    const bancaVal = (document.getElementById('t-banca') || {}).value?.trim() || '';
    const fileInput = document.getElementById('t-file');
    const file = fileInput ? fileInput.files[0] : null;

    if (!nomeVal || !cfVal) {
        showToast("Inserisci almeno Nome e Codice Fiscale.", 'error');
        return;
    }

    const tDataExisting = readStorageJSON('tesserino_data', {});

    // Funzione helper per il salvataggio sicuro
    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            nome: nomeVal, 
            cf: cfVal, 
            indirizzo: indirizzoVal,
            regione: regioneVal, 
            num: numVal,
            iban: ibanVal,
            banca: bancaVal,
            intestatario: nomeVal,
            nomeFile: fileName !== undefined ? fileName : (tDataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (tDataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (tDataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('tesserino_data', JSON.stringify(data));
            showToast("Dati personali salvati!", 'success');
            openModule('tesserino');
        } catch (e) {
            showToast("Spazio esaurito. Carica un file più piccolo.", 'error');
            console.error(e);
        }
    };

    if (file) {
        if (!isImageFile(file)) {
            showToast("Formato non supportato: carica solo immagini.", 'error');
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            showToast("Immagine troppo grande. Max 1.5 MB.", 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            saveData(e.target.result, file.name, file.type);
        };
        reader.readAsDataURL(file);
    } else {
        // Salva mantenendo il file pre-esistente
        saveData();
    }
}
function saveF24WithFile() {
    const annoVal = document.getElementById('f-anno').value.trim();
    const protocolloVal = document.getElementById('f-protocollo').value.trim();
    const dataPagamentoVal = document.getElementById('f-data-pagamento').value; // <--- Legge la data inserita
    const fileInput = document.getElementById('f-file');
    const file = fileInput ? fileInput.files[0] : null;
    
    if (!annoVal || !protocolloVal || !dataPagamentoVal) {
        showToast("Compila tutti i campi obbligatori.", 'error');
        return;
    }

    const f24DataExisting = readStorageJSON('f24_data', {});

    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            anno: annoVal, 
            protocollo: protocolloVal,
            dataPagamento: dataPagamentoVal, // <--- Salva la data nel localStorage
            nomeFile: fileName !== undefined ? fileName : (f24DataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (f24DataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (f24DataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('f24_data', JSON.stringify(data));
            showToast("Dati F24 ELIDE salvati!", 'success');
            openModule('f24');
        } catch (e) {
            showToast("Spazio esaurito. Carica un file più piccolo.", 'error');
            console.error(e);
        }
    };

    if (file) {
        if (!isImageFile(file)) {
            showToast("Formato non supportato: carica solo immagini.", 'error');
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            showToast("Immagine troppo grande. Max 1.5 MB.", 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            saveData(e.target.result, file.name, file.type);
        };
        reader.readAsDataURL(file);
    } else {
        saveData(f24DataExisting.contenutoBase64, f24DataExisting.nomeFile, f24DataExisting.tipoFile);
    }
}
function savePagoPAWithFile() {
    const idVal = document.getElementById('p-id').value.trim();
    const dataVal = document.getElementById('p-data').value.trim();
    const fileInput = document.getElementById('p-file');
    const file = fileInput ? fileInput.files[0] : null;
    
    const annoCorrente = new Date().getFullYear(); // <--- Anno di riferimento
    const pDataExisting = readStorageJSON('pagopa_data', {});

    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            id: idVal, 
            data: dataVal,
            effettuato: true,                 // <--- Fondamentale per sbloccare il controllo
            anno: annoCorrente,               // <--- Salva l'anno corrente per il confronto
            nomeFile: fileName !== undefined ? fileName : (pDataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (pDataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (pDataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('pagopa_data', JSON.stringify(data));
            showToast("Dati PagoPA salvati!", 'success');
            openModule('pagopa');
        } catch (e) {
            showToast("Spazio esaurito. Carica un file più piccolo.", 'error');
            console.error(e);
        }
    };

    if (file) {
        if (!isImageFile(file)) {
            showToast("Formato non supportato: carica solo immagini.", 'error');
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            showToast("Immagine troppo grande. Max 1.5 MB.", 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            saveData(e.target.result, file.name, file.type);
        };
        reader.readAsDataURL(file);
    } else {
        saveData(pDataExisting.contenutoBase64, pDataExisting.nomeFile, pDataExisting.tipoFile);
    }
}

async function saveArchivioDocumenti() {
    const tipo = document.getElementById('ad-tipo').value.trim();
    const numero = document.getElementById('ad-numero').value.trim();
    const scadenza = document.getElementById('ad-scadenza').value;
    const fileDocumento = (document.getElementById('ad-doc-file') || {}).files?.[0] || null;
    const fileRinnovo = (document.getElementById('ad-rinnovo-file') || {}).files?.[0] || null;
    const removeRinnovo = Boolean(document.getElementById('ad-remove-rinnovo')?.checked);
    const archivioDocumenti = readStorageJSON('archivio_documenti_list', []);
    const isEditing = Number.isInteger(editingArchivioDocumentoIndex)
        && editingArchivioDocumentoIndex >= 0
        && editingArchivioDocumentoIndex < archivioDocumenti.length;
    const documentoEsistente = isEditing ? archivioDocumenti[editingArchivioDocumentoIndex] : null;

    if (!tipo || !numero || !scadenza) {
        showToast("Compila tipo, numero documento e scadenza.", 'error');
        return;
    }

    if (!fileDocumento && !documentoEsistente?.contenutoBase64Documento) {
        showToast("Carica l'immagine del documento.", 'error');
        return;
    }

    if (fileDocumento) {
        if (!isImageFile(fileDocumento)) {
            showToast("Il documento deve essere un'immagine valida.", 'error');
            return;
        }
        if (fileDocumento.size > MAX_IMAGE_SIZE_BYTES) {
            showToast("Immagine documento troppo grande. Max 1.5 MB.", 'error');
            return;
        }
    }

    if (fileRinnovo) {
        if (!isImageFile(fileRinnovo)) {
            showToast("La ricevuta rinnovo deve essere un'immagine valida.", 'error');
            return;
        }
        if (fileRinnovo.size > MAX_IMAGE_SIZE_BYTES) {
            showToast("Immagine ricevuta rinnovo troppo grande. Max 1.5 MB.", 'error');
            return;
        }
    }

    try {
        const contenutoBase64Documento = fileDocumento
            ? await readImageAsDataUrl(fileDocumento)
            : (documentoEsistente?.contenutoBase64Documento || null);
        const contenutoBase64Rinnovo = fileRinnovo
            ? await readImageAsDataUrl(fileRinnovo)
            : (removeRinnovo ? null : (documentoEsistente?.contenutoBase64Rinnovo || null));
        const documentoAggiornato = {
            tipo,
            numero,
            scadenza,
            nomeFileDocumento: fileDocumento ? fileDocumento.name : (documentoEsistente?.nomeFileDocumento || null),
            tipoFileDocumento: fileDocumento ? fileDocumento.type : (documentoEsistente?.tipoFileDocumento || null),
            contenutoBase64Documento,
            nomeFileRinnovo: fileRinnovo ? fileRinnovo.name : (removeRinnovo ? null : (documentoEsistente?.nomeFileRinnovo || null)),
            tipoFileRinnovo: fileRinnovo ? fileRinnovo.type : (removeRinnovo ? null : (documentoEsistente?.tipoFileRinnovo || null)),
            contenutoBase64Rinnovo,
            creatoIl: documentoEsistente?.creatoIl || new Date().toISOString(),
            aggiornatoIl: new Date().toISOString()
        };
        if (isEditing) {
            archivioDocumenti[editingArchivioDocumentoIndex] = documentoAggiornato;
        } else {
            archivioDocumenti.push(documentoAggiornato);
        }
        localStorage.setItem('archivio_documenti_list', JSON.stringify(archivioDocumenti));
        editingArchivioDocumentoIndex = null;
        showToast(isEditing ? "Documento aggiornato!" : "Documento archiviato!", 'success');
        openModule('archivio_documenti');
    } catch (error) {
        showToast("Errore nel salvataggio del documento.", 'error');
        console.error(error);
    }
}

function editArchivioDocumento(index) {
    const archivioDocumenti = readStorageJSON('archivio_documenti_list', []);
    const record = archivioDocumenti[index];
    if (!record) return;
    editingArchivioDocumentoIndex = index;
    openModule('archivio_documenti');
}

function cancelArchivioDocumentoEdit() {
    editingArchivioDocumentoIndex = null;
    openModule('archivio_documenti');
}

async function deleteArchivioDocumento(index) {
    if (await appConfirm("Vuoi davvero eliminare questo documento archiviato?")) {
        const archivioDocumenti = readStorageJSON('archivio_documenti_list', []);
        archivioDocumenti.splice(index, 1);
        localStorage.setItem('archivio_documenti_list', JSON.stringify(archivioDocumenti));
        if (Number.isInteger(editingArchivioDocumentoIndex) && editingArchivioDocumentoIndex === index) {
            editingArchivioDocumentoIndex = null;
            showToast("Documento in modifica eliminato.", 'info');
        } else if (Number.isInteger(editingArchivioDocumentoIndex) && editingArchivioDocumentoIndex > index) editingArchivioDocumentoIndex -= 1;
        openModule('archivio_documenti');
    }
}

function viewArchivioDocumentoImage(index, imageType) {
    const archivioDocumenti = readStorageJSON('archivio_documenti_list', []);
    const record = archivioDocumenti[index];
    if (!record) {
        showToast("Documento non trovato.", 'error');
        return;
    }

    const base64Data = imageType === 'rinnovo' ? record.contenutoBase64Rinnovo : record.contenutoBase64Documento;
    if (!isSafeDataUrl(base64Data)) {
        showToast("Immagine non disponibile.", 'error');
        return;
    }

    const titolo = imageType === 'rinnovo' ? 'Ricevuta Rinnovo Documento' : 'Documento Archiviato';
    visualizzaImmagineSalvata(base64Data, titolo, 'archivio_documenti');
}

function saveNewCane() {
    saveDogRecord();
}

function updateDog() {
    saveDogRecord(editingDogIndex);
}

function saveDogRecord(index = null) {
    const nome = document.getElementById('c-nome').value.trim();
    const razza = document.getElementById('c-razza').value.trim();
    const sesso = document.getElementById('c-sesso').value;
    const nascita = document.getElementById('c-nascita').value;
    const microchip = document.getElementById('c-microchip').value.trim();
    if (!nome) { showToast("Inserisci il nome del cane.", 'error'); return; }

    const dogData = { nome, razza, sesso, nascita, microchip };
    let dogsList = readStorageJSON('dogs_list', []);
    const isEditing = Number.isInteger(index) && index >= 0 && index < dogsList.length;
    const previousDog = isEditing ? dogsList[index] : null;

    if (isEditing) {
        dogsList[index] = dogData;
    } else {
        dogsList.push(dogData);
    }

    localStorage.setItem('dogs_list', JSON.stringify(dogsList));
    syncCurrentDogData(dogsList, { preferredDog: dogData, replacedDog: previousDog });
    editingDogIndex = null;
    showToast(isEditing ? "Cane aggiornato!" : "Cane aggiunto!", 'success');
    openModule('canidiary');
}

function editDog(index) {
    const dogsList = readStorageJSON('dogs_list', []);
    const dog = dogsList[index];
    if (!dog) return;
    editingDogIndex = index;
    openModule('canidiary');
}

function cancelDogEdit() {
    editingDogIndex = null;
    openModule('canidiary');
}

async function deleteDog(index) {
    if (await appConfirm("Vuoi davvero rimuovere questo cane?")) {
        let dogsList = readStorageJSON('dogs_list', []);
        const removedDog = dogsList[index];
        if (!removedDog) return;
        dogsList.splice(index, 1);
        localStorage.setItem('dogs_list', JSON.stringify(dogsList));
        if (Number.isInteger(editingDogIndex) && editingDogIndex === index) editingDogIndex = null;
        else if (Number.isInteger(editingDogIndex) && editingDogIndex > index) editingDogIndex -= 1;
        syncCurrentDogData(dogsList, { removedDog });
        openModule('canidiary');
    }
}

function creaRicevutaPerCliente(index) {
    const rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const cliente = rubricaClienti[index];
    if (!cliente) return;

    // Apre il modulo per la creazione della ricevuta
    openModule('ricevute');

    // Popola automaticamente i campi del modulo con i dati del cliente selezionato
    setTimeout(() => {
        const elAcquirente = document.getElementById('r-acquirente');
        const elCf = document.getElementById('r-cf-acquirente');
        const elIndirizzo = document.getElementById('r-indirizzo-acquirente');
        const elEmail = document.getElementById('r-email-acquirente');

        if (elAcquirente) elAcquirente.value = cliente.nome || '';
        if (elCf) elCf.value = cliente.cf || '';
        if (elIndirizzo) elIndirizzo.value = cliente.indirizzo || '';
        if (elEmail) elEmail.value = cliente.email || '';
    }, 50);
}

async function addClienteInRubrica() {
    const nomeInput = await appPrompt("Inserisci nome cliente:", "");
    if (nomeInput === null) return;

    const nome = nomeInput.trim();
    if (!nome) {
        showToast("Il nome cliente è obbligatorio.", 'error');
        return;
    }

    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const clienteEsistente = rubricaClienti.some((cliente) => (cliente.nome || '').trim().toLowerCase() === nome.toLowerCase());
    if (clienteEsistente) {
        showToast("Cliente già presente in rubrica.", 'error');
        return;
    }

    const cfInput = await appPrompt("Inserisci P.IVA / CF (facoltativo):", "");
    if (cfInput === null) return;
    const indirizzoInput = await appPrompt("Inserisci indirizzo (facoltativo):", "");
    if (indirizzoInput === null) return;
    const emailInput = await appPrompt("Inserisci email (facoltativo):", "");
    if (emailInput === null) return;
    const notaInput = await appPrompt("Inserisci nota cliente (facoltativa):", "");
    if (notaInput === null) return;

    rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const duplicatoAlSalvataggio = rubricaClienti.some((cliente) => (cliente.nome || '').trim().toLowerCase() === nome.toLowerCase());
    if (duplicatoAlSalvataggio) {
        showToast("Cliente già presente in rubrica.", 'error');
        return;
    }

    rubricaClienti.push({
        nome,
        cf: cfInput.trim(),
        indirizzo: indirizzoInput.trim(),
        email: emailInput.trim(),
        nota: notaInput.trim(),
        totaleAcquisti: 0,
        numeroAcquisti: 0,
        dataUltimoAcquisto: ''
    });

    localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
    showToast("Cliente aggiunto in rubrica!", 'success');
    openModule('clienti');
}

async function editCliente(index) {
    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const cliente = rubricaClienti[index];
    if (!cliente) return;

    const nomeInput = await appPrompt("Modifica nome cliente:", cliente.nome || '');
    if (nomeInput === null) return;

    const nome = nomeInput.trim();
    if (!nome) {
        showToast("Il nome cliente è obbligatorio.", 'error');
        return;
    }

    const nomeDuplicato = rubricaClienti.some((item, idx) => idx !== index && (item.nome || '').trim().toLowerCase() === nome.toLowerCase());
    if (nomeDuplicato) {
        showToast("Esiste già un cliente con questo nome.", 'error');
        return;
    }

    const cfInput = await appPrompt("Modifica P.IVA / CF:", cliente.cf || '');
    if (cfInput === null) return;
    const indirizzoInput = await appPrompt("Modifica indirizzo:", cliente.indirizzo || '');
    if (indirizzoInput === null) return;
    const emailInput = await appPrompt("Modifica email:", cliente.email || '');
    if (emailInput === null) return;

    rubricaClienti = readStorageJSON('rubrica_clienti', []);
    if (index < 0 || index >= rubricaClienti.length || rubricaClienti[index] === undefined) {
        showToast("Cliente non trovato.", 'error');
        return;
    }

    const nomeDuplicatoAlSalvataggio = rubricaClienti.some((item, idx) => idx !== index && (item.nome || '').trim().toLowerCase() === nome.toLowerCase());
    if (nomeDuplicatoAlSalvataggio) {
        showToast("Esiste già un cliente con questo nome.", 'error');
        return;
    }

    rubricaClienti[index] = {
        ...rubricaClienti[index],
        nome,
        cf: cfInput.trim(),
        indirizzo: indirizzoInput.trim(),
        email: emailInput.trim()
    };

    localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
    showToast("Cliente aggiornato!", 'success');
    openModule('clienti');
}

async function deleteCliente(index) {
    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    if (index < 0 || index >= rubricaClienti.length || rubricaClienti[index] === undefined) return;

    if (await appConfirm("Vuoi davvero rimuovere questo cliente dalla rubrica?")) {
        rubricaClienti.splice(index, 1);
        localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
        openModule('clienti');
    }
}

function savePolizza() {
    const compagnia = document.getElementById('pol-compagnia').value.trim();
    const numero = document.getElementById('pol-numero').value.trim();
    const tipo = document.getElementById('pol-tipo').value;
    const scadenza = document.getElementById('pol-scadenza').value;
    const note = document.getElementById('pol-note').value.trim();
    if (!compagnia || !numero) { showToast("Inserisci compagnia e numero polizza.", 'error'); return; }
    let polizzeList = readStorageJSON('polizze_list', []);
    polizzeList.push({ compagnia, numero, tipo, scadenza, note });
    localStorage.setItem('polizze_list', JSON.stringify(polizzeList));
    showToast("Polizza salvata!", 'success');
    openModule('polizze');
}

async function deletePolizza(index) {
    if (await appConfirm("Vuoi davvero rimuovere questa polizza?")) {
        let polizzeList = readStorageJSON('polizze_list', []);
        polizzeList.splice(index, 1);
        localStorage.setItem('polizze_list', JSON.stringify(polizzeList));
        openModule('polizze');
    }
}
function saveRaccoltaGiornaliera() {
    const data = document.getElementById('reg-data').value;
    const specie = document.getElementById('reg-specie').value;
    const peso = parseFloat(document.getElementById('reg-peso').value) || 0;
    const luogo = document.getElementById('reg-luogo').value.trim();
    const note = document.getElementById('reg-note').value.trim();
    if (!data || peso <= 0) { showToast("Data e peso obbligatori.", 'error'); return; }
    if (luogo) aggiungiLuogoRaccolta(luogo);
    let storicoRaccolta = readStorageJSON('storico_raccolta_giornaliera', []);
    storicoRaccolta.push({ data, specie, peso, luogo, note });
    localStorage.setItem('storico_raccolta_giornaliera', JSON.stringify(storicoRaccolta));
    showToast("Raccolta registrata!", 'success');
    openModule('registro_giornaliero');
}

async function deleteRaccoltaGiornaliera(index) {
    if (await appConfirm("Vuoi davvero rimuovere questo record dal registro?")) {
        let storicoRaccolta = readStorageJSON('storico_raccolta_giornaliera', []);
        storicoRaccolta.splice(index, 1);
        localStorage.setItem('storico_raccolta_giornaliera', JSON.stringify(storicoRaccolta));
        openModule('registro_giornaliero');
    }
}
function calcolaTotale() {
    const elPeso = document.getElementById('pesoGrammi');
    const elPrezzo = document.getElementById('prezzoKg');
    const elImporto = document.getElementById('importoTotale');
    if (!elPeso || !elPrezzo || !elImporto) return;
    const grammi = parseFloat(elPeso.value) || 0;
    const prezzoKg = parseFloat(elPrezzo.value) || 0;
    
    if (grammi > 0 && prezzoKg > 0) {
        const totale = calcolaImportoTotale(grammi, prezzoKg);
        elImporto.value = totale.toFixed(2);
        calcolaRitenutaAcconto();
    }
}

function toggleRegimeFiscaleFields() {
    const elRegime = document.getElementById('r-regime');
    if (!elRegime) return;
    const regime = elRegime.value;
    const containerF24 = document.getElementById('container-f24-field');
    const containerRitenuta = document.getElementById('container-ritenuta');
    
    if (regime === 'ritenuta') {
        if (containerF24) containerF24.style.display = 'none';
        if (containerRitenuta) containerRitenuta.style.display = 'block';
        calcolaRitenutaAcconto();
    } else {
        if (containerF24) containerF24.style.display = 'block';
        if (containerRitenuta) containerRitenuta.style.display = 'none';
    }
}

function toggleCoordinateBancarie() {
    const metodo = document.getElementById('r-metodo-pagamento');
    const container = document.getElementById('container-coordinate-bancarie');
    if (!metodo || !container) return;
    const isBonifico = metodo.value === 'bonifico';
    container.style.display = isBonifico ? 'block' : 'none';
    if (isBonifico) {
        const tData = readStorageJSON('tesserino_data', {});
        const elIban = document.getElementById('r-iban');
        const elBanca = document.getElementById('r-banca');
        if (elIban && !elIban.value && tData.iban) elIban.value = tData.iban;
        if (elBanca && !elBanca.value && tData.banca) elBanca.value = tData.banca;
    }
}

function calcolaRitenutaAcconto() {
    const elRegime = document.getElementById('r-regime');
    const regime = elRegime ? elRegime.value : 'sostitutiva';
    if (regime !== 'ritenuta') return;
    
    const elImporto = document.getElementById('importoTotale');
    if (!elImporto) return;
    const importoTotale = parseFloat(elImporto.value) || 0;
    
    const { ritenuta, netto } = calcolaDettaglioRitenuta(importoTotale);
    
    const elRitenuta = document.getElementById('r-importo-ritenuta');
    const elNetto = document.getElementById('r-netto-pagare');
    
    if (elRitenuta) elRitenuta.value = ritenuta.toFixed(2);
    if (elNetto) elNetto.value = netto.toFixed(2);
}

async function registraVenditaConPrezzoKg() {
    // 1. BLOCCO MANCANZA DATI TESSERINO
    const tData = readStorageJSON('tesserino_data', {});
    if (!tData.nome || !tData.cf || !tData.num) {
        await appAlert("❌ Attenzione: Impossibile procedere.\nMancano i dati anagrafici, il codice fiscale o gli estremi del tesserino di raccolta.");
        openModule('tesserino');
        return;
    }

    // 2. CONTROLLO VALIDITÀ PAGOPA (Tassa regionale/annuale tesserino)
    const pagoPaSaved = readStorageJSON('pagopa_data', {});
    const annoCorrente = new Date().getFullYear();
    
    if (!pagoPaSaved.effettuato || parseInt(pagoPaSaved.anno) !== annoCorrente) {
        await appAlert("❌ Attenzione: Ricevuta PagoPA non valida o assente per l'anno in corso.\nÈ necessario regolarizzare il pagamento della tassa tesserino prima di registrare vendite.");
        openModule('pagopa');
        return;
    }

    // 3. CONTROLLO RICEVUTA F24 (Imposta sostitutiva 100€) - SCELTA AUTOMATICA REGIME
    const f24SavedData = readStorageJSON('f24_data', {});
    const f24InputVal = document.getElementById('r-f24') ? document.getElementById('r-f24').value.trim() : '';
    const protocolloF24 = f24InputVal || f24SavedData.protocollo;
    let dataPagamentoF24 = f24SavedData.dataPagamento ? new Date(f24SavedData.dataPagamento) : null;

    let f24Valido = false;
    if (protocolloF24 && dataPagamentoF24 && !isNaN(dataPagamentoF24.getTime())) {
        const scadenzaF24 = new Date(annoCorrente, 1, 16, 23, 59, 59); // 1 = Febbraio
        if (dataPagamentoF24 <= scadenzaF24) {
            f24Valido = true;
        }
    }

    let regimeScelto = f24Valido ? 'sostitutiva' : 'ritenuta';

    // 4. CONTROLLO OBBLIGATORIETÀ LUOGO / AREA DI RACCOLTA E PROVINCIA (Tracciabilità)
    const luogoRaccoltaInput = document.getElementById('r-comune');
    const luogoAreaRaccolta = luogoRaccoltaInput ? luogoRaccoltaInput.value.trim() : '';
    
    if (!luogoAreaRaccolta) {
        await appAlert("❌ Dato obbligatorio mancante!\nIl campo 'Luogo / Area di Raccolta e Provincia' è fondamentale per gli adempimenti della tracciabilità e non può essere lasciato vuoto.");
        if (luogoRaccoltaInput) luogoRaccoltaInput.focus();
        return;
    }

    // 5. GESTIONE ACQUIRENTE
    const acquirenteNome = (document.getElementById('r-acquirente') || {}).value?.trim() || '';
    const acquirenteCf = (document.getElementById('r-cf-acquirente') || {}).value?.trim() || '';
    const acquirenteIndirizzo = document.getElementById('r-indirizzo-acquirente') ? document.getElementById('r-indirizzo-acquirente').value.trim() : '';
    const acquirenteEmail = document.getElementById('r-email-acquirente') ? document.getElementById('r-email-acquirente').value.trim() : '';
    
    if (!acquirenteNome) {
        await appAlert("Inserisci il nome o la ragione sociale dell'acquirente.");
        return;
    }

    // 5b. METODO DI PAGAMENTO E COORDINATE BANCARIE
    const elMetodoPagamento = document.getElementById('r-metodo-pagamento');
    const metodoPagamento = elMetodoPagamento ? elMetodoPagamento.value : 'contanti';
    const ibanVenditore = metodoPagamento === 'bonifico' ? (document.getElementById('r-iban') || {}).value?.trim() || '' : '';
    const bancaVenditore = metodoPagamento === 'bonifico' ? (document.getElementById('r-banca') || {}).value?.trim() || '' : '';
    const intestatarioVenditore = metodoPagamento === 'bonifico' ? tData.nome || '' : '';
    const causaleVenditore = metodoPagamento === 'bonifico' ? (document.getElementById('r-causale') || {}).value?.trim() || '' : '';

    // 6. CALCOLI FINANZIARI
    const pesoGrammi = parseFloat((document.getElementById('pesoGrammi') || {}).value) || 0;
    const qualitaScelta = (document.getElementById('r-qualita') || {}).value || '';
    const importoTotale = parseFloat((document.getElementById('importoTotale') || {}).value) || 0;
    const dataOdierna = new Date().toLocaleDateString();
    
    let importoRitenuta = '0.00';
    let importoNetto = importoTotale.toFixed(2);

    if (regimeScelto === 'ritenuta') {
        const dettagliRitenuta = calcolaDettaglioRitenuta(importoTotale);
        importoRitenuta = dettagliRitenuta.ritenuta.toFixed(2);
        importoNetto = dettagliRitenuta.netto.toFixed(2);
    }

    // 6.1 ACQUISIZIONE NOTA E AGGIORNAMENTO AUTOMATICO RUBRICA CLIENTI
    const notaClienteInput = document.getElementById('r-nota-cliente');
    const notaClienteValore = notaClienteInput ? notaClienteInput.value.trim() : '';

    if (typeof salvaClienteInRubrica === 'function') {
        salvaClienteInRubrica({
            acquirente: acquirenteNome,
            cfAcquirente: acquirenteCf,
            indirizzoAcquirente: acquirenteIndirizzo,
            emailAcquirente: acquirenteEmail,
            totale: importoTotale,
            data: dataOdierna,
            nota: notaClienteValore // Passa correttamente la nota alla rubrica
        });
    }

    // 7. CALCOLO SOGLIA ANNUA (7000 €)
    let storico = readStorageJSON('storico_vendite', []);
    
    const statoSoglia = calcolaStatoSogliaVendite(storico, annoCorrente, importoTotale);
    const nuovoTotaleAnno = statoSoglia.nuovoTotaleAnno;
    const quantoManca = statoSoglia.quantoManca;

    if (statoSoglia.superato) {
        await appAlert(`❌ ATTENZIONE: Soglia di blocco di € 7.000 superata!\nIl totale annuo delle vendite raggiungerebbe € ${nuovoTotaleAnno.toFixed(2)}. Registrazione bloccata per limiti normativi.`);
        return;
    }

    const messaggioConservazioneCartacea =
        `Presa visione:\n\n` +
        `Anche se l'app salva i dati in memoria e crea backup automatici, ` +
        `è vivamente consigliato conservare una copia cartacea di ogni ricevuta.\n\n` +
        `Premi OK per confermare la presa visione e continuare.`;

    if (!(await appConfirm(messaggioConservazioneCartacea))) {
        return;
    }

    // 8. MESSAGGIO DI RIEPILOGO CON TRACCIABILITÀ E PRESA VISIONE
    const tipoRicevutaTesto = regimeScelto === 'sostitutiva' 
        ? "Imposta Sostitutiva (F24)" 
        : "Ritenuta d'Acconto (23% sul 78%)";

    const messaggioRiepilogo = 
        `📋 RIEPILOGO NUOVA RICEVUTA\n` +
        `----------------------------------------\n` +
        `• Luogo / Area di Raccolta e Provincia: ${luogoAreaRaccolta} [OBBLIGATORIO - TRACCIABILITÀ]\n` +
        `• Tipo Regime (Automatico): ${tipoRicevutaTesto}\n` +
        `• Importo Totale (Lordo): € ${importoTotale.toFixed(2)}\n` +
        `• Ritenuta applicata: € ${importoRitenuta}\n` +
        `• Importo Netto: € ${importoNetto}\n` +
        `----------------------------------------\n` +
        `• Totale vendite annue: € ${nuovoTotaleAnno.toFixed(2)} / € 7.000,00\n` +
        `• Mancante alla soglia di blocco: € ${quantoManca.toFixed(2)}\n\n` +
        `Premi OK per confermare la presa visione e registrare la vendita.`;

    if (!(await appConfirm(messaggioRiepilogo))) {
        return; 
    }
   
    // 9. REGISTRAZIONE NELLO STORICO VENDITE (Le note del cliente restano escluse dalla ricevuta stampata)
    const vendita = {
        venditoreNome: tData.nome, 
        venditoreCf: tData.cf, 
        venditoreTesserino: tData.num || 'N.D.', 
        venditoreRegione: tData.regione || 'N.D.',
        acquirente: acquirenteNome, 
        acquirenteCf: acquirenteCf,
        acquirenteIndirizzo: acquirenteIndirizzo,
        acquirenteEmail: acquirenteEmail,
        specie: (document.getElementById('r-specie') || {}).value || '', 
        qualita: qualitaScelta,
        peso: pesoGrammi, 
        importo: importoTotale.toFixed(2),
        regime: regimeScelto,
        ritenuta: importoRitenuta,
        netto: importoNetto,
        luogoRaccolta: luogoAreaRaccolta, 
        lotto: (document.getElementById('r-lotto') || {}).value?.trim() || '', 
        f24: regimeScelto === 'sostitutiva' ? protocolloF24 : 'ESENTE (Ritenuta d\'Acconto 23% su 78%)', 
        metodoPagamento,
        ibanVenditore,
        bancaVenditore,
        intestatarioVenditore,
        causaleVenditore,
        data: dataOdierna
    };
    
    storico.push(vendita);
    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    aggiungiLuogoRaccolta(luogoAreaRaccolta);
    
    const nuovoIndice = storico.length - 1;

    showToast("✔ Ricevuta registrata!", 'success');
    
    // 10. APERTURA DIRETTA DELLA VISUALIZZAZIONE
    if (typeof openModule === 'function') {
        openModule('storico_ricevute');
    }
    
    setTimeout(() => {
        if (typeof visualizzaRicevutaSalvata === 'function') {
            visualizzaRicevutaSalvata(nuovoIndice);
        }
    }, 100);
}

// Funzione di supporto per la gestione della rubrica con storico acquisti
function salvaClienteInRubrica(nuovaRicevuta) {
    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    
    const index = rubricaClienti.findIndex(c => c.nome.toLowerCase() === nuovaRicevuta.acquirente.toLowerCase());
    const importoRicevuta = parseFloat(nuovaRicevuta.totale) || 0;

    if (index !== -1) {
        rubricaClienti[index].totaleAcquisti = (parseFloat(rubricaClienti[index].totaleAcquisti) || 0) + importoRicevuta;
        rubricaClienti[index].numeroAcquisti = (rubricaClienti[index].numeroAcquisti || 0) + 1;
        rubricaClienti[index].dataUltimoAcquisto = nuovaRicevuta.data;
        if (nuovaRicevuta.cfAcquirente) rubricaClienti[index].cf = nuovaRicevuta.cfAcquirente;
        if (nuovaRicevuta.indirizzoAcquirente) rubricaClienti[index].indirizzo = nuovaRicevuta.indirizzoAcquirente;
        if (nuovaRicevuta.emailAcquirente) rubricaClienti[index].email = nuovaRicevuta.emailAcquirente;
        
        // Aggiorna la nota se compilata in fase di ricevuta
        if (nuovaRicevuta.nota) {
            rubricaClienti[index].nota = nuovaRicevuta.nota;
        }
    } else {
        rubricaClienti.push({
            nome: nuovaRicevuta.acquirente,
            cf: nuovaRicevuta.cfAcquirente || '',
            indirizzo: nuovaRicevuta.indirizzoAcquirente || '',
            email: nuovaRicevuta.emailAcquirente || '',
            totaleAcquisti: importoRicevuta,
            numeroAcquisti: 1,
            dataUltimoAcquisto: nuovaRicevuta.data,
            nota: nuovaRicevuta.nota || '' 
        });
    }

    localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
}

function visualizzaRicevutaSalvata(index) {
    const storico = readStorageJSON('storico_vendite', []);
    const v = storico[index];
    if(!v) return;
    const safeReceipt = sanitizeRenderable(v);
    const importoNumerico = parseFloat(v.importo) || 0;

    const isRitenuta = v.regime === 'ritenuta';
    
    // Dati fiscali pronti per essere inseriti alla fine dei dettagli
    const dettagliRitenutaRicevuta = calcolaDettaglioRitenuta(importoNumerico);
    const dettagliFiscoHtml = isRitenuta ? `
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #ccc;">
            <p><strong>Regime Fiscale:</strong> Ritenuta d'Acconto del 23% (esonerata dall'imposta sostitutiva)</p>
            <p><strong>Compenso Lordo:</strong> € ${safeReceipt.importo}</p>
            <p><strong>Ritenuta d'Acconto (23%):</strong> € ${safeReceipt.ritenuta || dettagliRitenutaRicevuta.ritenuta.toFixed(2)}</p>
            <p style="font-size: 1.05rem; margin-top: 5px; color: #16a34a;"><strong>Totale Ricevuta:</strong> € ${safeReceipt.netto || dettagliRitenutaRicevuta.netto.toFixed(2)}</p>
        </div>
    ` : `
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #ccc;">
            <p><strong>Regime Fiscale:</strong> Imposta Sostitutiva (Legge 145/2018)</p>
            <p><strong>Versamento F24 ELIDE (100€):</strong> Protocollo N. ${safeReceipt.f24}</p>
            <p style="font-size: 1.05rem; margin-top: 5px; color: #16a34a;"><strong>Totale Ricevuta:</strong> € ${safeReceipt.importo}</p>
        </div>
    `;

    const isBonifico = v.metodoPagamento === 'bonifico';
    const metodoPagamentoLabel = isBonifico ? 'Bonifico Bancario' : 'Contanti';
    const coordinateBancarieHtml = isBonifico ? `
        <div style="margin-top: 12px; padding: 10px; border: 1px dashed #ccc; border-radius: 4px;">
            <p><strong>Modalità di Pagamento:</strong> Bonifico Bancario</p>
            ${safeReceipt.intestatarioVenditore ? `<p><strong>Intestatario:</strong> ${safeReceipt.intestatarioVenditore}</p>` : ''}
            ${safeReceipt.ibanVenditore ? `<p><strong>IBAN:</strong> ${safeReceipt.ibanVenditore}</p>` : ''}
            ${safeReceipt.bancaVenditore ? `<p><strong>Banca:</strong> ${safeReceipt.bancaVenditore}</p>` : ''}
            ${safeReceipt.causaleVenditore ? `<p><strong>Causale:</strong> ${safeReceipt.causaleVenditore}</p>` : ''}
        </div>
    ` : `<p style="margin-top: 8px;"><strong>Modalità di Pagamento:</strong> ${metodoPagamentoLabel}</p>`;

    const ritenutaImportoF24 = safeReceipt.ritenuta ? parseFloat(safeReceipt.ritenuta).toFixed(2) : dettagliRitenutaRicevuta.ritenuta.toFixed(2);
    const baseImponibileF24 = safeReceipt.importo
        ? (parseFloat(safeReceipt.importo) * 0.78).toFixed(2)
        : dettagliRitenutaRicevuta.baseImponibile.toFixed(2);
    const dataVenditaF24 = (() => {
        try {
            const parts = (v.data || '').split('/');
            if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        } catch (_e) { /* ignore */ }
        return new Date();
    })();
    const meseRiferimento = String(dataVenditaF24.getMonth() + 1).padStart(2, '0');
    const annoRiferimento = String(dataVenditaF24.getFullYear());
    const mesePagamentoScadenza = dataVenditaF24.getMonth() + 1 === 12 ? 1 : dataVenditaF24.getMonth() + 2;
    const annoPagamentoScadenza = dataVenditaF24.getMonth() + 1 === 12 ? dataVenditaF24.getFullYear() + 1 : dataVenditaF24.getFullYear();
    const nomiMesi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    const scadenzaF24Testo = `16 ${nomiMesi[mesePagamentoScadenza - 1]} ${annoPagamentoScadenza}`;
    const periodoRiferimentoF24 = `${meseRiferimento}/${annoRiferimento}`;
    const f24TableStyle = 'width:100%; border-collapse:collapse; table-layout:fixed; font-size:0.82rem; color:#222; margin-bottom:14px;';
    const f24LabelCellStyle = 'padding:5px 8px; font-weight:bold; width:38%; vertical-align:top; white-space:normal; overflow-wrap:anywhere; word-break:break-word;';
    const f24ValueCellStyle = 'padding:5px 8px; vertical-align:top; white-space:normal; overflow-wrap:anywhere; word-break:break-word;';

    const paginaCortesiaRitenutaHtml = isRitenuta ? `
        <div class="module-card" style="background:#fff; color:#000; padding:20px; border-radius:8px; margin-top:0; width:100%; box-sizing:border-box; page-break-before:always; break-before:page;">
            <h3 style="margin-bottom: 10px; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Pagina di Cortesia per l'Acquirente — Adempimenti Ritenuta d'Acconto</h3>
            <p style="margin-bottom:8px;"><strong>Questa pagina è un promemoria operativo per l'acquirente.</strong> Le scadenze possono subire proroghe: verificare sempre con il proprio consulente fiscale.</p>

            <h4 style="margin: 12px 0 6px 0; font-size: 0.95rem; color: #1a56db;">📋 Dati per la Compilazione del Modello F24 — Ritenuta d'Acconto</h4>
            <table style="${f24TableStyle}">
                <tbody>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Modello</td>
                        <td style="${f24ValueCellStyle}">F24</td>
                    </tr>
                    <tr>
                        <td style="${f24LabelCellStyle}">Sezione</td>
                        <td style="${f24ValueCellStyle}">Erario</td>
                    </tr>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Codice Tributo</td>
                        <td style="${f24ValueCellStyle}; font-weight:bold; color:#1a56db;">1040</td>
                    </tr>
                    <tr>
                        <td style="${f24LabelCellStyle}">Descrizione Tributo</td>
                        <td style="${f24ValueCellStyle}">Ritenute su redditi di lavoro autonomo occasionale (art. 25 DPR 600/73)</td>
                    </tr>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Anno di Riferimento</td>
                        <td style="${f24ValueCellStyle}">${annoRiferimento}</td>
                    </tr>
                    <tr>
                        <td style="${f24LabelCellStyle}">Periodo di Riferimento</td>
                        <td style="${f24ValueCellStyle}">${periodoRiferimentoF24}</td>
                    </tr>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Compenso Lordo Erogato</td>
                        <td style="${f24ValueCellStyle}">€ ${safeReceipt.importo}</td>
                    </tr>
                    <tr>
                        <td style="${f24LabelCellStyle}">Base Imponibile (78%)</td>
                        <td style="${f24ValueCellStyle}">€ ${baseImponibileF24}</td>
                    </tr>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Importo a Debito (Ritenuta 23%)</td>
                        <td style="${f24ValueCellStyle}; font-weight:bold; color:#c0392b;">€ ${ritenutaImportoF24}</td>
                    </tr>
                    <tr>
                        <td style="${f24LabelCellStyle}">Scadenza Versamento</td>
                        <td style="${f24ValueCellStyle}; font-weight:bold;">Entro il ${scadenzaF24Testo} (salvo proroghe)</td>
                    </tr>
                    <tr style="background:#f0f4ff;">
                        <td style="${f24LabelCellStyle}">Contribuente (Acquirente — Sostituto d'imposta)</td>
                        <td style="${f24ValueCellStyle}">${safeReceipt.acquirente}${safeReceipt.acquirenteCf ? ' — CF/P.IVA: ' + safeReceipt.acquirenteCf : ''}</td>
                    </tr>
                </tbody>
            </table>

            <h4 style="margin: 12px 0 6px 0; font-size: 0.95rem; color: #333;">Adempimenti Successivi</h4>
            <ol style="padding-left:18px; line-height:1.45;">
                <li style="margin-bottom:8px;"><strong>Autofattura / documento di acquisto da privato:</strong> registrare correttamente l'acquisto del tartufo da raccoglitore occasionale con i dati della ricevuta.</li>
                <li style="margin-bottom:8px;"><strong>Pagamento ritenuta con F24:</strong> versare la ritenuta d'acconto (€ ${ritenutaImportoF24}) utilizzando i dati della tabella sopra, entro il ${scadenzaF24Testo}.</li>
                <li style="margin-bottom:8px;"><strong>Certificazione Unica (CU):</strong> predisporre e rilasciare al tartufaio la CU dei compensi/ritenute entro il 16 marzo dell'anno successivo (salvo proroghe).</li>
                <li style="margin-bottom:8px;"><strong>Modello 770:</strong> includere i dati delle ritenute operate nel modello 770 con invio telematico entro la scadenza annuale prevista (tipicamente 31 ottobre, salvo proroghe).</li>
                <li style="margin-bottom:0;"><strong>Promemoria consegna CU al tartufaio:</strong> ricordare la consegna della certificazione unica al venditore entro i termini, conservando prova della trasmissione.</li>
            </ol>
        </div>
    ` : '';

    // Supporto per retrocompatibilità con vecchie ricevute salvate come v.comune
    const luogoAreaVisualizzazione = safeReceipt.luogoRaccolta || safeReceipt.comune || 'Non specificato';

    let activeView = document.getElementById('active-module-view');
    activeView.querySelector('.module-body-content').innerHTML = `
        <div id="ricevuta-${index}">
            <h2>RICEVUTA VENDITA OCCASIONALE N. ${index + 1}</h2>
            <p>Conforme a Legge 145/2018, Reg. CE 178/02 & DPR 633/1972</p>
            <div class="module-card" style="background:#fff; color:#000; padding:20px; border-radius:8px;">
                <p style="font-size: 0.72rem; color: #444; text-align: justify; margin-bottom: 15px; border-bottom: 1px dashed #ccc; padding-bottom: 8px; line-height: 1.3;">
                    <strong>DICHIARAZIONE DI CESSIONE OCCASIONALE E TRACCIABILITÀ:</strong> 
                    Operazione effettuata nell'ambito della raccolta hobbistica/occasionale dei tartufi, esonerata dall'obbligo di emissione di fattura elettronica e di certificazione fiscale ai sensi dell'art. 34, comma 6, del DPR n. 633/1972 e s.m.i., nonché in conformità alle disposizioni di cui alla Legge 30 dicembre 2018, n. 145. Si attesta inoltre la piena tracciabilità del prodotto alimentare ai sensi degli artt. 18 e 19 del Regolamento (CE) n. 178/2002.
                </p>
                
                <h3 style="margin-bottom: 10px; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dati del Venditore (Cessionario occasionale)</h3>
                <p><strong>Nome e Cognome:</strong> ${safeReceipt.venditoreNome}</p>
                <p><strong>Codice Fiscale:</strong> ${safeReceipt.venditoreCf}</p>
                <p><strong>Tesserino Raccolta N.:</strong> ${safeReceipt.venditoreTesserino} - <strong>Rilasciato dalla Regione:</strong> ${safeReceipt.venditoreRegione}</p>
                
                <h3 style="margin: 15px 0 10px 0; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dati dell'Acquirente</h3>
                <p><strong>Acquirente:</strong> ${safeReceipt.acquirente}</p>
                <p><strong>P.IVA / Codice Fiscale:</strong> ${safeReceipt.acquirenteCf || 'Non inserito'}</p>
                <p><strong>Indirizzo:</strong> ${safeReceipt.acquirenteIndirizzo || 'Non inserito'}</p>
                <p><strong>Email:</strong> ${safeReceipt.acquirenteEmail || 'Non specificata'}</p>
                
                <h3 style="margin: 15px 0 10px 0; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dettagli Ricevuta e Tracciabilità</h3>
                <p><strong>Specie di Tartufo:</strong> ${safeReceipt.specie}</p>
                <p><strong>Classificazione Qualità:</strong> ${safeReceipt.qualita || 'Non specificata'}</p>
                <p><strong>Peso:</strong> ${safeReceipt.peso} grammi</p>
                <p><strong>Luogo / Area di Raccolta e Provincia:</strong> ${luogoAreaVisualizzazione}</p>
                <p><strong>Codice Lotto / Tracciabilità:</strong> ${safeReceipt.lotto}</p>
                
                ${dettagliFiscoHtml}

                ${coordinateBancarieHtml}

                <p style="margin-top: 10px;"><strong>Data Vendita:</strong> ${safeReceipt.data}</p>

                <div style="margin-top: 30px; display: flex; justify-content: space-between; page-break-inside: avoid;">
                    <div style="width: 45%; text-align: center;">
                        <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;"></div>
                        <p style="font-size: 0.85rem;">Firma dell'Acquirente</p>
                    </div>
                    <div style="width: 45%; text-align: center;">
                        <div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 5px;"></div>
                        <p style="font-size: 0.85rem;">Firma del Venditore (Cessionario)</p>
                    </div>
                </div>
            </div>
            ${paginaCortesiaRitenutaHtml}
        </div>
        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('printPage')}>🖨️ Stampa / Salva PDF Conforme</button>
        <button class="overlay-btn btn-info btn-full" style="margin-top:10px;" ${actionAttrs('condividiRicevuta', [index])}>📤 Condividi Ricevuta (WhatsApp)</button>
        <button class="overlay-btn btn-success btn-full" style="margin-top:10px;" ${actionAttrs('condividiRicevutaEmail', [index])}>📧 Condividi / Invia Email (${safeReceipt.acquirenteEmail || 'Email non inserita'})</button>
        <button class="overlay-btn btn-neutral btn-full" style="margin-top:10px;" ${actionAttrs('chiudiDettaglioRicevuta')}>← Torna all'Archivio</button>
    `;
}

async function eliminaRicevutaConDoppiaConferma(index) {
    const primaConferma = await appConfirm("Sei sicuro di voler eliminare questa ricevuta dallo storico?");
    if (primaConferma) {
        const secondaConferma = await appConfirm("ATTENZIONE: L'operazione è irreversibile. Vuoi davvero confermare l'eliminazione definitiva?");
        if (secondaConferma) {
            let storico = readStorageJSON('storico_vendite', []);
            storico.splice(index, 1);
            localStorage.setItem('storico_vendite', JSON.stringify(storico));
            showToast("Ricevuta eliminata.", 'info');
            openModule('storico_ricevute');
        }
    }
}

function modificaRicevuta(index) {
    const storico = readStorageJSON('storico_vendite', []);
    const v = storico[index];
    if (!v) return;

    openModule('ricevute');

    setTimeout(() => {
        const elRegime = document.getElementById('r-regime');
        const elAcquirente = document.getElementById('r-acquirente');
        const elCf = document.getElementById('r-cf-acquirente');
        const elSpecie = document.getElementById('r-specie');
        const elQualita = document.getElementById('r-qualita');
        const elPeso = document.getElementById('pesoGrammi');
        const elPrezzoKg = document.getElementById('prezzoKg');
        const elImporto = document.getElementById('importoTotale');
        const elComune = document.getElementById('r-comune');
        const elLotto = document.getElementById('r-lotto');
        const elF24 = document.getElementById('r-f24');

        if (elRegime) { elRegime.value = v.regime || 'sostitutiva'; toggleRegimeFiscaleFields(); }
        if (elAcquirente) elAcquirente.value = v.acquirente || '';
        if (elCf) elCf.value = v.acquirenteCf || '';
        if (elSpecie) elSpecie.value = v.specie || '';
        if (elQualita) elQualita.value = v.qualita || 'Prima Scelta';
        if (elPeso) elPeso.value = v.peso || '';
        if (elImporto) { elImporto.value = v.importo || ''; calcolaRitenutaAcconto(); }
        if (elComune) {
            if (v.comune && !Array.from(elComune.options).some(o => o.value === v.comune)) {
                elComune.innerHTML = buildLuoghiSelectOptions(v.comune);
            }
            elComune.value = v.comune || '';
        }
        if (elLotto) elLotto.value = v.lotto || '';
        if (elF24) elF24.value = v.f24 || '';

        const elMetodo = document.getElementById('r-metodo-pagamento');
        if (elMetodo) {
            elMetodo.value = v.metodoPagamento || 'contanti';
            toggleCoordinateBancarie();
            if (v.metodoPagamento === 'bonifico') {
                const elIban = document.getElementById('r-iban');
                const elBanca = document.getElementById('r-banca');
                const elCausale = document.getElementById('r-causale');
                if (elIban) elIban.value = v.ibanVenditore || '';
                if (elBanca) elBanca.value = v.bancaVenditore || '';
                if (elCausale) elCausale.value = v.causaleVenditore || '';
            }
        }

        const btnRegistra = document.querySelector('#active-module-view button[data-action="registerRicevutaSafe"]');

        if (btnRegistra) {
            btnRegistra.innerText = "Aggiorna Ricevuta Esistente";
            btnRegistra.setAttribute('data-action', 'salvaModificaRicevuta');
            btnRegistra.setAttribute('data-action-args', JSON.stringify([index]));
        }
    }, 50);
}
function salvaModificaRicevuta(index) {
    let storico = readStorageJSON('storico_vendite', []);
    const tData = readStorageJSON('tesserino_data', {});
    const f24SavedData = readStorageJSON('f24_data', {});
    
    const acquirenteNome = (document.getElementById('r-acquirente') || {}).value?.trim() || '';
    if (!acquirenteNome) {
        showToast("Inserisci il nome dell'acquirente.", 'error');
        return;
    }

    let regimeScelto = document.getElementById('r-regime') ? document.getElementById('r-regime').value : 'sostitutiva';
    const f24InputVal = document.getElementById('r-f24') ? document.getElementById('r-f24').value.trim() : '';
    const protocolloF24 = f24InputVal || f24SavedData.protocollo;

    if (regimeScelto === 'sostitutiva' && !protocolloF24) {
        regimeScelto = 'ritenuta';
    }

    const importoCorrente = parseFloat((document.getElementById('importoTotale') || {}).value) || 0;
    const dettagliRitenuta = calcolaDettaglioRitenuta(importoCorrente);
    const importoRitenuta = regimeScelto === 'ritenuta' ? dettagliRitenuta.ritenuta.toFixed(2) : '0.00';
    const importoNetto = regimeScelto === 'ritenuta' ? dettagliRitenuta.netto.toFixed(2) : importoCorrente.toFixed(2);

    storico[index] = {
        venditoreNome: tData.nome || storico[index].venditoreNome, 
        venditoreCf: tData.cf || storico[index].venditoreCf, 
        venditoreTesserino: tData.num || storico[index].venditoreTesserino, 
        venditoreRegione: tData.regione || storico[index].venditoreRegione,
        acquirente: acquirenteNome, 
        acquirenteCf: (document.getElementById('r-cf-acquirente') || {}).value?.trim() || '',
        specie: (document.getElementById('r-specie') || {}).value || '',
        qualita: (document.getElementById('r-qualita') || {}).value || '',
        peso: (document.getElementById('pesoGrammi') || {}).value || '',
        importo: importoCorrente.toFixed(2),
        regime: regimeScelto,
        ritenuta: importoRitenuta,
        netto: importoNetto,
        comune: (document.getElementById('r-comune') || {}).value?.trim() || '',
        lotto: (document.getElementById('r-lotto') || {}).value?.trim() || '',
        f24: regimeScelto === 'sostitutiva' ? protocolloF24 : 'ESENTE (Ritenuta d\'Acconto)',
        metodoPagamento: (document.getElementById('r-metodo-pagamento') || {}).value || storico[index].metodoPagamento || 'contanti',
        ibanVenditore: (document.getElementById('r-iban') || {}).value?.trim() || storico[index].ibanVenditore || '',
        bancaVenditore: (document.getElementById('r-banca') || {}).value?.trim() || storico[index].bancaVenditore || '',
        intestatarioVenditore: storico[index].intestatarioVenditore || tData.nome || '',
        causaleVenditore: (document.getElementById('r-causale') || {}).value?.trim() || storico[index].causaleVenditore || '',
        data: storico[index].data
    };

    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    aggiungiLuogoRaccolta((document.getElementById('r-comune') || {}).value?.trim() || '');
    showToast("Ricevuta aggiornata!", 'success');
    openModule('storico_ricevute');
}

function salvaLuogoRaccoltaNuovo() {
    const input = document.getElementById('nuovo-luogo-input');
    const val = input ? input.value.trim() : '';
    if (!val) { showToast('Inserisci un luogo valido.', 'error'); return; }
    const lista = readStorageJSON('luoghi_raccolta', []);
    if (lista.includes(val)) { showToast('Luogo già presente.', 'warning'); return; }
    aggiungiLuogoRaccolta(val);
    showToast('Luogo aggiunto!', 'success');
    openModule('archivio_luoghi');
}

function eliminaLuogoRaccoltaDaArchivio(index) {
    const lista = readStorageJSON('luoghi_raccolta', []);
    if (index < 0 || index >= lista.length) return;
    lista.splice(index, 1);
    localStorage.setItem('luoghi_raccolta', JSON.stringify(lista));
    showToast('Luogo eliminato.', 'success');
    openModule('archivio_luoghi');
}

function aggiornaLuogoRaccoltaInArchivio(index) {
    const lista = readStorageJSON('luoghi_raccolta', []);
    if (index < 0 || index >= lista.length) return;
    const input = document.getElementById(`luogo-edit-${index}`);
    const val = input ? input.value.trim() : '';
    if (!val) { showToast('Il luogo non può essere vuoto.', 'error'); return; }
    lista[index] = val;
    lista.sort((a, b) => a.localeCompare(b, 'it'));
    localStorage.setItem('luoghi_raccolta', JSON.stringify(lista));
    showToast('Luogo aggiornato!', 'success');
    openModule('archivio_luoghi');
}

async function condividiRicevuta(index) {
    const storico = readStorageJSON('storico_vendite', []);
    const v = storico[index];
    if(!v) return;

    const testoMessaggio = `📄 RICEVUTA VENDITA OCCASIONALE N. ${index + 1}\n` +
        `Data: ${v.data}\n` +
        `Venditore: ${v.venditoreNome} (CF: ${v.venditoreCf})\n` +
        `Acquirente: ${v.acquirente}\n` +
        `Specie: ${v.specie} (${v.peso}g)\n` +
        `Importo: € ${v.importo}\n` +
        `Comune: ${v.comune} | Lotto: ${v.lotto}`;

    if (navigator.share) {
        try {
            if (typeof html2pdf !== 'undefined') {
                const element = document.querySelector('.module-card');
                const options = {
                    margin: 10,
                    filename: `Ricevuta_${index + 1}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                
                const pdfBlob = await html2pdf().from(element).set(options).output('blob');
                const file = new File([pdfBlob], `Ricevuta_${index + 1}.pdf`, { type: 'application/pdf' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title: `Ricevuta N. ${index + 1}`,
                        text: testoMessaggio,
                        files: [file]
                    });
                    return;
                }
            }
            
            await navigator.share({
                title: `Ricevuta N. ${index + 1}`,
                text: testoMessaggio
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.log("Condivisione annullata o non riuscita", err);
            }
        }
    } else {
        const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(testoMessaggio)}`;
        window.location.href = whatsappUrl;
    }
}

function chiudiDettaglioRicevuta() {
    openModule('storico_ricevute');
}

function esportaDatiCSV() {
    const storico = readStorageJSON('storico_vendite', []);
    if(storico.length === 0) { 
        showToast("Nessuna vendita registrata.", 'info'); 
        return; 
    }
    
    let csvContent = "data:text/csv;charset=utf-8,Data,Acquirente,Specie,Peso (g),Importo (€),Regime\n";
    
    storico.forEach(r => {
        const row = [
            `"${r.data || ''}"`,
            `"${(r.acquirente || '').replace(/"/g, '""')}"`,
            `"${(r.specie || '').replace(/"/g, '""')}"`,
            r.peso || 0,
            r.importo || 0,
            `"${r.regime || 'sostitutiva'}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `contabilita_tartufi_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function mostraRicevuteCliente(nomeCliente) {
    // Salva il filtro attivo nel localStorage
    localStorage.setItem('filtro_storico_cliente', nomeCliente);
    
    // Apre il modulo dello storico ricevute
    if (typeof openModule === 'function') {
        openModule('storico_ricevute');
    }
}

function mostraRicevuteClienteByIndex(index) {
    const rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const cliente = rubricaClienti[index];
    if (!cliente || !cliente.nome) return;
    mostraRicevuteCliente(cliente.nome);
}

function buildCompleteBackupData() {
    return { 
        tesserino: localStorage.getItem('tesserino_data'), 
        pagopa: localStorage.getItem('pagopa_data'),
        archivioDocumentiList: localStorage.getItem('archivio_documenti_list'),
        f24: localStorage.getItem('f24_data'),
        storicoVendite: localStorage.getItem('storico_vendite'), 
        luoghiRaccolta: localStorage.getItem('luoghi_raccolta'),
        archivioLuoghiRaccolta: localStorage.getItem('luoghi_raccolta'),
        archivioAreeLuoghiRaccolta: localStorage.getItem('luoghi_raccolta'),
        poiList: localStorage.getItem('poi_list'),
        dogsList: localStorage.getItem('dogs_list'),
        caneData: localStorage.getItem('cane_data'),
        polizzeList: localStorage.getItem('polizze_list'),
        storicoRaccolta: localStorage.getItem('storico_raccolta_giornaliera'),
        rubricaClienti: localStorage.getItem('rubrica_clienti'),
        speseList: localStorage.getItem('spese_list'),
        vetHistoryList: localStorage.getItem('vet_history_list'),
        heatDiaryList: localStorage.getItem('heat_diary_list'),
        vetClinicsList: localStorage.getItem('vet_clinics_list'),
        calendariTartufiCustom: localStorage.getItem('calendari_tartufi_custom'),
        noteRegionaliTartufi: localStorage.getItem('note_regionali_tartufi'),
        offlineRegioniPreferite: localStorage.getItem(OFFLINE_REGIONI_PREFERITE_KEY),
        backupDirLabel: localStorage.getItem(_BACKUP_DIR_LABEL_KEY)
    };
}

function formatBackupTimestamp(isoDate) {
    if (!isoDate) return 'n/d';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'n/d';
    return date.toLocaleString('it-IT');
}

let lastAutomaticBackupSavedAt = null;
const _BACKUP_DIR_HANDLE_KEY = 'backup_dir_handle';
const _BACKUP_DIR_LABEL_KEY = 'backup_dir_label';

function getAutomaticBackupDestinationLabel() {
    return localStorage.getItem(_BACKUP_DIR_LABEL_KEY) || null;
}

function setAutomaticBackupDestinationLabel(label) {
    if (label) {
        TruffleStorage.setItemSilent(_BACKUP_DIR_LABEL_KEY, label);
    } else {
        TruffleStorage.removeItemSilent(_BACKUP_DIR_LABEL_KEY);
    }
    syncAutomaticBackupDestinationUI();
}

function syncAutomaticBackupDestinationUI() {
    const destinationEl = document.getElementById('local-backup-destination');
    if (!destinationEl) return;
    const label = getAutomaticBackupDestinationLabel();
    destinationEl.textContent = label
        ? `Percorso backup registrato: ${label}`
        : 'Percorso backup registrato: non configurato';
}

function syncAutomaticBackupStatusUI() {
    const statusEl = document.getElementById('local-backup-status');
    if (!statusEl) return;
    if (!lastAutomaticBackupSavedAt) {
        statusEl.textContent = 'Stato ultimo backup automatico: non disponibile';
        return;
    }
    statusEl.textContent = `Stato ultimo backup automatico: OK - ${formatBackupTimestamp(lastAutomaticBackupSavedAt)}`;
}

let _automaticBackupDirHandle = null;

async function _loadBackupDirHandle() {
    if (_automaticBackupDirHandle) return _automaticBackupDirHandle;
    try {
        const handle = await TruffleStorage.loadDirectoryHandle(_BACKUP_DIR_HANDLE_KEY);
        if (handle) _automaticBackupDirHandle = handle;
    } catch {
        // IndexedDB unavailable or handle not yet saved
    }
    return _automaticBackupDirHandle;
}

function _matchesDirectoryName(handle, expectedName) {
    return Boolean(handle && typeof handle.name === 'string' && handle.name.toLowerCase() === expectedName.toLowerCase());
}

function _normalizeAutomaticBackupDestinationLabel(destinationLabel) {
    const currentLabel = getAutomaticBackupDestinationLabel();
    if (destinationLabel === AUTOMATIC_BACKUP_FILES_FOLDER_NAME && currentLabel) {
        return currentLabel;
    }
    return destinationLabel;
}

async function _resolveAutomaticBackupDirectory(selectedDirHandle) {
    if (_matchesDirectoryName(selectedDirHandle, AUTOMATIC_BACKUP_FILES_FOLDER_NAME)) {
        return {
            backupDirHandle: selectedDirHandle,
            destinationLabel: AUTOMATIC_BACKUP_FILES_FOLDER_NAME
        };
    }

    if (_matchesDirectoryName(selectedDirHandle, AUTOMATIC_BACKUP_APP_FOLDER_NAME)) {
        const backupDirHandle = await selectedDirHandle.getDirectoryHandle(AUTOMATIC_BACKUP_FILES_FOLDER_NAME, { create: true });
        return {
            backupDirHandle,
            destinationLabel: `${AUTOMATIC_BACKUP_APP_FOLDER_NAME}/${AUTOMATIC_BACKUP_FILES_FOLDER_NAME}`
        };
    }

    const appDirHandle = await selectedDirHandle.getDirectoryHandle(AUTOMATIC_BACKUP_APP_FOLDER_NAME, { create: true });
    const backupDirHandle = await appDirHandle.getDirectoryHandle(AUTOMATIC_BACKUP_FILES_FOLDER_NAME, { create: true });
    return {
        backupDirHandle,
        destinationLabel: buildAutomaticBackupPathLabel(selectedDirHandle.name)
    };
}

async function configureAutomaticBackupFolder(forceReselect = false) {
    if (!window.showDirectoryPicker) {
        await appAlert("Il browser non supporta la scelta guidata della cartella backup. Verrà usato il download standard del file.");
        return null;
    }

    try {
        let selectedDirHandle = forceReselect ? null : await _loadBackupDirHandle();
        if (!selectedDirHandle) {
            await appAlert(
                `📁 Configurazione backup automatico\n\n` +
                `1. Seleziona la cartella Download del dispositivo.\n` +
                `2. L'app creerà (o riutilizzerà) automaticamente il percorso ${buildAutomaticBackupPathLabel('Download')}.\n` +
                `3. Il file backup_truffle_automatico.json verrà salvato sempre lì e il percorso sarà registrato.`
            );
            selectedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } else {
            const permission = await selectedDirHandle.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                _automaticBackupDirHandle = null;
                await TruffleStorage.saveDirectoryHandle(_BACKUP_DIR_HANDLE_KEY, null).catch(() => {});
                setAutomaticBackupDestinationLabel(null);
                await appAlert("⚠️ Permesso negato\n\nNon posso più usare la cartella backup registrata. Seleziona di nuovo la cartella Download per ricreare il percorso guidato.");
                selectedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            }
        }

        const { backupDirHandle, destinationLabel } = await _resolveAutomaticBackupDirectory(selectedDirHandle);
        const normalizedDestinationLabel = _normalizeAutomaticBackupDestinationLabel(destinationLabel);
        _automaticBackupDirHandle = backupDirHandle;
        await TruffleStorage.saveDirectoryHandle(_BACKUP_DIR_HANDLE_KEY, backupDirHandle);
        setAutomaticBackupDestinationLabel(normalizedDestinationLabel);
        return { backupDirHandle, destinationLabel: normalizedDestinationLabel };
    } catch (error) {
        if (error && error.name === 'AbortError') {
            return null;
        }
        _automaticBackupDirHandle = null;
        await TruffleStorage.saveDirectoryHandle(_BACKUP_DIR_HANDLE_KEY, null).catch(() => {});
        setAutomaticBackupDestinationLabel(null);
        await appAlert("⚠️ Cartella backup non disponibile\n\nLa cartella selezionata non è accessibile. Reimposta la cartella Download per registrare di nuovo il percorso guidato.");
        return null;
    }
}

async function chooseAutomaticBackupFolder() {
    const configuredFolder = await configureAutomaticBackupFolder(true);
    if (configuredFolder) {
        showToast(`Cartella backup registrata: ${configuredFolder.destinationLabel}.`, 'success');
    }
}

async function downloadBackupFile(data, { automatic = false } = {}) {
    const jsonStr = JSON.stringify(data, null, 2);
    const fileName = 'backup_truffle_automatico.json';

    if (window.showDirectoryPicker) {
        let backupDirHandle = null;
        if (automatic) {
            // In automatic mode never open pickers: use only the already-granted handle.
            const storedDirHandle = await _loadBackupDirHandle();
            if (storedDirHandle) {
                try {
                    // Use queryPermission to avoid triggering a browser prompt (requestPermission
                    // may require a user gesture on some browsers).
                    const permission = await storedDirHandle.queryPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        const resolvedDirectory = await _resolveAutomaticBackupDirectory(storedDirHandle);
                        backupDirHandle = resolvedDirectory.backupDirHandle;
                        _automaticBackupDirHandle = backupDirHandle;
                        await TruffleStorage.saveDirectoryHandle(_BACKUP_DIR_HANDLE_KEY, backupDirHandle).catch(() => {});
                        setAutomaticBackupDestinationLabel(_normalizeAutomaticBackupDestinationLabel(resolvedDirectory.destinationLabel));
                    } else {
                        return 'needs_reauth';
                    }
                } catch {
                    // Permission check unavailable — exit silently without any fallback
                }
            }
        } else {
            const configuredFolder = await configureAutomaticBackupFolder();
            if (!configuredFolder) {
                return false;
            }
            backupDirHandle = configuredFolder.backupDirHandle;
        }

        if (backupDirHandle) {
            try {
                const fileHandle = await backupDirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable({ keepExistingData: false });
                await writable.write(jsonStr);
                await writable.close();
                lastAutomaticBackupSavedAt = new Date().toISOString();
                syncAutomaticBackupStatusUI();
                await TruffleStorage.saveAutomaticBackupSnapshot(data, automatic ? 'automatic' : 'manual').catch(() => {});
                return true;
            } catch (err) {
                // In automatic mode: surface permission errors for reauth; exit silently for other errors.
                // In manual mode propagate so the caller can show a clear error.
                if (!automatic) {
                    throw err;
                }
                if (err && err.name === 'NotAllowedError') {
                    return 'needs_reauth';
                }
            }
        }
    }

    // In automatic mode, skip anchor download to avoid unexpected browser dialogs.
    if (automatic) return false;

    // Fallback: anchor download
    const dataStr = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    lastAutomaticBackupSavedAt = new Date().toISOString();
    syncAutomaticBackupStatusUI();
    await TruffleStorage.saveAutomaticBackupSnapshot(data, 'manual').catch(() => {});
    return true;
}

async function forceLocalBackupNow() {
    try {
        const backupData = buildCompleteBackupData();
        const backupSaved = await downloadBackupFile(backupData, { automatic: false });
        if (!backupSaved) {
            showToast("Backup non completato.", 'info');
            return;
        }
        lastAutomaticBackupFingerprint = JSON.stringify(backupData);
        const destinationLabel = getAutomaticBackupDestinationLabel();
        showToast(destinationLabel ? `Backup salvato in ${destinationLabel}.` : "Backup salvato.", 'success');
    } catch (err) {
        const reason = (err && err.message) ? `: ${err.message}` : '';
        showToast(`Errore durante il salvataggio del backup${reason}`, 'error');
    }
}

async function archiviaAnnoPrecedente() {
    const annoPrecedente = new Date().getFullYear() - 1;

    const riepilogo = await appConfirm(
        `Archiviazione anno ${annoPrecedente}\n\n` +
        `Questa operazione creerà un file di backup JSON con tutti i dati dell'anno ${annoPrecedente} ` +
        `(ricevute vendita, registro raccolta, spese) e li rimuoverà dall'app.\n\n` +
        `Assicurati di salvare il file scaricato prima di procedere.\n\nConfermi?`
    );
    if (!riepilogo) return;

    function getYearFromDateStr(dateStr) {
        if (!dateStr) return null;
        if (String(dateStr).includes('/')) {
            const parts = String(dateStr).split('/');
            return parseInt(parts[parts.length - 1], 10);
        }
        return parseInt(String(dateStr).slice(0, 4), 10);
    }

    const storicoVendite = readStorageJSON('storico_vendite', []);
    const storicoRaccolta = readStorageJSON('storico_raccolta_giornaliera', []);
    const speseList = readStorageJSON('spese_list', []);

    const venditeAnno = storicoVendite.filter(item => getYearFromDateStr(item.data) === annoPrecedente);
    const raccoltaAnno = storicoRaccolta.filter(item => getYearFromDateStr(item.data) === annoPrecedente);
    const speseAnno = speseList.filter(item => getYearFromDateStr(item.data) === annoPrecedente);

    if (venditeAnno.length === 0 && raccoltaAnno.length === 0 && speseAnno.length === 0) {
        showToast(`Nessun dato trovato per l'anno ${annoPrecedente}.`, 'error');
        return;
    }

    const archivioData = {
        anno: annoPrecedente,
        dataExport: new Date().toISOString(),
        storicoVendite: venditeAnno,
        storicoRaccolta: raccoltaAnno,
        speseList: speseAnno
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(archivioData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `archivio_tartufi_${annoPrecedente}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    localStorage.setItem('storico_vendite', JSON.stringify(storicoVendite.filter(item => getYearFromDateStr(item.data) !== annoPrecedente)));
    localStorage.setItem('storico_raccolta_giornaliera', JSON.stringify(storicoRaccolta.filter(item => getYearFromDateStr(item.data) !== annoPrecedente)));
    localStorage.setItem('spese_list', JSON.stringify(speseList.filter(item => getYearFromDateStr(item.data) !== annoPrecedente)));

    showToast(`✅ Archivio ${annoPrecedente} creato. Dati dell'anno rimossi dall'app.`, 'success');
}

async function ripristinaBackupDaFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;

    const backupMap = {
        tesserino: 'tesserino_data',
        pagopa: 'pagopa_data',
        archivioDocumentiList: 'archivio_documenti_list',
        f24: 'f24_data',
        storicoVendite: 'storico_vendite',
        luoghiRaccolta: 'luoghi_raccolta',
        poiList: 'poi_list',
        dogsList: 'dogs_list',
        caneData: 'cane_data',
        polizzeList: 'polizze_list',
        storicoRaccolta: 'storico_raccolta_giornaliera',
        rubricaClienti: 'rubrica_clienti',
        speseList: 'spese_list',
        vetHistoryList: 'vet_history_list',
        heatDiaryList: 'heat_diary_list',
        vetClinicsList: 'vet_clinics_list',
        calendariTartufiCustom: 'calendari_tartufi_custom',
        noteRegionaliTartufi: 'note_regionali_tartufi',
        offlineRegioniPreferite: OFFLINE_REGIONI_PREFERITE_KEY,
        backupDirLabel: _BACKUP_DIR_LABEL_KEY,
    };

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const content = JSON.parse(e.target.result);
            const { entries, keysToRemove } = buildBackupRestorePlan(content, backupMap);

            const confirmed = await appConfirm(
                '⚠️ Ripristina Backup\n\n' +
                'Questa operazione sovrascriverà i dati attuali dell\'app con quelli contenuti nel file di backup.\n\n' +
                'Vuoi continuare?'
            );
            if (!confirmed) {
                if (input) input.value = '';
                return;
            }

            for (const storageKey of keysToRemove) {
                localStorage.removeItem(storageKey);
            }
            for (const [storageKey, value] of entries) {
                localStorage.setItem(storageKey, value);
            }

            showToast('✅ Backup ripristinato con successo.', 'success');
            setTimeout(() => location.reload(), 800);
        } catch (err) {
            if (input) input.value = '';
            showToast('❌ File di backup non valido.', 'error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

async function _requestBackupReauth() {
    if (_backupReauthInProgress) return;
    _backupReauthInProgress = true;
    _automaticBackupDirHandle = null;
    await TruffleStorage.saveDirectoryHandle(_BACKUP_DIR_HANDLE_KEY, null).catch(() => {});
    setAutomaticBackupDestinationLabel(null);
    try {
        await appAlert(
            '⚠️ Autorizzazione cartella backup scaduta\n\n' +
            "Dopo l'aggiornamento o la reinstallazione dell'app il permesso di accesso alla cartella backup non è più valido.\n\n" +
            'Premi OK per selezionare di nuovo la cartella e ripristinare il backup automatico.'
        );
        const configuredFolder = await configureAutomaticBackupFolder(true);
        if (configuredFolder) {
            showToast(`Cartella backup registrata: ${configuredFolder.destinationLabel}.`, 'success');
            await runAutomaticLocalBackup();
        }
    } finally {
        _backupReauthInProgress = false;
    }
}

async function runAutomaticLocalBackup() {
    const hasDestinationLabel = Boolean(getAutomaticBackupDestinationLabel());
    const hasStoredHandle = hasDestinationLabel ? true : Boolean(await _loadBackupDirHandle());
    if (!hasDestinationLabel && !hasStoredHandle) return;
    const backupData = buildCompleteBackupData();
    const fingerprint = JSON.stringify(backupData);
    if (fingerprint === lastAutomaticBackupFingerprint) return;
    const backupSaved = await downloadBackupFile(backupData, { automatic: true });
    if (backupSaved === 'needs_reauth') {
        await _requestBackupReauth();
        return;
    }
    if (!backupSaved) return;
    lastAutomaticBackupFingerprint = fingerprint;
}

const AUTO_BACKUP_DATA_CHANGE_DEBOUNCE_MS = 500;
let automaticBackupLifecycleInitialized = false;
let lastAutomaticBackupFingerprint = '';
let dataChangeDebounceTimer = null;
let _backupReauthInProgress = false;

function setupAutomaticBackupLifecycle() {
    if (automaticBackupLifecycleInitialized) return;
    automaticBackupLifecycleInitialized = true;
    const api = window.TruffleStorage;
    if (api && typeof api.setDataChangeListener === 'function') {
        api.setDataChangeListener(() => {
            clearTimeout(dataChangeDebounceTimer);
            dataChangeDebounceTimer = setTimeout(() => runAutomaticLocalBackup(), AUTO_BACKUP_DATA_CHANGE_DEBOUNCE_MS);
        });
    }
}

setupAutomaticBackupLifecycle();

function toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) { drawer.classList.toggle('drawer-open'); backdrop.classList.toggle('active'); }
}

function centerOnUser() {
    if (userMarker) { const pos = userMarker.getLatLng(); map.setView([pos.lat, pos.lng], getAdaptiveFocusZoom(18)); userMarker.openPopup(); }
    else { showToast("Posizione GPS non disponibile.", 'error'); }
}

function saveVetClinic() {
    const nome = document.getElementById('vc-nome').value.trim();
    const indirizzo = document.getElementById('vc-indirizzo').value.trim();
    const tel = document.getElementById('vc-tel').value.trim();
    const cell = document.getElementById('vc-cell').value.trim();
    const note = document.getElementById('vc-note').value.trim();
    if (!nome || (!tel && !cell)) { showToast("Inserisci nome e almeno un numero.", 'error'); return; }
    let vetClinics = readStorageJSON('vet_clinics_list', []);
    vetClinics.push({ nome, indirizzo, tel, cell, note });
    localStorage.setItem('vet_clinics_list', JSON.stringify(vetClinics));
    showToast("Clinica salvata!", 'success'); openModule('vet-emergency');
}

async function deleteVetClinic(index) {
    if (await appConfirm("Rimuovere contatto?")) {
        let vetClinics = readStorageJSON('vet_clinics_list', []);
        vetClinics.splice(index, 1);
        localStorage.setItem('vet_clinics_list', JSON.stringify(vetClinics));
        openModule('vet-emergency');
    }
}

async function shareLocationToVet(telNumber) {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const senderName = getSavedSenderName();
        const senderLine = senderName ? ` Da: ${senderName}.` : '';
        const msg = `EMERGENZA VETERINARIA!${senderLine} Coordinate GPS: Lat: ${pos.lat.toFixed(6)}, Lng: ${pos.lng.toFixed(6)}`;
        const method = await appChooseSendMethod('Come vuoi inviare il messaggio di emergenza?');
        if (method === 'sms') { window.location.href = `sms:${telNumber}?body=${encodeURIComponent(msg)}`; }
        else if (method === 'whatsapp') { window.location.href = `whatsapp://send?phone=${encodeURIComponent(telNumber)}&text=${encodeURIComponent(msg)}`; }
    } else { showToast("GPS non disponibile.", 'error'); }
}

function shareLocationToVetByIndex(index) {
    const vetClinics = readStorageJSON('vet_clinics_list', []);
    const clinic = vetClinics[index];
    const contactNumber = clinic && (clinic.cell || clinic.tel);
    if (!contactNumber) { showToast("Nessun numero disponibile.", 'error'); return; }
    shareLocationToVet(sanitizePhoneHref(contactNumber));
}

async function callVetClinicByIndex(index) {
    const vetClinics = readStorageJSON('vet_clinics_list', []);
    const clinic = vetClinics[index];
    if (!clinic) return;
    const hasTel = Boolean(clinic.tel);
    const hasCell = Boolean(clinic.cell);
    if (!hasTel && !hasCell) { showToast("Nessun numero disponibile.", 'error'); return; }
    const method = await appChooseCallMethod('Quale numero vuoi chiamare?', hasTel, hasCell);
    if (method === 'tel') {
        window.location.href = `tel:${sanitizePhoneHref(clinic.tel)}`;
    } else if (method === 'cell') {
        window.location.href = `tel:${sanitizePhoneHref(clinic.cell)}`;
    }
}

function whatsappVetClinicByIndex(index) {
    const vetClinics = readStorageJSON('vet_clinics_list', []);
    const clinic = vetClinics[index];
    if (!clinic || !clinic.cell) { showToast("Nessun numero di cellulare disponibile.", 'error'); return; }
    window.location.href = `whatsapp://send?phone=${encodeURIComponent(sanitizePhoneHref(clinic.cell))}`;
}

function syncVetUnifiedInputForm() {
    const modeSelect = document.getElementById('vet-entry-category');
    const caneSelect = document.getElementById('vet-entry-cane');
    const typeRow = document.getElementById('vet-entry-type-row');
    const dateLabel = document.getElementById('vet-entry-date-label');
    const noteLabel = document.getElementById('vet-entry-note-label');
    const noteInput = document.getElementById('vet-entry-note');
    const saveBtn = document.getElementById('vet-entry-save-btn');
    if (!modeSelect || !caneSelect || !typeRow || !dateLabel || !noteLabel || !noteInput || !saveBtn) return;

    const isHeatMode = modeSelect.value === 'heat_diary';
    const options = Array.from(caneSelect.options);
    const femaleOptions = options.filter(opt => opt.dataset.sesso === 'Femmina');

    if (isHeatMode && femaleOptions.length === 0) {
        modeSelect.value = 'vet_history';
    }

    const applyHeatMode = modeSelect.value === 'heat_diary';
    options.forEach((opt) => {
        const isFemale = opt.dataset.sesso === 'Femmina';
        opt.hidden = applyHeatMode && !isFemale;
        opt.disabled = applyHeatMode && !isFemale;
    });

    if (applyHeatMode) {
        if (!caneSelect.selectedOptions[0] || caneSelect.selectedOptions[0].dataset.sesso !== 'Femmina') {
            const firstFemale = femaleOptions[0];
            if (firstFemale) caneSelect.value = firstFemale.value;
        }
        typeRow.style.display = 'none';
        dateLabel.textContent = 'Data Inizio Calore:';
        noteLabel.textContent = 'Note:';
        noteInput.placeholder = 'Es. Durata, comportamento...';
        saveBtn.textContent = 'Registra Calore';
        saveBtn.style.background = '#be185d';
        return;
    }

    typeRow.style.display = '';
    dateLabel.textContent = 'Data del Trattamento:';
    noteLabel.textContent = 'Note / Dettagli:';
    noteInput.placeholder = 'Es. Nome farmaco o dosaggio';
    saveBtn.textContent = 'Registra nel Libretto';
    saveBtn.style.background = '#2563eb';
}

function refreshVetBookletFilter(event) {
    const selectedDog = ((event?.target?.value) || '').trim();
    if (selectedDog) {
        localStorage.setItem('vet_filter_cane_nome', selectedDog);
    } else {
        localStorage.removeItem('vet_filter_cane_nome');
    }
    openModule('vet');
}

function printVetFilteredBooklet() {
    const activeView = document.getElementById('active-module-view');
    if ((activeView?.dataset?.activeModule || '') !== 'vet') return;

    const selectedDog = ((document.getElementById('vet-filter-cane') || {}).value || '').trim();
    if (!selectedDog) {
        showToast("Seleziona un cane nel filtro prima di stampare.", 'error');
        return;
    }

    const printBlock = document.getElementById('vet-filtered-print-only');
    if (!printBlock || printBlock.dataset.hasData !== '1') {
        showToast("Nessun dato da stampare per il cane selezionato.", 'error');
        return;
    }

    let hasCleanedUp = false;
    let cleanupTimerId = null;
    let cleanupOnFocus = null;
    const cleanupSummaryPrintMode = () => {
        if (hasCleanedUp) return;
        hasCleanedUp = true;
        document.body.classList.remove('summary-print-mode');
        if (cleanupTimerId) {
            clearTimeout(cleanupTimerId);
            cleanupTimerId = null;
        }
        if (cleanupOnFocus) window.removeEventListener('focus', cleanupOnFocus);
        window.removeEventListener('afterprint', cleanupSummaryPrintMode);
    };
    cleanupOnFocus = () => cleanupSummaryPrintMode();

    try {
        window.addEventListener('focus', cleanupOnFocus, { once: true });
        window.addEventListener('afterprint', cleanupSummaryPrintMode, { once: true });
        document.body.classList.add('summary-print-mode');
        cleanupTimerId = window.setTimeout(cleanupSummaryPrintMode, 5000);
        window.print();
    } catch (error) {
        window.removeEventListener('afterprint', cleanupSummaryPrintMode);
        if (cleanupOnFocus) window.removeEventListener('focus', cleanupOnFocus);
        cleanupSummaryPrintMode();
        throw error;
    }
}

function saveVetUnifiedEntry() {
    const mode = (document.getElementById('vet-entry-category') || {}).value || 'vet_history';
    const caneSelect = document.getElementById('vet-entry-cane');
    const selectedCane = caneSelect ? caneSelect.selectedOptions[0] : null;
    const cane = selectedCane ? selectedCane.value : '';
    const data = (document.getElementById('vet-entry-date') || {}).value || '';
    const note = ((document.getElementById('vet-entry-note') || {}).value || '').trim();

    if (!data) {
        const message = mode === 'heat_diary' ? "Inserisci la data dell'inizio calore." : "Inserisci la data.";
        showToast(message, 'error');
        return;
    }

    if (mode === 'heat_diary') {
        if (!selectedCane || selectedCane.dataset.sesso !== 'Femmina') {
            showToast("Per il diario calore seleziona una cagna femmina.", 'error');
            return;
        }
        let heatDiary = readStorageJSON('heat_diary_list', []);
        heatDiary.push({ cane, data, note });
        localStorage.setItem('heat_diary_list', JSON.stringify(heatDiary));
        showToast("Calore registrato!", 'success');
        openModule('vet');
        return;
    }

    const tipoEl = document.getElementById('vet-entry-type');
    if (!tipoEl) {
        showToast("Tipologia intervento non disponibile.", 'error');
        return;
    }
    const tipo = tipoEl.value;
    let vetHistory = readStorageJSON('vet_history_list', []);
    vetHistory.push({ cane, tipo, data, note });
    localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
    showToast("Trattamento registrato!", 'success');
    openModule('vet');
}

async function deleteVetHistoryItem(index) {
    if (await appConfirm("Rimuovere record?")) {
        let vetHistory = readStorageJSON('vet_history_list', []);
        vetHistory.splice(index, 1);
        localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
        openModule('vet');
    }
}

async function deleteHeatEntry(index) {
    if (await appConfirm("Rimuovere questo calore?")) {
        let heatDiary = readStorageJSON('heat_diary_list', []);
        heatDiary.splice(index, 1);
        localStorage.setItem('heat_diary_list', JSON.stringify(heatDiary));
        openModule('vet');
    }
}

function shareAppUrl() {
    const shareData = {
        title: 'SmartTruffle Path',
        text: 'Condividi la tua applicazione per la raccolta dei tartufi',
        url: window.location.href
    };

    if (navigator.share) {
        navigator.share(shareData).catch((err) => {
            console.log("Condivisione annullata o non riuscita", err);
        });
    } else {
        navigator.clipboard.writeText(window.location.href).then(() => {
            showToast("Link copiato!", 'success');
        }).catch(() => {
            showToast("Impossibile condividere.", 'error');
        });
    }
}

// --- PWA Install ---
let deferredInstallPrompt = null;
const installUnavailableMessage = "Installazione non disponibile al momento. Usa il menu del browser per installare l'app o aggiungerla alla schermata Home.";

function isPwaInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        || window.navigator.standalone === true;
}

function updateInstallCallToAction() {
    const btn = document.getElementById('btn-installa-app');
    const badge = document.getElementById('app-installato-badge');
    if (!btn || !badge) return;

    if (isPwaInstalled()) {
        btn.style.display = 'none';
        badge.style.display = 'block';
        return;
    }

    badge.style.display = 'none';
    btn.style.display = '';
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateInstallCallToAction, { once: true });
    } else {
        updateInstallCallToAction();
    }
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallCallToAction();
});

async function installApp() {
    if (isPwaInstalled()) {
        updateInstallCallToAction();
        return;
    }

    if (!deferredInstallPrompt) {
        showToast(installUnavailableMessage, 'info');
        return;
    }

    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;

    try {
        await promptEvent.prompt();
        const choiceResult = await promptEvent.userChoice;
        if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] Installazione accettata');
        } else {
            console.log('[PWA] Installazione rifiutata');
        }
    } catch (err) {
        console.warn('[PWA] Errore durante il prompt di installazione:', err);
        deferredInstallPrompt = promptEvent;
        showToast(installUnavailableMessage, 'info');
    }

    updateInstallCallToAction();
}

function updateDrawerVersionDisplay() {
    const el = document.getElementById('drawer-app-version');
    if (!el) return;
    const version = globalThis.SMARTTRUFFLE_CACHE_VERSION;
    if (version) el.textContent = `v ${version}`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateInstallCallToAction, { once: true });
    document.addEventListener('DOMContentLoaded', updateDrawerVersionDisplay, { once: true });
} else {
    updateInstallCallToAction();
    updateDrawerVersionDisplay();
}

function visualizzaImmagineSalvata(base64Data, titolo, moduloProvenienza = 'tesserino') {
    if (!isSafeDataUrl(base64Data)) return;
    
    let activeView = document.getElementById('active-module-view');
    if (!activeView) return;

    let contentHTML = `
        <h2>Visualizzazione Documento</h2>
        <p><strong>${escapeHtml(titolo || 'Allegato')}</strong></p>
        <div class="module-card" style="text-align: center; background: #fff; padding: 15px; border-radius: 8px;">
            <img src="${base64Data}" style="max-width: 100%; height: auto; border-radius: 6px;" alt="Documento Salvato">
        </div>
        <button class="overlay-btn" style="background:#556152; margin-top:15px; width:100%;" ${actionAttrs('openModule', [moduloProvenienza])}>← Torna Indietro</button>
    `;
    
    activeView.querySelector('.module-body-content').innerHTML = contentHTML;
}
function chiudiVisualizzazioneImmagine(moduloProvenienza = 'tesserino') {
    const overlayImmagine = document.getElementById('image-overlay-container');
    if (overlayImmagine) {
        overlayImmagine.style.display = 'none';
    } else {
        openModule(moduloProvenienza);
    }
}
// Funzione per mostrare il Disclaimer Legale ad OGNI apertura dell'app
function mostraDisclaimerIniziale() {
    let modalOverlay = document.getElementById('disclaimer-overlay');
    
    // Testi delle 5 pagine del disclaimer
    const pagineDisclaimer = [
        `<strong>1. Natura dello Strumento</strong><br>Questa applicazione è concepita e fornita esclusivamente come strumento informale di supporto hobbistico, tracciabilità interna e geolocalizzazione per la raccolta dei tartufi.`,
        `<strong>2. Esclusione di Consulenza Fiscale e Professionale</strong><br><span style="color: #f87171;">Il software non costituisce in alcun modo un servizio di consulenza finanziaria, fiscale, legale o professionale, né sostituisce l'assistenza diretta di un commercialista abilitato o di un professionista iscritto agli albi competenti.</span> Le funzioni di calcolo, archiviazione di ricevute e gestione contabile hanno carattere puramente indicativo e di supporto organizzativo privato.`,
        `<strong>3. Responsabilità Esclusiva dell'Utente</strong><br>L'utente è l'unico e il solo responsabile della conformità fiscale, della correttezza e veridicità dei dati inseriti, della conservazione e gestione dei documenti di pagamento, nonché del puntuale rispetto di tutte le normative vigenti, statali e regionali, in materia di raccolta e commercializzazione dei tartufi.`,
        `<strong>4. Geolocalizzazione e Sicurezza all'Aperto</strong><br>Le indicazioni di orientamento, le coordinate GPS, la bussola e la memorizzazione dei punti di interesse o dei parcheggi dipendono da fattori esterni. Gli sviluppatori non garantiscono l'accuratezza o la continuità del segnale e declinano ogni responsabilità per eventuali situazioni di smarrimento, ritardi, incidenti o pericoli derivanti dall'esplorazione di aree boschive o impervie.`,
        `<strong>5. Manleva</strong><br>Gli sviluppatori, i creatori e i distributori del software declinano espressamente ogni responsabilità civile e penale per imprecisioni, errori di calcolo, omissioni, perdite di dati, blocco delle funzionalità o per qualsivoglia sanzione amministrativa, fiscale o giudiziaria derivante, direttamente o indirettamente, dall'utilizzo di questa applicazione.`
    ];

    let paginaCorrente = 0;

    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'disclaimer-overlay';
        modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.85); z-index: 99999;
            display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;
        `;
        
        modalOverlay.innerHTML = `
            <div style="background: rgba(29,40,30,0.96); color: #f6f1e6; padding: 25px; border-radius: 12px; max-width: 500px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.07); font-family: sans-serif;">
                <h3 style="color: #f59e0b; margin-top: 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: space-between;">
                    <span>⚠️ Avviso e Limitazione di Responsabilità</span>
                    <span id="disclaimer-counter" style="font-size: 0.8rem; color: #b8b0a0; font-weight: normal;">1 / 5</span>
                </h3>
                <div id="disclaimer-text-container" style="font-size: 0.85rem; color: #ddd6c8; line-height: 1.5; min-height: 110px; max-height: 55vh; overflow-y: auto; padding-right: 5px; margin: 15px 0;">
                    ${pagineDisclaimer[0]}
                </div>
                <div id="disclaimer-buttons-container">
                    <button id="btn-avanti-disclaimer" style="background: #627d54; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-top: 10px;">
                        Avanti
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const textContainer = document.getElementById('disclaimer-text-container');
        const counterContainer = document.getElementById('disclaimer-counter');
        const buttonsContainer = document.getElementById('disclaimer-buttons-container');

function aggiornaVistaDisclaimer() {
            textContainer.innerHTML = pagineDisclaimer[paginaCorrente];
            counterContainer.innerText = `${paginaCorrente + 1} / 5`;

            if (paginaCorrente < pagineDisclaimer.length - 1) {
                // Pagine intermedie: mostra solo il tasto "Avanti"
                buttonsContainer.innerHTML = `
                    <button id="btn-avanti-disclaimer" style="background: #627d54; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-top: 10px;">
                        Avanti
                    </button>
                `;
                document.getElementById('btn-avanti-disclaimer').addEventListener('click', () => {
                    paginaCorrente++;
                    aggiornaVistaDisclaimer();
                });
            } else {
                // Ultima pagina: mostra i tasti originali della funzione
                buttonsContainer.innerHTML = `
                    <button id="btn-accetta-disclaimer" style="background: #22c55e; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-top: 10px;">
                        Accetta e Continua
                    </button>
                    <button id="btn-abbandona-app" style="background: #3a4a3a; color: #f87171; border: 1px solid rgba(255,255,255,0.12); padding: 10px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 0.9rem; cursor: pointer; margin-top: 8px;">
                        Abbandona
                    </button>
                `;

                // Azione per il tasto "Accetta e Continua"
                document.getElementById('btn-accetta-disclaimer').addEventListener('click', () => {
                    modalOverlay.style.display = 'none';
                });

                // Azione per il tasto "Abbandona"
                document.getElementById('btn-abbandona-app').addEventListener('click', () => {
                    try {
                        window.close();
                    } catch (e) {
                        console.log(e);
                    }
                    window.location.href = "about:blank";
                });
            }
        }

        // Assegnazione evento primo click sul tasto "Avanti" iniziale
        document.getElementById('btn-avanti-disclaimer').addEventListener('click', () => {
            paginaCorrente++;
            aggiornaVistaDisclaimer();
        });

    } else {
        modalOverlay.style.display = 'flex';
    }
}

// 1. Funzione per autocompilare i campi cliente richiamando i dati salvati
function autocompilaDatiCliente(nomeInserito) {
    if (!nomeInserito || nomeInserito.trim() === '') return;
    const rubricaClienti = readStorageJSON('rubrica_clienti', []);
    const clienteTrovato = rubricaClienti.find(c => c.nome.toLowerCase() === nomeInserito.trim().toLowerCase());

    if (clienteTrovato) {
        const elCf = document.getElementById('r-cf-acquirente');
        const elIndirizzo = document.getElementById('r-indirizzo-acquirente');
        const elEmail = document.getElementById('r-email-acquirente');
        const elNota = document.getElementById('r-nota-cliente');

        if (elCf && !elCf.value) elCf.value = clienteTrovato.cf || '';
        if (elIndirizzo && !elIndirizzo.value) elIndirizzo.value = clienteTrovato.indirizzo || '';
        if (elEmail && !elEmail.value) elEmail.value = clienteTrovato.email || '';
        if (elNota && !elNota.value) elNota.value = clienteTrovato.nota || '';
    }
}

async function condividiRicevutaEmail(index) {
    const storico = readStorageJSON('storico_vendite', []);
    const v = storico[index];
    if (!v) {
        showToast("Ricevuta non trovata.", 'error');
        return;
    }

    const emailDestinatarioTesto = v.acquirenteEmail ? v.acquirenteEmail : "Non specificato";
    const isRitenuta = v.regime === 'ritenuta';

    // Gestione dinamica dei dettagli economici in base al regime fiscale registrato
    let dettagliEconomiciTesto = "";
    if (isRitenuta) {
        const lordo = parseFloat(v.importo) || 0;
        const dettagliRitenuta = calcolaDettaglioRitenuta(lordo);
        const ritenuta = v.ritenuta ? parseFloat(v.ritenuta) : dettagliRitenuta.ritenuta;
        const netto = v.netto !== undefined ? parseFloat(v.netto) : dettagliRitenuta.netto;

        dettagliEconomiciTesto = 
            `• Regime Fiscale: Ritenuta d'Acconto (23%)\n` +
            `• Compenso Lordo: € ${lordo.toFixed(2)}\n` +
            `• Ritenuta d'Acconto (23%): € ${ritenuta.toFixed(2)}\n` +
            `• Importo Netto Corrisposto: € ${netto.toFixed(2)}`;
    } else {
        dettagliEconomiciTesto = 
            `• Regime Fiscale: Imposta Sostitutiva (Legge 145/2018)\n` +
            `• Importo Totale: € ${v.importo}`;
    }

    const corpo = 
        `Gentile ${v.acquirente},\n\n` +
        `Di seguito i dettagli della ricevuta di vendita occasionale di tartufi conforme alla Legge 145/2018:\n\n` +
        `• Email Acquirente Registrata: ${emailDestinatarioTesto}\n` +
        `• Data: ${v.data}\n` +
        `• Specie: ${v.specie}\n` +
        `• Qualità: ${v.qualita || 'Non specificata'}\n` +
        `• Peso: ${v.peso} grammi\n` +
        `${dettagliEconomiciTesto}\n` +
        `• Comune / Area di Raccolta: ${v.luogoRaccolta || v.comune || 'Non specificato'}\n` +
        `• Codice Lotto: ${v.lotto}\n\n` +
        `Cordiali saluti,\n${v.venditoreNome}`;

    if (navigator.share) {
        try {
            let fileToShare = null;

            if (typeof html2pdf !== 'undefined') {
                const element = document.getElementById(`ricevuta-${index}`);
                if (element) {
                    const options = {
                        margin: 10,
                        filename: `Ricevuta_${index + 1}.pdf`,
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 2, useCORS: true },
                        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                    };
                    
                    const pdfBlob = await html2pdf().from(element).set(options).output('blob');
                    fileToShare = new File([pdfBlob], `Ricevuta_${index + 1}.pdf`, { type: 'application/pdf' });
                }
            }

            const shareData = {
                title: `Ricevuta di Vendita Occasionale - Lotto ${v.lotto || 'Tartufo'}`,
                text: corpo
            };

            if (fileToShare && navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
                shareData.files = [fileToShare];
            }

            await navigator.share(shareData);
            return;

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.log("Condivisione email annullata o non riuscita", err);
            }
        }
    } else {
        // Fallback per desktop o browser che non supportano navigator.share con file
        await appAlert(`Browser non supporta l'allegato automatico.\nEmail: ${emailDestinatarioTesto}`);
    }
}

function salvaNotaCliente(index, testoNota) {
    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    if (rubricaClienti[index]) {
        rubricaClienti[index].nota = testoNota;
        localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
        // Facoltativo: un piccolo feedback visivo di conferma
        console.log("Nota salvata con successo per il cliente index:", index);
    }
}

function salvaNotaClienteDaInput(index) {
    const textarea = document.getElementById(`nota-cliente-${index}`);
    if (!textarea) return;

    let rubricaClienti = readStorageJSON('rubrica_clienti', []);
    if (rubricaClienti[index]) {
        rubricaClienti[index].nota = textarea.value.trim();
        localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
        showToast("Nota salvata!", 'success');
        openModule('clienti');
    }
}
function saveSpesa() {
    const data = document.getElementById('spese-data').value;
    const categoria = document.getElementById('spese-categoria').value;
    const importo = parseFloat(document.getElementById('spese-importo').value);
    const note = document.getElementById('spese-note').value.trim();

    if (!data || isNaN(importo) || importo <= 0) {
        showToast("Data e importo obbligatori.", 'error');
        return;
    }

    let speseList = readStorageJSON('spese_list', []);
    speseList.push({ data, categoria, importo, note });
    localStorage.setItem('spese_list', JSON.stringify(speseList));
    
    showToast("Spesa registrata!", 'success');
    openModule('spese');
}

async function deleteSpesa(index) {
    if (await appConfirm("Vuoi davvero eliminare questa spesa?")) {
        let speseList = readStorageJSON('spese_list', []);
        speseList.splice(index, 1);
        localStorage.setItem('spese_list', JSON.stringify(speseList));
        openModule('spese');
    }
}

function salvaArchivioRegionaleTartufi(regione) {
    const selectRegioneArchivio = document.getElementById('seleziona-regione-archivio');
    const regioneDaSelect = (selectRegioneArchivio && typeof selectRegioneArchivio.value === 'string')
        ? selectRegioneArchivio.value.trim()
        : '';
    const regioneEffettiva = regioneDaSelect || ((typeof regione === 'string' && regione.trim()) ? regione.trim() : '');

    if (!regioneEffettiva) {
        showToast("Seleziona una regione prima di salvare.", 'error');
        return;
    }

    regione = regioneEffettiva;

    let calendariPersonalizzatiArchivio = readStorageJSON('calendari_tartufi_custom', {});
    if (!calendariPersonalizzatiArchivio[regione]) {
        calendariPersonalizzatiArchivio[regione] = {};
    }

    // Legge i 9 campi numerati da 0 a 8 associati alle specie
    for (let idSpecie = 0; idSpecie <= 8; idSpecie++) {
        const inputEl = document.getElementById(`specie-archivio-${idSpecie}`);
        if (inputEl) {
            calendariPersonalizzatiArchivio[regione][idSpecie] = inputEl.value.trim();
        }
    }

    localStorage.setItem('calendari_tartufi_custom', JSON.stringify(calendariPersonalizzatiArchivio));

    // Salvataggio della nota regionale / fermo biologico
    const inputNotaRegionale = document.getElementById('nota-regione-speciale');
    if (inputNotaRegionale) {
        let noteRegionaliSalvate = readStorageJSON('note_regionali_tartufi', {});
        noteRegionaliSalvate[regione] = inputNotaRegionale.value.trim();
        localStorage.setItem('note_regionali_tartufi', JSON.stringify(noteRegionaliSalvate));
    }

    showToast("Calendario salvato!", 'success');
    openModule('archivio');
}

function isSpecieApertaCorrente(periodoStr) {
    if (!periodoStr) return false;
    
    const oggi = new Date();
    const annoCorrente = oggi.getFullYear();
    
    // Mappatura completa dei mesi in italiano (inclusi abbreviazioni)
    const mesiMap = {
        "gennaio": 0, "gen": 0,
        "febbraio": 1, "feb": 1,
        "marzo": 2, "mar": 2,
        "aprile": 3, "apr": 3,
        "maggio": 4, "mag": 4,
        "giugno": 5, "giu": 5,
        "luglio": 6, "lug": 6,
        "agosto": 7, "ago": 7,
        "settembre": 8, "set": 8, "sett": 8,
        "ottobre": 9, "ott": 9,
        "novembre": 10, "nov": 10,
        "dicembre": 11, "dic": 11
    };

    // Funzione interna di supporto per convertire una stringa di data (es. "1 ottobre" o "15/10") in un oggetto Date
    function parseDataStringa(stringaData, annoRiferimento) {
        stringaData = stringaData.toLowerCase().trim();
        
        // Tentativo 1: Formato numerico (es. 01/10 o 1-10 o 1.10.2026)
        const matchNum = stringaData.match(/(\d{1,2})[\/\-\.\s](\d{1,2})(?:[\/\-\.\s](\d{4}))?/);
        if (matchNum) {
            const giorno = parseInt(matchNum[1], 10);
            const mese = parseInt(matchNum[2], 10) - 1; // I mesi in JS vanno da 0 a 11
            const anno = matchNum[3] ? parseInt(matchNum[3], 10) : annoRiferimento;
            return new Date(anno, mese, giorno);
        }

        // Tentativo 2: Formato testuale (es. "1 ottobre" o "ottobre")
        let trovatoMese = null;
        let giorno = 1; // Default al primo del mese se il giorno non è specificato

        for (const [nomeMese, idxMese] of Object.entries(mesiMap)) {
            if (stringaData.includes(nomeMese)) {
                trovatoMese = idxMese;
                break;
            }
        }

        if (trovatoMese === null) return null;

        // Cerca se c'è un numero che rappresenta il giorno prima del mese
        const matchGiorno = stringaData.match(/(\d{1,2})/);
        if (matchGiorno) {
            giorno = parseInt(matchGiorno[1], 10);
        }

        return new Date(annoRiferimento, trovatoMese, giorno);
    }

    // Pulisce la stringa rimuovendo parole superflue come "dal", "al", "ore", ecc.
    let testoPulito = periodoStr.toLowerCase()
        .replace(/\bdal\b/g, '')
        .replace(/\bal\b/g, '-')
        .replace(/\bdel\b/g, '')
        .trim();

    // Divide la stringa in due parti usando il trattino o la parola "al" come separatore
    const parti = testoPulito.split(/\s*-\s*/);
    if (parti.length < 2) return false;

    let dataInizio = parseDataStringa(parti[0], annoCorrente);
    let dataFine = parseDataStringa(parti[1], annoCorrente);

    if (!dataInizio || !dataFine) return false;

    // Se la data di fine è precedente o uguale a quella di inizio, significa che siamo a cavallo d'anno (es. Ottobre - Gennaio)
    if (dataInizio > dataFine) {
        if (oggi.getMonth() <= dataFine.getMonth()) {
            // Se siamo nei primi mesi dell'anno corrente, l'inizio è avvenuto l'anno scorso
            dataInizio.setFullYear(annoCorrente - 1);
        } else {
            // Altrimenti, la fine si sposta all'anno prossimo
            dataFine.setFullYear(annoCorrente + 1);
        }
    }

    // Normalizza l'orario a inizio e fine giornata per un confronto pulito
    dataInizio.setHours(0, 0, 0, 0);
    dataFine.setHours(23, 59, 59, 999);

    return oggi >= dataInizio && oggi <= dataFine;
}

function elaboraTestoIncollato() {
    estraiDateTartufiDaTesto();
}

function estraiDateTartufiDaTesto() {
    const textarea = document.getElementById('testo-normativa-tartufi');
    if (!textarea) return;
    
    let testo = textarea.value.trim();
    if (!testo) {
        showToast("Inserisci prima il testo della normativa.", 'error');
        return;
    }

    const selectRegione = document.getElementById('seleziona-regione-archivio');
    const regioneCorrente = selectRegione ? selectRegione.value : (window.currentArchivioRegione || "Abruzzo");

    // Normalizza i ritorni a capo e gli spazi multipli
    testo = testo.replace(/\r?\n|\r/g, ' '); 
    testo = testo.replace(/\s+/g, ' ');
    const testoLower = testo.toLowerCase();

    // Mappatura ordinata dalla più specifica alla più generica
    const regoleEstrazione = [
        { id: 4, keywords: ["tuber brumale var. moschatum", "tuber brumale var moschatum", "tartufo moscato"] },
        { id: 3, keywords: ["tuber brumale", "tartufo nero d'inverno", "tartufo nero di inverno", "trifola nera"] },
        { id: 0, keywords: ["tuber magnatum", "tartufo bianco"] },
        { id: 1, keywords: ["tuber melanosporum", "tartufo nero di norcia", "tartufo nero pregiato"] },
        { id: 5, keywords: ["tuber aestivum", "scorzone", "tartufo d'estate", "tartufo estivo"] },
        { id: 6, keywords: ["tuber uncinatum", "tartufo uncinato" ] },
        { id: 7, keywords: ["tuber borchii", "t. borchi", "t. albidum", "bianchetto", "marzuolo"] },
        { id: 2, keywords: ["tuber macrosporum", "tartufo nero liscio"] },
        { id: 8, keywords: ["tuber mesentericum", "tartufo nero ordinario", "tartufo nero di bagnoli"] }
    ];

    let calendariPersonalizzati = readStorageJSON('calendari_tartufi_custom', {});
    if (!calendariPersonalizzati[regioneCorrente]) {
        calendariPersonalizzati[regioneCorrente] = {};
    }

    let modificheEffettuate = 0;
    const specieAggiornate = new Set();

    // Raccoglie tutte le specie trovate nel testo con la loro posizione iniziale esatta
    let occorrenzeTrovate = [];

    regoleEstrazione.forEach(regola => {
        if (specieAggiornate.has(regola.id)) return;

        let primaPos = -1;
        for (let kw of regola.keywords) {
            let idx = testoLower.indexOf(kw);
            if (idx !== -1 && (primaPos === -1 || idx < primaPos)) {
                primaPos = idx;
            }
        }

        if (primaPos !== -1) {
            occorrenzeTrovate.push({ id: regola.id, posizione: primaPos });
            specieAggiornate.add(regola.id); // Evita duplicati di specie
        }
    });

    // Ordina le specie in base alla loro sequenza di comparsa nel testo
    occorrenzeTrovate.sort((a, b) => a.posizione - b.posizione);

    // Estrae i periodi delimitando lo spazio compreso tra una specie e la successiva
    occorrenzeTrovate.forEach((specie, index) => {
        let inizioSlice = specie.posizione;
        // La ricerca per questa specie si ferma dove inizia la specie successiva nel testo (o alla fine del testo)
        let fineSlice = (index + 1 < occorrenzeTrovate.length) ? occorrenzeTrovate[index + 1].posizione : testo.length;
        
        let porzioneTesto = testo.substring(inizioSlice, fineSlice);

        // Cerca tutte le date del tipo "dal ... al ..." in questo intervallo circoscritto
        const regexSingola = /dal\s+([\d]{1,2}[\s°ªa-zA-Zà-ù]+?)\s+al\s+([\d]{1,2}[\s°ªa-zA-Zà-ù]+?)(?=\s+e\s+dal|[;.,]|$)/gi;
        
        let match;
        let periodiTrovati = [];

        while ((match = regexSingola.exec(porzioneTesto)) !== null) {
            let p1 = match[1].replace(/[()]/g, '').trim();
            let p2 = match[2].replace(/[()]/g, '').trim();
            let periodoStr = `${p1} - ${p2}`;

            if (!periodiTrovati.includes(periodoStr)) {
                periodiTrovati.push(periodoStr);
            }
        }

        if (periodiTrovati.length > 0) {
            let periodoFinale = periodiTrovati.join(" e ");

            calendariPersonalizzati[regioneCorrente][specie.id] = periodoFinale;

            const inputSpecie = document.getElementById(`specie-archivio-${specie.id}`);
            if (inputSpecie) {
                inputSpecie.value = periodoFinale;
            }
            modificheEffettuate++;
        }
    });

    if (modificheEffettuate > 0) {
        localStorage.setItem('calendari_tartufi_custom', JSON.stringify(calendariPersonalizzati));
        
        if (typeof window.aggiornaCalendarioGPS === 'function') {
            window.aggiornaCalendarioGPS();
        }

        showToast(`🔍 Aggiornati ${modificheEffettuate} periodi.`, 'success');
    } else {
        showToast("Impossibile estrarre le date. Verifica il testo.", 'error');
    }
}
// Funzione per scaricare i calendari e le note regionali in formato JSON
// Funzione per esportare e condividere i calendari e le note regionali in formato JSON
async function esportaCalendariJSON() {
    const exportData = {
        calendari_tartufi_custom: readStorageJSON('calendari_tartufi_custom', {}),
        note_regionali_tartufi: readStorageJSON('note_regionali_tartufi', {}),
        dataExport: new Date().toISOString()
    };

    const fileName = `calendari_tartufi_backup_${new Date().toISOString().slice(0,10)}.json`;
    const jsonString = JSON.stringify(exportData, null, 2);
    const file = new File([jsonString], fileName, { type: 'application/json' });

    // Controlla se il dispositivo supporta la condivisione nativa (es. Smartphone / Tablet)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                title: 'Backup Calendari Tartufi',
                text: 'Ecco il file di backup dei calendari e delle note regionali dei tartufi.',
                files: [file]
            });
            return; // Condivisione riuscita
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.log("Condivisione nativa annullata o fallita, procedo con il download classico.", error);
            } else {
                return; // L'utente ha annullato esplicitamente la condivisione
            }
        }
    }

    // Fallback per PC o browser non supportati (Download diretto del file)
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

// Funzione per caricare/ripristinare i calendari da un file JSON
function importaCalendariJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const content = JSON.parse(e.target.result);
            if (!content || typeof content !== 'object' || Array.isArray(content)) {
                throw new Error('Contenuto backup non valido');
            }
            const pendingWrites = [];
            
            if (content.calendari_tartufi_custom) {
                if (typeof content.calendari_tartufi_custom !== 'object' || Array.isArray(content.calendari_tartufi_custom)) {
                    throw new Error('Calendari non validi');
                }
                pendingWrites.push(['calendari_tartufi_custom', JSON.stringify(content.calendari_tartufi_custom)]);
            }
            if (content.note_regionali_tartufi) {
                if (typeof content.note_regionali_tartufi !== 'object' || Array.isArray(content.note_regionali_tartufi)) {
                    throw new Error('Note regionali non valide');
                }
                pendingWrites.push(['note_regionali_tartufi', JSON.stringify(content.note_regionali_tartufi)]);
            }

            pendingWrites.forEach(([storageKey, value]) => {
                localStorage.setItem(storageKey, value);
            });

            showToast("Calendari importati!", 'success');
            openModule('archivio'); // Ricarica il modulo archivio per mostrare i dati aggiornati
        } catch (err) {
            showToast("File JSON non valido.", 'error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}
async function mostraInfoModulo(moduleName) {
    const guideTesti = {
        'poilist': "ℹ️ Guida - Elenco Punti & Tartufaie\n\nQui puoi visualizzare tutti i punti di interesse e le tartufaie salvate con coordinate e note. Il tasto '🧭 Vai' imposta una navigazione basata su GPS: l'app calcola la distanza e la direzione geografica del punto rispetto al Nord.\n\nQuesta navigazione non usa il magnetometro / la bussola hardware del telefono, quindi non indica dove stai guardando con il dispositivo. Per orientarti devi confrontare la mappa con i tuoi spostamenti reali.\n\nPuoi anche condividere la posizione o eliminare i punti non più utili.",
        'punti_condivisi': "ℹ️ **Guida - Importa Punti Condivisi / SOS**\n\nIncolla il messaggio ricevuto da un altro utente (punto tartufaia o SOS di emergenza). Il sistema estrae automaticamente le coordinate GPS, rileva il nome del mittente quando presente nel testo e salva il punto nell'elenco: per i SOS usa sempre 🆘, mentre per gli altri puoi scegliere il marker.",
        'tesserino': "ℹ️ **Guida - Anagrafica & Tesserino Digitale**\n\nInserisci e archivia i dati del tuo tesserino regionale di raccolta tartufi e carica una foto del documento (max 1.5MB). Consigliate immagini leggere.",
        'pagopa': "ℹ️ **Guida - Ricevuta PagoPA**\n\nRegistra la quietanza di pagamento della tassa regionale annuale obbligatoria caricando un'immagine. Questo dato è indispensabile per sbloccare la registrazione delle vendite.",
        'archivio_documenti': "ℹ️ **Guida - Archivio Altri Documenti**\n\nSalva altri documenti (es. carta d'identità o autorizzazione funghi) indicando numero documento, scadenza e immagine del documento. Puoi anche allegare l'immagine della ricevuta di rinnovo.",
        'ricevute': "ℹ️ **Guida - Ricevuta di Vendita Occasionale**\n\nEmetti ricevute di vendita conformi alla normativa vigente (Legge 145/2018). Il sistema sceglie automaticamente il regime fiscale corretto (Imposta Sostitutiva o Ritenuta d'Acconto) in base alla presenza di un F24 valido.",
        'storico_ricevute': "ℹ️ **Guida - Archivio Storico Ricevute**\n\nConsulta l'elenco cronologico di tutte le ricevute emesse, con la possibilità di visualizzarle, modificarle, stamparle o filtrarle per acquirente.",
        'archivio_luoghi': "ℹ️ **Guida - Archivio Luoghi di Raccolta**\n\nGestisci l'elenco dei luoghi e aree di raccolta memorizzati. Questi vengono suggeriti automaticamente nel campo 'Luogo / Area di Raccolta' durante l'emissione di nuove ricevute. Puoi aggiungere, rinominare o eliminare qualsiasi voce.",
        'f24': "ℹ️ **Guida - F24 ELIDE**\n\nRegistra il versamento dell'imposta sostitutiva annuale di 100€ prevista dalla Legge 145/2018 per la vendita occasionale dei tartufi.",
        'canidiary': "ℹ️ **Guida - Anagrafica Cane**\n\nGestisci l'anagrafica dei tuoi cani da tartufo inserendo razza, sesso, data di nascita e numero di microchip.",
        'polizze': "ℹ️ **Guida - Polizze & Assicurazioni**\n\nTieni traccia delle polizze assicurative (RC cane, responsabilità civile per la raccolta e infortuni) monitorando le relative scadenze.",
        'vet': "ℹ️ **Guida - Libretti Sanitari Cani & Profilassi**\n\nUsa la card unica \"Nuova Registrazione\" per inserire trattamenti/visite oppure voci del diario calore. In modalità diario calore puoi selezionare solo cagne femmine, con previsione del prossimo ciclo nello storico.",
        'registro_giornaliero': "ℹ️ **Guida - Registro Giornaliero Ritrovamenti**\n\nAnnota i quantitativi giornalieri raccolti suddivisi per specie e data, con filtri avanzati per anno e tipologia di tartufo.",
        'spese': "ℹ️ **Guida - Gestione Spese Tartufaio**\n\nTraccia tutte le spese vive connesse all'attività (carburante, attrezzatura, visite veterinarie e tasse) e visualizza il totale dell'anno corrente.",
        'bilancio': "ℹ️ **Guida - Contabilità & Bilancio Annuo**\n\nMonitora i guadagni netti, le spese totali, l'utile effettivo e verifica in tempo reale il rispetto della soglia limite di occasionalità di 7.000,00 €.",
        'export': `ℹ️ Guida - Report & Backup Dati\n\nEsporta i dati contabili in formato CSV.\n\nIl backup automatico ti guida a scegliere la cartella Download del dispositivo e poi crea/usa sempre il percorso ${buildAutomaticBackupPathLabel('Download')} per salvare backup_truffle_automatico.json. Usa '📁 Imposta Cartella Backup' per registrare o cambiare il percorso, poi '💾 Salva Backup Ora' per forzarlo manualmente.\n\nSe il browser non supporta la scelta guidata della cartella, l'app usa il normale download del file JSON.`,
        'vet-emergency': "ℹ️ **Guida - Pronto Soccorso & Cliniche H24**\n\nMemorizza i contatti delle cliniche veterinarie aperte 24 ore su 24 e invia rapidamente la tua posizione GPS in caso di emergenza.",
        'clienti': "ℹ️ **Guida - Rubrica Clienti**\n\nVisualizza l'elenco dei tuoi clienti ordinati per volume d'acquisto, consulta lo storico, aggiungi nuovi nominativi e gestisci modifiche, note ed eliminazioni.",
        'archivio': "ℹ️ **Guida - Archivio Date per Regione**\n\nGestisci e personalizza i calendari regionali di raccolta dei tartufi o estrai automaticamente le date incollando il testo normativo ufficiale.",
        'calendario': "ℹ️ **Guida - Calendario Raccolta (GPS)**\n\nVerifica in base alla tua posizione GPS attuale quali specie di tartufo hanno il periodo di raccolta attualmente aperto o chiuso.",
        'mappa_offline': "ℹ️ **Guida - Download Mappa Offline**\n\nSeleziona le regioni italiane che ti interessano, premi '💾 Salva Preferenze' per registrarle (anche per svuotarle) e poi usa '📥 Scarica Regioni Selezionate' quando vuoi scaricare la cache. I quadratini della mappa (tile) vengono salvati nella memoria del browser. La mappa funzionerà anche senza connessione internet, finché la cache non viene svuotata dal sistema.\n\n🔄 **Re-download automatico**: l'app ricorda le regioni e il livello di zoom scelti. Se il browser svuota la cache, non appena torni online la mappa viene riscaricata in automatico, senza che tu debba fare nulla. Se il provider rallenta o blocca temporaneamente i download, l'app riduce il ritmo, aspetta e poi riprende da sola dalle tile mancanti.\n\nConsigli:\n• Usa la connessione Wi-Fi per scaricare\n• Zoom 14 è il miglior compromesso tra dettaglio e spazio\n• Puoi eliminare la cache in qualsiasi momento con il tasto apposito"
    };

    const messaggio = guideTesti[moduleName] || "ℹ️ Guida non disponibile per questo modulo.";
    await appAlert(messaggio);
}

// ── Mappa Offline ──────────────────────────────────────────────────────────────

/**
 * Calcola le coordinate (x, y) di un tile OSM dato lat/lng e zoom.
 */
function latlngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

/**
 * Genera l'elenco di tutti gli URL tile compresi nel bounding box [minLat, minLng, maxLat, maxLng]
 * per tutti i livelli di zoom da minZoom a maxZoom.
 */
function getTileUrls(bbox, minZoom, maxZoom) {
    const [minLat, minLng, maxLat, maxLng] = bbox;
    const urls = [];
    for (let z = minZoom; z <= maxZoom; z++) {
        const tileMin = latlngToTile(maxLat, minLng, z);
        const tileMax = latlngToTile(minLat, maxLng, z);
        for (let x = tileMin.x; x <= tileMax.x; x++) {
            for (let y = tileMin.y; y <= tileMax.y; y++) {
                urls.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
            }
        }
    }
    return urls;
}

function getCacheStorageSafe() {
    const cacheStorage = globalThis.caches;
    if (!cacheStorage || typeof cacheStorage.open !== 'function') return null;
    return cacheStorage;
}

function isOsmTileUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'tile.openstreetmap.org' || /^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname);
    } catch {
        return false;
    }
}

function normalizeOsmTileUrl(url) {
    try {
        const parsed = new URL(url);
        if (/^[abc]\.tile\.openstreetmap\.org$/.test(parsed.hostname)) {
            parsed.hostname = 'tile.openstreetmap.org';
            return parsed.toString();
        }
    } catch {
        // URL non valido, restituisce l'originale invariato
    }
    return url;
}

const OFFLINE_DOWNLOAD_BATCH_SIZE = 3;
const OFFLINE_STORAGE_QUOTA_ERRORS_TO_ABORT = 8;
const OFFLINE_DOWNLOAD_BATCH_PAUSE_MS = 450;
const OFFLINE_DOWNLOAD_BATCH_PAUSE_JITTER_MS = 250;
const OFFLINE_DOWNLOAD_PROVIDER_RESUME_DELAY_MS = 5000;
const OFFLINE_DOWNLOAD_PROVIDER_COOLDOWN_BASE_MS = 15000;
const OFFLINE_DOWNLOAD_PROVIDER_COOLDOWN_MAX_MS = 120000;

function buildOfflineTileUrlsByZoom(regionIds, maxZoom) {
    const urlsByZoom = [];
    const seenGlobal = new Set();
    for (let zoom = OFFLINE_MAP_MIN_ZOOM; zoom <= maxZoom; zoom++) {
        const urlsAtZoom = [];
        for (const id of regionIds) {
            const regione = REGIONI_ITALIA_OFFLINE.find(r => r.id === id);
            if (!regione) continue;
            const zoomUrls = getTileUrls(regione.bbox, zoom, zoom);
            for (const url of zoomUrls) {
                if (seenGlobal.has(url)) continue;
                seenGlobal.add(url);
                urlsAtZoom.push(url);
            }
        }
        if (urlsAtZoom.length > 0) {
            urlsByZoom.push({ zoom, urls: urlsAtZoom });
        }
    }
    return urlsByZoom;
}

async function getOfflineMapCachedUrlsSet({ includeLegacy = false, validateSize = false } = {}) {
    const cacheStorage = getCacheStorageSafe();
    if (!cacheStorage) throw new Error('CACHE_API_UNAVAILABLE');
    // Apre direttamente la cache (se non esiste, open() la crea vuota e keys() restituirà []).
    // Non si usa caches.keys() per il pre-check perché su alcuni browser può restituire
    // un array vuoto o incompleto anche quando la cache esiste, causando false-negative.
    let cache;
    try {
        cache = await cacheStorage.open(OFFLINE_MAP_CACHE_NAME);
    } catch {
        return new Set();
    }
    if (!cache || typeof cache.keys !== 'function') return new Set();
    let requests = [];
    try {
        requests = await cache.keys();
    } catch {
        return new Set();
    }
    // Cache dedicata alle tile: per coerenza consideriamo solo URL OSM.
    // Gli URL vengono normalizzati (subdomain a/b/c → nessun subdomain) per evitare
    // false-negative causati da tile scaricate con subdomain diversi.
    const cachedUrls = new Set();
    if (validateSize) {
        // Processa le richieste a blocchi per evitare migliaia di match() concorrenti.
        for (let i = 0; i < requests.length; i += OFFLINE_DOWNLOAD_BATCH_SIZE) {
            const batch = requests.slice(i, i + OFFLINE_DOWNLOAD_BATCH_SIZE);
            await Promise.all(batch.map(async (req) => {
                if (!isOsmTileUrl(req.url)) return;
                try {
                    const response = await cache.match(req, { ignoreVary: true });
                    if (isValidCachedTileResponse(response)) {
                        cachedUrls.add(normalizeOsmTileUrl(req.url));
                    }
                } catch {
                    // match() non disponibile o tile inaccessibile, ignorata
                }
            }));
        }
    } else {
        for (const req of requests) {
            if (isOsmTileUrl(req.url)) cachedUrls.add(normalizeOsmTileUrl(req.url));
        }
    }

    if (!includeLegacy || typeof cacheStorage.keys !== 'function') {
        return cachedUrls;
    }

    let cacheNames = [];
    try {
        cacheNames = await cacheStorage.keys();
    } catch {
        return cachedUrls;
    }

    const appCacheNames = cacheNames.filter((name) => name.startsWith(APP_CACHE_NAME_PREFIX));
    if (appCacheNames.length <= 1) {
        return cachedUrls;
    }
    const currentAppCacheName = [...appCacheNames].sort().at(-1);
    const legacyCacheNames = appCacheNames.filter((name) => name !== currentAppCacheName);
    for (const legacyCacheName of legacyCacheNames) {
        let legacyCache;
        try {
            legacyCache = await cacheStorage.open(legacyCacheName);
        } catch {
            continue;
        }
        if (!legacyCache || typeof legacyCache.keys !== 'function') continue;
        let legacyRequests = [];
        try {
            legacyRequests = await legacyCache.keys();
        } catch {
            continue;
        }
        legacyRequests.forEach((req) => {
            if (isOsmTileUrl(req.url)) cachedUrls.add(normalizeOsmTileUrl(req.url));
        });
    }

    return cachedUrls;
}

function getOfflinePreferencesFromInputs() {
    const regioni = [...document.querySelectorAll('.offline-region-cb:checked')].map((cb) => cb.value);
    const zoomSelect = document.getElementById('offline-zoom-select');
    const parsedZoom = parseInt(zoomSelect ? zoomSelect.value : `${OFFLINE_MAP_DEFAULT_MAX_ZOOM}`, 10);
    const maxZoom = Number.isFinite(parsedZoom) ? parsedZoom : OFFLINE_MAP_DEFAULT_MAX_ZOOM;
    return { regioni, maxZoom };
}

function buildOfflineSelectionCoverage(preferenze, cachedUrls) {
    const normalizedPreferences = {
        regioni: Array.isArray(preferenze?.regioni) ? preferenze.regioni : [],
        maxZoom: typeof preferenze?.maxZoom === 'number' ? preferenze.maxZoom : OFFLINE_MAP_DEFAULT_MAX_ZOOM
    };
    const urlsByZoom = buildOfflineTileUrlsByZoom(normalizedPreferences.regioni, normalizedPreferences.maxZoom)
        .map((level) => {
            const coverage = summarizeTileCoverage(cachedUrls, level.urls);
            return { zoom: level.zoom, ...coverage };
        });
    const allUrls = urlsByZoom.flatMap((level) => level.tileUrls);
    return {
        preferenze: normalizedPreferences,
        urlsByZoom,
        ...summarizeTileCoverage(cachedUrls, allUrls)
    };
}

async function analyzeOfflineSelectionCoverage(preferenze) {
    const cachedUrls = await getOfflineMapCachedUrlsSet({ includeLegacy: true, validateSize: true });
    return buildOfflineSelectionCoverage(preferenze, cachedUrls);
}

function renderOfflineSelectionCoverage(coverage, { errorMessage = '', loading = false } = {}) {
    const coverageEl = document.getElementById('offline-selection-coverage');
    if (!coverageEl) return;
    if (loading) {
        coverageEl.innerHTML = '<p style="margin:0; color:#6b7280; font-size:0.8rem;">Verifica copertura in corso…</p>';
        return;
    }
    if (errorMessage) {
        coverageEl.innerHTML = `<p style="margin:0; color:#ef4444; font-size:0.8rem;">⚠️ ${escapeHtml(errorMessage)}</p>`;
        return;
    }
    if (!coverage || coverage.preferenze.regioni.length === 0) {
        coverageEl.innerHTML = '<p style="margin:0; color:#6b7280; font-size:0.8rem;">Seleziona almeno una regione per verificare le tile richieste.</p>';
        return;
    }
    if (coverage.total === 0) {
        coverageEl.innerHTML = '<p style="margin:0; color:#6b7280; font-size:0.8rem;">Nessuna tile richiesta per la selezione corrente.</p>';
        return;
    }

    const badge = coverage.isFullyCached
        ? '<span style="color:#22c55e; font-size:0.78rem; font-weight:bold;">✅ Copertura completa</span>'
        : coverage.cached > 0
            ? '<span style="color:#f59e0b; font-size:0.78rem; font-weight:bold;">🟨 Copertura parziale</span>'
            : '<span style="color:#ef4444; font-size:0.78rem; font-weight:bold;">⬜ Nessuna tile valida in cache</span>';
    const missingByZoom = coverage.urlsByZoom
        .filter((level) => level.missing > 0)
        .map((level) => `z${level.zoom}: ${level.missing}`)
        .join(' • ');
    const zoomRange = `${OFFLINE_MAP_MIN_ZOOM}–${coverage.preferenze.maxZoom}`;

    coverageEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
            <span style="color:#ddd6c8;">Regioni selezionate: ${coverage.preferenze.regioni.length}</span>
            ${badge}
        </div>
        <p style="margin:0 0 6px 0; color:#ddd6c8;">Tile attese per zoom ${zoomRange}: <strong>${coverage.total}</strong></p>
        <p style="margin:0 0 6px 0; color:#22c55e;">Tile valide in cache: <strong>${coverage.cached}</strong></p>
        <p style="margin:0 0 6px 0; color:${coverage.missing > 0 ? '#f59e0b' : '#22c55e'};">Tile mancanti: <strong>${coverage.missing}</strong></p>
        ${missingByZoom ? `<p style="margin:0; color:#b8b0a0; font-size:0.78rem;">Mancanti per zoom: ${escapeHtml(missingByZoom)}</p>` : '<p style="margin:0; color:#6b7280; font-size:0.78rem;">Tutte le tile richieste risultano presenti e valide.</p>'}
    `;
}

async function verificaCoperturaMappaOffline({ preferenze = getOfflinePreferencesFromInputs(), notify = true } = {}) {
    if (!Array.isArray(preferenze.regioni) || preferenze.regioni.length === 0) {
        renderOfflineSelectionCoverage(null);
        if (notify) showToast('Seleziona almeno una regione prima di verificare la copertura.', 'info');
        return null;
    }
    renderOfflineSelectionCoverage(null, { loading: true });
    try {
        const coverage = await analyzeOfflineSelectionCoverage(preferenze);
        renderOfflineSelectionCoverage(coverage);
        if (notify) {
            if (coverage.missing === 0) {
                showToast(`✅ Copertura completa: ${coverage.cached} tile valide già presenti in cache.`, 'success');
            } else {
                showToast(`ℹ️ Copertura parziale: mancano ${coverage.missing} tile su ${coverage.total}.`, 'info');
            }
        }
        return coverage;
    } catch {
        renderOfflineSelectionCoverage(null, { errorMessage: 'Impossibile verificare la copertura delle tile.' });
        if (notify) showToast('Impossibile verificare la copertura delle tile.', 'error');
        return null;
    }
}

function saveOfflinePreferences(preferenze) {
    localStorage.setItem(OFFLINE_REGIONI_PREFERITE_KEY, JSON.stringify(preferenze));
}

function buildOfflineRecoveryPreferenceKey(preferenze) {
    const regioni = Array.isArray(preferenze?.regioni) ? [...preferenze.regioni].sort() : [];
    const maxZoom = Number.isFinite(Number(preferenze?.maxZoom)) ? Number(preferenze.maxZoom) : OFFLINE_MAP_DEFAULT_MAX_ZOOM;
    return JSON.stringify({ regioni, maxZoom });
}

function readOfflineRecoveryState() {
    return readStorageJSON(OFFLINE_RECOVERY_STATE_KEY, null);
}

function persistOfflineRecoveryState(state) {
    try {
        localStorage.setItem(OFFLINE_RECOVERY_STATE_KEY, JSON.stringify(state));
    } catch {
        // localStorage non disponibile o pieno, nessuna persistenza dello stato
    }
}

function clearOfflineMapRecoveryResumeTimer() {
    if (offlineMapRecoveryResumeTimerId !== null) {
        clearTimeout(offlineMapRecoveryResumeTimerId);
        offlineMapRecoveryResumeTimerId = null;
    }
}

function clearOfflineRecoveryState() {
    clearOfflineMapRecoveryResumeTimer();
    try {
        localStorage.removeItem(OFFLINE_RECOVERY_STATE_KEY);
    } catch {
        // localStorage non disponibile, nessuna azione
    }
}

function buildOfflineRecoveryState(preferenze, status, {
    trigger = 'manual',
    remainingMissing = null,
    missingTotal = null,
    recoveredTiles = null,
    nextRetryAt = null,
    consecutiveProviderErrors = 0,
    consecutiveThrottledErrors = 0
} = {}) {
    return {
        status,
        trigger,
        preferenze,
        preferenceKey: buildOfflineRecoveryPreferenceKey(preferenze),
        remainingMissing,
        missingTotal,
        recoveredTiles,
        nextRetryAt,
        consecutiveProviderErrors: Math.max(0, Number(consecutiveProviderErrors) || 0),
        consecutiveThrottledErrors: Math.max(0, Number(consecutiveThrottledErrors) || 0),
        updatedAt: Date.now()
    };
}

function formatOfflineDelayMs(delayMs) {
    const totalSeconds = Math.max(1, Math.ceil((Math.max(0, Number(delayMs) || 0)) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds}s`;
}

function getOfflineRecoveryDelayMs(preferenze) {
    const state = readOfflineRecoveryState();
    if (!state || state.preferenceKey !== buildOfflineRecoveryPreferenceKey(preferenze)) return 0;
    if (!Number.isFinite(Number(state.nextRetryAt))) return 0;
    return Math.max(0, Number(state.nextRetryAt) - Date.now());
}

function scheduleOfflineRecoveryResume(preferenze, delayMs, trigger = 'resume') {
    clearOfflineMapRecoveryResumeTimer();
    if (!navigator.onLine) return;
    const safeDelayMs = Math.max(0, Number(delayMs) || 0);
    offlineMapRecoveryResumeTimerId = setTimeout(() => {
        offlineMapRecoveryResumeTimerId = null;
        runOfflineMapRecovery({
            preferenze,
            trigger,
            showProgress: true,
            startToastMessage: '🔄 Ripresa automatica download mappa offline…',
            waitingToastMessage: '⏸️ Download temporaneamente rallentato dal provider.'
        }).catch(() => {});
    }, safeDelayMs);
}

function buildOfflineFailureDetail(quotaErrors, nonQuotaErrors) {
    if (quotaErrors > 0 && nonQuotaErrors > 0) {
        return `${quotaErrors} da spazio cache esaurito, ${nonQuotaErrors} da rete/provider`;
    }
    if (quotaErrors > 0) {
        return `${quotaErrors} da spazio cache esaurito`;
    }
    if (nonQuotaErrors > 0) {
        return `${nonQuotaErrors} da rete/provider`;
    }
    return 'nessun errore rilevato';
}

async function salvaPreferenzeMappaOffline() {
    const preferenze = getOfflinePreferencesFromInputs();
    saveOfflinePreferences(preferenze);
    const recoveryState = readOfflineRecoveryState();
    if (
        preferenze.regioni.length === 0
        || (recoveryState && recoveryState.preferenceKey !== buildOfflineRecoveryPreferenceKey(preferenze))
    ) {
        clearOfflineRecoveryState();
    }
    applyMapConnectivityZoomCap();
    await runAutomaticLocalBackup();
    aggiornaStatoCacheRegioni();
    if (preferenze.regioni.length > 0) {
        showToast('✅ Preferenze mappa offline salvate.', 'success');
    } else {
        showToast('✅ Preferenze salvate: nessuna regione selezionata.', 'success');
    }
}

async function runOfflineMapRecovery({
    preferenze,
    trigger = 'manual',
    showProgress = false,
    startToastMessage = '',
    waitingToastMessage = ''
} = {}) {
    if (!Array.isArray(preferenze?.regioni) || preferenze.regioni.length === 0) {
        if (showProgress) {
            const progressArea = document.getElementById('offline-progress-area');
            if (progressArea) progressArea.style.display = 'none';
        }
        return null;
    }

    if (isOfflineMapRecoveryRunning) {
        if (trigger === 'manual') {
            showToast('⏳ Recupero mappa offline già in corso.', 'info');
        }
        return null;
    }

    const waitingDelayMs = getOfflineRecoveryDelayMs(preferenze);
    if (waitingDelayMs > 0 && trigger !== 'resume') {
        scheduleOfflineRecoveryResume(preferenze, waitingDelayMs, 'resume');
        if (waitingToastMessage) {
            showToast(`${waitingToastMessage} Ripresa automatica tra ${formatOfflineDelayMs(waitingDelayMs)}.`, 'info');
        }
        return null;
    }

    isOfflineMapRecoveryRunning = true;
    clearOfflineMapRecoveryResumeTimer();

    const getProgressEls = showProgress
        ? () => ({
            progressArea: document.getElementById('offline-progress-area'),
            progressBar: document.getElementById('offline-progress-bar'),
            progressText: document.getElementById('offline-progress-text')
        })
        : () => ({ progressArea: null, progressBar: null, progressText: null });

    const { progressArea, progressBar, progressText } = getProgressEls();
    if (progressArea) progressArea.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = 'Recupero tile mancanti: 0 / 0…';

    try {
        if (startToastMessage) showToast(startToastMessage, 'info');
        renderOfflineSelectionCoverage(null, { loading: true });
        let coverage;
        try {
            coverage = await analyzeOfflineSelectionCoverage(preferenze);
            renderOfflineSelectionCoverage(coverage);
        } catch {
            renderOfflineSelectionCoverage(null, { errorMessage: 'Impossibile verificare la copertura delle tile.' });
        }
        if (!coverage) {
            showToast('Impossibile analizzare le tile richieste prima del download.', 'error');
            return null;
        }

        const total = coverage.total;
        const missingTotal = coverage.missing;
        if (total === 0) {
            clearOfflineRecoveryState();
            showToast('Nessuna tile richiesta per la selezione corrente.', 'info');
            return { status: 'empty' };
        }
        if (missingTotal === 0) {
            clearOfflineRecoveryState();
            showToast(`✅ Nessuna tile mancante: copertura già completa (${coverage.cached}/${coverage.total}).`, 'success');
            return { status: 'complete', coverage };
        }
        const { progressText: progressTextInit } = getProgressEls();
        if (progressTextInit) progressTextInit.textContent = `Recupero tile mancanti: 0 / ${missingTotal}…`;

        let cache;
        try {
            cache = await caches.open(OFFLINE_MAP_CACHE_NAME);
        } catch {
            showToast('Il browser non supporta la cache offline. Usa Chrome o Firefox.', 'error');
            return null;
        }

        const storedRecoveryState = readOfflineRecoveryState();
        const initialState = storedRecoveryState?.preferenceKey === buildOfflineRecoveryPreferenceKey(preferenze)
            ? {
                consecutiveProviderErrors: storedRecoveryState.consecutiveProviderErrors,
                consecutiveThrottledErrors: storedRecoveryState.consecutiveThrottledErrors
            }
            : undefined;

        const result = await downloadTileBatchesWithRecovery(coverage.urlsByZoom, {
            cache,
            downloadTileFn: downloadTileWithRetry,
            batchSize: OFFLINE_DOWNLOAD_BATCH_SIZE,
            quotaErrorsToAbort: OFFLINE_STORAGE_QUOTA_ERRORS_TO_ABORT,
            initialState,
            batchPauseBaseMs: OFFLINE_DOWNLOAD_BATCH_PAUSE_MS,
            batchPauseJitterMs: OFFLINE_DOWNLOAD_BATCH_PAUSE_JITTER_MS,
            providerCooldownBaseMs: OFFLINE_DOWNLOAD_PROVIDER_COOLDOWN_BASE_MS,
            providerCooldownMaxMs: OFFLINE_DOWNLOAD_PROVIDER_COOLDOWN_MAX_MS,
            onBatchComplete: ({ level, totals, adaptivePauseMs, state, summary }) => {
                const { progressArea: pa, progressBar: pb, progressText: pt } = getProgressEls();
                if (pa) pa.style.display = 'block';
                const pct = Math.round((totals.done / missingTotal) * 100);
                if (pb) pb.style.width = pct + '%';
                if (pt) {
                    const slowdownNote = state.consecutiveProviderErrors > 0
                        ? ` • ritmo ridotto (${formatOfflineDelayMs(adaptivePauseMs)})`
                        : '';
                    const throttleNote = summary.throttledErrors > 0 ? ' • server in attesa' : '';
                    pt.textContent = `Recupero tile mancanti: ${totals.done} / ${missingTotal} (${pct}%)… z${level.zoom}${slowdownNote}${throttleNote}`;
                }
            }
        });

        const nonQuotaErrors = Math.max(0, result.nonQuotaErrors);
        const updatedCoverage = await analyzeOfflineSelectionCoverage(preferenze).catch(() => null);
        if (updatedCoverage) renderOfflineSelectionCoverage(updatedCoverage);
        const remainingMissing = updatedCoverage ? updatedCoverage.missing : null;
        const recoveredTiles = updatedCoverage ? Math.max(0, missingTotal - updatedCoverage.missing) : null;

        if (result.abortedByQuota) {
            persistOfflineRecoveryState(buildOfflineRecoveryState(preferenze, 'quota_stopped', {
                trigger,
                remainingMissing,
                missingTotal,
                recoveredTiles,
                consecutiveProviderErrors: result.state?.consecutiveProviderErrors || 0,
                consecutiveThrottledErrors: result.state?.consecutiveThrottledErrors || 0
            }));
            showToast(`⚠️ Download interrotto: recuperate ${recoveredTiles ?? 'n/d'}/${missingTotal} tile mancanti (${buildOfflineFailureDetail(result.quotaErrors, nonQuotaErrors)}). Riduci lo zoom massimo (11–12) o scarica meno regioni.`, 'error');
            return { status: 'quota_stopped', result, updatedCoverage };
        }

        if (!updatedCoverage) {
            const resumeDelayMs = result.pausedForProvider
                ? Math.max(OFFLINE_DOWNLOAD_PROVIDER_RESUME_DELAY_MS, result.cooldownMs || 0)
                : OFFLINE_DOWNLOAD_PROVIDER_RESUME_DELAY_MS;
            const recoveryStatus = result.pausedForProvider ? 'provider_paused' : 'resumable';
            persistOfflineRecoveryState(buildOfflineRecoveryState(preferenze, recoveryStatus, {
                trigger,
                remainingMissing,
                missingTotal,
                recoveredTiles,
                nextRetryAt: Date.now() + resumeDelayMs,
                consecutiveProviderErrors: result.state?.consecutiveProviderErrors || 0,
                consecutiveThrottledErrors: result.state?.consecutiveThrottledErrors || 0
            }));
            scheduleOfflineRecoveryResume(preferenze, resumeDelayMs, 'resume');
            showToast(`⚠️ Verifica finale non disponibile: recuperate ${recoveredTiles ?? 'n/d'}/${missingTotal} tile mancanti. Nuovo tentativo automatico tra ${formatOfflineDelayMs(resumeDelayMs)}.`, 'info');
            return { status: recoveryStatus, result, updatedCoverage: null };
        }

        if (remainingMissing === 0) {
            clearOfflineRecoveryState();
            showToast(`✅ Copertura completata: recuperate tutte le ${missingTotal} tile mancanti (${updatedCoverage?.cached ?? coverage.cached}/${total} valide in cache).`, 'success');
            return { status: 'complete', result, updatedCoverage };
        }

        if (result.pausedForProvider) {
            const resumeDelayMs = Math.max(OFFLINE_DOWNLOAD_PROVIDER_RESUME_DELAY_MS, result.cooldownMs || 0);
            persistOfflineRecoveryState(buildOfflineRecoveryState(preferenze, 'provider_paused', {
                trigger,
                remainingMissing,
                missingTotal,
                recoveredTiles,
                nextRetryAt: Date.now() + resumeDelayMs,
                consecutiveProviderErrors: result.state?.consecutiveProviderErrors || 0,
                consecutiveThrottledErrors: result.state?.consecutiveThrottledErrors || 0
            }));
            scheduleOfflineRecoveryResume(preferenze, resumeDelayMs, 'resume');
            showToast(`⏸️ Download in pausa per limitazione del provider: recuperate ${recoveredTiles ?? 'n/d'}/${missingTotal} tile mancanti, ne restano ${remainingMissing ?? 'n/d'}. Ripresa automatica tra ${formatOfflineDelayMs(resumeDelayMs)}.`, 'info');
            return { status: 'provider_paused', result, updatedCoverage };
        }

        if ((remainingMissing ?? 0) > 0) {
            const resumeDelayMs = OFFLINE_DOWNLOAD_PROVIDER_RESUME_DELAY_MS;
            persistOfflineRecoveryState(buildOfflineRecoveryState(preferenze, 'resumable', {
                trigger,
                remainingMissing,
                missingTotal,
                recoveredTiles,
                nextRetryAt: Date.now() + resumeDelayMs,
                consecutiveProviderErrors: result.state?.consecutiveProviderErrors || 0,
                consecutiveThrottledErrors: result.state?.consecutiveThrottledErrors || 0
            }));
            scheduleOfflineRecoveryResume(preferenze, resumeDelayMs, 'resume');
            showToast(`🔄 Download parziale ma riprendibile: recuperate ${recoveredTiles ?? 'n/d'}/${missingTotal} tile mancanti, ne restano ${remainingMissing ?? 'n/d'} (${buildOfflineFailureDetail(result.quotaErrors, nonQuotaErrors)}). Nuovo tentativo automatico tra ${formatOfflineDelayMs(resumeDelayMs)}.`, 'info');
            return { status: 'resumable', result, updatedCoverage };
        }

        clearOfflineRecoveryState();
        return { status: 'complete', result, updatedCoverage };
    } finally {
        const { progressArea: paFinal } = getProgressEls();
        if (paFinal) paFinal.style.display = 'none';
        aggiornaStatoCacheRegioni();
        updateOfflineMapRuntimeStatusIndicator();
        isOfflineMapRecoveryRunning = false;
    }
}

async function scaricaRegioniOffline() {
    const preferenze = getOfflinePreferencesFromInputs();
    if (preferenze.regioni.length === 0) {
        showToast('Seleziona almeno una regione prima di scaricare.', 'error');
        return;
    }
    saveOfflinePreferences(preferenze);
    await runOfflineMapRecovery({
        preferenze,
        trigger: 'manual',
        showProgress: true,
        startToastMessage: '📥 Download mappa offline in corso…',
        waitingToastMessage: '⏸️ Download temporaneamente rallentato dal provider.'
    });
    // Se il Service Worker non controlla ancora questa pagina (es. primo avvio dopo
    // installazione o aggiornamento), le tile in cache non vengono intercettate finché
    // la pagina non viene ricaricata. In questo caso avvisiamo l'utente.
    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
        if (!navigator.serviceWorker.controller) {
            showToast(
                registration
                    ? '🔄 Ricarica l\'app per collegare il Service Worker alla mappa offline (tieni premuto il tasto Aggiorna o chiudi e riapri l\'app).'
                    : '⚠️ Il Service Worker non risulta registrato: ricarica l\'app con connessione attiva e riprova.',
                registration ? 'info' : 'error'
            );
        }
    }
}

async function aggiornaStatoCacheRegioni() {
    const statusEl = document.getElementById('offline-cache-status');

    // Improvement 5: render immediately from persisted counts (istantaneo, senza attendere la Cache API).
    const savedStatus = readStorageJSON(OFFLINE_CACHE_STATUS_KEY, null);
    if (statusEl && savedStatus && Array.isArray(savedStatus.regions)) {
        let htmlCached = '';
        for (const entry of savedStatus.regions) {
            const regione = REGIONI_ITALIA_OFFLINE.find(r => r.id === entry.id);
            if (!regione) continue;
            // Usa la stessa condizione di isOfflineRegionFullyCached: totale > 0 e cached === total.
            const isFullyCached = entry.total > 0 && entry.cached === entry.total;
            const badge = isFullyCached
                ? `<span style="color:#22c55e; font-size:0.75rem; font-weight:bold; margin-left:4px;">✅ in cache</span>`
                : entry.cached > 0
                    ? `<span style="color:#f59e0b; font-size:0.75rem; margin-left:4px;">🟨 cache parziale</span>`
                : `<span style="color:#6b7280; font-size:0.75rem; margin-left:4px;">⬜ non scaricata</span>`;
            htmlCached += `<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:0.82rem; color:#ddd6c8;">${escapeHtml(regione.nome)}</span>${badge}</div>`;
        }
        if (htmlCached) statusEl.innerHTML = htmlCached;
    }

    let cachedUrls = new Set();
    try {
        // Improvement 1: validateSize=true esclude tile corrotte o troncate dal conteggio.
        cachedUrls = await getOfflineMapCachedUrlsSet({ includeLegacy: true, validateSize: true });
    } catch {
        if (statusEl) {
            statusEl.innerHTML = '<p style="margin:0; color:#ef4444; font-size:0.8rem;">⚠️ Impossibile verificare la cache locale del browser.</p>';
        }
        return;
    }

    if (!statusEl) return;

    // Improvement 3: usa sempre il maxZoom salvato nelle preferenze, non quello del <select>
    // (il select può mostrare un valore non ancora salvato e rendere il badge fuorviante).
    const pref = getOfflinePreferences();
    const maxZoom = typeof pref.maxZoom === 'number' ? pref.maxZoom : OFFLINE_MAP_DEFAULT_MAX_ZOOM;

    let html = '';
    const statusRegions = [];
    for (const regione of REGIONI_ITALIA_OFFLINE) {
        const sampleUrls = getTileUrls(regione.bbox, OFFLINE_MAP_MIN_ZOOM, maxZoom);
        const cachedTileCount = countCachedTileUrls(cachedUrls, sampleUrls);
        const isFullyCached = isOfflineRegionFullyCached(cachedUrls, sampleUrls);
        statusRegions.push({ id: regione.id, total: sampleUrls.length, cached: cachedTileCount });
        const badge = isFullyCached
            ? `<span style="color:#22c55e; font-size:0.75rem; font-weight:bold; margin-left:4px;">✅ in cache</span>`
            : cachedTileCount > 0
                ? `<span style="color:#f59e0b; font-size:0.75rem; margin-left:4px;">🟨 cache parziale</span>`
            : `<span style="color:#6b7280; font-size:0.75rem; margin-left:4px;">⬜ non scaricata</span>`;
        html += `<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:0.82rem; color:#ddd6c8;">${escapeHtml(regione.nome)}</span>${badge}</div>`;
    }
    statusEl.innerHTML = html;

    // Improvement 5: salva i conteggi in localStorage per il rendering immediato al prossimo avvio.
    try {
        localStorage.setItem(OFFLINE_CACHE_STATUS_KEY, JSON.stringify({ maxZoom, regions: statusRegions }));
    } catch {
        // localStorage non disponibile o quota esaurita, nessuna azione
    }
}

async function eliminaCacheMappaOffline() {
    const conferma = await appConfirm('Eliminare tutta la cache della mappa offline? Dovrai riscaricarne le regioni per usarla offline.');
    if (!conferma) return;
    try {
        const deleted = await caches.delete(OFFLINE_MAP_CACHE_NAME);
        if (deleted) {
            showToast('✅ Cache mappa offline eliminata.', 'success');
        } else {
            showToast('Nessuna cache offline trovata.', 'info');
        }
    } catch {
        showToast('Errore durante l\'eliminazione della cache.', 'error');
    }
    clearOfflineRecoveryState();
    // Improvement 5: invalida i conteggi salvati poiché la cache è stata svuotata.
    try { localStorage.removeItem(OFFLINE_CACHE_STATUS_KEY); } catch {
        // localStorage non disponibile, nessuna azione
    }
    aggiornaStatoCacheRegioni();
    updateOfflineMapRuntimeStatusIndicator();
}

// ── Pulizia tile invalide (Improvement 4) ──────────────────────────────────────
async function cleanupInvalidCachedTiles() {
    const cacheStorage = getCacheStorageSafe();
    if (!cacheStorage) return;
    let cache;
    try {
        cache = await cacheStorage.open(OFFLINE_MAP_CACHE_NAME);
    } catch { return; }
    if (!cache || typeof cache.keys !== 'function') return;
    let requests;
    try {
        requests = await cache.keys();
    } catch { return; }
    for (let i = 0; i < requests.length; i += OFFLINE_DOWNLOAD_BATCH_SIZE) {
        const batch = requests.slice(i, i + OFFLINE_DOWNLOAD_BATCH_SIZE);
        await Promise.all(batch.map(async (req) => {
            if (!isOsmTileUrl(req.url)) return;
            try {
                const response = await cache.match(req, { ignoreVary: true });
                if (!isValidCachedTileResponse(response)) {
                    await cache.delete(req).catch(() => {});
                }
            } catch {
                // match() non disponibile o tile inaccessibile, ignorata
            }
        }));
    }
}

// ── Re-download automatico regioni offline al ritorno della connessione ────────
function riprendiRecuperoMappaOfflineSeInAttesa() {
    const state = readOfflineRecoveryState();
    if (!state || !Array.isArray(state.preferenze?.regioni) || state.preferenze.regioni.length === 0) return false;
    if (!['provider_paused', 'resumable'].includes(state.status)) return false;
    if (state.preferenceKey !== buildOfflineRecoveryPreferenceKey(getOfflinePreferences())) {
        clearOfflineRecoveryState();
        return false;
    }
    const nextRetryAt = Number(state.nextRetryAt);
    const delayMs = Number.isFinite(nextRetryAt) ? Math.max(0, nextRetryAt - Date.now()) : 0;
    scheduleOfflineRecoveryResume(state.preferenze, delayMs, 'resume');
    return true;
}

async function autoRiscaricaRegioniOfflineSeNecessario() {
    if (riprendiRecuperoMappaOfflineSeInAttesa()) return;
    const pref = getOfflinePreferences();
    if (!Array.isArray(pref.regioni) || pref.regioni.length === 0) return;
    let coverage;
    try {
        coverage = await analyzeOfflineSelectionCoverage(pref);
    } catch {
        return;
    }
    if (!coverage || coverage.total === 0 || coverage.missing === 0) return;
    await runOfflineMapRecovery({
        preferenze: pref,
        trigger: 'automatic',
        showProgress: false,
        startToastMessage: '🔄 Cache mappa offline incompleta: recupero delle tile mancanti in corso…',
        waitingToastMessage: '⏸️ Recupero automatico mappa offline in attesa del provider.'
    });
}

window.addEventListener('online', () => {
    applyMapConnectivityZoomCap();
    updateOfflineMapRuntimeStatusIndicator();
    updateZoomIndicator();
    autoRiscaricaRegioniOfflineSeNecessario();
});

window.addEventListener('offline', () => {
    clampMapZoomForOffline();
    updateOfflineMapRuntimeStatusIndicator();
    updateZoomIndicator();
});
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (shouldReloadOnNextServiceWorkerControllerChange) {
            shouldReloadOnNextServiceWorkerControllerChange = false;
            window.location.reload();
            return;
        }
        updateOfflineMapRuntimeStatusIndicator();
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
        const messageType = event?.data?.type;
        if (messageType === 'tile-network-unavailable') {
            if (!isTileNetworkUnavailable) {
                isTileNetworkUnavailable = true;
                clampMapZoomForOffline();
                updateOfflineMapRuntimeStatusIndicator();
                updateZoomIndicator();
            }
            return;
        }
        if (messageType === 'tile-network-ok') {
            if (isTileNetworkUnavailable && navigator.onLine) {
                isTileNetworkUnavailable = false;
                applyMapConnectivityZoomCap();
                updateOfflineMapRuntimeStatusIndicator();
                updateZoomIndicator();
                autoRiscaricaRegioniOfflineSeNecessario();
            }
        }
    });
}
async function showGpsNavigationExplanationIfNeeded(destinationLabel) {
    if (localStorage.getItem(GPS_NAVIGATION_EXPLANATION_SEEN_KEY) === 'true') return;
    try {
        await appAlert(`🧭 Destinazione: ${destinationLabel}\n\n${GPS_NAVIGATION_EXPLANATION_TEXT}`);
    } finally {
        localStorage.setItem(GPS_NAVIGATION_EXPLANATION_SEEN_KEY, 'true');
    }
}
