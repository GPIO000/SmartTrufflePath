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
let poiMapMarkers = {}; // Mantiene i riferimenti ai marker sulla mappa

let targetNavigation = null; // Può essere 'car' oppure l'indice numerico del POI (es. 'poi_0')

// Calcolo distanza in metri e freccia di direzione dinamica
function calculateDistanceAndBearing(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Raggio della terra in metri
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // in metri

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    brng = (brng + 360) % 360;

    // Frecce direzionali e nomi
    const arrows = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
    const directions = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ovest', 'Ovest', 'Nord-Ovest'];
    const index = Math.round((brng / 45)) % 8;
    
    return {
        distance: distance > 1000 ? (distance / 1000).toFixed(2) + ' km' : Math.round(distance) + ' m',
        arrow: arrows[index],
        direction: directions[index]
    };
}

// Aggiornamento Bussola in tempo reale con freccia
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

// Geolocalizzazione GPS in tempo reale
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

                // Ripristina marker auto
                if (carCoordinates) {
                    carMarker = L.marker([carCoordinates.lat, carCoordinates.lng]).addTo(map)
                        .bindPopup("<b>🚗 La tua Auto</b>");
                }
                // Ripristina tutti i POI salvati sulla mappa
                renderAllPoiMarkers();
            } else {
                userMarker.setLatLng([lat, lng]);
            }

            // Aggiorna bussola
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

// Disegna tutti i POI sulla mappa
function renderAllPoiMarkers() {
    // Rimuovi vecchi marker se presenti
    Object.values(poiMapMarkers).forEach(marker => map.removeLayer(marker));
    poiMapMarkers = {};

    poiList.forEach((poi, index) => {
        const marker = L.marker([poi.lat, poi.lng]).addTo(map)
            .bindPopup(`<b>📍 Tartufo / Punto</b><br>Nota: ${poi.note || 'Nessuna nota'}<br><small>${poi.date}</small>`);
        poiMapMarkers[index] = marker;
    });
}

// Funzione Salva Parcheggio
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

// Pulsante Ritorno all'Auto
function returnToCar() {
    if (carCoordinates) {
        targetNavigation = 'car';
        map.setView([carCoordinates.lat, carCoordinates.lng], 18);
        if (carMarker) carMarker.openPopup();
    } else {
        alert("Nessun parcheggio salvato. Clicca prima su 'Auto'.");
    }
}

// Funzione Salva Punto di Interesse con Nota / Promemoria
function savePoiPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const note = prompt("Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):", "Tartufaia");
        if (note === null) return; // Annullato dall'utente

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

        // Imposta subito questo punto come bersaglio della bussola e della mappa
        targetNavigation = `poi_${newIndex}`;
        map.setView([pos.lat, pos.lng], 18);
        if (poiMapMarkers[newIndex]) poiMapMarkers[newIndex].openPopup();

        alert("📍 Punto salvato con successo e impostato sulla bussola!");
    } else {
        alert("Segnale GPS non ancora disponibile per marcare il punto.");
    }
}

// Funzione per navigare verso un POI specifico dall'elenco
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

// Funzione per eliminare un POI dall'elenco
function deletePoi(index) {
    if (confirm("Vuoi davvero eliminare questo punto salvato?")) {
        if (poiMapMarkers[index]) {
            map.removeLayer(poiMapMarkers[index]);
            delete poiMapMarkers[index];
        }
        poiList.splice(index, 1);
        localStorage.setItem('poi_list', JSON.stringify(poiList));
        renderAllPoiMarkers();
        openModule('poilist'); // Ricarica la vista elenco aggiornata
    }
}

// Pulsante SOS GPS
function triggerSOS() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        const msg = `EMERGENZA TARTUFAIA! Coordinate GPS: Lat: ${pos.lat}, Lng: ${pos.lng}.`;
        window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
    } else {
        alert("Impossibile rilevare le coordinate GPS.");
    }
}

