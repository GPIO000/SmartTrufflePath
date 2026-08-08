// Inizializzazione Mappa corretta (ordine invertito per evitare ReferenceError)
const map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

setTimeout(() => {
    map.invalidateSize();
}, 300);

setTimeout(() => {
    map.invalidateSize();
    mostraDisclaimerIniziale(); // <-- Mostra il disclaimer subito dopo l'avvio/GPS
}, 400);

let userMarker = null;
let carMarker = null;
let carCoordinates = JSON.parse(localStorage.getItem('car_coords')) || null;
let poiList = JSON.parse(localStorage.getItem('poi_list') || '[]');
let poiMapMarkers = {}; 
let targetNavigation = null;

let deferredInstallPrompt = null;
let appAlreadyInstalled = false;

function syncInstallButtonState() {
    const btn = document.getElementById('btn-installa-app');
    if (!btn) return;
    if (appAlreadyInstalled) {
        btn.textContent = '✅ App già installata';
        btn.disabled = true;
        btn.style.display = 'block';
        btn.style.background = '#475569';
        btn.style.cursor = 'default';
        return;
    }
    if (deferredInstallPrompt) {
        btn.textContent = '📲 Installa app';
        btn.disabled = false;
        btn.style.display = 'block';
        btn.style.background = '#16a34a';
        btn.style.cursor = 'pointer';
    } else {
        btn.style.display = 'none';
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    syncInstallButtonState();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    appAlreadyInstalled = true;
    syncInstallButtonState();
});

window.addEventListener('load', () => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
        appAlreadyInstalled = true;
    }
    syncInstallButtonState();
});

function installApp() {
    if (!deferredInstallPrompt || appAlreadyInstalled) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
        deferredInstallPrompt = null;
        appAlreadyInstalled = choiceResult.outcome === 'accepted';
        syncInstallButtonState();
        console.log(choiceResult.outcome === 'accepted' ? 'Installazione PWA accettata' : 'Installazione PWA rifiutata');
    });
}

function updateInstallButtonVisibility() {
    syncInstallButtonState();
}

// ============================================
// GEOLOCALIZZAZIONE E GPS
// ============================================
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
        const marker = L.marker([poi.lat, poi.lng]).addTo(map)
            .bindPopup(`<b>📍 Tartufo / Punto</b><br>Nota: ${poi.note || 'Nessuna nota'}<br><small>${poi.date}</small>`);
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
        alert("🚗 Posizione dell'auto salvata con successo!");
    } else { alert("Segnale GPS non ancora disponibile per marcare l'auto."); }
}

