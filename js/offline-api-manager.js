/**
 * offline-api-manager.js — Gestore centralizzato per disabilitare API calls in modalità offline
 *
 * Funzionalità:
 * - Monitora lo stato di connettività (online/offline)
 * - Previene automaticamente le chiamate API quando offline
 * - Memorizza l'ultimo stato disponibile per mostrarla all'utente
 * - Notifica i moduli interessati quando cambia lo stato di rete
 * - Fornisce helper per verificare la connessione prima di fare fetch
 *
 * Uso:
 *   import { isOnline, canFetchAPI, onConnectivityChange, markAPIUnavailable } from './offline-api-manager.js';
 *
 *   // Verificare prima di fare fetch
 *   if (canFetchAPI()) {
 *       await fetchSomeAPI();
 *   }
 *
 *   // Registrare callback per cambi di connettività
 *   onConnectivityChange((isOnline) => {
 *       console.log('Rete:', isOnline ? 'disponibile' : 'offline');
 *   });
 */

// ── Stato interno ──────────────────────────────────────────────────────────

let _isOnline = typeof navigator !== 'undefined' && navigator.onLine;
let _lastOnlineTime = _isOnline ? Date.now() : null;
let _connectivityCallbacks = [];
let _apiUnavailableReasons = new Map(); // Traccia i motivi per cui le API non sono disponibili

// ── Costanti ───────────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 8000;
const CONNECTIVITY_CHECK_INTERVAL_MS = 5000;
const API_RETRY_DELAY_MS = 30000; // Aspetta 30s prima di riprovare dopo un fallimento

// ── Monitoraggio connettività ──────────────────────────────────────────────

/**
 * Inizializza il monitoraggio della connettività di rete
 */
export function initConnectivityMonitoring() {
    if (typeof window === 'undefined') return;

    // Ascolta gli eventi online/offline
    window.addEventListener('online', () => {
        _isOnline = true;
        _lastOnlineTime = Date.now();
        _apiUnavailableReasons.clear();
        console.log('[OfflineAPI] 🟢 Connessione ripristinata');
        _notifyConnectivityChange(true);
    });

    window.addEventListener('offline', () => {
        _isOnline = false;
        console.log('[OfflineAPI] 🔴 Connessione persa');
        _notifyConnectivityChange(false);
    });

    // Verifica periodica dello stato di rete (fallback per browser che non supportano online/offline)
    setInterval(() => {
        const wasOnline = _isOnline;
        _isOnline = navigator.onLine;
        if (wasOnline !== _isOnline) {
            console.log(`[OfflineAPI] Stato rilevato: ${_isOnline ? 'online' : 'offline'}`);
            _notifyConnectivityChange(_isOnline);
        }
    }, CONNECTIVITY_CHECK_INTERVAL_MS);
}

// ── API Pubbliche ──────────────────────────────────────────────────────────

/**
 * Restituisce true se il dispositivo è online
 * @returns {boolean}
 */
export function isOnline() {
    return _isOnline;
}

/**
 * Restituisce true se le API possono essere chiamate (online + non in rate-limit)
 * @returns {boolean}
 */
export function canFetchAPI() {
    return _isOnline;
}

/**
 * Restituisce il tempo (in ms) da cui il dispositivo è online
 * @returns {number|null} null se offline
 */
export function getOnlineTime() {
    return _lastOnlineTime ? Date.now() - _lastOnlineTime : null;
}

/**
 * Registra una callback per cambi di connettività
 * @param {(isOnline: boolean) => void} callback
 */
export function onConnectivityChange(callback) {
    if (typeof callback === 'function') {
        _connectivityCallbacks.push(callback);
    }
}

/**
 * Rimuove una callback di connettività
 * @param {(isOnline: boolean) => void} callback
 */
export function offConnectivityChange(callback) {
    const idx = _connectivityCallbacks.indexOf(callback);
    if (idx !== -1) {
        _connectivityCallbacks.splice(idx, 1);
    }
}

/**
 * Segna un'API come temporaneamente non disponibile (es. rate-limited, timeout)
 * @param {string} apiName Nome/identificatore dell'API
 * @param {string} reason Motivo (es. "timeout", "rate-limit", "error")
 * @param {number} [delayMs] Millisecondi di attesa prima di ritentare (default: API_RETRY_DELAY_MS)
 */
