// Inizializzazione della mappa con controlli di zoom in alto a destra
const map = L.map('map', {
    zoomControl: false
}).setView([41.8719, 12.5674], 6);

L.control.zoom({
    position: 'topright'
}).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

let userMarker = null;
let carMarker = null;
let carCoordinates = JSON.parse(localStorage.getItem('car_coords')) || null;

// Gestione multipla dei Punti di Interesse (POI / Tartufaie)
let poiList = JSON.parse(localStorage.getItem('poi_list') || '[]');
let poiMapMarkers = {}; 

let targetNavigation = null; 

// Calcolo distanza in metri e freccia di direzione dinamica
function calculateDistanceAndBearing(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
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
    const compassText = document.getElementById('compass-text');
    if (!compassText) return;

    let target = null;
    let label = '';

    if (targetNavigation === 'car' && carCoordinates) {
        target = carCoordinates;
        label = '🚗 Auto';
    } else if (typeof targetNavigation === 'string' && targetNavigation.startsWith('poi_')) {
        const index = parseInt(targetNavigation.split('_')[1]);
        if (poiList[index]) {
            target = poiList[index];
            label = `📍 ${poiList[index].note || 'Punto'}`;
        }
    }

    if (target) {
        const res = calculateDistanceAndBearing(currentLat, currentLng, target.lat, target.lng);
        compassText.innerHTML = `🧭 <b>${label}:</b> ${res.arrow} ${res.distance} (${res.direction})`;
    } else {
        compassText.innerHTML = `🧭 Seleziona una destinazione (Auto o Punto)`;
    }
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            const dot = document.getElementById('gps-status-dot');
            if (dot) {
                dot.style.backgroundColor = '#22c55e';
                dot.title = "GPS Attivo: " + lat.toFixed(4) + ", " + lng.toFixed(4);
            }

            if (!userMarker) {
                userMarker = L.marker([lat, lng]).addTo(map)
                    .bindPopup("<b>Sei qui</b><br>Posizione tartufaia rilevata.")
                    .openPopup();
                map.setView([lat, lng], 16);

                if (carCoordinates) {
                    carMarker = L.marker([carCoordinates.lat, carCoordinates.lng]).addTo(map)
                        .bindPopup("<b>🚗 La tua Auto</b>");
                }
                renderAllPoiMarkers();
            } else {
                userMarker.setLatLng([lat, lng]);
            }

            updateCompass(lat, lng);
        },
        (error) => {
            console.warn("Errore GPS: " + error.message);
            const dot = document.getElementById('gps-status-dot');
            if (dot) dot.style.backgroundColor = '#ef4444';
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
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

function saveCarPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        carCoordinates = { lat: pos.lat, lng: pos.lng };
        localStorage.setItem('car_coords', JSON.stringify(carCoordinates));

        if (carMarker) {
            carMarker.setLatLng([pos.lat, pos.lng]);
        } else {
            carMarker = L.marker([pos.lat, pos.lng]).addTo(map)
                .bindPopup("<b>🚗 La tua Auto</b>");
        }
        alert("🚗 Posizione dell'auto salvata con successo!");
    } else {
        alert("Segnale GPS non ancora disponibile per marcare l'auto.");
    }
}

// --- GESTIONE CANCELLAZIONE POSIZIONE AUTO ---
function deleteCarPosition() {
    if (carCoordinates) {
        if (confirm("Vuoi davvero eliminare la posizione dell'auto salvata?")) {
            if (carMarker) {
                map.removeLayer(carMarker);
                carMarker = null;
            }
            carCoordinates = null;
            localStorage.removeItem('car_coords');
            
            if (targetNavigation === 'car') {
                targetNavigation = null;
            }
            
            alert("🚗 Posizione dell'auto rimossa con successo!");
        }
    } else {
        alert("Nessuna posizione dell'auto attualmente salvata.");
    }
}

function returnToCar() {
    if (carCoordinates) {
        targetNavigation = 'car';
        map.setView([carCoordinates.lat, carCoordinates.lng], 18);
        if (carMarker) carMarker.openPopup();
    } else {
        alert("Nessun parcheggio salvato. Clicca prima su 'Auto'.");
    }
}

function savePoiPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const note = prompt("Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):", "Tartufaia");
        if (note === null) return;

        const newPoi = {
            lat: pos.lat,
            lng: pos.lng,
            note: note || "Punto di interesse",
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
    } else {
        alert("Segnale GPS non ancora disponibile per marcare il punto.");
    }
}

function navigateToPoi(index) {
    if (poiList[index]) {
        targetNavigation = `poi_${index}`;
        map.setView([poiList[index].lat, poiList[index].lng], 18);
        if (poiMapMarkers[index]) {
            poiMapMarkers[index].openPopup();
        }
        closeActiveModule();
        alert(`🧭 Destinazione impostata sulla bussola: ${poiList[index].note}`);
    }
}

function sharePoi(index) {
    if (poiList[index]) {
        const p = poiList[index];
        const msg = `📍 TARTUFAIA CONDIVISA\nNota: ${p.note}\nData: ${p.date}\nGoogle Maps: https://maps.google.com/?q=${p.lat},${p.lng}`;
        if (navigator.share) {
            navigator.share({ title: 'Tartufaia', text: msg }).catch(() => {});
        } else {
            window.location.href = `whatsapp://send?text=${encodeURIComponent(msg)}`;
        }
    }
}

function deletePoi(index) {
    if (confirm("Vuoi davvero eliminare questo punto salvato?")) {
        if (poiMapMarkers[index]) {
            map.removeLayer(poiMapMarkers[index]);
            delete poiMapMarkers[index];
        }
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
    } else {
        alert("Impossibile rilevare le coordinate GPS.");
    }
}

