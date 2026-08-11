import * as TruffleStorage from './storage-sync.js';
import { normalizeBackupEntry } from './backup-utils.js';
import { calcolaDettaglioRitenuta, calcolaImportoTotale, calcolaStatoSogliaVendite } from './fiscal-utils.js';

window.TruffleStorage = TruffleStorage;

try {
    if (window.TruffleStorage && typeof window.TruffleStorage.init === 'function') {
        await window.TruffleStorage.init();
    }
} catch (error) {
    console.warn('Inizializzazione storage avanzato non riuscita.', error);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => console.log('Service Worker registrato con successo:', reg.scope))
            .catch((err) => console.log('Registrazione Service Worker fallita:', err));
    });
}

// Inizializzazione Mappa corretta (ordine invertito per evitare ReferenceError)
const map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

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

function appConfirm(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('app-dialog');
        const msg = document.getElementById('app-dialog-message');
        const inputField = document.getElementById('app-dialog-input');
        const cancelBtn = document.getElementById('app-dialog-cancel');
        const okBtn = document.getElementById('app-dialog-ok');
        if (!dialog) { resolve(window.confirm(message)); return; }
        msg.textContent = message;
        inputField.style.display = 'none';
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        okBtn.textContent = 'OK';
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        const onOk = () => { dialog.close(); cleanup(); resolve(true); };
        const onCancel = () => { dialog.close(); cleanup(); resolve(false); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
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
        msg.textContent = message;
        inputField.style.display = '';
        inputField.value = defaultValue;
        cancelBtn.style.display = '';
        cancelBtn.textContent = 'Annulla';
        okBtn.textContent = 'OK';
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        const onOk = () => { const val = inputField.value; dialog.close(); cleanup(); resolve(val); };
        const onCancel = () => { dialog.close(); cleanup(); resolve(null); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.showModal();
        requestAnimationFrame(() => inputField.focus());
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

const ACTION_HANDLERS = {
    toggleDrawer: () => toggleDrawer(),
    centerOnUser: () => centerOnUser(),
    saveCarPosition: () => saveCarPosition(),
    returnToCar: () => returnToCar(),
    deleteCarPosition: () => deleteCarPosition(),
    savePoiPosition: () => savePoiPosition(),
    triggerSOS: () => triggerSOS(),
    shareAppUrl: () => shareAppUrl(),
    installApp: () => installApp(),
    openModule: (_event, moduleName, editMode = false) => openModule(moduleName, editMode),
    closeActiveModule: () => closeActiveModule(),
    mostraInfoModulo: (_event, moduleName) => mostraInfoModulo(moduleName),
    navigateToPoi: (_event, index) => navigateToPoi(index),
    sharePoi: (_event, index) => sharePoi(index),
    deletePoi: (_event, index) => deletePoi(index),
    viewStoredDocument: (_event, storageKey, title, moduleName) => viewStoredDocument(storageKey, title, moduleName),
    clearData: (_event, storageKey, moduleName) => clearData(storageKey, moduleName),
    saveTesserino: () => saveTesserino(),
    savePagoPAWithFile: () => savePagoPAWithFile(),
    saveF24WithFile: () => saveF24WithFile(),
    saveNewCane: () => saveNewCane(),
    deleteDog: (_event, index) => deleteDog(index),
    savePolizza: () => savePolizza(),
    deletePolizza: (_event, index) => deletePolizza(index),
    saveVetHistoryItem: () => saveVetHistoryItem(),
    deleteVetHistoryItem: (_event, index) => deleteVetHistoryItem(index),
    saveHeatEntry: () => saveHeatEntry(),
    deleteHeatEntry: (_event, index) => deleteHeatEntry(index),
    saveRaccoltaGiornaliera: () => saveRaccoltaGiornaliera(),
    deleteRaccoltaGiornaliera: (_event, index) => deleteRaccoltaGiornaliera(index),
    saveSpesa: () => saveSpesa(),
    deleteSpesa: (_event, index) => deleteSpesa(index),
    esportaDatiCSV: () => esportaDatiCSV(),
    esportaBackupJSON: () => esportaBackupJSON(),
    forceLocalBackupNow: () => forceLocalBackupNow(),
    restoreLatestAutomaticBackup: () => restoreLatestAutomaticBackup(),
    saveVetClinic: () => saveVetClinic(),
    shareLocationToVetByIndex: (_event, index) => shareLocationToVetByIndex(index),
    deleteVetClinic: (_event, index) => deleteVetClinic(index),
    salvaNotaClienteDaInput: (_event, index) => salvaNotaClienteDaInput(index),
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
    calcolaTotale: () => calcolaTotale(),
    calcolaRitenutaAcconto: () => calcolaRitenutaAcconto(),
    toggleCoordinateBancarie: () => toggleCoordinateBancarie(),
    autocompilaDatiCliente: (event) => autocompilaDatiCliente(event.target.value),
    importBackupData: (event) => importBackupData(event),
    archiviaAnnoPrecedente: () => archiviaAnnoPrecedente(),
    setArchivioRegione: (event) => {
        window.currentArchivioRegione = event.target.value;
        openModule('archivio');
    },
    refreshRegistroGiornaliero: () => openModule('registro_giornaliero'),
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
    printPage: () => window.print(),
    closeDrawerAndModule: () => {
        toggleDrawer();
        closeActiveModule();
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
    return /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,[a-z0-9+/=\s]+$/i.test(String(value ?? ''));
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

function restoreBackupEntries(data) {
    const backupSchema = {
        tesserino: { storageKey: 'tesserino_data', fallbackValue: {} },
        pagopa: { storageKey: 'pagopa_data', fallbackValue: {} },
        f24: { storageKey: 'f24_data', fallbackValue: {} },
        storicoVendite: { storageKey: 'storico_vendite', fallbackValue: [] },
        poiList: { storageKey: 'poi_list', fallbackValue: [] },
        dogsList: { storageKey: 'dogs_list', fallbackValue: [] },
        caneData: { storageKey: 'cane_data', fallbackValue: {} },
        polizzeList: { storageKey: 'polizze_list', fallbackValue: [] },
        storicoRaccolta: { storageKey: 'storico_raccolta_giornaliera', fallbackValue: [] },
        rubricaClienti: { storageKey: 'rubrica_clienti', fallbackValue: [] },
        speseList: { storageKey: 'spese_list', fallbackValue: [] },
        vetHistoryList: { storageKey: 'vet_history_list', fallbackValue: [] },
        heatDiaryList: { storageKey: 'heat_diary_list', fallbackValue: [] },
        vetClinicsList: { storageKey: 'vet_clinics_list', fallbackValue: [] },
        calendariTartufiCustom: { storageKey: 'calendari_tartufi_custom', fallbackValue: {} },
        noteRegionaliTartufi: { storageKey: 'note_regionali_tartufi', fallbackValue: {} },
        carCoords: { storageKey: 'car_coords', fallbackValue: {} }
    };

    const normalizedEntries = [];

    Object.entries(backupSchema).forEach(([backupKey, config]) => {
        if (!Object.prototype.hasOwnProperty.call(data, backupKey) || data[backupKey] === null) return;
        const normalizedValue = normalizeBackupEntry(data[backupKey], config.fallbackValue);
        normalizedEntries.push([config.storageKey, normalizedValue]);
    });

    normalizedEntries.forEach(([storageKey, normalizedValue]) => {
        localStorage.setItem(storageKey, normalizedValue);
    });
}

setTimeout(() => {
    map.invalidateSize();
    mostraDisclaimerIniziale(); // <-- Mostra il disclaimer subito dopo l'avvio/GPS
}, 400);

let userMarker = null;
let carMarker = null;
let carCoordinates = readStorageJSON('car_coords', null);
let poiList = readStorageJSON('poi_list', []);
let poiMapMarkers = {}; 
let targetNavigation = null;
if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const dot = document.getElementById('gps-status-dot');
        if (dot) { dot.style.backgroundColor = '#22c55e'; dot.title = "GPS Attivo: " + lat.toFixed(4) + ", " + lng.toFixed(4); }
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`, { headers: { 'Accept-Language': 'it' } })
        .then(res => res.json()).then(data => {
            if (data && data.address) {
                const regione = data.address.region || data.address.state || '';
                const provincia = data.address.province || data.address.county || '';
                const comune = data.address.city || data.address.town || data.address.village || data.address.municipality || '';
                const gpsText = document.getElementById('gps-status-text');
                if (gpsText) {
                    let parti = [];
                    if (regione) parti.push(`<b>${regione}</b>`);
                    if (provincia) parti.push(`<b>${provincia}</b>`);
                    if (comune) parti.push(`<b>${comune}</b>`);
                    gpsText.innerHTML = parti.length > 0 ? `GPS: ${parti.join(' > ')}` : `GPS Attivo: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            }
        }).catch(err => console.log("Errore geocodifica:", err));
        if (!userMarker) {
            userMarker = L.marker([lat, lng]).addTo(map).bindPopup("<b>Sei qui</b>").openPopup();
            map.setView([lat, lng], 16);
            if (carCoordinates) { carMarker = L.marker([carCoordinates.lat, carCoordinates.lng]).addTo(map).bindPopup("<b>🚗 La tua Auto</b>"); }
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
        const marker = L.marker([poi.lat, poi.lng]).addTo(map)
            .bindPopup(`<b>📍 Tartufo / Punto</b><br>Nota: ${safePoi.note || 'Nessuna nota'}<br><small>${safePoi.date || ''}</small>`);
        poiMapMarkers[index] = marker;
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
    if (targetNavigation === 'car' && carCoordinates) {
        target = carCoordinates; label = '🚗 Auto';
    } else if (typeof targetNavigation === 'string' && targetNavigation.startsWith('poi_')) {
        const index = parseInt(targetNavigation.split('_')[1]);
        if (poiList[index]) { target = poiList[index]; label = `📍 ${poiList[index].note || 'Punto'}`; }
    }
    if (target) {
        const res = calculateDistanceAndBearing(currentLat, currentLng, target.lat, target.lng);
        compassText.innerHTML = `🧭 <b>${label}:</b> ${res.arrow} ${res.distance} (${res.direction})`;
    } else {
        compassText.innerHTML = `🧭 Seleziona una destinazione (Auto o Punto)`;
    }
}
function saveCarPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        carCoordinates = { lat: pos.lat, lng: pos.lng };
        localStorage.setItem('car_coords', JSON.stringify(carCoordinates));
        if (carMarker) { carMarker.setLatLng([pos.lat, pos.lng]); }
        else { carMarker = L.marker([pos.lat, pos.lng]).addTo(map).bindPopup("<b>🚗 La tua Auto</b>"); }
        showToast("🚗 Posizione auto salvata!", 'success');
    } else { showToast("Segnale GPS non ancora disponibile.", 'error'); }
}