// --- GESTIONE MODULI INTERATTIVI CON SALVATAGGIO LOCALE ---
function openModule(moduleName) {
    toggleDrawer(); // Chiude il menu laterale
    
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
                            <div style="display:flex; gap:8px; margin-top:10px;">
                                <button class="overlay-btn" style="background:#16a34a;" onclick="navigateToPoi(${idx})">🧭 Vai qui</button>
                                <button class="overlay-btn" style="background:#dc2626;" onclick="deletePoi(${idx})">🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = poiHtml;
            break;

        case 'tesserino':
            const savedData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
            contentHTML = `
                <h2>Anagrafica & Tesserino Digitale</h2>
                <p><strong>Normativa:</strong> Legge 145/2018</p>
                <div class="module-card">
                    <label>Nome e Cognome:</label>
                    <input type="text" id="t-nome" class="mod-input" value="${savedData.nome || ''}" placeholder="Es. Mario Rossi">
                    
                    <label>Codice Fiscale:</label>
                    <input type="text" id="t-cf" class="mod-input" value="${savedData.cf || ''}" placeholder="RSSMRA...">
                    
                    <label>Regione / Provincia di Rilascio:</label>
                    <input type="text" id="t-regione" class="mod-input" value="${savedData.regione || ''}" placeholder="Es. Molise / Campobasso">
                    
                    <label>Numero Tesserino / Autorizzazione:</label>
                    <input type="text" id="t-num" class="mod-input" value="${savedData.num || ''}" placeholder="Es. TR-2026-001">
                    
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveTesserino()">Salva Dati Tesserino</button>
                </div>`;
            break;
            
        case 'pagopa':
            const pagopaData = JSON.parse(localStorage.getItem('pagopa_data') || '{}');
            contentHTML = `
                <h2>Ricevuta PagoPA & QR Code</h2>
                <p>Quietanza versamento tassa regionale annuale.</p>
                <div class="module-card">
                    <label>ID Transazione / Codice Avviso:</label>
                    <input type="text" id="p-id" class="mod-input" value="${pagopaData.id || ''}" placeholder="Es. PPA-992837465">
                    
                    <label>Data Pagamento:</label>
                    <input type="date" id="p-data" class="mod-input" value="${pagopaData.data || ''}">
                    
                    <div style="background:#fff; color:#000; padding:15px; text-align:center; margin:15px 0; border-radius:6px;">
                        <strong>[ QR CODE ATTIVO PER CONTROLLO FORESTALE ]</strong><br>
                        <span style="font-size:0.8rem;">Verifica immediata tesserino in regola</span>
                    </div>

                    <button class="overlay-btn" style="width:100%;" onclick="savePagoPA()">Salva Quietanza PagoPA</button>
                </div>`;
            break;
            
        case 'ricevute':
            contentHTML = `
                <h2>Ricevuta di Vendita Occasionale</h2>
                <p>Conforme a Reg. CE 178/02 & DPR 633/1972</p>
                <div class="module-card">
                    <label>Acquirente (Privato o Ristorante):</label>
                    <input type="text" id="r-acquirente" class="mod-input" placeholder="Nome acquirente">
                    
                    <label>Specie Tartufo:</label>
                    <select id="r-specie" class="mod-input">
                        <option value="Pregiato Bianco (Tuber magnatum pico)">Pregiato Bianco (Tuber magnatum pico)</option>
                        <option value="Nero Pregiato (Tuber melanosporum)">Nero Pregiato (Tuber melanosporum)</option>
                        <option value="Scorzone (Tuber aestivum)">Scorzone (Tuber aestivum)</option>
                    </select>

                    <label>Peso (grammi):</label>
                    <input type="number" id="r-peso" class="mod-input" placeholder="Es. 150">

                    <label>Importo (€):</label>
                    <input type="number" id="r-importo" class="mod-input" placeholder="Es. 200.00">

                    <label>Comune di Raccolta:</label>
                    <input type="text" id="r-comune" class="mod-input" placeholder="Comune di ritrovamento">

                    <label>N. Protocollo F24 ELIDE collegato:</label>
                    <input type="text" id="r-f24" class="mod-input" placeholder="Obbligatorio sotto i 7.000€">

                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="registraVendita()">Registra e Genera Ricevuta</button>
                </div>`;
            break;

        case 'f24':
            const f24Data = JSON.parse(localStorage.getItem('f24_data') || '{}');
            contentHTML = `
                <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                <p>Legge 145/2018 (Codice Tributo: 1853)</p>
                <div class="module-card">
                    <p>Versamento annuo di 100€ per l'esonero dalla ritenuta d'acconto del 23%.</p>
                    
                    <label>Anno Fiscale:</label>
                    <input type="text" id="f-anno" class="mod-input" value="${f24Data.anno || '2026'}">

                    <label>Numero Protocollo F24 Quietanzato:</label>
                    <input type="text" id="f-protocollo" class="mod-input" value="${f24Data.protocollo || ''}" placeholder="Es. 000123456789">

                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveF24()">Salva Protocollo F24</button>
                </div>`;
            break;

        case 'canidiary':
            const caniData = JSON.parse(localStorage.getItem('cane_data') || '{}');
            contentHTML = `
                <h2>Profilo Cani & Diario Ricerca</h2>
                <div class="module-card">
                    <label>Nome del Cane:</label>
                    <input type="text" id="c-nome" class="mod-input" value="${caniData.nome || ''}" placeholder="Es. Argo">

                    <label>Razza:</label>
                    <input type="text" id="c-razza" class="mod-input" value="${caniData.razza || 'Lagotto Romagnolo'}">

                    <label>Numero Microchip:</label>
                    <input type="text" id="c-microchip" class="mod-input" value="${caniData.microchip || ''}" placeholder="Codice microchip">

                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveCane()">Salva Profilo Cane</button>
                </div>`;
            break;

        case 'vet':
            const vetData = JSON.parse(localStorage.getItem('vet_data') || '{}');
            contentHTML = `
                <h2>Libretto Sanitario & Vaccini</h2>
                <div class="module-card">
                    <p>Gestione profilassi sanitaria e antiparassitari.</p>
                    <label>Ultimo Antiparassitario (Data):</label>
                    <input type="date" id="v-antiparassitario" class="mod-input" value="${vetData.antiparassitario || ''}">
                    <label>Prossimo Vaccino (Scadenza):</label>
                    <input type="date" id="v-vaccino" class="mod-input" value="${vetData.vaccino || ''}">
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="saveVet()">Salva Scadenze</button>
                </div>`;
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
                <h2>Report per Commercialista</h2>
                <div class="module-card">
                    <p>Esporta i dati contabili e le ricevute registrate per la dichiarazione dei redditi.</p>
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="esportaDatiCSV()">Scarica Dati in CSV</button>
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
}