// --- GESTIONE MODULI CON DOPPIA VISTA (LETTURA / MODIFICA) ---
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

        case 'tesserino':
            const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
            if (tData.nome && !editMode) {
                contentHTML = `
                    <h2>Anagrafica & Tesserino Digitale</h2>
                    <p><strong>Normativa:</strong> Legge 145/2018</p>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Tesserino Registrato</p>
                        <p><strong>Nome:</strong> ${tData.nome}</p>
                        <p><strong>Codice Fiscale:</strong> ${tData.cf}</p>
                        <p><strong>Regione / Prov:</strong> ${tData.regione}</p>
                        <p><strong>N. Tesserino:</strong> ${tData.num}</p>
                        <div style="display:flex; gap:10px; margin-top:15px;">
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('tesserino', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('tesserino_data', 'tesserino')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Anagrafica & Tesserino Digitale</h2>
                    <p><strong>Normativa:</strong> Legge 145/2018</p>
                    <div class="module-card">
                        <label>Nome e Cognome:</label>
                        <input type="text" id="t-nome" class="mod-input" value="${tData.nome || ''}" placeholder="Es. Mario Rossi">
                        <label>Codice Fiscale:</label>
                        <input type="text" id="t-cf" class="mod-input" value="${tData.cf || ''}" placeholder="RSSMRA...">
                        <label>Regione / Provincia di Rilascio:</label>
                        <input type="text" id="t-regione" class="mod-input" value="${tData.regione || ''}" placeholder="Es. Molise / Campobasso">
                        <label>Numero Tesserino / Autorizzazione:</label>
                        <input type="text" id="t-num" class="mod-input" value="${tData.num || ''}" placeholder="Es. TR-2026-001">
                        <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveTesserino()">Salva Dati Tesserino</button>
                    </div>`;
            }
            break;
            
        case 'pagopa':
            const pData = JSON.parse(localStorage.getItem('pagopa_data') || '{}');
            if (pData.id && !editMode) {
                contentHTML = `
                    <h2>Ricevuta PagoPA & QR Code</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Quietanza Attiva</p>
                        <p><strong>ID Transazione:</strong> ${pData.id}</p>
                        <p><strong>Data Pagamento:</strong> ${pData.data}</p>
                        <div style="background:#fff; color:#000; padding:15px; text-align:center; margin:15px 0; border-radius:6px; display: flex; flex-direction: column; align-items: center;">
                            <div id="qrcode-container" style="margin-bottom: 10px;"></div>
                            <strong style="font-size:0.85rem;">[ QR CODE ATTIVO PER CONTROLLO FORESTALE ]</strong><br>
                            <span style="font-size:0.75rem; color:#555;">Verifica immediata tesserino in regola</span>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('pagopa', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('pagopa_data', 'pagopa')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Ricevuta PagoPA & QR Code</h2>
                    <p>Quietanza versamento tassa regionale annuale.</p>
                    <div class="module-card">
                        <label>ID Transazione / Codice Avviso:</label>
                        <input type="text" id="p-id" class="mod-input" value="${pData.id || ''}" placeholder="Es. PPA-992837465">
                        <label>Data Pagamento:</label>
                        <input type="date" id="p-data" class="mod-input" value="${pData.data || ''}">
                        <button class="overlay-btn" style="width:100%; margin-top:10px;" onclick="savePagoPA()">Salva Quietanza PagoPA</button>
                    </div>`;
            }
            break;
            
        case 'ricevute':
            // Recupera automaticamente il protocollo F24 salvato in precedenza
            const f24SavedData = JSON.parse(localStorage.getItem('f24_data') || '{}');
            const defaultProtocollo = f24SavedData.protocollo || '';

            contentHTML = `
                <h2>Ricevuta di Vendita Occasionale</h2>
                <p>Conforme a Legge 145/2018, Reg. CE 178/02 & DPR 633/1972</p>
                <div class="module-card">
                    <label>Acquirente (Privato o Ristorante / Ragione Sociale):</label>
                    <input type="text" id="r-acquirente" class="mod-input" placeholder="Nome o Ristorante">
                    <label>P.IVA / Codice Fiscale Acquirente:</label>
                    <input type="text" id="r-cf-acquirente" class="mod-input" placeholder="P.IVA o CF acquirente">
                    <label>Specie Tartufo:</label>
                    <select id="r-specie" class="mod-input">
                        <option value="Pregiato Bianco (Tuber magnatum pico)">Pregiato Bianco (Tuber magnatum pico)</option>
                        <option value="Nero Pregiato (Tuber melanosporum)">Nero Pregiato (Tuber melanosporum)</option>
                        <option value="Scorzone (Tuber aestivum)">Scorzone (Tuber aestivum)</option>
                    </select>
                    <label>Peso (grammi):</label>
                    <input type="number" id="r-peso" class="mod-input" placeholder="Es. 150">
                    <label>Importo Totale (€):</label>
                    <input type="number" id="r-importo" class="mod-input" placeholder="Es. 200.00">
                    <label>Comune di Raccolta / Località:</label>
                    <input type="text" id="r-comune" class="mod-input" placeholder="Comune di ritrovamento">
                    <label>Codice Lotto / Tracciabilità:</label>
                    <input type="text" id="r-lotto" class="mod-input" value="LOTTO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-01" placeholder="Codice lotto">
                    <label>N. Protocollo F24 ELIDE collegato (Compilato in automatico):</label>
                    <input type="text" id="r-f24" class="mod-input" value="${defaultProtocollo}" placeholder="Inserisci prima l'F24 nel menu apposito">
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="registraVendita()">Registra e Genera Ricevuta Conforme</button>
                </div>`;
            break;

        case 'f24':
            const fData = JSON.parse(localStorage.getItem('f24_data') || '{}');
            if (fData.protocollo && !editMode) {
                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ F24 Registrato</p>
                        <p><strong>Anno Fiscale:</strong> ${fData.anno}</p>
                        <p><strong>Protocollo:</strong> ${fData.protocollo}</p>
                        <div style="display:flex; gap:10px; margin-top:15px;">
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('f24', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('f24_data', 'f24')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <p>Legge 145/2018 (Codice Tributo: 1853)</p>
                    <div class="module-card">
                        <p>Versamento annuo di 100€ per l'esonero dalla ritenuta d'acconto del 23%.</p>
                        <label>Anno Fiscale:</label>
                        <input type="text" id="f-anno" class="mod-input" value="${fData.anno || '2026'}">
                        <label>Numero Protocollo F24 Quietanzato:</label>
                        <input type="text" id="f-protocollo" class="mod-input" value="${fData.protocollo || ''}" placeholder="Es. 000123456789">
                        <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveF24()">Salva Protocollo F24</button>
                    </div>`;
            }
            break;

        case 'canidiary':
            const cData = JSON.parse(localStorage.getItem('cane_data') || '{}');
            if (cData.nome && !editMode) {
                contentHTML = `
                    <h2>Profilo Cani & Diario Ricerca</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">🐕 Cane Registrato</p>
                        <p><strong>Nome:</strong> ${cData.nome}</p>
                        <p><strong>Razza:</strong> ${cData.razza}</p>
                        <p><strong>Microchip:</strong> ${cData.microchip || 'Non inserito'}</p>
                        <div style="display:flex; gap:10px; margin-top:15px;">
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('canidiary', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('cane_data', 'canidiary')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Profilo Cani & Diario Ricerca</h2>
                    <div class="module-card">
                        <label>Nome del Cane:</label>
                        <input type="text" id="c-nome" class="mod-input" value="${cData.nome || ''}" placeholder="Es. Argo">
                        <label>Razza:</label>
                        <input type="text" id="c-razza" class="mod-input" value="${cData.razza || 'Lagotto Romagnolo'}">
                        <label>Numero Microchip:</label>
                        <input type="text" id="c-microchip" class="mod-input" value="${cData.microchip || ''}" placeholder="Codice microchip">
                        <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveCane()">Salva Profilo Cane</button>
                    </div>`;
            }
            break;

        case 'vet':
            const vData = JSON.parse(localStorage.getItem('vet_data') || '{}');
            if (vData.vaccino && !editMode) {
                contentHTML = `
                    <h2>Libretto Sanitario & Vaccini</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">💉 Dati Sanitari Registrati</p>
                        <p><strong>Ultimo Antiparassitario:</strong> ${vData.antiparassitario || 'N.D.'}</p>
                        <p><strong>Scadenza Vaccino:</strong> ${vData.vaccino}</p>
                        <div style="display:flex; gap:10px; margin-top:15px;">
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('vet', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('vet_data', 'vet')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Libretto Sanitario & Vaccini</h2>
                    <div class="module-card">
                        <p>Gestione profilassi sanitaria e antiparassitari.</p>
                        <label>Ultimo Antiparassitario (Data):</label>
                        <input type="date" id="v-antiparassitario" class="mod-input" value="${vData.antiparassitario || ''}">
                        <label>Prossimo Vaccino (Scadenza):</label>
                        <input type="date" id="v-vaccino" class="mod-input" value="${vData.vaccino || ''}">
                        <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveVet()">Salva Scadenze</button>
                    </div>`;
            }
            break;

        case 'bilancio':
            const venditeSalvate = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
            let totaleIncassato = venditeSalvate.reduce((acc, item) => acc + Number(item.importo), 0);
            
            contentHTML = `
                <h2>Contabilità & Bilancio Annuo</h2>
                <div class="module-card">
                    <p>Entrate Totali Vendite: <strong style="color:#22c55e;">€ ${totaleIncassato.toFixed(2)}</strong></p>
                    <p>Imposta Sostitutiva F24: <strong>€ 100,00</strong></p>
                    <hr style="border-color:#334155; margin:15px 0;">
                    <p>Registrazioni di vendita effettuate: <strong>${venditeSalvate.length}</strong></p>
                </div>`;
            break;

        case 'export':
            contentHTML = `
                <h2>Report & Backup Dati</h2>
                <div class="module-card">
                    <p>Esporta i dati contabili per il commercialista o fai un backup completo dell'app.</p>
                    <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="esportaDatiCSV()">Scarica Contabilità in CSV</button>
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#16a34a;" onclick="esportaBackupJSON()">Scarica Backup Totale (JSON)</button>
                    
                    <hr style="border-color:#334155; margin:20px 0;">
                    <label style="font-weight:bold; color:#f8fafc;">Ripristina Backup da File JSON:</label>
                    <input type="file" id="import-file" accept=".json" class="mod-input" style="padding:8px;" onchange="importBackupData(event)">
                </div>`;
            break;

        case 'emergency':
            window.location.href = "tel:112";
            return;

        case 'vet-emergency':
            contentHTML = `
                <h2>Pronto Soccorso Cinofilo H24</h2>
                <div class="module-card" style="background:#451a03; border:1px solid #78350f;">
                    <p style="color:#fde047; font-weight:bold;">⚠️ EMERGENZA ESCHE AVVELENATE / VIPERA</p>
                    <p style="margin-top:8px;">1. Mantenere la calma e isolare il cane.</p>
                    <p>2. Non indurre il vomito autonomamente.</p>
                    <a href="tel:3330000000" style="display:block; text-align:center; background:#dc2626; color:#fff; padding:12px; border-radius:6px; margin-top:15px; text-decoration:none; font-weight:bold;">CHIAMA VET URGENZE H24</a>
                </div>`;
            break;

        default:
            contentHTML = `<h2>Modulo</h2><p>In fase di sviluppo.</p>`;
    }

    activeView.innerHTML = `
        <div class="module-header-bar">
            <button onclick="closeActiveModule()" class="back-map-btn">← Torna alla Mappa</button>
        </div>
        <div class="module-body-content">
            ${contentHTML}
        </div>
    `;
    activeView.style.display = 'flex';

    if (moduleName === 'pagopa' && pData.id && !editMode) {
        setTimeout(() => {
            const qrContainer = document.getElementById('qrcode-container');
            if (qrContainer && typeof QRCode !== 'undefined') {
                qrContainer.innerHTML = "";
                let qrString = `TARTUFO-REGIONE|ID:${pData.id}|DATA:${pData.data}`;
                new QRCode(qrContainer, {
                    text: qrString,
                    width: 128,
                    height: 128,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }
        }, 50);
    }
}

function closeActiveModule() {
    const activeView = document.getElementById('active-module-view');
    if (activeView) {
        activeView.style.display = 'none';
    }
}

function clearData(storageKey, moduleName) {
    if (confirm("Vuoi davvero eliminare questi dati?")) {
        localStorage.removeItem(storageKey);
        openModule(moduleName);
    }
}

function saveTesserino() {
    const data = {
        nome: document.getElementById('t-nome').value,
        cf: document.getElementById('t-cf').value,
        regione: document.getElementById('t-regione').value,
        num: document.getElementById('t-num').value
    };
    localStorage.setItem('tesserino_data', JSON.stringify(data));
    alert("Dati tesserino salvati con successo!");
    openModule('tesserino');
}

function savePagoPA() {
    const data = {
        id: document.getElementById('p-id').value,
        data: document.getElementById('p-data').value
    };
    localStorage.setItem('pagopa_data', JSON.stringify(data));
    alert("Quietanza PagoPA salvata!");
    openModule('pagopa');
}

function saveF24() {
    const data = {
        anno: document.getElementById('f-anno').value,
        protocollo: document.getElementById('f-protocollo').value
    };
    localStorage.setItem('f24_data', JSON.stringify(data));
    alert("Protocollo F24 ELIDE salvato correttamente!");
    openModule('f24');
}

function saveCane() {
    const data = {
        nome: document.getElementById('c-nome').value,
        razza: document.getElementById('c-razza').value,
        microchip: document.getElementById('c-microchip').value
    };
    localStorage.setItem('cane_data', JSON.stringify(data));
    alert("Profilo del cane salvato!");
    openModule('canidiary');
}

function saveVet() {
    const data = {
        antiparassitario: document.getElementById('v-antiparassitario').value,
        vaccino: document.getElementById('v-vaccino').value
    };
    localStorage.setItem('vet_data', JSON.stringify(data));
    alert("Dati sanitari salvati con successo!");
    openModule('vet');
}

function registraVendita() {
    const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
    const f24SavedData = JSON.parse(localStorage.getItem('f24_data') || '{}');
    
    if (!tData.nome || !tData.cf) {
        alert("Attenzione: Inserisci prima i dati della tua anagrafica e del tesserino nel menu 'Anagrafica & Tesserino Digitale' per emettere una ricevuta a norma di legge.");
        return;
    }

    if (!f24SavedData.protocollo) {
        alert("Attenzione: Non hai registrato il protocollo del modello F24 ELIDE (100€) nel menu dedicato. La ricevuta richiede l'assolvimento dell'imposta sostitutiva annua.");
    }

    const importoCorrente = parseFloat(document.getElementById('r-importo').value) || 0;
    
    // --- CONTROLLO SOGLIA 7.000 EURO ANNO SOLARE ---
    let storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const annoCorrente = new Date().getFullYear();
    
    let totaleAnno = storico
        .filter(item => {
            return item.data && item.data.includes(annoCorrente);
        })
        .reduce((acc, item) => acc + (parseFloat(item.importo) || 0), 0);

    totaleAnno += importoCorrente;

    if (totaleAnno > 7000) {
        alert(`🚨 ATTENZIONE: Superamento limite dei 7.000 €!\n\nIl totale delle vendite per l'anno ${annoCorrente} (inclusa questa ricevuta) ha raggiunto € ${totaleAnno.toFixed(2)}.\nOltre questa soglia decade il regime di cessione occasionale (Legge 145/2018). Contatta il tuo commercialista.`);
    } else if (totaleAnno > 6000) {
        alert(`⚠️ Avviso Soglia: Ti stai avvicinando al limite massimo di 7.000 € annui (Totale attuale stimato: € ${totaleAnno.toFixed(2)}).`);
    }
    // ----------------------------------------------

    const vendita = {
        venditoreNome: tData.nome || 'N.D.',
        venditoreCf: tData.cf || 'N.D.',
        venditoreTesserino: tData.num || 'N.D.',
        venditoreRegione: tData.regione || 'N.D.',
        acquirente: document.getElementById('r-acquirente').value,
        acquirenteCf: document.getElementById('r-cf-acquirente').value,
        specie: document.getElementById('r-specie').value,
        peso: document.getElementById('r-peso').value,
        importo: importoCorrente.toFixed(2),
        comune: document.getElementById('r-comune').value,
        lotto: document.getElementById('r-lotto').value,
        f24: document.getElementById('r-f24').value || f24SavedData.protocollo || 'Non inserito',
        data: new Date().toLocaleDateString()
    };
    
    storico.push(vendita);
    localStorage.setItem('storico_vendite', JSON.stringify(storico));

    let activeView = document.getElementById('active-module-view');
    activeView.querySelector('.module-body-content').innerHTML = `
        <h2>RICEVUTA DI VENDITA OCCASIONALE TARTUFI</h2>
        <p>Conforme a Legge 145/2018 (Regime dei 100€), Reg. CE 178/02 & DPR 633/1972</p>
        <div class="module-card" style="background:#fff; color:#000; padding:20px; border-radius:8px; font-size:0.85rem;">
            <h3 style="color:#000; border-bottom:2px solid #000; padding-bottom:5px; margin-bottom:10px; font-size:1rem; text-align:center;">DOCUMENTO DI VENDITA / TRACCIABILITÀ</h3>
            
            <div style="margin-bottom: 10px;">
                <strong>DATI DEL RACCOGLITORE (VENDITORE):</strong><br>
                Nominativo: ${vendita.venditoreNome}<br>
                Codice Fiscale: ${vendita.venditoreCf}<br>
                Tesserino N.: ${vendita.venditoreTesserino} (${vendita.venditoreRegione})
            </div>
            
            <div style="margin-bottom: 10px;">
                <strong>DATI DELL'ACQUIRENTE:</strong><br>
                Intestato a: ${vendita.acquirente} (P.IVA/CF: ${vendita.acquirenteCf})
            </div>

            <hr style="margin:8px 0; border-color:#ccc;">

            <p><strong>Data Emissione:</strong> ${vendita.data}</p>
            <p><strong>Specie Botanica:</strong> ${vendita.specie}</p>
            <p><strong>Quantità / Peso:</strong> ${vendita.peso} grammi</p>
            <p><strong>Comune di Raccolta:</strong> ${vendita.comune}</p>
            <p><strong>Codice Lotto (Tracciabilità):</strong> ${vendita.lotto}</p>
            <p><strong>Riferimento F24 ELIDE (Imposta Sostitutiva 100€ - Cod. 1853):</strong> Protocollo N. ${vendita.f24}</p>
            
            <hr style="margin:10px 0; border-color:#000;">
            <p style="font-size:1rem;"><strong>CORRISPETTIVO TOTALE: € ${vendita.importo}</strong></p>
            
            <p style="font-size:0.7rem; margin-top:12px; color:#444; text-align:justify;">
                <i>Operazione non soggetta a IVA ai sensi del regime di commercializzazione occasionale dei tartufi (Legge 145/2018). Imposta sostitutiva annuale di 100 euro assolta tramite F24 ELIDE (esenzione da ritenuta d'acconto del 23%). Tracciabilità garantita ai sensi del Regolamento CE n. 178/2002.</i>
            </p>
        </div>
        <div style="display:flex; gap:10px; margin-top:15px;">
            <button class="overlay-btn" style="background:#2563eb;" onclick="window.print()">🖨️ Stampa / Salva PDF</button>
            <button class="overlay-btn" style="background:#16a34a;" onclick="closeActiveModule()">✔ Fatto / Torna alla Mappa</button>
        </div>
    `;
}

function esportaDatiCSV() {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    if(storico.length === 0) {
        alert("Nessuna vendita registrata da esportare.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Data,Venditore,CF_Venditore,Acquirente,CF_Acquirente,Specie,Peso(g),Importo(Euro),Comune,Lotto,ProtocolloF24\n";
    storico.forEach(function(row) {
        csvContent += `${row.data},"${row.venditoreNome}","${row.venditoreCf}","${row.acquirente}","${row.acquirenteCf}","${row.specie}",${row.peso},${row.importo},"${row.comune}","${row.lotto}","${row.f24}"\n`;
    });
    var encodedUri = encodeURI(csvContent);
    var link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "report_tartufi_commercialista.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function esportaBackupJSON() {
    const backupData = {
        tesserino: JSON.parse(localStorage.getItem('tesserino_data') || '{}'),
        pagopa: JSON.parse(localStorage.getItem('pagopa_data') || '{}'),
        f24: JSON.parse(localStorage.getItem('f24_data') || '{}'),
        cane: JSON.parse(localStorage.getItem('cane_data') || '{}'),
        vet: JSON.parse(localStorage.getItem('vet_data') || '{}'),
        poiList: JSON.parse(localStorage.getItem('poi_list') || '[]'),
        storicoVendite: JSON.parse(localStorage.getItem('storico_vendite') || '[]'),
        carCoords: JSON.parse(localStorage.getItem('car_coords') || 'null')
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "backup_truffle_app.json");
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
            const importedData = JSON.parse(e.target.result);
            
            if (importedData.tesserino) localStorage.setItem('tesserino_data', JSON.stringify(importedData.tesserino));
            if (importedData.pagopa) localStorage.setItem('pagopa_data', JSON.stringify(importedData.pagopa));
            if (importedData.f24) localStorage.setItem('f24_data', JSON.stringify(importedData.f24));
            if (importedData.cane) localStorage.setItem('cane_data', JSON.stringify(importedData.cane));
            if (importedData.vet) localStorage.setItem('vet_data', JSON.stringify(importedData.vet));
            if (importedData.poiList) localStorage.setItem('poi_list', JSON.stringify(importedData.poiList));
            if (importedData.storicoVendite) localStorage.setItem('storico_vendite', JSON.stringify(importedData.storicoVendite));
            if (importedData.carCoords) localStorage.setItem('car_coords', JSON.stringify(importedData.carCoords));

            alert("Backup ripristinato con successo!");
            location.reload();
        } catch (error) {
            alert("Errore durante la lettura del file di backup.");
        }
    };
    reader.readAsText(file);
}

function toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) {
        drawer.classList.toggle('drawer-open');
        backdrop.classList.toggle('active');
    }
}