export function markAPIUnavailable(apiName, reason, delayMs = API_RETRY_DELAY_MS) {
    if (!apiName) return;

    const entry = {
        reason,
        unavailableSince: Date.now(),
        retryAfter: Date.now() + delayMs
    };

    _apiUnavailableReasons.set(apiName, entry);

    console.warn(`[OfflineAPI] API "${apiName}" non disponibile: ${reason} (ritento fra ${delayMs}ms)`);

    // Rimuovi automaticamente la marcatura dopo il ritardo
    setTimeout(() => {
        _apiUnavailableReasons.delete(apiName);
        console.log(`[OfflineAPI] API "${apiName}" pronta per nuovo tentativo`);
    }, delayMs);
}

/**
 * Verifica se un'API specifica è disponibile
 * @param {string} apiName Nome/identificatore dell'API
 * @returns {boolean}
 */
export function isAPIAvailable(apiName) {
    if (!_isOnline) return false;
    if (!apiName) return _isOnline;

    const entry = _apiUnavailableReasons.get(apiName);
    if (!entry) return true;

    // Se il tempo di ritento è passato, consenti il nuovo tentativo
    if (Date.now() >= entry.retryAfter) {
        _apiUnavailableReasons.delete(apiName);
        return true;
    }

    return false;
}

/**
 * Ottieni il motivo per cui un'API non è disponibile
 * @param {string} apiName Nome/identificatore dell'API
 * @returns {string|null}
 */
export function getAPIUnavailableReason(apiName) {
    const entry = _apiUnavailableReasons.get(apiName);
    return entry?.reason ?? null;
}

/**
 * Ripristina una specifica API (rimuove la marcatura di unavailable)
 * @param {string} apiName Nome/identificatore dell'API
 */
export function resetAPIAvailability(apiName) {
    if (apiName) {
        _apiUnavailableReasons.delete(apiName);
        console.log(`[OfflineAPI] API "${apiName}" ripristinata`);
    } else {
        _apiUnavailableReasons.clear();
        console.log(`[OfflineAPI] Tutte le API ripristinate`);
    }
}

/**
 * Helper per fare un fetch con protezione offline
 * @param {string} url
 * @param {object} [options]
 * @param {string} [apiName] Nome dell'API per tracciamento
 * @returns {Promise<Response>}
 * @throws {Error} Se offline o API non disponibile
 */
export async function fetchWithOfflineCheck(url, options = {}, apiName = null) {
    if (!canFetchAPI()) {
        const error = new Error('Dispositivo offline');
        error.code = 'OFFLINE';
        throw error;
    }

    if (apiName && !isAPIAvailable(apiName)) {
        const reason = getAPIUnavailableReason(apiName);
        const error = new Error(`API "${apiName}" non disponibile: ${reason}`);
        error.code = 'API_UNAVAILABLE';
        error.apiName = apiName;
        throw error;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 429) {
                // Rate limited
                markAPIUnavailable(apiName ?? 'unknown', 'rate-limit', 60000);
            }
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    } catch (error) {
        if (error?.name === 'AbortError') {
            // Timeout
            markAPIUnavailable(apiName ?? 'unknown', 'timeout', API_RETRY_DELAY_MS);
            const timeoutError = new Error('Timeout richiesta API');
            timeoutError.code = 'TIMEOUT';
            throw timeoutError;
        }

        // Errore di rete generale
        if (error instanceof TypeError && error.message.includes('fetch')) {
            const networkError = new Error('Errore di rete');
            networkError.code = 'NETWORK_ERROR';
            throw networkError;
        }

        throw error;
    }
}

/**
 * Crea una stringa di stato per debug/logging
 * @returns {string}
 */
export function getStatusString() {
    const status = _isOnline ? '🟢 Online' : '🔴 Offline';
    const unavailableCount = _apiUnavailableReasons.size;
    const unavailableStr = unavailableCount > 0
        ? ` | ${unavailableCount} API temporaneamente non disponibili`
        : '';

    return `${status}${unavailableStr}`;
}

// ── Helpers privati ────────────────────────────────────────────────────────

function _notifyConnectivityChange(isOnline) {
    _connectivityCallbacks.forEach((callback) => {
        try {
            callback(isOnline);
        } catch (error) {
            console.error('[OfflineAPI] Errore in callback di connettività:', error);
        }
    });
}

// ── Inizializzazione automatica ────────────────────────────────────────────

// Avvia il monitoraggio automaticamente quando il modulo viene importato
if (typeof window !== 'undefined') {
    initConnectivityMonitoring();
}