function closeActiveModule() {
    const activeView = document.getElementById('active-module-view');
    if (activeView) {
        activeView.style.display = 'none';
    }
}

// --- FUNZIONI DI SALVATAGGIO DATI ---
function saveTesserino() {
    const data = {
        nome: document.getElementById('t-nome').value,
        cf: document.getElementById('t-cf').value,
        regione: document.getElementById('t-regione').value,
        num: document.getElementById('t-num').value
    };
    localStorage.setItem('tesserino_data', JSON.stringify(data));
    alert("Dati tesserino salvati con successo!");
}

function savePagoPA() {
    const data = {
        id: document.getElementById('p-id').value,
        data: document.getElementById('p-data').value
    };
    localStorage.setItem('pagopa_data', JSON.stringify(data));
    alert("Quietanza PagoPA salvata!");
}

function saveF24() {
    const data = {
        anno: document.getElementById('f-anno').value,
        protocollo: document.getElementById('f-protocollo').value
    };
    localStorage.setItem('f24_data', JSON.stringify(data));
    alert("Protocollo F24 ELIDE salvato correttamente!");
}

function saveCane() {
    const data = {
        nome: document.getElementById('c-nome').value,
        razza: document.getElementById('c-razza').value,
        microchip: document.getElementById('c-microchip').value
    };
    localStorage.setItem('cane_data', JSON.stringify(data));
    alert("Profilo del cane salvato!");
}

function saveVet() {
    const data = {
        antiparassitario: document.getElementById('v-antiparassitario').value,
        vaccino: document.getElementById('v-vaccino').value
    };
    localStorage.setItem('vet_data', JSON.stringify(data));
    alert("Dati sanitari salvati con successo!");
}

function registraVendita() {
    const vendita = {
        acquirente: document.getElementById('r-acquirente').value,
        specie: document.getElementById('r-specie').value,
        peso: document.getElementById('r-peso').value,
        importo: document.getElementById('r-importo').value,
        comune: document.getElementById('r-comune').value,
        f24: document.getElementById('r-f24').value,
        data: new Date().toLocaleDateString()
    };
    
    let storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    storico.push(vendita);
    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    alert("Ricevuta di vendita registrata e archiviata per il bilancio!");
    closeActiveModule();
}

function esportaDatiCSV() {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    if(storico.length === 0) {
        alert("Nessuna vendita registrata da esportare.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Data,Acquirente,Specie,Peso(g),Importo(Euro),Comune,ProtocolloF24\n";
    storico.forEach(function(row) {
        csvContent += `${row.data},${row.acquirente},${row.specie},${row.peso},${row.importo},${row.comune},${row.f24}\n`;
    });
    var encodedUri = encodeURI(csvContent);
    var link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "report_tartufi_commercialista.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Gestione Menu a Cassetto (Drawer)
function toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) {
        drawer.classList.toggle('drawer-open');
        backdrop.classList.toggle('active');
    }
}