function deleteCarPosition() {
    if (carCoordinates) {
        if (confirm("Vuoi davvero eliminare la posizione dell'auto salvata?")) {
            if (carMarker) { map.removeLayer(carMarker); carMarker = null; }
            carCoordinates = null;
            localStorage.removeItem('car_coords');
            if (targetNavigation === 'car') targetNavigation = null;
            alert("🚗 Posizione dell'auto rimossa con successo!");
        }
    } else { alert("Nessuna posizione dell'auto attualmente salvata."); }
}
function returnToCar() {
    if (carCoordinates) {
        targetNavigation = 'car';
        map.setView([carCoordinates.lat, carCoordinates.lng], 18);
        if (carMarker) carMarker.openPopup();
    } else { alert("Nessun parcheggio salvato. Clicca prima su 'Auto'."); }
}
function savePoiPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const note = prompt("Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):", "Tartufaia");
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
        alert("📍 Punto salvato con successo e impostato sulla bussola!");
    } else { alert("Segnale GPS non ancora disponibile per marcare il punto."); }
}
function navigateToPoi(index) {
    if (poiList[index]) {
        targetNavigation = `poi_${index}`;
        map.setView([poiList[index].lat, poiList[index].lng], 18);
        if (poiMapMarkers[index]) poiMapMarkers[index].openPopup();
        closeActiveModule();
        alert(`🧭 Destinazione impostata sulla bussola: ${poiList[index].note}`);
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

function deletePoi(index) {
    if (confirm("Vuoi davvero eliminare questo punto salvato?")) {
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
    } else { alert("Impossibile rilevare le coordinate GPS."); }
}
function openModule(moduleName, editMode = false) {
    toggleDrawer();
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
                    poiHtml += `
                        <div class="module-card" style="margin-bottom:12px;">
                            <strong style="color:#60a5fa; font-size:1rem;">📍 ${poi.note}</strong>
                            <p style="font-size:0.8rem; color:#94a3b8; margin:4px 0;">Data: ${poi.date}</p>
                            <p style="font-size:0.8rem; color:#cbd5e1;">Lat: ${poi.lat.toFixed(4)}, Lng: ${poi.lng.toFixed(4)}</p>
                            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
                                <button class="overlay-btn" style="background:#16a34a;" onclick="navigateToPoi(${idx})">🧭 Vai</button>
                                <button class="overlay-btn" style="background:#0284c7;" onclick="sharePoi(${idx})">📤 Condividi</button>
                                <button class="overlay-btn" style="background:#dc2626;" onclick="deletePoi(${idx})">🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = poiHtml;
            break;
        default:
            contentHTML = `<h2>Modulo</h2><p>In fase di sviluppo.</p>`;
    }
    
    activeView.innerHTML = `
        <div class="module-header-bar" style="display: flex; justify-content: space-between; align-items: center;">
            <button onclick="closeActiveModule()" class="back-map-btn">← Torna alla Mappa</button>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="mostraInfoModulo('${moduleName}')" class="back-map-btn" style="background: #334155; color: #38bdf8; border: 1px solid #475569; display: inline-flex; align-items: center;">ℹ️</button>
                <button onclick="toggleDrawer(); closeActiveModule();" class="back-map-btn" style="color: #f8fafc;">☰ Torna al Menu</button>
            </div>
        </div>
        <div class="module-body-content">${contentHTML}</div>
    `;
    activeView.style.display = 'flex';
}

function closeActiveModule() {
    const activeView = document.getElementById('active-module-view');
    if (activeView) activeView.style.display = 'none';
}
function clearData(storageKey, moduleName) {
    if (confirm("Vuoi davvero eliminare questi dati?")) {
        localStorage.removeItem(storageKey);
        openModule(moduleName);
    }
}
function toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) { drawer.classList.toggle('drawer-open'); backdrop.classList.toggle('active'); updateInstallButtonVisibility(); }
}
function centerOnUser() {
    if (userMarker) { const pos = userMarker.getLatLng(); map.setView([pos.lat, pos.lng], 16); userMarker.openPopup(); }
    else { alert("Posizione GPS non disponibile."); }
}
function saveVetClinic() {
    const nome = document.getElementById('vc-nome').value.trim();
    const tel = document.getElementById('vc-tel').value.trim();
    const note = document.getElementById('vc-note').value.trim();
    if (!nome || !tel) { alert("Inserisci nome e telefono."); return; }
    let vetClinics = JSON.parse(localStorage.getItem('vet_clinics_list') || '[]');
    vetClinics.push({ nome, tel, note });
    localStorage.setItem('vet_clinics_list', JSON.stringify(vetClinics));
    alert("Clinica salvata!"); openModule('vet-emergency');
}

function deleteVetClinic(index) {
    if (confirm("Rimuovere contatto?")) {
        let vetClinics = JSON.parse(localStorage.getItem('vet_clinics_list') || '[]');
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
    } else { alert("GPS non disponibile."); }
}

function saveVetHistoryItem() {
    const cane = document.getElementById('vh-cane').value;
    const tipo = document.getElementById('vh-tipo').value;
    const data = document.getElementById('vh-data').value;
    const note = document.getElementById('vh-note').value.trim();
    if (!data) { alert("Inserisci la data."); return; }
    let vetHistory = JSON.parse(localStorage.getItem('vet_history_list') || '[]');
    vetHistory.push({ cane, tipo, data, note });
    localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
    alert("Trattamento registrato!"); openModule('vet');
}

function deleteVetHistoryItem(index) {
    if (confirm("Rimuovere record?")) {
        let vetHistory = JSON.parse(localStorage.getItem('vet_history_list') || '[]');
        vetHistory.splice(index, 1);
        localStorage.setItem('vet_history_list', JSON.stringify(vetHistory));
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
            alert("Link copiato negli appunti!");
        }).catch(() => {
            alert("Impossibile condividere o copiare il link.");
        });
    }
}

function visualizzaImmagineSalvata(base64Data, titolo, moduloProvenienza = 'tesserino') {
    if (!base64Data) return;
    
    let activeView = document.getElementById('active-module-view');
    if (!activeView) return;

    let contentHTML = `
        <h2>Visualizzazione Documento</h2>
        <p><strong>${titolo || 'Allegato'}</strong></p>
        <div class="module-card" style="text-align: center; background: #fff; padding: 15px; border-radius: 8px;">
            <img src="${base64Data}" style="max-width: 100%; height: auto; border-radius: 6px;" alt="Documento Salvato">
        </div>
        <button class="overlay-btn" style="background:#475569; margin-top:15px; width:100%;" onclick="openModule('${moduloProvenienza}')">← Torna Indietro</button>
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
        `<strong>1. Natura dello Strumento</strong><br>Questa applicazione è concepita e fornita esclusivamente come strumento informale di supporto hobbistico, tracciabilità interna e geolocalizzazione personale per l'attività di raccolta dei tartufi. Non costituisce in alcun modo un servizio professionale o ufficiale, né sostituisce le fonti normative primarie, gli organi competenti o il parere di un professionista abilitato.`,
        `<strong>2. Esclusione di Consulenza Fiscale e Professionale</strong><br><span style="color: #f87171;">Il software non costituisce in alcun modo un servizio di consulenza finanziaria, fiscale, legale o tecnica.</span> Le funzioni di ricevuta, contabilità, soglie di occasionalità e regimi fiscali sono fornite a scopo orientativo/organizzativo.`,
        `<strong>3. Responsabilità Esclusiva dell'Utente</strong><br>L'utente è l'unico e il solo responsabile della conformità fiscale, della correttezza e veridicità dei dati inseriti, della completezza dei documenti archiviati e del loro utilizzo.`,
        `<strong>4. Geolocalizzazione e Sicurezza all'Aperto</strong><br>Le indicazioni di orientamento, le coordinate GPS, la bussola e la memorizzazione dei punti di interesse o dei parcheggi dipendono dal dispositivo, dai permessi concessi e dalla copertura GPS.`,
        `<strong>5. Manleva</strong><br>Gli sviluppatori, i creatori e i distributori del software declinano espressamente ogni responsabilità civile e penale per imprecisioni, errori di calcolo, omissioni o malfunzionamenti.`
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
            <div style="background: #1e293b; color: #f8fafc; padding: 25px; border-radius: 12px; max-width: 500px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; font-family: sans-serif;">
                <h3 style="color: #f59e0b; margin-top: 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: space-between;">
                    <span>⚠️ Avviso e Limitazione di Responsabilità</span>
                    <span id="disclaimer-counter" style="font-size: 0.8rem; color: #94a3b8; font-weight: normal;">1 / 5</span>
                </h3>
                <div id="disclaimer-text-container" style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; min-height: 110px; max-height: 55vh; overflow-y: auto; padding-right: 5px; margin: 15px 0;">
                    ${pagineDisclaimer[0]}
                </div>
                <div id="disclaimer-buttons-container">
                    <button id="btn-avanti-disclaimer" style="background: #3b82f6; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer;">
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
                    <button id="btn-avanti-disclaimer" style="background: #3b82f6; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer;">
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
                    <button id="btn-accetta-disclaimer" style="background: #22c55e; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-bottom: 8px;">
                        Accetta e Continua
                    </button>
                    <button id="btn-abbandona-app" style="background: #334155; color: #f87171; border: 1px solid #475569; padding: 10px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 0.95rem; cursor: pointer;">
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
    const rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
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

// Funzione per condividere la ricevuta via Email (da richiamare nella visualizzazione ricevuta)
function condividiRicevutaEmail(index) {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const v = storico[index];
    if (!v) {
        alert("Ricevuta non trovata.");
        return;
    }

    // L'email viene inserita nel testo anziché nel parametro mailto principale se vuoi che l'utente la veda lì
    const emailTesto = v.acquirenteEmail ? v.acquirenteEmail : "Non specificata";

    const oggetto = encodeURIComponent(`Ricevuta di Vendita Occasionale - Lotto ${v.lotto || 'Tartufo'}`);
    const corpo = encodeURIComponent(
        `Gentile ${v.acquirente},\n\n` +
        `Indirizzo Email Acquirente: ${emailTesto}\n\n` +
        `Di seguito i dettagli della ricevuta di vendita occasionale di tartufi conforme alla Legge 145/2018:\n\n` +
        `• Data: ${v.data}\n` +
        `• Specie: ${v.specie}\n` +
        `• Qualità: ${v.qualita || 'Non specificata'}\n` +
        `• Peso: ${v.peso} grammi\n` +
        `• Importo Totale: € ${v.importo}\n` +
        `• Comune di Raccolta: ${v.comune}\n` +
        `• Codice Lotto: ${v.lotto}\n\n` +
        `Cordiali saluti,\n${v.venditoreNome}`
    );

    // Se non vuoi che inserisca l'email nel campo "A:", rimuovi ${v.acquirenteEmail} prima del punto e virgola
    window.location.href = `mailto:?subject=${oggetto}&body=${corpo}`;
}

async function condividiRicevutaEmail(index) {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const v = storico[index];
    if (!v) {
        alert("Ricevuta non trovata.");
        return;
    }

    const emailDestinatarioTesto = v.acquirenteEmail ? v.acquirenteEmail : "Non specificato";
    const isRitenuta = v.regime === 'ritenuta';

    // Gestione dinamica dei dettagli economici in base al regime fiscale registrato
    let dettagliEconomiciTesto = "";
    if (isRitenuta) {
        const lordo = parseFloat(v.importo) || 0;
        const ritenuta = v.ritenuta ? parseFloat(v.ritenuta) : (lordo * 0.23);
        const netto = v.netto !== undefined ? parseFloat(v.netto) : (lordo - ritenuta);

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
        alert(`Il tuo browser non supporta l'allegato automatico via Web. L'indirizzo email dell'acquirente è: ${emailDestinatarioTesto}`);
    }
}

function salvaNotaCliente(index, testoNota) {
    let rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
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

    let rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
    if (rubricaClienti[index]) {
        rubricaClienti[index].nota = textarea.value.trim();
        localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));
        alert("📝 Nota del cliente salvata con successo!");
        openModule('clienti');
    }
}
function saveSpesa() {
    const data = document.getElementById('spese-data').value;
    const categoria = document.getElementById('spese-categoria').value;
    const importo = parseFloat(document.getElementById('spese-importo').value);
    const note = document.getElementById('spese-note').value.trim();

    if (!data || isNaN(importo) || importo <= 0) {
        alert("Inserisci una data valida e un importo superiore a zero.");
        return;
    }

    let speseList = JSON.parse(localStorage.getItem('spese_list') || '[]');
    speseList.push({ data, categoria, importo, note });
    localStorage.setItem('spese_list', JSON.stringify(speseList));
    
    alert("Spesa registrata con successo!");
    openModule('spese');
}

function deleteSpesa(index) {
    if (confirm("Vuoi davvero eliminare questa spesa?")) {
        let speseList = JSON.parse(localStorage.getItem('spese_list') || '[]');
        speseList.splice(index, 1);
        localStorage.setItem('spese_list', JSON.stringify(speseList));
        openModule('spese');
    }
}

function salvaArchivioRegionaleTartufi(regione) {
    let calendariPersonalizzatiArchivio = JSON.parse(localStorage.getItem('calendari_tartufi_custom') || '{}');
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
        let noteRegionaliSalvate = JSON.parse(localStorage.getItem('note_regionali_tartufi') || '{}');
        noteRegionaliSalvate[regione] = inputNotaRegionale.value.trim();
        localStorage.setItem('note_regionali_tartufi', JSON.stringify(noteRegionaliSalvate));
    }

    alert(`✔ Date, note e periodi per la regione ${regione} salvati con successo nell'archivio unificato!`);
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
    // Esempio di utilizzo collegato a un pulsante o a un evento
    const testo = document.getElementById('inputTestoGrezzo').value;
    const datiEstratti = estraiSpecieEPeriodiDaTesto(testo);
    
    console.log(datiEstratti);
}