async function deleteCarPosition() {
    if (carCoordinates) {
        if (await appConfirm("Vuoi davvero eliminare la posizione dell'auto salvata?")) {
            if (carMarker) { map.removeLayer(carMarker); carMarker = null; }
            carCoordinates = null;
            localStorage.removeItem('car_coords');
            if (targetNavigation === 'car') targetNavigation = null;
            showToast("🚗 Posizione auto rimossa.", 'info');
        }
    } else { showToast("Nessuna posizione auto salvata.", 'info'); }
}
function returnToCar() {
    if (carCoordinates) {
        targetNavigation = 'car';
        map.setView([carCoordinates.lat, carCoordinates.lng], 18);
        if (carMarker) carMarker.openPopup();
    } else { showToast("Nessun parcheggio salvato.", 'info'); }
}
async function savePoiPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const note = await appPrompt("Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):", "Tartufaia");
        if (note === null) return;
        const newPoi = {
            lat: pos.lat, lng: pos.lng,
            note: note.trim() || "Punto di interesse",
            date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        poiList.push(newPoi);
        localStorage.setItem('poi_list', JSON.stringify(poiList));
        const newIndex = poiList.length - 1;
        renderAllPoiMarkers();
        targetNavigation = `poi_${newIndex}`;
        map.setView([pos.lat, pos.lng], 18);
        if (poiMapMarkers[newIndex]) poiMapMarkers[newIndex].openPopup();
        showToast("📍 Punto salvato!", 'success');
    } else { showToast("Segnale GPS non ancora disponibile.", 'error'); }
}
function navigateToPoi(index) {
    if (poiList[index]) {
        targetNavigation = `poi_${index}`;
        map.setView([poiList[index].lat, poiList[index].lng], 18);
        if (poiMapMarkers[index]) poiMapMarkers[index].openPopup();
        closeActiveModule();
        showToast(`🧭 Destinazione: ${poiList[index].note}`, 'success');
    }
}
function sharePoi(index) {
    if (poiList[index]) {
        const p = poiList[index];
        const msg = `📍 TARTUFAIA CONDIVISA\nNota: ${p.note}\nData: ${p.date}\nGoogle Maps: https://maps.google.com/?q=${p.lat},${p.lng}`;
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
function triggerSOS() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const msg = `EMERGENZA TARTUFAIA! Coordinate GPS: Lat: ${pos.lat}, Lng: ${pos.lng}.`;
        window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
    } else { showToast("Impossibile rilevare le coordinate GPS.", 'error'); }
}
function openModule(moduleName, editMode = false) {
    const drawer = document.getElementById('app-drawer');
    if (drawer && drawer.classList.contains('drawer-open')) toggleDrawer();
    let activeView = document.getElementById('active-module-view');
    if (!activeView) {
        activeView = document.createElement('div');
        activeView.id = 'active-module-view';
        document.getElementById('app-container').appendChild(activeView);
    }
    let contentHTML = '';
    switch(moduleName) {
        case 'poilist':
            let poiHtml = '<h2>Elenco Punti & Tartufaie</h2><p>I tuoi punti di ricerca salvati con note:</p>';
            if (poiList.length === 0) {
                poiHtml += '<div class="module-card"><p>Nessun punto salvato. Usa il tasto "Punto" sulla mappa.</p></div>';
            } else {
                poiList.forEach((poi, idx) => {
                    const safePoi = sanitizeRenderable(poi);
                    poiHtml += `
                        <div class="module-card card-gap">
                            <strong class="text-accent">📍 ${safePoi.note}</strong>
                            <p class="text-muted small-text" style="margin:4px 0;">Data: ${safePoi.date}</p>
                            <p class="text-subtle small-text">Lat: ${poi.lat.toFixed(4)}, Lng: ${poi.lng.toFixed(4)}</p>
                            <div class="btn-row">
                                <button class="overlay-btn btn-success" ${actionAttrs('navigateToPoi', [idx])}>🧭 Vai</button>
                                <button class="overlay-btn btn-info" ${actionAttrs('sharePoi', [idx])}>📤 Condividi</button>
                                <button class="overlay-btn btn-danger" ${actionAttrs('deletePoi', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = poiHtml;
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
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${tData.nomeFile || 'File PDF'}</p>`;
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
                        <label style="margin-top:10px;">Carica Tesserino (Foto o PDF - Max 1.5MB):</label>
                        <input type="file" id="t-file" accept="image/*,application/pdf" class="mod-input" style="padding:8px;">
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
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${pData.nomeFile || 'File PDF'}</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#b8b0a0;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>Ricevuta PagoPA & PDF</h2>
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
                    <h2>Ricevuta PagoPA & PDF</h2>
                    <p>Registra la quietanza di pagamento della tassa regionale:</p>
                    <div class="module-card">
                        <label>ID Transazione / Codice Avviso:</label>
                        <input type="text" id="p-id" class="mod-input" value="${pData.id || ''}" placeholder="Es. TRN123456789">
                        <label>Data Pagamento:</label>
                        <input type="date" id="p-data" class="mod-input" value="${pData.data || new Date().toISOString().slice(0,10)}">
                        <label>Carica Ricevuta (Immagine o PDF - Obbligatorio):</label>
                        <input type="file" id="p-file" accept="image/*,application/pdf" class="mod-input" style="padding:8px;">
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('savePagoPAWithFile')}>Archivia Ricevuta PagoPA</button>
                    </div>`;
            }
            break;
        case 'ricevute':
            const f24SavedData = readStorageJSON('f24_data', {});
            const defaultProtocollo = f24SavedData.protocollo || '';
            
            const annoCorrenteReg = new Date().getFullYear();
            let f24ValidoPreview = false;
            if (f24SavedData.protocollo && f24SavedData.dataPagamento) {
                const dataP = new Date(f24SavedData.dataPagamento);
                const scadenzaF24 = new Date(annoCorrenteReg, 1, 16, 23, 59, 59);
                if (dataP <= scadenzaF24) f24ValidoPreview = true;
            }
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
                    <input type="text" id="r-comune" class="mod-input" placeholder="Es. Comune / Località (Provincia) - Obbligatorio">
                    
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
                        <input type="text" id="r-causale" class="mod-input" placeholder="Es. Pagamento tartufi freschi - Ricevuta N. ...">
                    </div>
                    
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" ${actionAttrs('registerRicevutaSafe')}>Registra e Genera Ricevuta Conforme</button>
                </div>`;
            setTimeout(() => { toggleRegimeFiscaleFields(); toggleCoordinateBancarie(); }, 50);
            break;

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
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${fData.nomeFile || 'File PDF'}</p>`;
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
                        
                        <label>Carica Quietanza F24 (PDF o Immagine - Obbligatorio):</label>
                        <input type="file" id="f-file" accept="image/*,application/pdf" class="mod-input" style="padding:8px;">
                        
                        <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('saveF24WithFile')}>Archivia F24 ELIDE</button>
                    </div>`;
            }
            break;
        case 'canidiary':
            const dogsList = getRenderableStorageJSON('dogs_list', []);
            let dogsHtml = `
                <h2>Anagrafica Cane</h2>
                <p>Gestisci i tuoi cani da tartufo:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Nuovo Cane</h3>
                    <label>Nome del Cane:</label>
                    <input type="text" id="c-nome" class="mod-input" placeholder="Es. Argo">
                    <label>Razza:</label>
                    <input type="text" id="c-razza" class="mod-input" value="Lagotto Romagnolo">
                    <label>Sesso:</label>
                    <select id="c-sesso" class="mod-input">
                        <option value="Maschio">🐕 Maschio</option>
                        <option value="Femmina">🐩 Femmina</option>
                    </select>
                    <label>Data di Nascita:</label>
                    <input type="date" id="c-nascita" class="mod-input">
                    <label>Numero Microchip:</label>
                    <input type="text" id="c-microchip" class="mod-input" placeholder="Codice microchip">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('saveNewCane')}>Salva Nuovo Cane</button>
                </div>`;
            if (dogsList.length === 0) {
                dogsHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun cane registrato.</p></div>`;
            } else {
                dogsHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">I tuoi cani registrati:</h3>`;
                dogsList.forEach((dog, idx) => {
                    const sessoIcon = dog.sesso === 'Femmina' ? '🐩' : '🐕';
                    dogsHtml += `
                        <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:1rem;">${sessoIcon} ${dog.nome}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">Razza: ${dog.razza}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">⚥ Sesso: ${dog.sesso || 'Non specificato'}</p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Nascita: ${dog.nascita || 'Non specificata'}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">Microchip: ${dog.microchip || 'Non inserito'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteDog', [idx])}>🗑️ Elimina</button>
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
            let optionsHtml = '';
            if (dogsListVet.length > 0) {
                dogsListVet.forEach(dog => {
                    const selected = dog.nome === nomeCaneDefault ? 'selected' : '';
                    optionsHtml += `<option value="${dog.nome}" ${selected}>${dog.nome} (${dog.razza})</option>`;
                });
            } else { optionsHtml += `<option value="${nomeCaneDefault}">${nomeCaneDefault}</option>`; }
            let vetHtml = `
                <h2>Libretti Sanitari Cani & Profilassi</h2>
                <p>Storico trattamenti, vaccini e visite per il cane:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Trattamento / Visita</h3>
                    <label>Seleziona Cane:</label>
                    <select id="vh-cane" class="mod-input">${optionsHtml}</select>
                    <label>Tipologia Intervento:</label>
                    <select id="vh-tipo" class="mod-input">
                        <option value="💉 Vaccino">Vaccino</option>
                        <option value="💊 Antiparassitario Intestinale">Antiparassitario Intestinale (Pillola)</option>
                        <option value="💧 Spot-on">Spot-on (Antipulci / Zecche)</option>
                        <option value="🎗️ Collare Antiparassitario">Collare Antiparassitario</option>
                        <option value="🩺 Visita Veterinaria">Visita Veterinaria / Controllo</option>
                        <option value="🩹 Medicazione / Zecca">Medicazione / Ferita / Zecca</option>
                        <option value="🏥 Somministrazione Farmaci / Altro">Somministrazione Farmaci / Altro</option>
                    </select>
                    <label>Data del Trattamento:</label>
                    <input type="date" id="vh-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Note / Dettagli:</label>
                    <input type="text" id="vh-note" class="mod-input" placeholder="Es. Nome farmaco o dosaggio">
                    <button class="overlay-btn" style="margin-top:12px; width:100%; background:#2563eb;" ${actionAttrs('saveVetHistoryItem')}>Registra nel Libretto</button>
                </div>`;
            if (vetHistory.length === 0) {
                vetHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun trattamento registrato.</p></div>`;
            } else {
                vetHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Registrazioni:</h3>`;
                vetHistory.slice().reverse().forEach((item, index) => {
                    const originalIndex = vetHistory.length - 1 - index;
                    vetHtml += `
                        <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">🐕 ${item.cane}</strong>
                            <p style="font-size:0.9rem; color:#4d8a98; margin: 4px 0;"><b>${item.tipo}</b></p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Data: ${item.data}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteVetHistoryItem', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            // Diario calore per cagne femmine
            const femmineVet = dogsListVet.filter(d => d.sesso === 'Femmina');
            if (femmineVet.length > 0) {
                const heatDiary = getRenderableStorageJSON('heat_diary_list', []);
                vetHtml += `<h3 style="font-size:0.85rem; color:#f472b6; margin:20px 0 8px; text-transform:uppercase;">🌸 Diario Calore (Cagne Femmine)</h3>`;
                // Form aggiunta calore
                let optionsFemmine = '';
                femmineVet.forEach(d => { optionsFemmine += `<option value="${d.nome}">${d.nome}</option>`; });
                vetHtml += `
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid #f472b6;">
                    <h3 style="font-size:0.9rem; color:#f472b6; margin-bottom:10px;">➕ Registra Inizio Calore</h3>
                    <label>Seleziona Cagna:</label>
                    <select id="heat-cane" class="mod-input">${optionsFemmine}</select>
                    <label>Data Inizio Calore:</label>
                    <input type="date" id="heat-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Note:</label>
                    <input type="text" id="heat-note" class="mod-input" placeholder="Es. Durata, comportamento...">
                    <button class="overlay-btn" style="margin-top:12px; width:100%; background:#be185d;" ${actionAttrs('saveHeatEntry')}>Registra Calore</button>
                </div>`;
                if (heatDiary.length === 0) {
                    vetHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun calore registrato.</p></div>`;
                } else {
                    vetHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Calori:</h3>`;
                    heatDiary.slice().reverse().forEach((entry, index) => {
                        const originalIndex = heatDiary.length - 1 - index;
                        const dataInizio = new Date(entry.data);
                        const prossimoCalore = new Date(dataInizio);
                        prossimoCalore.setDate(prossimoCalore.getDate() + 180);
                        const prossimoStr = prossimoCalore.toISOString().slice(0, 10);
                        vetHtml += `
                        <div class="module-card" style="border-left: 4px solid #f472b6; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">🐩 ${entry.cane}</strong>
                            <p style="font-size:0.9rem; color:#f472b6; margin: 4px 0;"><b>🌸 Inizio Calore: ${entry.data}</b></p>
                            <p style="font-size:0.85rem; color:#fbbf24; margin: 2px 0;">📅 Prossimo calore previsto: <b>${prossimoStr}</b></p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${entry.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteHeatEntry', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                    });
                }
            }
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
            let opzioniSpecieHtml = `<option value="tutte">Tutte le specie</option>`;
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
                </div>`;
            let datiFiltrati = storicoRaccolta.filter(item => {
                const annoItem = item.data ? item.data.slice(0,4) : '';
                return (filtroAnno === 'tutti' || annoItem === filtroAnno) && (filtroSpecie === 'tutte' || item.specie === filtroSpecie);
            });
            if (datiFiltrati.length === 0) {
                registroHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun ritrovamento trovato con i filtri selezionati.</p></div>`;
            } else {
                registroHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Storico Filtrato (${datiFiltrati.length}):</h3>`;
                datiFiltrati.slice().reverse().forEach((item) => {
                    const originalIndex = storicoRaccolta.indexOf(item);
                    registroHtml += `
                        <div class="module-card" style="border-left: 4px solid #10b981; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">📅 ${item.data}</strong>
                            <p style="font-size:0.9rem; color:#4d8a98; margin: 4px 0;"><b>${item.specie}</b></p>
                            <p style="font-size:0.85rem; color:#22c55e; margin: 2px 0;">⚖️ Peso: <b>${item.peso} g</b></p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteRaccoltaGiornaliera', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = registroHtml;
            break;
        case 'spese':
            const speseList = getRenderableStorageJSON('spese_list', []);
            let totaleSpeseAnno = 0;
            const annoCorrenteSpese = new Date().getFullYear();

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
                </div>`;

            if (speseList.length === 0) {
                speseHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessuna spesa registrata.</p></div>`;
            } else {
                speseHtml += `<h3 style="font-size:0.85rem; color:#b8b0a0; margin-bottom:8px; text-transform:uppercase;">Elenco Spese Registrate:</h3>`;
                
                speseList.slice().reverse().forEach((item, index) => {
                    const originalIndex = speseList.length - 1 - index;
                    const dataSpesa = item.data ? new Date(item.data) : null;
                    if (dataSpesa && dataSpesa.getFullYear() === annoCorrenteSpese) {
                        totaleSpeseAnno += parseFloat(item.importo) || 0;
                    }

                    speseHtml += `
                        <div class="module-card" style="border-left: 4px solid #f59e0b; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:0.95rem;">💶 € ${parseFloat(item.importo).toFixed(2)}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;"><b>${item.categoria}</b></p>
                            <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📅 Data: ${item.data}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteSpesa', [originalIndex])}>🗑️ Elimina</button>
                        </div>`;
                });

                speseHtml = `
                    <div class="module-card" style="background: #121610; border: 1px solid rgba(255,255,255,0.07); margin-bottom: 15px; text-align: center;">
                        <p style="font-size: 0.8rem; color: #b8b0a0; text-transform: uppercase;">Totale Spese Anno Corrente (${annoCorrenteSpese})</p>
                        <p style="font-size: 1.4rem; color: #f59e0b; font-weight: bold; margin: 4px 0 0 0;">€ ${totaleSpeseAnno.toFixed(2)}</p>
                    </div>` + speseHtml;
            }
            contentHTML = speseHtml;
            break;
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
                    <p>Esporta i dati contabili o gestisci backup locali senza cloud.</p>
                    <button class="overlay-btn btn-primary btn-full mt-15" ${actionAttrs('esportaDatiCSV')}>Scarica Contabilità in CSV</button>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#16a34a;" ${actionAttrs('esportaBackupJSON')}>Esporta Backup Manuale (JSON)</button>
                    <hr style="border-color:rgba(255,255,255,0.07); margin:20px 0;">
                    <label style="font-weight:bold; color:#f6f1e6;">Ripristina Backup da File JSON:</label>
                    <input type="file" id="import-file" accept=".json,application/json" class="mod-input" style="padding:8px;" ${eventActionAttrs('change', 'importBackupData')}>
                    <hr style="border-color:rgba(255,255,255,0.07); margin:20px 0;">
                    <h3 style="margin:0 0 10px 0; font-size:0.95rem; color:#4d8a98;">Backup automatico locale</h3>
                    <p style="font-size:0.82rem; color:#ddd6c8; margin:0 0 10px 0;">L'app salva automaticamente il file <strong>backup_truffle_automatico.json</strong> nella cartella Download ad ogni modifica dei dati (sovrascrive il precedente). Nessun cloud.</p>
                    <p id="local-backup-status" style="font-size:0.82rem; color:#b8b0a0; margin:0 0 10px 0;">Stato ultimo backup automatico: non disponibile</p>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" ${actionAttrs('forceLocalBackupNow')}>💾 Salva Backup Ora</button>
                    <button class="overlay-btn" style="margin-top:8px; width:100%; background:#0f766e;" ${actionAttrs('restoreLatestAutomaticBackup')}>📂 Ripristina da File...</button>
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
                <h2>Pronto Soccorso & Cliniche Veterinarie H24</h2>
                <p>Gestisci i numeri d'emergenza dei veterinari:</p>
                <div class="module-card" style="margin-bottom: 20px; background: rgba(29,40,30,0.96); border: 1px solid rgba(255,255,255,0.07);">
                    <h3 style="font-size:0.9rem; color:#f6f1e6; margin-bottom:10px;">➕ Aggiungi Clinica H24</h3>
                    <label>Nome Clinica o Medico:</label>
                    <input type="text" id="vc-nome" class="mod-input" placeholder="Es. Clinica Centrale">
                    <label>Numero di Telefono:</label>
                    <input type="tel" id="vc-tel" class="mod-input" placeholder="Es. 0874123456">
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
                    const telHref = sanitizePhoneHref(clinic.tel);
                    clinicHtml += `
                        <div class="module-card" style="border-left: 4px solid #dc2626; margin-bottom: 12px;">
                            <strong style="color:#f6f1e6; font-size:1rem;">🏥 ${safeClinic.nome}</strong>
                            <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">📞 ${safeClinic.tel}</p>
                            <p style="font-size:0.8rem; color:#b8b0a0; margin-bottom: 8px;">📝 ${safeClinic.note || 'Nessuna nota'}</p>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <a href="tel:${telHref}" class="overlay-btn btn-danger" style="text-decoration:none; text-align:center; display:inline-block; padding:8px 12px;">📞 Chiama</a>
                                <button class="overlay-btn btn-info" style="padding:8px 12px;" ${actionAttrs('shareLocationToVetByIndex', [idx])}>📍 Invia GPS</button>
                                <button class="overlay-btn btn-neutral" style="padding:8px 12px;" ${actionAttrs('deleteVetClinic', [idx])}>🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = clinicHtml;
            break;

       case 'clienti':
    const rubricaClienti = getRenderableStorageJSON('rubrica_clienti', []);
    
    // Ordina dal cliente che ha speso di più a quello che ha speso di meno
    rubricaClienti.sort((a, b) => (b.totaleAcquisti || 0) - (a.totaleAcquisti || 0));

    let clientiHtml = `
        <h2>Rubrica Clienti & Acquirenti</h2>
        <p>Elenco dei clienti salvati con storico acquisti:</p>
    `;
    if (rubricaClienti.length === 0) {
        clientiHtml += `<div class="module-card"><p style="color:#b8b0a0;">Nessun cliente salvato in rubrica.</p></div>`;
    } else {
        rubricaClienti.forEach((cliente, idx) => {
            // Formattazione del totale acquisti in valuta
            const totaleFormattato = (cliente.totaleAcquisti || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
            
            clientiHtml += `
                <div class="module-card" style="border-left: 4px solid #0284c7; margin-bottom: 12px;">
                    <strong style="color:#f6f1e6; font-size:1rem;">👤 ${cliente.nome}</strong>
                    <p style="font-size:0.85rem; color:#4d8a98; margin: 4px 0;">P.IVA / CF: ${cliente.cf || 'Non inserito'}</p>
                    <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📍 Indirizzo: ${cliente.indirizzo || 'Non inserito'}</p>
                    <p style="font-size:0.8rem; color:#ddd6c8; margin: 2px 0;">📧 Email: ${cliente.email || 'Non specificata'}</p>
                    
                    <!-- Sezione Statistiche Spesa -->
                    <div style="background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 6px; margin: 8px 0;">
                        <p style="font-size:0.85rem; color:#4ade80; margin: 0; font-weight: bold;">💰 Totale Acquisti: ${totaleFormattato}</p>
                        <p style="font-size:0.75rem; color:#b8b0a0; margin: 2px 0 0 0;">📦 Ricevute emesse: ${cliente.numeroAcquisti || 1} | Ultimo: ${cliente.dataUltimoAcquisto || 'N.D.'}</p>
                    </div>

                    <!-- Sezione Note Cliente con Tasto Salva a pieno larghezza -->
                    <div style="margin: 8px 0;">
                        <label style="font-size:0.75rem; color:#b8b0a0; display:block; margin-bottom:2px;">📝 Note Cliente:</label>
                        <textarea 
                            id="nota-cliente-${idx}"
                            style="width: 100%; background: #121610; color: #f6f1e6; border: 1px solid rgba(255,255,255,0.07); border-radius: 4px; padding: 6px; font-size: 0.8rem; resize: vertical;" 
                            rows="2" 
                            placeholder="Scrivi una nota per questo cliente..."
                        >${cliente.nota || ''}</textarea>
                        <button class="overlay-btn" style="width: 100%; background:#eab308; color:#0f172a; font-weight:bold; padding:8px; font-size:0.85rem; margin-top:6px; border-radius:4px; border:none; cursor:pointer;" ${actionAttrs('salvaNotaClienteDaInput', [idx])}>💾 Salva Nota</button>
                    </div>

                    <!-- Blocco tasti principali distanziato -->
                    <div style="display:flex; gap:6px; margin-top:16px; flex-wrap:wrap;">
                        <button class="overlay-btn btn-success" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('creaRicevutaPerCliente', [idx])}>📄 Nuova Ricevuta</button>
                        <button class="overlay-btn btn-info" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('mostraRicevuteClienteByIndex', [idx])}>📜 Vedi Ricevute</button>
                        <button class="overlay-btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" ${actionAttrs('deleteCliente', [idx])}>🗑️ Elimina</button>
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
    activeView.style.display = 'flex';
    if (moduleName === 'export') {
        setTimeout(syncAutomaticBackupStatusUI, 0);
    }
}

function closeActiveModule() {
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
        // Controllo della dimensione del file
        if (file.size > 1.5 * 1024 * 1024) {
            showToast("File troppo grande. Max 1.5 MB.", 'error');
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
        if (file.size > 1.5 * 1024 * 1024) {
            showToast("File troppo grande. Max 1.5 MB.", 'error');
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
        if (file.size > 1.5 * 1024 * 1024) {
            showToast("File troppo grande. Max 1.5 MB.", 'error');
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

function saveNewCane() {
    const nome = document.getElementById('c-nome').value.trim();
    const razza = document.getElementById('c-razza').value.trim();
    const sesso = document.getElementById('c-sesso').value;
    const nascita = document.getElementById('c-nascita').value;
    const microchip = document.getElementById('c-microchip').value.trim();
    if (!nome) { showToast("Inserisci il nome del cane.", 'error'); return; }
    let dogsList = readStorageJSON('dogs_list', []);
    dogsList.push({ nome, razza, sesso, nascita, microchip });
    localStorage.setItem('dogs_list', JSON.stringify(dogsList));
    localStorage.setItem('cane_data', JSON.stringify({ nome, razza, sesso, nascita, microchip }));
    showToast("Cane aggiunto!", 'success');
    openModule('canidiary');
}
async function deleteDog(index) {
    if (await appConfirm("Vuoi davvero rimuovere questo cane?")) {
        let dogsList = readStorageJSON('dogs_list', []);
        dogsList.splice(index, 1);
        localStorage.setItem('dogs_list', JSON.stringify(dogsList));
        if (dogsList.length > 0) { localStorage.setItem('cane_data', JSON.stringify(dogsList[dogsList.length - 1])); }
        else { localStorage.removeItem('cane_data'); }
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

async function deleteCliente(index) {
    if (await appConfirm("Vuoi davvero rimuovere questo cliente dalla rubrica?")) {
        let rubricaClienti = readStorageJSON('rubrica_clienti', []);
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
    const note = document.getElementById('reg-note').value.trim();
    if (!data || peso <= 0) { showToast("Data e peso obbligatori.", 'error'); return; }
    let storicoRaccolta = readStorageJSON('storico_raccolta_giornaliera', []);
    storicoRaccolta.push({ data, specie, peso, note });
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
    const grammi = parseFloat(document.getElementById('pesoGrammi').value) || 0;
    const prezzoKg = parseFloat(document.getElementById('prezzoKg').value) || 0;
    
    if (grammi > 0 && prezzoKg > 0) {
        const totale = calcolaImportoTotale(grammi, prezzoKg);
        document.getElementById('importoTotale').value = totale.toFixed(2);
        calcolaRitenutaAcconto();
    }
}

function toggleRegimeFiscaleFields() {
    const regime = document.getElementById('r-regime').value;
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
    const regime = document.getElementById('r-regime') ? document.getElementById('r-regime').value : 'sostitutiva';
    if (regime !== 'ritenuta') return;
    
    const importoTotale = parseFloat(document.getElementById('importoTotale').value) || 0;
    
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
    const acquirenteNome = document.getElementById('r-acquirente').value.trim();
    const acquirenteCf = document.getElementById('r-cf-acquirente').value.trim();
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
    const pesoGrammi = parseFloat(document.getElementById('pesoGrammi').value) || 0;
    const qualitaScelta = document.getElementById('r-qualita').value;
    const importoTotale = parseFloat(document.getElementById('importoTotale').value) || 0;
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
        `Premi OK per confermare la presa visione e registrare la vendita, oppure Annulla per interrompere.`;

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
        specie: document.getElementById('r-specie').value, 
        qualita: qualitaScelta,
        peso: pesoGrammi, 
        importo: importoTotale.toFixed(2),
        regime: regimeScelto,
        ritenuta: importoRitenuta,
        netto: importoNetto,
        luogoRaccolta: luogoAreaRaccolta, 
        lotto: document.getElementById('r-lotto').value.trim(), 
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
        if (elComune) elComune.value = v.comune || '';
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
    
    const acquirenteNome = document.getElementById('r-acquirente').value.trim();
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

    const importoCorrente = parseFloat(document.getElementById('importoTotale').value) || 0;
    const dettagliRitenuta = calcolaDettaglioRitenuta(importoCorrente);
    const importoRitenuta = regimeScelto === 'ritenuta' ? dettagliRitenuta.ritenuta.toFixed(2) : '0.00';
    const importoNetto = regimeScelto === 'ritenuta' ? dettagliRitenuta.netto.toFixed(2) : importoCorrente.toFixed(2);

    storico[index] = {
        venditoreNome: tData.nome || storico[index].venditoreNome, 
        venditoreCf: tData.cf || storico[index].venditoreCf, 
        venditoreTesserino: tData.num || storico[index].venditoreTesserino, 
        venditoreRegione: tData.regione || storico[index].venditoreRegione,
        acquirente: acquirenteNome, 
        acquirenteCf: document.getElementById('r-cf-acquirente').value.trim(),
        specie: document.getElementById('r-specie').value, 
        qualita: document.getElementById('r-qualita').value,
        peso: document.getElementById('pesoGrammi').value, 
        importo: importoCorrente.toFixed(2),
        regime: regimeScelto,
        ritenuta: importoRitenuta,
        netto: importoNetto,
        comune: document.getElementById('r-comune').value.trim(), 
        lotto: document.getElementById('r-lotto').value.trim(), 
        f24: regimeScelto === 'sostitutiva' ? protocolloF24 : 'ESENTE (Ritenuta d\'Acconto)',
        metodoPagamento: (document.getElementById('r-metodo-pagamento') || {}).value || storico[index].metodoPagamento || 'contanti',
        ibanVenditore: (document.getElementById('r-iban') || {}).value?.trim() || storico[index].ibanVenditore || '',
        bancaVenditore: (document.getElementById('r-banca') || {}).value?.trim() || storico[index].bancaVenditore || '',
        intestatarioVenditore: storico[index].intestatarioVenditore || tData.nome || '',
        causaleVenditore: (document.getElementById('r-causale') || {}).value?.trim() || storico[index].causaleVenditore || '',
        data: storico[index].data
    };

    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    showToast("Ricevuta aggiornata!", 'success');
    openModule('storico_ricevute');
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
        f24: localStorage.getItem('f24_data'),
        storicoVendite: localStorage.getItem('storico_vendite'), 
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
        carCoords: localStorage.getItem('car_coords')
    };
}

function esportaBackupJSON() {
    const backupData = buildCompleteBackupData();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr); 
    downloadAnchor.setAttribute("download", "backup_truffle_completo.json");
    document.body.appendChild(downloadAnchor); 
    downloadAnchor.click(); 
    downloadAnchor.remove();
}

function importBackupData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('Backup non valido');
            }
            restoreBackupEntries(data);
            
            showToast("Backup ripristinato!", 'success'); 
            location.reload();
        } catch(err) { 
            showToast("Errore lettura backup.", 'error'); 
        }
    };
    reader.readAsText(file);
}

function formatBackupTimestamp(isoDate) {
    if (!isoDate) return 'n/d';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'n/d';
    return date.toLocaleString('it-IT');
}

let lastAutomaticBackupSavedAt = null;

function syncAutomaticBackupStatusUI() {
    const statusEl = document.getElementById('local-backup-status');
    if (!statusEl) return;
    if (!lastAutomaticBackupSavedAt) {
        statusEl.textContent = 'Stato ultimo backup automatico: non disponibile';
        return;
    }
    statusEl.textContent = `Stato ultimo backup automatico: OK - ${formatBackupTimestamp(lastAutomaticBackupSavedAt)}`;
}

let _automaticBackupFileHandle = null;

async function downloadBackupFile(data) {
    const jsonStr = JSON.stringify(data, null, 2);
    const fileName = 'backup_truffle_automatico.json';

    if (window.showSaveFilePicker) {
        try {
            if (!_automaticBackupFileHandle) {
                _automaticBackupFileHandle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
                });
            }
            const writable = await _automaticBackupFileHandle.createWritable();
            await writable.write(jsonStr);
            await writable.close();
            lastAutomaticBackupSavedAt = new Date().toISOString();
            syncAutomaticBackupStatusUI();
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') {
                _automaticBackupFileHandle = null;
                return;
            }
            // If overwrite fails (e.g. handle invalidated), clear handle and fall through to anchor download
            _automaticBackupFileHandle = null;
        }
    }

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
}

async function forceLocalBackupNow() {
    const backupData = buildCompleteBackupData();
    await downloadBackupFile(backupData);
    lastAutomaticBackupFingerprint = JSON.stringify(backupData);
    showToast("Backup salvato nella cartella Download.", 'success');
}

async function restoreLatestAutomaticBackup() {
    if (!await appConfirm("Scegli il file di backup automatico (backup_truffle_automatico.json) dalla cartella Download del dispositivo.")) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        fileInput.remove();
        if (!file) {
            showToast("Nessun file selezionato.", 'info');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    throw new Error('Backup non valido');
                }
                restoreBackupEntries(data);
                showToast("Backup ripristinato!", 'success');
                setTimeout(() => location.reload(), 500);
            } catch {
                showToast("Errore lettura backup.", 'error');
            }
        };
        reader.readAsText(file);
    });
    fileInput.click();
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

async function runAutomaticLocalBackup() {
    const backupData = buildCompleteBackupData();
    const fingerprint = JSON.stringify(backupData);
    if (fingerprint === lastAutomaticBackupFingerprint) return;
    await downloadBackupFile(backupData);
    lastAutomaticBackupFingerprint = fingerprint;
}

const AUTO_BACKUP_DATA_CHANGE_DEBOUNCE_MS = 500;
let automaticBackupLifecycleInitialized = false;
let lastAutomaticBackupFingerprint = '';
let dataChangeDebounceTimer = null;

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
    if (userMarker) { const pos = userMarker.getLatLng(); map.setView([pos.lat, pos.lng], 16); userMarker.openPopup(); }
    else { showToast("Posizione GPS non disponibile.", 'error'); }
}

function saveVetClinic() {
    const nome = document.getElementById('vc-nome').value.trim();
    const tel = document.getElementById('vc-tel').value.trim();
    const note = document.getElementById('vc-note').value.trim();
    if (!nome || !tel) { showToast("Inserisci nome e telefono.", 'error'); return; }
    let vetClinics = readStorageJSON('vet_clinics_list', []);
    vetClinics.push({ nome, tel, note });
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

function shareLocationToVet(telNumber) {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const msg = `EMERGENZA VETERINARIA! Coordinate GPS: Lat: ${pos.lat.toFixed(6)}, Lng: ${pos.lng.toFixed(6)}`;
        window.location.href = `sms:${telNumber}?body=${encodeURIComponent(msg)}`;
    } else { showToast("GPS non disponibile.", 'error'); }
}

function shareLocationToVetByIndex(index) {
    const vetClinics = readStorageJSON('vet_clinics_list', []);
    const clinic = vetClinics[index];
    if (!clinic || !clinic.tel) return;
    shareLocationToVet(sanitizePhoneHref(clinic.tel));
}

function saveVetHistoryItem() {
    const cane = document.getElementById('vh-cane').value;
    const tipo = document.getElementById('vh-tipo').value;
    const data = document.getElementById('vh-data').value;
    const note = document.getElementById('vh-note').value.trim();
    if (!data) { showToast("Inserisci la data.", 'error'); return; }
    let vetHistory = readStorageJSON('vet_history_list', []);
    vetHistory.push({ cane, tipo, data, note });
    localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
    showToast("Trattamento registrato!", 'success'); openModule('vet');
}

async function deleteVetHistoryItem(index) {
    if (await appConfirm("Rimuovere record?")) {
        let vetHistory = readStorageJSON('vet_history_list', []);
        vetHistory.splice(index, 1);
        localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
        openModule('vet');
    }
}

function saveHeatEntry() {
    const cane = document.getElementById('heat-cane').value;
    const data = document.getElementById('heat-data').value;
    const note = document.getElementById('heat-note').value.trim();
    if (!data) { showToast("Inserisci la data dell'inizio calore.", 'error'); return; }
    let heatDiary = readStorageJSON('heat_diary_list', []);
    heatDiary.push({ cane, data, note });
    localStorage.setItem('heat_diary_list', JSON.stringify(heatDiary));
    showToast("Calore registrato!", 'success');
    openModule('vet');
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
        title: 'Truffle App',
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

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-installa-app');
    if (btn) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('btn-installa-app');
    if (btn) btn.style.display = 'none';
});

function installApp() {
    // Già in esecuzione come PWA installata (standalone / fullscreen / minimal-ui)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        || window.navigator.standalone === true;

    if (isStandalone) {
        showToast("L'app è già installata.", 'info');
        return;
    }

    if (!deferredInstallPrompt) {
        showToast("Installazione non disponibile. Su iOS usa Safari > 'Aggiungi alla schermata Home'.", 'info');
        return;
    }

    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] Installazione accettata');
        } else {
            console.log('[PWA] Installazione rifiutata');
        }
        deferredInstallPrompt = null;
    });
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
        'poilist': "ℹ️ **Guida - Elenco Punti & Tartufaie**\n\nQui puoi visualizzare tutti i punti di interesse e le tartufaie salvate con le relative coordinate e note. Puoi impostare la navigazione sulla bussola, condividere la posizione o eliminare i punti non più utili.",
        'tesserino': "ℹ️ **Guida - Anagrafica & Tesserino Digitale**\n\nInserisci e archivia i dati del tuo tesserino regionale di raccolta tartufi e carica una foto o un PDF del documento (max 1.5MB) per averlo sempre a portata di mano.",
        'pagopa': "ℹ️ **Guida - Ricevuta PagoPA & PDF**\n\nRegistra la quietanza di pagamento della tassa regionale annuale obbligatoria. Questo dato è indispensabile per sbloccare la registrazione delle vendite.",
        'ricevute': "ℹ️ **Guida - Ricevuta di Vendita Occasionale**\n\nEmetti ricevute di vendita conformi alla normativa vigente (Legge 145/2018). Il sistema sceglie automaticamente il regime fiscale corretto (Imposta Sostitutiva o Ritenuta d'Acconto) in base alla presenza di un F24 valido.",
        'storico_ricevute': "ℹ️ **Guida - Archivio Storico Ricevute**\n\Consulta l'elenco cronologico di tutte le ricevute emesse, con la possibilità di visualizzarle, modificarle, stamparle o filtrarle per acquirente.",
        'f24': "ℹ️ **Guida - F24 ELIDE**\n\nRegistra il versamento dell'imposta sostitutiva annuale di 100€ prevista dalla Legge 145/2018 per la vendita occasionale dei tartufi.",
        'canidiary': "ℹ️ **Guida - Anagrafica Cane**\n\nGestisci l'anagrafica dei tuoi cani da tartufo inserendo razza, sesso, data di nascita e numero di microchip.",
        'polizze': "ℹ️ **Guida - Polizze & Assicurazioni**\n\nTieni traccia delle polizze assicurative (RC cane, responsabilità civile per la raccolta e infortuni) monitorando le relative scadenze.",
        'vet': "ℹ️ **Guida - Libretti Sanitari Cani & Profilassi**\n\nRegistra lo storico dei trattamenti veterinari, dei vaccini e della somministrazione di antiparassitari per i tuoi cani. Per le cagne femmine è disponibile il diario del calore con previsione del prossimo ciclo.",
        'registro_giornaliero': "ℹ️ **Guida - Registro Giornaliero Ritrovamenti**\n\nAnnota i quantitativi giornalieri raccolti suddivisi per specie e data, con filtri avanzati per anno e tipologia di tartufo.",
        'spese': "ℹ️ **Guida - Gestione Spese Tartufaio**\n\nTraccia tutte le spese vive connesse all'attività (carburante, attrezzatura, visite veterinarie e tasse) e visualizza il totale dell'anno corrente.",
        'bilancio': "ℹ️ **Guida - Contabilità & Bilancio Annuo**\n\nMonitora i guadagni netti, le spese totali, l'utile effettivo e verifica in tempo reale il rispetto della soglia limite di occasionalità di 7.000,00 €.",
        'export': "ℹ️ **Guida - Report & Backup Dati**\n\nEsporta i dati contabili in formato CSV o crea un backup manuale JSON.\n\nIl backup automatico salva il file **backup_truffle_automatico.json** nella cartella Download del dispositivo ogni volta che modifichi un dato (sovrascrive sempre lo stesso file). Usa '💾 Salva Backup Ora' per forzarlo manualmente. Per ripristinare, premi '📂 Ripristina da File...' e scegli il file dalla cartella Download.",
        'vet-emergency': "ℹ️ **Guida - Pronto Soccorso & Cliniche H24**\n\nMemorizza i contatti delle cliniche veterinarie aperte 24 ore su 24 e invia rapidamente la tua posizione GPS in caso di emergenza.",
        'clienti': "ℹ️ **Guida - Rubrica Clienti & Acquirenti**\n\nVisualizza l'elenco dei tuoi clienti ordinati per volume d'acquisto, consulta lo storico e gestisci le note dedicate.",
        'archivio': "ℹ️ **Guida - Archivio Date per Regione**\n\nGestisci e personalizza i calendari regionali di raccolta dei tartufi o estrai automaticamente le date incollando il testo normativo ufficiale.",
        'calendario': "ℹ️ **Guida - Calendario Raccolta (GPS)**\n\nVerifica in base alla tua posizione GPS attuale quali specie di tartufo hanno il periodo di raccolta attualmente aperto o chiuso."
    };

    const messaggio = guideTesti[moduleName] || "ℹ️ Guida non disponibile per questo modulo.";
    await appAlert(messaggio);
}
