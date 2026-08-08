// ============================================
// INIZIALIZZAZIONE MAPPA E VARIABILI GLOBALI
// ============================================
const map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 19, 
    attribution: '© OpenStreetMap' 
}).addTo(map);

setTimeout(() => {
    map.invalidateSize();
}, 300);

setTimeout(() => {
    map.invalidateSize();
    mostraDisclaimerIniziale();
}, 400);

// Variabili globali
let userMarker = null;
let carMarker = null;
let carCoordinates = JSON.parse(localStorage.getItem('car_coords')) || null;
let poiList = JSON.parse(localStorage.getItem('poi_list') || '[]');
let poiMapMarkers = {};
let targetNavigation = null;

// ============================================
// GEOLOCALIZZAZIONE E GPS
// ============================================
if (navigator.geolocation) {
    navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const dot = document.getElementById('gps-status-dot');
        
        if (dot) { 
            dot.style.backgroundColor = '#22c55e'; 
            dot.title = "GPS Attivo: " + lat.toFixed(4) + ", " + lng.toFixed(4); 
        }
        
        // Reverse geocoding
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`, { 
            headers: { 'Accept-Language': 'it' } 
        })
        .then(res => res.json())
        .then(data => {
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
        })
        .catch(err => console.log("Errore geocodifica:", err));
        
        if (!userMarker) {
            userMarker = L.marker([lat, lng]).addTo(map).bindPopup("<b>Sei qui</b>").openPopup();
            map.setView([lat, lng], 16);
            if (carCoordinates) { 
                carMarker = L.marker([carCoordinates.lat, carCoordinates.lng]).addTo(map).bindPopup("<b>🚗 La tua Auto</b>"); 
            }
            renderAllPoiMarkers();
        } else { 
            userMarker.setLatLng([lat, lng]); 
        }
        updateCompass(lat, lng);
    }, (error) => {
        console.warn("Errore GPS: " + error.message);
        const dot = document.getElementById('gps-status-dot');
        if (dot) dot.style.backgroundColor = '#ef4444';
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });
}

// ============================================
// FUNZIONI MARKER E NAVIGAZIONE
// ============================================
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

function saveCarPosition() {
    if (userMarker) {
        const pos = userMarker.getLatLng();
        carCoordinates = { lat: pos.lat, lng: pos.lng };
        localStorage.setItem('car_coords', JSON.stringify(carCoordinates));
        if (carMarker) { 
            carMarker.setLatLng([pos.lat, pos.lng]); 
        } else { 
            carMarker = L.marker([pos.lat, pos.lng]).addTo(map).bindPopup("<b>🚗 La tua Auto</b>"); 
        }
        showUserMessage("🚗 Posizione dell'auto salvata con successo!");
    } else { 
        showUserMessage("Segnale GPS non ancora disponibile per marcare l'auto."); 
    }
}

function deleteCarPosition() {
    if (carCoordinates) {
        if (confirm("Vuoi davvero eliminare la posizione dell'auto salvata?")) {
            if (carMarker) { 
                map.removeLayer(carMarker); 
                carMarker = null; 
            }
            carCoordinates = null;
            localStorage.removeItem('car_coords');
            if (targetNavigation === 'car') targetNavigation = null;
            showUserMessage("🚗 Posizione dell'auto rimossa con successo!");
        }
    } else { 
        showUserMessage("Nessuna posizione dell'auto attualmente salvata."); 
    }
}

function returnToCar() {
    if (carCoordinates) {
        targetNavigation = 'car';
        map.setView([carCoordinates.lat, carCoordinates.lng], 18);
        if (carMarker) carMarker.openPopup();
    } else { 
        showUserMessage("Nessun parcheggio salvato. Clicca prima su 'Auto'."); 
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
        showUserMessage("📍 Punto salvato con successo e impostato sulla bussola!");
    } else { 
        showUserMessage("Segnale GPS non ancora disponibile per marcare il punto."); 
    }
}

function navigateToPoi(index) {
    if (poiList[index]) {
        targetNavigation = `poi_${index}`;
        map.setView([poiList[index].lat, poiList[index].lng], 18);
        if (poiMapMarkers[index]) poiMapMarkers[index].openPopup();
        closeActiveModule();
        showUserMessage(`🧭 Destinazione impostata sulla bussola: ${poiList[index].note}`);
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
        showUserMessage("Impossibile rilevare le coordinate GPS."); 
    }
}

function centerOnUser() {
    if (userMarker) { 
        const pos = userMarker.getLatLng(); 
        map.setView([pos.lat, pos.lng], 16); 
        userMarker.openPopup(); 
    } else { 
        showUserMessage("Posizione GPS non disponibile."); 
    }
}

// ============================================
// GESTIONE MODULI (Semplificata)
// ============================================
function openModule(moduleName, editMode = false) {
    toggleDrawer();
    let activeView = document.getElementById('active-module-view');
    if (!activeView) {
        activeView = document.createElement('div');
        activeView.id = 'active-module-view';
        document.getElementById('app-container').appendChild(activeView);
    }
    
    let contentHTML = '';
    
    // SWITCH MODULI (solo struttura di base - implementare i singoli moduli)
    switch(moduleName) {
        case 'poilist':
            contentHTML = generatePoiListHTML();
            break;
        case 'tesserino':
            contentHTML = generateTesserinoHTML(editMode);
            break;
        case 'ricevute':
            contentHTML = generateRicevuteHTML();
            break;
        case 'export':
            contentHTML = generateExportHTML();
            break;
        default:
            contentHTML = `<h2>Modulo</h2><p>In fase di sviluppo: ${moduleName}</p>`;
    }
    
    activeView.innerHTML = `
        <div class="module-header-bar" style="display: flex; justify-content: space-between; align-items: center;">
            <button onclick="closeActiveModule()" class="back-map-btn">← Torna alla Mappa</button>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="mostraInfoModulo('${moduleName}')" class="back-map-btn" style="background: #334155; color: #38bdf8; border: 1px solid #475569;">ℹ️</button>
                <button onclick="toggleDrawer(); closeActiveModule();" class="back-map-btn">☰ Menu</button>
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

// ============================================
// GENERATORI HTML MODULI
// ============================================
function generatePoiListHTML() {
    let html = '<h2>Elenco Punti & Tartufaie</h2><p>I tuoi punti di ricerca salvati:</p>';
    if (poiList.length === 0) {
        html += '<div class="module-card"><p>Nessun punto salvato. Usa il tasto "Punto" sulla mappa.</p></div>';
    } else {
        poiList.forEach((poi, idx) => {
            html += `
                <div class="module-card" style="margin-bottom:12px;">
                    <strong style="color:#60a5fa;">📍 ${poi.note}</strong>
                    <p style="font-size:0.8rem; color:#94a3b8;">Data: ${poi.date}</p>
                    <p style="font-size:0.8rem;">Lat: ${poi.lat.toFixed(4)}, Lng: ${poi.lng.toFixed(4)}</p>
                    <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
                        <button class="overlay-btn" style="background:#16a34a;" onclick="navigateToPoi(${idx})">🧭 Vai</button>
                        <button class="overlay-btn" style="background:#0284c7;" onclick="sharePoi(${idx})">📤 Condividi</button>
                        <button class="overlay-btn" style="background:#dc2626;" onclick="deletePoi(${idx})">🗑️ Elimina</button>
                    </div>
                </div>`;
        });
    }
    return html;
}

function generateTesserinoHTML(editMode) {
    const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
    if (tData.nome && !editMode) {
        return `
            <h2>Anagrafica & Tesserino Digitale</h2>
            <div class="module-card" style="border-left: 4px solid #22c55e;">
                <p style="color:#22c55e; font-weight:bold;">✔ Tesserino Registrato</p>
                <p><strong>Nome:</strong> ${tData.nome}</p>
                <p><strong>Codice Fiscale:</strong> ${tData.cf}</p>
                <p><strong>Regione:</strong> ${tData.regione}</p>
                <p><strong>N. Tesserino:</strong> ${tData.num}</p>
                <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                    <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('tesserino', true)">✏️ Modifica</button>
                    <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('tesserino_data', 'tesserino')">🗑️ Elimina</button>
                </div>
            </div>`;
    } else {
        return `
            <h2>Anagrafica & Tesserino Digitale</h2>
            <div class="module-card">
                <label>Nome e Cognome:</label>
                <input type="text" id="t-nome" class="mod-input" placeholder="Es. Mario Rossi">
                <label>Codice Fiscale:</label>
                <input type="text" id="t-cf" class="mod-input" placeholder="Es. RSSMRA80A01H501W">
                <label>Regione:</label>
                <input type="text" id="t-regione" class="mod-input" placeholder="Es. Molise">
                <label>Numero Tesserino:</label>
                <input type="text" id="t-num" class="mod-input" placeholder="Numero autorizzazione">
                <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="saveTesserino()">Salva Tesserino</button>
            </div>`;
    }
}

function generateRicevuteHTML() {
    return `
        <h2>Ricevuta di Vendita Occasionale</h2>
        <p>Conforme a Legge 145/2018</p>
        <div class="module-card">
            <label>Acquirente:</label>
            <input type="text" id="r-acquirente" class="mod-input" placeholder="Nome cliente">
            <label>Specie:</label>
            <select id="r-specie" class="mod-input">
                <option>Tuber magnatum Pico (Bianco Pregiato)</option>
                <option>Tuber melanosporum (Nero Pregiato)</option>
                <option>Tuber aestivum (Scorzone)</option>
            </select>
            <label>Peso (g):</label>
            <input type="number" id="r-peso" class="mod-input" placeholder="Es. 150">
            <label>Importo (€):</label>
            <input type="number" id="r-importo" class="mod-input" placeholder="Es. 200">
            <button class="overlay-btn" style="margin-top:15px; width:100%; background:#22c55e;" onclick="saveRicevuta()">Salva Ricevuta</button>
        </div>`;
}

function generateExportHTML() {
    return `
        <h2>Report & Backup Dati</h2>
        <div class="module-card">
            <p>Esporta i dati o fai un backup.</p>
            <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="esportaBackupJSON()">📥 Scarica Backup JSON</button>
            <label style="margin-top:15px; font-weight:bold;">Ripristina da File:</label>
            <input type="file" id="import-file" accept=".json" class="mod-input" onchange="importBackupData(event)">
        </div>`;
}

// ============================================
// UTILITY E FUNZIONI HELPER
// ============================================
function clearData(storageKey, moduleName) {
    if (confirm("Vuoi davvero eliminare questi dati?")) {
        localStorage.removeItem(storageKey);
        openModule(moduleName);
    }
}

function saveTesserino() {
    const nome = document.getElementById('t-nome')?.value.trim();
    const cf = document.getElementById('t-cf')?.value.trim().toUpperCase();
    const regione = document.getElementById('t-regione')?.value.trim();
    const num = document.getElementById('t-num')?.value.trim();
    
    if (!nome || !cf) {
        showUserMessage("Inserisci almeno Nome e Codice Fiscale.");
        return;
    }
    
    const data = { nome, cf, regione, num };
    localStorage.setItem('tesserino_data', JSON.stringify(data));
    showUserMessage("✔ Dati tesserino salvati!");
    openModule('tesserino');
}

function saveRicevuta() {
    const acquirente = document.getElementById('r-acquirente')?.value.trim();
    const specie = document.getElementById('r-specie')?.value;
    const peso = parseFloat(document.getElementById('r-peso')?.value) || 0;
    const importo = parseFloat(document.getElementById('r-importo')?.value) || 0;
    
    if (!acquirente || peso <= 0 || importo <= 0) {
        showUserMessage("Compila tutti i campi obbligatori con valori validi.");
        return;
    }
    
    let ricevute = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    ricevute.push({
        acquirente,
        specie,
        peso,
        importo,
        data: new Date().toLocaleDateString()
    });
    localStorage.setItem('storico_vendite', JSON.stringify(ricevute));
    showUserMessage("📄 Ricevuta salvata!");
    openModule('ricevute');
}

function esportaBackupJSON() {
    const backup = {
        tesserino: localStorage.getItem('tesserino_data'),
        storico_vendite: localStorage.getItem('storico_vendite'),
        poi_list: localStorage.getItem('poi_list'),
        car_coords: localStorage.getItem('car_coords')
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importBackupData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.tesserino) localStorage.setItem('tesserino_data', data.tesserino);
            if (data.storico_vendite) localStorage.setItem('storico_vendite', data.storico_vendite);
            if (data.poi_list) localStorage.setItem('poi_list', data.poi_list);
            if (data.car_coords) localStorage.setItem('car_coords', data.car_coords);
            showUserMessage("✔ Backup ripristinato!");
            location.reload();
        } catch(err) {
            showUserMessage("❌ Errore durante la lettura del file.");
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

function shareAppUrl() {
    const shareData = {
        title: 'Truffle App',
        text: 'Scarica l\'app per la raccolta dei tartufi',
        url: window.location.href
    };
    
    if (navigator.share) {
        navigator.share(shareData).catch((err) => {
            console.log("Condivisione annullata", err);
        });
    } else {
        navigator.clipboard.writeText(window.location.href).then(() => {
            showUserMessage("Link copiato negli appunti!");
        });
    }
}

// ============================================
// DISCLAIMER E INFORMAZIONI
// ============================================
function mostraDisclaimerIniziale() {
    let modalOverlay = document.getElementById('disclaimer-overlay');
    
    const pagineDisclaimer = [
        `<strong>1. Natura dello Strumento</strong><br>Questa applicazione è uno strumento informale di supporto hobbistico.`,
        `<strong>2. Responsabilità</strong><br>L'utente è responsabile della conformità fiscale e della veridicità dei dati.`,
        `<strong>3. Geolocalizzazione</strong><br>Le indicazioni GPS sono orientative e non garantite.`,
        `<strong>4. Manleva</strong><br>Declinamo responsabilità per imprecisioni o errori di calcolo.`,
        `<strong>5. Accettazione</strong><br>Premere Accetta per continuare con l'applicazione.`
    ];
    
    let paginaCorrente = 0;
    
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'disclaimer-overlay';
        modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.85); z-index: 99999;
            display: flex; justify-content: center; align-items: center; padding: 20px;
        `;
        
        modalOverlay.innerHTML = `
            <div style="background: #1e293b; color: #f8fafc; padding: 25px; border-radius: 12px; max-width: 500px; width: 100%; border: 1px solid #334155;">
                <h3 style="color: #f59e0b; margin-top: 0;">⚠️ Avviso Legale</h3>
                <p id="disclaimer-counter" style="font-size: 0.8rem; color: #94a3b8;">1 / 5</p>
                <div id="disclaimer-text-container" style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; min-height: 100px; max-height: 400px; overflow-y: auto; margin: 15px 0;">
                    ${pagineDisclaimer[0]}
                </div>
                <div id="disclaimer-buttons-container"></div>
            </div>
        `;
        document.body.appendChild(modalOverlay);
        
        const textContainer = document.getElementById('disclaimer-text-container');
        const counterContainer = document.getElementById('disclaimer-counter');
        const buttonsContainer = document.getElementById('disclaimer-buttons-container');
        
        function aggiornaVistaDisclaimer() {
            textContainer.innerHTML = pagineDisclaimer[paginaCorrente];
            counterContainer.innerText = `${paginaCorrente + 1} / ${pagineDisclaimer.length}`;
            
            if (paginaCorrente < pagineDisclaimer.length - 1) {
                buttonsContainer.innerHTML = `
                    <button style="background: #3b82f6; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold;">
                        Avanti
                    </button>
                `;
                buttonsContainer.querySelector('button').addEventListener('click', () => {
                    paginaCorrente++;
                    aggiornaVistaDisclaimer();
                });
            } else {
                buttonsContainer.innerHTML = `
                    <button id="btn-accetta" style="background: #22c55e; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; margin-bottom: 8px;">
                        Accetta e Continua
                    </button>
                    <button id="btn-abbandona" style="background: #ef4444; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold;">
                        Abbandona
                    </button>
                `;
                document.getElementById('btn-accetta').addEventListener('click', () => {
                    modalOverlay.style.display = 'none';
                });
                document.getElementById('btn-abbandona').addEventListener('click', () => {
                    window.location.href = "about:blank";
                });
            }
        }
        
        aggiornaVistaDisclaimer();
    } else {
        modalOverlay.style.display = 'flex';
    }
}

function mostraInfoModulo(moduleName) {
    const guide = {
        'poilist': 'Visualizza i tuoi punti di interesse e tartufaie salvate.',
        'tesserino': 'Archivia i dati del tuo tesserino di raccolta.',
        'ricevute': 'Emetti ricevute di vendita conformi alla normativa.',
        'export': 'Scarica backup o ripristina i tuoi dati.'
    };
    alert(guide[moduleName] || 'Guida non disponibile.');
}

// ============================================
// PWA: INSTALLAZIONE SU DISPOSITIVO MOBILE
// ============================================
let deferredPrompt;

// Cattura l'evento di installazione (beforeinstallprompt)
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Mostra il pulsante di installazione
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        installBtn.style.display = 'block';
    }
});

/**
 * Funzione per installare l'app su dispositivo mobile
 * Richiamata dal click sul pulsante "Installa App"
 */
function installApp() {
    if (!deferredPrompt) {
        showUserMessage("L'app è già installata o non disponibile su questo dispositivo.");
        return;
    }
    
    // Mostra il prompt di installazione
    deferredPrompt.prompt();
    
    // Attendi che l'utente risponda al prompt
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            showUserMessage('✔ App installata con successo! Puoi usarla offline.');
            console.log("Utente ha accettato l'installazione");
        } else {
            console.log("Utente ha rifiutato l'installazione");
        }
        deferredPrompt = null;
    }).catch((err) => {
        console.error('Errore durante l\'installazione:', err);
        showUserMessage('❌ Errore durante l\'installazione dell\'app.');
    });
}

// Gestisci l'evento di installazione completata
window.addEventListener('appinstalled', () => {
    showUserMessage('App installata! Usa l\'icona sul tuo schermo home per accedere rapidamente.');
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
});

// Verifica se l'app è in modalità standalone (installata)
window.addEventListener('load', () => {
    const isInStandaloneMode = () => (window.navigator.standalone === true) || (window.matchMedia('(display-mode: standalone)').matches);
    
    if (isInStandaloneMode()) {
        console.log('App è in modalità standalone/installata');
        const installBtn = document.getElementById('install-btn');
        if (installBtn) {
            installBtn.style.display = 'none';
        }
    } else {
        console.log('App è in modalità browser');
    }
});

/**
 * Funzione ausiliaria: Mostra messaggio toast all'utente
 */
function showUserMessage(message, timeout = 3000) {
    try {
        let toast = document.getElementById('tmf-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'tmf-toast';
            Object.assign(toast.style, {
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(15,23,42,0.95)',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: '8px',
                zIndex: 99999,
                fontSize: '0.95rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                opacity: '0',
                transition: 'opacity 200ms ease-in-out'
            });
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        void toast.offsetWidth; // Force reflow
        toast.style.opacity = '1';
        clearTimeout(toast._tmf_hide_timeout);
        toast._tmf_hide_timeout = setTimeout(() => {
            toast.style.opacity = '0';
        }, timeout);
    } catch (e) {
        console.warn('showUserMessage fallback:', e);
        alert(message);
    }
}