function estraiDateTartufiDaTesto() {
    const textarea = document.getElementById('testo-normativa-tartufi');
    if (!textarea) return;
    
    let testo = textarea.value.trim();
    if (!testo) {
        alert("Inserisci o incolla prima il testo della normativa regionale nel riquadro.");
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
        { id: 8, keywords: ["tuber brumale var. moschatum", "tuber brumale var moschatum", "tartufo moscato"] },
        { id: 4, keywords: ["tuber brumale", "tartufo nero d’inverno", "tartufo nero di inverno", "trifola nera"] },
        { id: 0, keywords: ["tuber magnatum", "tartufo bianco"] },
        { id: 1, keywords: ["tuber melanosporum", "tartufo nero di norcia", "tartufo nero pregiato"] },
        { id: 2, keywords: ["tuber aestivum", "scorzone", "tartufo d'estate", "tartufo estivo"] },
        { id: 3, keywords: ["tuber uncinatum", "tartufo uncinato" ] },
        { id: 5, keywords: ["tuber borchii", "t. borchi", "t. albidum", "bianchetto", "marzuolo"] },
        { id: 6, keywords: ["tuber macrosporum", "tartufo nero liscio"] },
        { id: 7, keywords: ["tuber mesentericum", "tartufo nero ordinario", "tartufo nero di bagnoli"] }
    ];

    let calendariPersonalizzati = JSON.parse(localStorage.getItem('calendari_tartufi_custom') || '{}');
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
        
        if (typeof aggiornaCalendarioGPS === 'function') {
            aggiornaCalendarioGPS();
        }

        alert(`🔍 Estrazione completata con successo!\nAggiornati ${modificheEffettuate} periodi di raccolta per la regione: ${regioneCorrente}.`);
    } else {
        alert("⚠️ Impossibile estrarre automaticamente le date. Verifica che il testo contenga i nomi corretti e la struttura 'dal ... al ...'.");
    }
}
// Funzione per scaricare i calendari e le note regionali in formato JSON
// Funzione per esportare e condividere i calendari e le note regionali in formato JSON
async function esportaCalendariJSON() {
    const calendari = localStorage.getItem('calendari_tartufi_custom') || '{}';
    const note = localStorage.getItem('note_regionali_tartufi') || '{}';
    
    const exportData = {
        calendari_tartufi_custom: JSON.parse(calendari),
        note_regionali_tartufi: JSON.parse(note),
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
            
            if (content.calendari_tartufi_custom) {
                localStorage.setItem('calendari_tartufi_custom', JSON.stringify(content.calendari_tartufi_custom));
            }
            if (content.note_regionali_tartufi) {
                localStorage.setItem('note_regionali_tartufi', JSON.stringify(content.note_regionali_tartufi));
            }

            alert("✔ Calendari e note regionali importati con successo!");
            openModule('archivio'); // Ricarica il modulo archivio per mostrare i dati aggiornati
        } catch (err) {
            alert("❌ Errore durante la lettura del file JSON. Assicurati che sia un file di backup valido.");
            console.error(err);
        }
    };
    reader.readAsText(file);
}
function mostraInfoModulo(moduleName) {
    const guideTesti = {
        'poilist': "ℹ️ **Guida - Elenco Punti & Tartufaie**\n\nQui puoi visualizzare tutti i punti di interesse e le tartufaie salvate con le relative coordinate e note. Puoi impostare la navigazione, condividere o eliminare i punti.",
        'tesserino': "ℹ️ **Guida - Anagrafica & Tesserino Digitale**\n\nInserisci e archivia i dati del tuo tesserino regionale di raccolta tartufi e carica una foto o un PDF del documento (max 1.5 MB).",
        'pagopa': "ℹ️ **Guida - Ricevuta PagoPA & PDF**\n\nRegistra la quietanza di pagamento della tassa regionale annuale obbligatoria. Questo dato è indispensabile per sbloccare la registrazione delle vendite occasionali.",
        'ricevute': "ℹ️ **Guida - Ricevuta di Vendita Occasionale**\n\nEmetti ricevute di vendita conformi alla normativa vigente (Legge 145/2018). Il sistema sceglie automaticamente il regime fiscale corretto in base ai dati salvati.",
        'storico_ricevute': "ℹ️ **Guida - Archivio Storico Ricevute**\n\nConsulta l'elenco cronologico di tutte le ricevute emesse, con la possibilità di visualizzarle, modificarle, stamparle o condividerle.",
        'f24': "ℹ️ **Guida - F24 ELIDE**\n\nRegistra il versamento dell'imposta sostitutiva annuale di 100€ prevista dalla Legge 145/2018 per la vendita occasionale dei tartufi.",
        'canidiary': "ℹ️ **Guida - Profilo Cani & Diario**\n\nGestisci l'anagrafica dei tuoi cani da tartufo inserendo razza, data di nascita e numero di microchip.",
        'polizze': "ℹ️ **Guida - Polizze & Assicurazioni**\n\nTieni traccia delle polizze assicurative (RC cane, responsabilità civile per la raccolta e infortuni) monitorando le relative scadenze.",
        'vet': "ℹ️ **Guida - Libretto Sanitario & Profilassi**\n\nRegistra lo storico dei trattamenti veterinari, dei vaccini e della somministrazione di antiparassitari per i tuoi cani.",
        'registro_giornaliero': "ℹ️ **Guida - Registro Giornaliero Ritrovamenti**\n\nAnnota i quantitativi giornalieri raccolti suddivisi per specie e data, con filtri avanzati per anno e tipologia.",
        'spese': "ℹ️ **Guida - Gestione Spese Tartufaio**\n\nTraccia tutte le spese vive connesse all'attività (carburante, attrezzatura, visite veterinarie e tasse) e visualizza il totale dell'anno corrente.",
        'bilancio': "ℹ️ **Guida - Contabilità & Bilancio Annuo**\n\nMonitora i guadagni netti, le spese totali, l'utile effettivo e verifica in tempo reale il rispetto della soglia limite di occasionalità.",
        'export': "ℹ️ **Guida - Report & Backup Dati**\n\nEsporta i dati contabili in formato CSV, scarica un backup completo in formato JSON o ripristina i dati da un file di salvataggio precedente.",
        'vet-emergency': "ℹ️ **Guida - Pronto Soccorso & Cliniche H24**\n\nMemorizza i contatti delle cliniche veterinarie aperte 24 ore su 24 e invia rapidamente la tua posizione GPS in caso di emergenza.",
        'clienti': "ℹ️ **Guida - Rubrica Clienti & Acquirenti**\n\nVisualizza l'elenco dei tuoi clienti ordinati per volume d'acquisto, consulta lo storico e gestisci le note dedicate.",
        'archivio': "ℹ️ **Guida - Archivio Date per Regione**\n\nGestisci e personalizza i calendari regionali di raccolta dei tartufi o estrai automaticamente le date incollando il testo normativo regionale.",
        'calendario': "ℹ️ **Guida - Calendario Raccolta (GPS)**\n\nVerifica in base alla tua posizione GPS attuale quali specie di tartufo hanno il periodo di raccolta attualmente aperto o chiuso."
    };

    const messaggio = guideTesti[moduleName] || "ℹ️ Guida non disponibile per questo modulo.";
    alert(messaggio);
}
