// Inizializzazione Mappa corretta (ordine invertito per evitare ReferenceError)
const map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

setTimeout(() => {
    map.invalidateSize();
}, 300);

let userMarker = null;
let carMarker = null;
let carCoordinates = JSON.parse(localStorage.getItem('car_coords')) || null;
let poiList = JSON.parse(localStorage.getItem('poi_list') || '[]');
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
        case 'tesserino':
            const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
            if (tData.nome && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (tData.contenutoBase64) {
                    if (tData.tipoFile && tData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${tData.nomeFile || 'Immagine'}</p><img src="${tData.contenutoBase64}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="Tesserino"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn" style="background:#0284c7;" onclick="visualizzaImmagineSalvata('${tData.contenutoBase64}', 'Tesserino Digitale', 'tesserino')">👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${tData.nomeFile || 'File PDF'}</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#94a3b8;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>Anagrafica & Tesserino Digitale</h2>
                    <p><strong>Normativa:</strong> Legge 145/2018</p>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Tesserino Registrato</p>
                        <p><strong>Nome:</strong> ${tData.nome}</p>
                        <p><strong>Codice Fiscale:</strong> ${tData.cf}</p>
                        <p><strong>Regione / Prov:</strong> ${tData.regione}</p>
                        <p><strong>N. Tesserino:</strong> ${tData.num}</p>
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('tesserino', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('tesserino_data', 'tesserino')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>Anagrafica & Tesserino Digitale</h2>
                    <p>Inserisci i dati del tuo tesserino regionale per la raccolta dei tartufi:</p>
                    <div class="module-card">
                        <label>Nome e Cognome:</label>
                        <input type="text" id="t-nome" class="mod-input" value="${tData.nome || ''}" placeholder="Es. Mario Rossi">
                        <label>Codice Fiscale:</label>
                        <input type="text" id="t-cf" class="mod-input" value="${tData.cf || ''}" placeholder="Es. RSSMRA80A01H501W">
                        <label>Regione / Provincia di Rilascio:</label>
                        <input type="text" id="t-regione" class="mod-input" value="${tData.regione || ''}" placeholder="Es. Molise / Abruzzo">
                        <label>Numero Tesserino:</label>
                        <input type="text" id="t-num" class="mod-input" value="${tData.num || ''}" placeholder="Numero autorizzazione">
                        <label>Carica Tesserino (Foto o PDF - Max 1.5MB):</label>
                        <input type="file" id="t-file" accept="image/*,application/pdf" class="mod-input" style="padding:8px;">
                        <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="saveTesserino()">Salva Tesserino</button>
                    </div>`;
            }
            break;
        case 'pagopa':
            const pData = JSON.parse(localStorage.getItem('pagopa_data') || '{}');
            if (pData.id && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (pData.contenutoBase64) {
                    if (pData.tipoFile && pData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${pData.nomeFile || 'Immagine'}</p><img src="${pData.contenutoBase64}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="Quietanza PagoPA"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn" style="background:#0284c7;" onclick="visualizzaImmagineSalvata('${pData.contenutoBase64}', 'Quietanza PagoPA', 'pagopa')">👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${pData.nomeFile || 'File PDF'}</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#94a3b8;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>Ricevuta PagoPA & PDF</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ Quietanza Attiva</p>
                        <p><strong>ID Transazione:</strong> ${pData.id}</p>
                        <p><strong>Data Pagamento:</strong> ${pData.data}</p>
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('pagopa', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('pagopa_data', 'pagopa')">🗑️ Elimina</button>
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
                        <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="savePagoPAWithFile()">Archivia Ricevuta PagoPA</button>
                    </div>`;
            }
            break;
        case 'ricevute':
            const f24SavedData = JSON.parse(localStorage.getItem('f24_data') || '{}');
            const defaultProtocollo = f24SavedData.protocollo || '';
            contentHTML = `
                <h2>Ricevuta di Vendita Occasionale</h2>
                <p>Conforme a Legge 145/2018, Reg. CE 178/02 & DPR 633/1972</p>
                <div class="module-card">
                    <label>Regime Fiscale / Modalità di Assoggettamento:</label>
                    <select id="r-regime" class="mod-input" onchange="toggleRegimeFiscaleFields()">
                        <option value="sostitutiva">Imposta Sostitutiva (F24 ELIDE - 100€ annui, esonero ritenuta)</option>
                        <option value="ritenuta">Ritenuta d'Acconto (23% operata dal sostituto d'imposta)</option>
                    </select>

                    <label>Acquirente (Privato o Ristorante / Ragione Sociale):</label>
                    <input type="text" id="r-acquirente" class="mod-input" placeholder="Nome o Ristorante">
                    
                    <label>P.IVA / Codice Fiscale Acquirente:</label>
                    <input type="text" id="r-cf-acquirente" class="mod-input" placeholder="P.IVA o CF acquirente">
                    
                    <label>Specie Tartufo:</label>
                    <select id="r-specie" class="mod-input">
                        <option value="Tuber magnatum Pico (Pregiato Bianco)">Tuber magnatum Pico (Pregiato Bianco)</option>
                        <option value="Tuber melanosporum Vitt. (Nero Pregiato)">Tuber melanosporum Vitt. (Nero Pregiato)</option>
                        <option value="Tuber aestivum Vitt. (Scorzone Estivo)">Tuber aestivum Vitt. (Scorzone Estivo)</option>
                        <option value="Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)">Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)</option>
                        <option value="Tuber brumale Vitt. (Moscatuto / Invernale)">Tuber brumale Vitt. (Moscatuto / Invernale)</option>
                        <option value="Tuber brumale var. moschatum De Ferry (Brumale moscato)">Tuber brumale var. moschatum De Ferry (Brumale moscato)</option>
                        <option value="Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)">Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)</option>
                        <option value="Tuber macrosporum Vitt. (Nero Liscio)">Tuber macrosporum Vitt. (Nero Liscio)</option>
                        <option value="Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)">Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)</option>
                    </select>
                    <label>Classificazione Qualità:</label>
                    <select id="r-qualita" class="mod-input">
                        <option value="Prima Scelta">Prima Scelta</option>
                        <option value="Seconda Scelta">Seconda Scelta</option>
                        <option value="Terza Scelta">Terza Scelta</option>
                    </select>
                    <label>Peso (grammi):</label>
                    <input type="number" id="pesoGrammi" class="mod-input" placeholder="Es. 150" oninput="calcolaTotale()">

                    <label>Prezzo al kg (€):</label>
                    <input type="number" id="prezzoKg" class="mod-input" placeholder="Es. 1500.00" oninput="calcolaTotale()">

                    <label>Importo Complessivo / Corrispettivo (€):</label>
                    <input type="number" id="importoTotale" class="mod-input" placeholder="Es. 200.00" oninput="calcolaRitenutaAcconto()">

                    <div id="container-ritenuta" style="display:none; background:#0f172a; padding:10px; border-radius:6px; margin:10px 0; border:1px solid #334155;">
                        <p style="font-size:0.85rem; color:#38bdf8; margin-bottom:6px;"><b>Calcolo Ritenuta d'Acconto (23%):</b></p>
                        <label>Importo Ritenuta d'Acconto (€):</label>
                        <input type="number" id="r-importo-ritenuta" class="mod-input" readonly style="background:#1e293b; color:#22c55e; font-weight:bold;">
                        <label style="margin-top:6px;">Netto a Pagare percepito dal raccoglitore (€):</label>
                        <input type="number" id="r-netto-pagare" class="mod-input" readonly style="background:#1e293b; color:#22c55e; font-weight:bold;">
                    </div>

                    <label>Comune di Raccolta / Località:</label>
                    <input type="text" id="r-comune" class="mod-input" placeholder="Comune di ritrovamento">
                    
                    <label>Codice Lotto / Tracciabilità:</label>
                    <input type="text" id="r-lotto" class="mod-input" value="LOTTO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-01" placeholder="Codice lotto">
                    
                    <div id="container-f24-field">
                        <label>N. Protocollo F24 ELIDE collegato:</label>
                        <input type="text" id="r-f24" class="mod-input" value="${defaultProtocollo}" placeholder="Protocollo F24">
                    </div>
                    
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="registraVenditaConPrezzoKg()">Registra e Genera Ricevuta Conforme</button>
                </div>`;
            setTimeout(toggleRegimeFiscaleFields, 50);
            break;
        case 'clienti':
            const rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
            const storicoVenditeClienti = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
            let clientiHtml = '<h2>Rubrica Clienti</h2><p>Elenco dei clienti e ristoranti salvati automaticamente:</p>';
            if (rubricaClienti.length === 0) {
                clientiHtml += '<div class="module-card"><p>Nessun cliente registrato in rubrica. Emetti una ricevuta per aggiungerli automaticamente.</p></div>';
            } else {
                clientiHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">Clienti Registrati (${rubricaClienti.length}):</h3>`;
                rubricaClienti.forEach((cliente, idx) => {
                    const venditeCliente = storicoVenditeClienti.filter(v => v.acquirente.toLowerCase() === cliente.nome.toLowerCase());
                    const totaleSpeso = venditeCliente.reduce((acc, v) => acc + Number(v.importo), 0);
                    clientiHtml += `
                        <div class="module-card" style="border-left: 4px solid #38bdf8; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:1rem;">👤 ${cliente.nome}</strong>
                            <p style="font-size:0.85rem; color:#cbd5e1; margin: 4px 0;">P.IVA / CF: ${cliente.cf || 'Non inserito'}</p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin: 2px 0;">📅 Ultimo acquisto: ${cliente.dataUltimoAcquisto || 'N.D.'}</p>
                            <p style="font-size:0.85rem; color:#22c55e; font-weight:bold; margin-top: 4px;">Totale Acquisti: € ${totaleSpeso.toFixed(2)} (${venditeCliente.length} ricevute)</p>
                            <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem; margin-top:8px;" onclick="deleteCliente(${idx})">🗑️ Rimuovi da Rubrica</button>
                        </div>`;
                });
            }
            contentHTML = clientiHtml;
            break;
        case 'storico_ricevute':
            const storicoVendite = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
            let storicoHtml = '<h2>Archivio Storico Ricevute</h2><p>Elenco cronologico delle ricevute di vendita emesse:</p>';
            if (storicoVendite.length === 0) {
                storicoHtml += '<div class="module-card"><p>Nessuna ricevuta emessa finora.</p></div>';
            } else {
                storicoVendite.slice().reverse().forEach((item, index) => {
                    const originalIndex = storicoVendite.length - 1 - index;
                    const regimeLabel = item.regime === 'ritenuta' ? '<span style="color:#38bdf8; font-size:0.75rem;">[Ritenuta d\'Acconto]</span>' : '<span style="color:#22c55e; font-size:0.75rem;">[Imposta Sostitutiva]</span>';
                    storicoHtml += `
                        <div class="module-card" style="margin-bottom:12px; border-left: 4px solid #3b82f6;">
                            <strong style="color:#60a5fa; font-size:0.95rem;">📄 Ricevuta #${originalIndex + 1} - ${item.data} ${regimeLabel}</strong>
                            <p style="font-size:0.85rem; color:#f8fafc; margin:4px 0;">Acquirente: <b>${item.acquirente}</b></p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin:2px 0;">Specie: ${item.specie} (${item.peso}g)</p>
                            <p style="font-size:0.9rem; color:#22c55e; font-weight:bold; margin-top:4px;">Importo: € ${item.importo}</p>
                            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
                                <button class="overlay-btn" style="background:#2563eb; padding:6px 10px; font-size:0.75rem;" onclick="visualizzaRicevutaSalvata(${originalIndex})">👁️ Visualizza</button>
                                <button class="overlay-btn" style="background:#0284c7; padding:6px 10px; font-size:0.75rem;" onclick="modificaRicevuta(${originalIndex})">✏️ Modifica</button>
                                <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem;" onclick="eliminaRicevutaConDoppiaConferma(${originalIndex})">🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = storicoHtml;
            break;
        case 'f24':
            const fData = JSON.parse(localStorage.getItem('f24_data') || '{}');
            if (fData.protocollo && !editMode) {
                let filePreviewHTML = '';
                let visualizzaBtnHTML = '';
                if (fData.contenutoBase64) {
                    if (fData.tipoFile && fData.tipoFile.startsWith('image/')) {
                        filePreviewHTML = `<div style="margin-top:10px;"><p><strong>Documento Allegato:</strong> ${fData.nomeFile || 'Immagine'}</p><img src="${fData.contenutoBase64}" style="max-width:100%; border-radius:6px; margin-top:5px;" alt="F24 ELIDE"></div>`;
                        visualizzaBtnHTML = `<button class="overlay-btn" style="background:#0284c7;" onclick="visualizzaImmagineSalvata('${fData.contenutoBase64}', 'F24 ELIDE', 'f24')">👁️ Visualizza Immagine</button>`;
                    } else {
                        filePreviewHTML = `<p style="margin-top:10px;"><strong>Documento PDF Allegato:</strong> ${fData.nomeFile || 'File PDF'}</p>`;
                    }
                } else {
                    filePreviewHTML = `<p style="margin-top:10px; color:#94a3b8;">Nessun file allegato.</p>`;
                }

                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <div class="module-card" style="border-left: 4px solid #22c55e;">
                        <p style="color:#22c55e; font-weight:bold; margin-bottom:10px;">✔ F24 Registrato</p>
                        <p><strong>Anno Fiscale:</strong> ${fData.anno}</p>
                        <p><strong>Protocollo:</strong> ${fData.protocollo}</p>
                        ${filePreviewHTML}
                        <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                            ${visualizzaBtnHTML}
                            <button class="overlay-btn" style="background:#2563eb;" onclick="openModule('f24', true)">✏️ Modifica</button>
                            <button class="overlay-btn" style="background:#dc2626;" onclick="clearData('f24_data', 'f24')">🗑️ Elimina</button>
                        </div>
                    </div>`;
            } else {
                contentHTML = `
                    <h2>F24 ELIDE - Imposta Sostitutiva</h2>
                    <p>Registra il versamento dell'imposta sostitutiva (100€ annui - Legge 145/2018):</p>
                    <div class="module-card">
                        <label>Anno Fiscale di Riferimento:</label>
                        <input type="text" id="f-anno" class="mod-input" value="${fData.anno || new Date().getFullYear()}" placeholder="Es. 2026">
                        <label>Numero di Protocollo Telematico:</label>
                        <input type="text" id="f-protocollo" class="mod-input" value="${fData.protocollo || ''}" placeholder="Es. 24010112345678901">
                        <label>Carica Quietanza F24 (PDF o Immagine - Obbligatorio):</label>
                        <input type="file" id="f-file" accept="image/*,application/pdf" class="mod-input" style="padding:8px;">
                        <button class="overlay-btn" style="margin-top:15px; width:100%; background:#2563eb;" onclick="saveF24WithFile()">Archivia F24 ELIDE</button>
                    </div>`;
            }
            break;
        case 'canidiary':
            const dogsList = JSON.parse(localStorage.getItem('dogs_list') || '[]');
            let dogsHtml = `
                <h2>Profilo Cani & Diario Ricerca</h2>
                <p>Gestisci i tuoi cani da tartufo:</p>
                <div class="module-card" style="margin-bottom: 20px; background: #1e293b; border: 1px solid #334155;">
                    <h3 style="font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">➕ Aggiungi Nuovo Cane</h3>
                    <label>Nome del Cane:</label>
                    <input type="text" id="c-nome" class="mod-input" placeholder="Es. Argo">
                    <label>Razza:</label>
                    <input type="text" id="c-razza" class="mod-input" value="Lagotto Romagnolo">
                    <label>Data di Nascita:</label>
                    <input type="date" id="c-nascita" class="mod-input">
                    <label>Numero Microchip:</label>
                    <input type="text" id="c-microchip" class="mod-input" placeholder="Codice microchip">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" onclick="saveNewCane()">Salva Nuovo Cane</button>
                </div>`;
            if (dogsList.length === 0) {
                dogsHtml += `<div class="module-card"><p style="color:#94a3b8;">Nessun cane registrato.</p></div>`;
            } else {
                dogsHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">I tuoi cani registrati:</h3>`;
                dogsList.forEach((dog, idx) => {
                    dogsHtml += `
                        <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:1rem;">🐕 ${dog.nome}</strong>
                            <p style="font-size:0.85rem; color:#38bdf8; margin: 4px 0;">Razza: ${dog.razza}</p>
                            <p style="font-size:0.8rem; color:#cbd5e1; margin: 2px 0;">📅 Nascita: ${dog.nascita || 'Non specificata'}</p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin-bottom: 8px;">Microchip: ${dog.microchip || 'Non inserito'}</p>
                            <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem;" onclick="deleteDog(${idx})">🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = dogsHtml;
            break;
        case 'polizze':
            const polizzeList = JSON.parse(localStorage.getItem('polizze_list') || '[]');
            let polizzeHtml = `
                <h2>Polizze & Assicurazioni</h2>
                <p>Gestisci le polizze assicurative (RC Cane, Responsabilità Civile Raccolta, Infortuni):</p>
                <div class="module-card" style="margin-bottom: 20px; background: #1e293b; border: 1px solid #334155;">
                    <h3 style="font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">➕ Aggiungi Nuova Polizza</h3>
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
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" onclick="savePolizza()">Salva Polizza</button>
                </div>`;
            if (polizzeList.length === 0) {
                polizzeHtml += `<div class="module-card"><p style="color:#94a3b8;">Nessuna polizza registrata.</p></div>`;
            } else {
                polizzeHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">Le tue polizze attive:</h3>`;
                
                const oggi = new Date();
                
                polizzeList.forEach((pol, idx) => {
                    let statoScadenza = '';
                    let bordoColore = '#3b82f6';
                    
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
                        statoScadenza = `<p style="font-size:0.8rem; color:#94a3b8; margin: 2px 0;">⏳ Scadenza: Non specificata</p>`;
                    }

                    polizzeHtml += `
                        <div class="module-card" style="border-left: 4px solid ${bordoColore}; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:1rem;">🛡️ ${pol.compagnia}</strong>
                            <p style="font-size:0.85rem; color:#38bdf8; margin: 4px 0;">Tipo: ${pol.tipo}</p>
                            <p style="font-size:0.8rem; color:#cbd5e1; margin: 2px 0;">📋 N. ${pol.numero}</p>
                            ${statoScadenza}
                            <p style="font-size:0.8rem; color:#94a3b8; margin-bottom: 8px;">📝 Note: ${pol.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem;" onclick="deletePolizza(${idx})">🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = polizzeHtml;
            break;
        case 'vet':
            const dogsListVet = JSON.parse(localStorage.getItem('dogs_list') || '[]');
            const cDataVet = JSON.parse(localStorage.getItem('cane_data') || '{}');
            const nomeCaneDefault = cDataVet.nome || (dogsListVet.length > 0 ? dogsListVet[0].nome : 'Il tuo cane');
            const vetHistory = JSON.parse(localStorage.getItem('vet_history_list') || '[]');
            let optionsHtml = '';
            if (dogsListVet.length > 0) {
                dogsListVet.forEach(dog => {
                    const selected = dog.nome === nomeCaneDefault ? 'selected' : '';
                    optionsHtml += `<option value="${dog.nome}" ${selected}>${dog.nome} (${dog.razza})</option>`;
                });
            } else { optionsHtml += `<option value="${nomeCaneDefault}">${nomeCaneDefault}</option>`; }
            let vetHtml = `
                <h2>Libretto Sanitario & Profilassi</h2>
                <p>Storico trattamenti, vaccini e visite per il cane:</p>
                <div class="module-card" style="margin-bottom: 20px; background: #1e293b; border: 1px solid #334155;">
                    <h3 style="font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">➕ Aggiungi Trattamento / Visita</h3>
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
                    </select>
                    <label>Data del Trattamento:</label>
                    <input type="date" id="vh-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Note / Dettagli:</label>
                    <input type="text" id="vh-note" class="mod-input" placeholder="Es. Nome farmaco o dosaggio">
                    <button class="overlay-btn" style="margin-top:12px; width:100%; background:#2563eb;" onclick="saveVetHistoryItem()">Registra nel Libretto</button>
                </div>`;
            if (vetHistory.length === 0) {
                vetHtml += `<div class="module-card"><p style="color:#94a3b8;">Nessun trattamento registrato.</p></div>`;
            } else {
                vetHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">Storico Registrazioni:</h3>`;
                vetHistory.slice().reverse().forEach((item, index) => {
                    const originalIndex = vetHistory.length - 1 - index;
                    vetHtml += `
                        <div class="module-card" style="border-left: 4px solid #22c55e; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:0.95rem;">🐕 ${item.cane}</strong>
                            <p style="font-size:0.9rem; color:#38bdf8; margin: 4px 0;"><b>${item.tipo}</b></p>
                            <p style="font-size:0.8rem; color:#cbd5e1; margin: 2px 0;">📅 Data: ${item.data}</p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem;" onclick="deleteVetHistoryItem(${originalIndex})">🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = vetHtml;
            break;
        case 'registro_giornaliero':
            const storicoRaccolta = JSON.parse(localStorage.getItem('storico_raccolta_giornaliera') || '[]');
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
                "Tuber aestivum Vitt. (Scorzone Estivo)", "Tuber uncinatum Chatin (Scorzone Invernale / Uncinato)",
                "Tuber brumale Vitt. (Moscatuto / Invernale)", "Tuber brumale var. moschatum De Ferry (Brumale moscato - Sottospecie)",
                "Tuber borchii Vitt. / albidum Pico (Bianchetto / Marzuolo)", "Tuber macrosporum Vitt. (Nero Liscio)",
                "Tuber mesentericum Vitt. (Nero Ordinario / Bagnolese)"
            ];
            let opzioniSpecieHtml = `<option value="tutte">Tutte le specie</option>`;
            listaSpecie9.forEach(s => { opzioniSpecieHtml += `<option value="${s}" ${filtroSpecie === s ? 'selected' : ''}>${s}</option>`; });
            let selectSpecieFormHtml = '';
            listaSpecie9.forEach(s => { selectSpecieFormHtml += `<option value="${s}">${s}</option>`; });
            let registroHtml = `
                <h2>Registro Giornaliero Ritrovamenti</h2>
                <p>Registra i quantitativi raccolti e filtra per anno o specie</p>
                <div class="module-card" style="margin-bottom: 20px; background: #1e293b; border: 1px solid #334155;">
                    <h3 style="font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">➕ Aggiungi Raccolta</h3>
                    <label>Data:</label>
                    <input type="date" id="reg-data" class="mod-input" value="${new Date().toISOString().slice(0,10)}">
                    <label>Specie Tartufo:</label>
                    <select id="reg-specie" class="mod-input">${selectSpecieFormHtml}</select>
                    <label>Peso Totale (grammi):</label>
                    <input type="number" id="reg-peso" class="mod-input" placeholder="Es. 250">
                    <label>Note:</label>
                    <input type="text" id="reg-note" class="mod-input" placeholder="Es. Bosco di castagni">
                    <button class="overlay-btn" style="margin-top:12px; width:100%; background:#2563eb;" onclick="saveRaccoltaGiornaliera()">Salva nel Registro</button>
                </div>
                <div class="module-card" style="margin-bottom: 15px; background: #0f172a; border: 1px solid #334155;">
                    <h3 style="font-size:0.85rem; color:#38bdf8; margin-bottom:8px;">🔍 Filtri Archivio</h3>
                    <div style="display: flex; gap: 10px;">
                        <div style="flex:1;"><label style="font-size:0.75rem;">Anno:</label><select id="filtro-anno" class="mod-input" onchange="openModule('registro_giornaliero')">${opzioniAnniHtml}</select></div>
                        <div style="flex:2;"><label style="font-size:0.75rem;">Specie:</label><select id="filtro-specie" class="mod-input" onchange="openModule('registro_giornaliero')">${opzioniSpecieHtml}</select></div>
                    </div>
                </div>`;
            let datiFiltrati = storicoRaccolta.filter(item => {
                const annoItem = item.data ? item.data.slice(0,4) : '';
                return (filtroAnno === 'tutti' || annoItem === filtroAnno) && (filtroSpecie === 'tutte' || item.specie === filtroSpecie);
            });
            if (datiFiltrati.length === 0) {
                registroHtml += `<div class="module-card"><p style="color:#94a3b8;">Nessun ritrovamento trovato con i filtri selezionati.</p></div>`;
            } else {
                registroHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">Storico Filtrato (${datiFiltrati.length}):</h3>`;
                datiFiltrati.slice().reverse().forEach((item) => {
                    const originalIndex = storicoRaccolta.indexOf(item);
                    registroHtml += `
                        <div class="module-card" style="border-left: 4px solid #10b981; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:0.95rem;">📅 ${item.data}</strong>
                            <p style="font-size:0.9rem; color:#38bdf8; margin: 4px 0;"><b>${item.specie}</b></p>
                            <p style="font-size:0.85rem; color:#22c55e; margin: 2px 0;">⚖️ Peso: <b>${item.peso} g</b></p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin-bottom: 8px;">📝 Note: ${item.note || 'Nessuna nota'}</p>
                            <button class="overlay-btn" style="background:#dc2626; padding:6px 10px; font-size:0.75rem;" onclick="deleteRaccoltaGiornaliera(${originalIndex})">🗑️ Elimina</button>
                        </div>`;
                });
            }
            contentHTML = registroHtml;
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
                    <p>Esporta i dati contabili o fai un backup completo.</p>
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
            const vetClinics = JSON.parse(localStorage.getItem('vet_clinics_list') || '[]');
            let clinicHtml = `
                <h2>Pronto Soccorso & Cliniche Veterinarie H24</h2>
                <p>Gestisci i numeri d'emergenza dei veterinari:</p>
                <div class="module-card" style="margin-bottom: 20px; background: #1e293b; border: 1px solid #334155;">
                    <h3 style="font-size:0.9rem; color:#f8fafc; margin-bottom:10px;">➕ Aggiungi Clinica H24</h3>
                    <label>Nome Clinica o Medico:</label>
                    <input type="text" id="vc-nome" class="mod-input" placeholder="Es. Clinica Centrale">
                    <label>Numero di Telefono:</label>
                    <input type="tel" id="vc-tel" class="mod-input" placeholder="Es. 0874123456">
                    <label>Note:</label>
                    <input type="text" id="vc-note" class="mod-input" placeholder="Es. Aperto festivi e notturno">
                    <button class="overlay-btn" style="margin-top:10px; width:100%; background:#2563eb;" onclick="saveVetClinic()">Salva Contatto Emergenza</button>
                </div>`;
            if (vetClinics.length === 0) {
                clinicHtml += `<div class="module-card"><p style="color:#94a3b8;">Nessuna clinica salvata.</p></div>`;
            } else {
                clinicHtml += `<h3 style="font-size:0.85rem; color:#94a3b8; margin-bottom:8px; text-transform:uppercase;">I tuoi contatti salvati:</h3>`;
                vetClinics.forEach((clinic, idx) => {
                    clinicHtml += `
                        <div class="module-card" style="border-left: 4px solid #dc2626; margin-bottom: 12px;">
                            <strong style="color:#f8fafc; font-size:1rem;">🏥 ${clinic.nome}</strong>
                            <p style="font-size:0.85rem; color:#38bdf8; margin: 4px 0;">📞 ${clinic.tel}</p>
                            <p style="font-size:0.8rem; color:#94a3b8; margin-bottom: 8px;">📝 ${clinic.note || 'Nessuna nota'}</p>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <a href="tel:${clinic.tel}" class="overlay-btn" style="background:#dc2626; text-decoration:none; text-align:center; display:inline-block; padding:8px 12px;">📞 Chiama</a>
                                <button class="overlay-btn" style="background:#0284c7; padding:8px 12px;" onclick="shareLocationToVet('${clinic.tel}')">📍 Invia GPS</button>
                                <button class="overlay-btn" style="background:#475569; padding:8px 12px;" onclick="deleteVetClinic(${idx})">🗑️ Elimina</button>
                            </div>
                        </div>`;
                });
            }
            contentHTML = clinicHtml;
            break;
        default:
            contentHTML = `<h2>Modulo</h2><p>In fase di sviluppo.</p>`;
    }
    activeView.innerHTML = `
        <div class="module-header-bar" style="display: flex; justify-content: space-between; align-items: center;">
            <button onclick="closeActiveModule()" class="back-map-btn">← Torna alla Mappa</button>
            <button onclick="toggleDrawer(); closeActiveModule();" class="back-map-btn" style="color: #f8fafc;">☰ Torna al Menu</button>
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
function saveTesserino() {
    const nomeVal = document.getElementById('t-nome').value.trim();
    const cfVal = document.getElementById('t-cf').value.trim().toUpperCase();
    const regioneVal = document.getElementById('t-regione').value.trim();
    const numVal = document.getElementById('t-num').value.trim();
    const fileInput = document.getElementById('t-file');
    const file = fileInput ? fileInput.files[0] : null;

    if (!nomeVal || !cfVal) {
        alert("Inserisci almeno Nome e Codice Fiscale.");
        return;
    }

    const tDataExisting = JSON.parse(localStorage.getItem('tesserino_data') || '{}');

    // Funzione helper per il salvataggio sicuro
    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            nome: nomeVal, 
            cf: cfVal, 
            regione: regioneVal, 
            num: numVal,
            nomeFile: fileName !== undefined ? fileName : (tDataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (tDataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (tDataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('tesserino_data', JSON.stringify(data));
            alert("Dati tesserino salvati con successo!");
            openModule('tesserino');
        } catch (e) {
            alert("Errore: Spazio di archiviazione esaurito! Prova a caricare un'immagine o PDF più piccolo (max 1.5MB).");
            console.error(e);
        }
    };

    if (file) {
        // Controllo della dimensione del file
        if (file.size > 1.5 * 1024 * 1024) {
            alert("Il file è troppo grande. Carica un documento inferiore a 1.5 MB.");
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
function savePagoPAWithFile() {
    const idVal = document.getElementById('p-id').value.trim();
    const dataVal = document.getElementById('p-data').value;
    const fileInput = document.getElementById('p-file');
    const file = fileInput ? fileInput.files[0] : null;

    if (!idVal || !dataVal) {
        alert("Inserisci ID transazione e data.");
        return;
    }

    const pDataExisting = JSON.parse(localStorage.getItem('pagopa_data') || '{}');

    // Il file è obbligatorio se non ne esiste già uno precedentemente salvato
    if (!file && !pDataExisting.contenutoBase64) {
        alert("Il caricamento della ricevuta (Immagine o PDF) è obbligatorio.");
        return;
    }

    // Funzione helper per il salvataggio sicuro
    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            id: idVal, 
            data: dataVal,
            nomeFile: fileName !== undefined ? fileName : (pDataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (pDataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (pDataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('pagopa_data', JSON.stringify(data));
            alert("Quietanza PagoPA archiviata con successo!");
            openModule('pagopa');
        } catch (e) {
            alert("Errore: Spazio di archiviazione esaurito! Prova a caricare un'immagine o PDF più piccolo (max 1.5MB).");
            console.error(e);
        }
    };

    if (file) {
        // Controllo della dimensione del file
        if (file.size > 1.5 * 1024 * 1024) {
            alert("Il file è troppo grande. Carica un documento inferiore a 1.5 MB.");
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
    const fileInput = document.getElementById('f-file');
    const file = fileInput ? fileInput.files[0] : null;

    if (!annoVal || !protocolloVal) {
        alert("Inserisci l'anno fiscale e il numero di protocollo.");
        return;
    }

    const fDataExisting = JSON.parse(localStorage.getItem('f24_data') || '{}');

    // Il file è obbligatorio se non ne esiste già uno precedentemente salvato
    if (!file && !fDataExisting.contenutoBase64) {
        alert("Il caricamento della ricevuta F24 (PDF o Immagine) è obbligatorio.");
        return;
    }

    // Funzione helper per il salvataggio sicuro
    const saveData = (base64Content, fileName, fileType) => {
        const data = { 
            anno: annoVal, 
            protocollo: protocolloVal,
            nomeFile: fileName !== undefined ? fileName : (fDataExisting.nomeFile || null),
            tipoFile: fileType !== undefined ? fileType : (fDataExisting.tipoFile || null),
            contenutoBase64: base64Content !== undefined ? base64Content : (fDataExisting.contenutoBase64 || null)
        };
        
        try {
            localStorage.setItem('f24_data', JSON.stringify(data));
            alert("F24 ELIDE archiviato con successo!");
            openModule('f24');
        } catch (e) {
            alert("Errore: Spazio di archiviazione esaurito! Prova a caricare un'immagine o PDF più piccolo (max 1.5MB).");
            console.error(e);
        }
    };

    if (file) {
        // Verifica estensione/tipo file
        if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
            alert("Il file deve essere in formato PDF o Immagine.");
            return;
        }
        
        // Controllo della dimensione del file
        if (file.size > 1.5 * 1024 * 1024) {
            alert("Il file è troppo grande. Carica un documento inferiore a 1.5 MB.");
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
function saveNewCane() {
    const nome = document.getElementById('c-nome').value.trim();
    const razza = document.getElementById('c-razza').value.trim();
    const nascita = document.getElementById('c-nascita').value;
    const microchip = document.getElementById('c-microchip').value.trim();
    if (!nome) { alert("Inserisci almeno il nome del cane."); return; }
    let dogsList = JSON.parse(localStorage.getItem('dogs_list') || '[]');
    dogsList.push({ nome, razza, nascita, microchip });
    localStorage.setItem('dogs_list', JSON.stringify(dogsList));
    localStorage.setItem('cane_data', JSON.stringify({ nome, razza, nascita, microchip }));
    alert("Cane aggiunto con successo!");
    openModule('canidiary');
}
function deleteDog(index) {
    if (confirm("Vuoi davvero rimuovere questo cane?")) {
        let dogsList = JSON.parse(localStorage.getItem('dogs_list') || '[]');
        dogsList.splice(index, 1);
        localStorage.setItem('dogs_list', JSON.stringify(dogsList));
        if (dogsList.length > 0) { localStorage.setItem('cane_data', JSON.stringify(dogsList[dogsList.length - 1])); }
        else { localStorage.removeItem('cane_data'); }
        openModule('canidiary');
    }
}
function deleteCliente(index) {
    if (confirm("Vuoi davvero rimuovere questo cliente dalla rubrica?")) {
        let rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
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
    if (!compagnia || !numero) { alert("Inserisci almeno la compagnia e il numero di polizza."); return; }
    let polizzeList = JSON.parse(localStorage.getItem('polizze_list') || '[]');
    polizzeList.push({ compagnia, numero, tipo, scadenza, note });
    localStorage.setItem('polizze_list', JSON.stringify(polizzeList));
    alert("Polizza salvata con successo!");
    openModule('polizze');
}

function deletePolizza(index) {
    if (confirm("Vuoi davvero rimuovere questa polizza?")) {
        let polizzeList = JSON.parse(localStorage.getItem('polizze_list') || '[]');
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
    if (!data || peso <= 0) { alert("Inserisci una data valida e un peso maggiore di zero."); return; }
    let storicoRaccolta = JSON.parse(localStorage.getItem('storico_raccolta_giornaliera') || '[]');
    storicoRaccolta.push({ data, specie, peso, note });
    localStorage.setItem('storico_raccolta_giornaliera', JSON.stringify(storicoRaccolta));
    alert("Raccolta registrata con successo!");
    openModule('registro_giornaliero');
}

function deleteRaccoltaGiornaliera(index) {
    if (confirm("Vuoi davvero rimuovere questo record dal registro?")) {
        let storicoRaccolta = JSON.parse(localStorage.getItem('storico_raccolta_giornaliera') || '[]');
        storicoRaccolta.splice(index, 1);
        localStorage.setItem('storico_raccolta_giornaliera', JSON.stringify(storicoRaccolta));
        openModule('registro_giornaliero');
    }
}
function calcolaTotale() {
    const grammi = parseFloat(document.getElementById('pesoGrammi').value) || 0;
    const prezzoKg = parseFloat(document.getElementById('prezzoKg').value) || 0;
    
    if (grammi > 0 && prezzoKg > 0) {
        const totale = (grammi / 1000) * prezzoKg;
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

function calcolaRitenutaAcconto() {
    const regime = document.getElementById('r-regime') ? document.getElementById('r-regime').value : 'sostitutiva';
    if (regime !== 'ritenuta') return;
    
    const importoTotale = parseFloat(document.getElementById('importoTotale').value) || 0;
    const ritenuta = importoTotale * 0.23;
    const netto = importoTotale - ritenuta;
    
    const elRitenuta = document.getElementById('r-importo-ritenuta');
    const elNetto = document.getElementById('r-netto-pagare');
    
    if (elRitenuta) elRitenuta.value = ritenuta.toFixed(2);
    if (elNetto) elNetto.value = netto.toFixed(2);
}

function registraVenditaConPrezzoKg() {
    const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
    if (!tData.nome || !tData.cf) {
        alert("Attenzione: Impossibile procedere. Manca la comunicazione dei dati anagrafici e del tesserino.");
        openModule('tesserino');
        return;
    }

    let regimeScelto = document.getElementById('r-regime') ? document.getElementById('r-regime').value : 'sostitutiva';
    const f24SavedData = JSON.parse(localStorage.getItem('f24_data') || '{}');
    const f24InputVal = document.getElementById('r-f24') ? document.getElementById('r-f24').value.trim() : '';
    const protocolloF24 = f24InputVal || f24SavedData.protocollo;

    // CONTROLLO AUTOMATICO: SE L'F24 NON È PRESENTE, SI PROCEDE CON LA RITENUTA D'ACCONTO
    if (regimeScelto === 'sostitutiva' && !protocolloF24) {
        regimeScelto = 'ritenuta';
        alert("ℹ️ Ricevuta F24 non rilevata:\nIl sistema ha automaticamente convertito la scelta sul regime a 'Ritenuta d'Acconto (23%)'.");
    }

    const acquirenteNome = document.getElementById('r-acquirente').value.trim();
    const acquirenteCf = document.getElementById('r-cf-acquirente').value.trim();
    
    if (!acquirenteNome) {
        alert("Inserisci il nome o la ragione sociale dell'acquirente.");
        return;
    }

    let rubricaClienti = JSON.parse(localStorage.getItem('rubrica_clienti') || '[]');
    const clienteEsistente = rubricaClienti.find(c => c.nome.toLowerCase() === acquirenteNome.toLowerCase());
    
    if (!clienteEsistente) {
        rubricaClienti.push({
            nome: acquirenteNome,
            cf: acquirenteCf,
            dataUltimoAcquisto: new Date().toLocaleDateString()
        });
    } else {
        clienteEsistente.dataUltimoAcquisto = new Date().toLocaleDateString();
        if(acquirenteCf) clienteEsistente.cf = acquirenteCf;
    }
    localStorage.setItem('rubrica_clienti', JSON.stringify(rubricaClienti));

    const pesoGrammi = parseFloat(document.getElementById('pesoGrammi').value) || 0;
    const qualitaScelta = document.getElementById('r-qualita').value;
    const importoTotale = parseFloat(document.getElementById('importoTotale').value) || 0;
    
    const importoRitenuta = regimeScelto === 'ritenuta' ? (importoTotale * 0.23).toFixed(2) : '0.00';
    const importoNetto = regimeScelto === 'ritenuta' ? (importoTotale * 0.77).toFixed(2) : importoTotale.toFixed(2);

    let storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const vendita = {
        venditoreNome: tData.nome, 
        venditoreCf: tData.cf, 
        venditoreTesserino: tData.num || 'N.D.', 
        venditoreRegione: tData.regione || 'N.D.',
        acquirente: acquirenteNome, 
        acquirenteCf: acquirenteCf,
        specie: document.getElementById('r-specie').value, 
        qualita: qualitaScelta,
        peso: pesoGrammi, 
        importo: importoTotale.toFixed(2),
        regime: regimeScelto,
        ritenuta: importoRitenuta,
        netto: importoNetto,
        comune: document.getElementById('r-comune').value.trim(), 
        lotto: document.getElementById('r-lotto').value.trim(), 
        f24: regimeScelto === 'sostitutiva' ? protocolloF24 : 'ESENTE (Ritenuta d\'Acconto)', 
        data: new Date().toLocaleDateString()
    };
    
    storico.push(vendita);
    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    alert("✔ Ricevuta registrata correttamente con il regime applicabile!");
    openModule('storico_ricevute');
}
function visualizzaRicevutaSalvata(index) {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const v = storico[index];
    if(!v) return;

    const isRitenuta = v.regime === 'ritenuta';
    const dettagliFiscoHtml = isRitenuta ? `
        <p><strong>Regime Fiscale:</strong> Ritenuta d'Acconto del 23% (esonerata dall'imposta sostitutiva)</p>
        <p><strong>Compenso Lordo:</strong> € ${v.importo}</p>
        <p><strong>Ritenuta d'Acconto (23%):</strong> € ${v.ritenuta || (v.importo * 0.23).toFixed(2)}</p>
        <p style="font-size: 1.05rem; margin-top: 5px; color: #16a34a;"><strong>Netto a Pagare / Percepito:</strong> € ${v.netto || (v.importo * 0.77).toFixed(2)}</p>
    ` : `
        <p><strong>Regime Fiscale:</strong> Imposta Sostitutiva (Legge 145/2018)</p>
        <p><strong>Versamento F24 ELIDE (100€):</strong> Protocollo N. ${v.f24}</p>
        <p style="font-size: 1.1rem; margin-top: 10px;"><strong>Importo Totale:</strong> € ${v.importo}</p>
    `;

    let activeView = document.getElementById('active-module-view');
    activeView.querySelector('.module-body-content').innerHTML = `
        <h2>RICEVUTA VENDITA OCCASIONALE N. ${index + 1}</h2>
        <p>Conforme a Legge 145/2018, Reg. CE 178/02 & DPR 633/1972</p>
        <div class="module-card" style="background:#fff; color:#000; padding:20px; border-radius:8px;">
            <p style="font-size: 0.72rem; color: #444; text-align: justify; margin-bottom: 15px; border-bottom: 1px dashed #ccc; padding-bottom: 8px; line-height: 1.3;">
                <strong>DICHIARAZIONE DI CESSIONE OCCASIONALE E TRACCIABILITÀ:</strong> 
                Operazione effettuata nell'ambito della raccolta hobbistica/occasionale dei tartufi, esonerata dall'obbligo di emissione di fattura elettronica e di certificazione fiscale ai sensi dell'art. 34, comma 6, del DPR n. 633/1972 e s.m.i., nonché in conformità alle disposizioni di cui alla Legge 30 dicembre 2018, n. 145. Si attesta inoltre la piena tracciabilità del prodotto alimentare ai sensi degli artt. 18 e 19 del Regolamento (CE) n. 178/2002.
            </p>
            <h3 style="margin-bottom: 10px; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dati del Venditore (Cessionario occasionale)</h3>
            <p><strong>Nome e Cognome:</strong> ${v.venditoreNome}</p>
            <p><strong>Codice Fiscale:</strong> ${v.venditoreCf}</p>
            <p><strong>Tesserino Raccolta N.:</strong> ${v.venditoreTesserino} - <p><strong> Rilasciato dalla Regione:</strong> ${v.venditoreRegione}</p>
            ${dettagliFiscoHtml}
            <h3 style="margin: 15px 0 10px 0; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dati dell'Acquirente</h3>
            <p><strong>Acquirente / Ristorante:</strong> ${v.acquirente}</p>
            <p><strong>P.IVA / Codice Fiscale:</strong> ${v.acquirenteCf || 'Non inserito'}</p>
            <h3 style="margin: 15px 0 10px 0; border-bottom: 2px solid #ddd; padding-bottom: 5px; font-size: 1rem; color: #333;">Dettagli Prodotto & Tracciabilità</h3>
            <p><strong>Specie di Tartufo:</strong> ${v.specie}</p>
            <p><strong>Classificazione Qualità:</strong> ${v.qualita || 'Non specificata'}</p>
            <p><strong>Peso:</strong> ${v.peso} grammi</p>
            <p><strong>Comune di Raccolta / Località:</strong> ${v.comune}</p>
            <p><strong>Codice Lotto / Tracciabilità:</strong> ${v.lotto}</p>
            <p><strong>Data Vendita:</strong> ${v.data}</p>
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
        <button class="overlay-btn" style="background:#2563eb; margin-top:15px; width:100%;" onclick="window.print()">🖨️ Stampa / Salva PDF Conforme</button>
        <button class="overlay-btn" style="background:#0284c7; margin-top:10px; width:100%;" onclick="condividiRicevuta(${index})">📤 Condividi Ricevuta (WhatsApp / PDF)</button>
        <button class="overlay-btn" style="background:#475569; margin-top:10px; width:100%;" onclick="chiudiDettaglioRicevuta()">← Torna all'Archivio</button>
    `;
}
function eliminaRicevutaConDoppiaConferma(index) {
    const primaConferma = confirm("Sei sicuro di voler eliminare questa ricevuta dallo storico?");
    if (primaConferma) {
        const secondaConferma = confirm("ATTENZIONE: L'operazione è irreversibile. Vuoi davvero confermare l'eliminazione definitiva?");
        if (secondaConferma) {
            let storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
            storico.splice(index, 1);
            localStorage.setItem('storico_vendite', JSON.stringify(storico));
            alert("Ricevuta eliminata con successo.");
            openModule('storico_ricevute');
        }
    }
}

function modificaRicevuta(index) {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
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

        const btnRegistra = document.querySelector('#active-module-view button[onclick="registraVenditaConPrezzoKg()"]');

        if (btnRegistra) {
            btnRegistra.innerText = "Aggiorna Ricevuta Esistente";
            btnRegistra.setAttribute('onclick', `salvaModificaRicevuta(${index})`);
        }
    }, 50);
}
function salvaModificaRicevuta(index) {
    let storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    const tData = JSON.parse(localStorage.getItem('tesserino_data') || '{}');
    const f24SavedData = JSON.parse(localStorage.getItem('f24_data') || '{}');
    
    const acquirenteNome = document.getElementById('r-acquirente').value.trim();
    if (!acquirenteNome) {
        alert("Inserisci il nome o la ragione sociale dell'acquirente.");
        return;
    }

    let regimeScelto = document.getElementById('r-regime') ? document.getElementById('r-regime').value : 'sostitutiva';
    const f24InputVal = document.getElementById('r-f24') ? document.getElementById('r-f24').value.trim() : '';
    const protocolloF24 = f24InputVal || f24SavedData.protocollo;

    if (regimeScelto === 'sostitutiva' && !protocolloF24) {
        regimeScelto = 'ritenuta';
    }

    const importoCorrente = parseFloat(document.getElementById('importoTotale').value) || 0;
    const importoRitenuta = regimeScelto === 'ritenuta' ? (importoCorrente * 0.23).toFixed(2) : '0.00';
    const importoNetto = regimeScelto === 'ritenuta' ? (importoCorrente * 0.77).toFixed(2) : importoCorrente.toFixed(2);

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
        data: storico[index].data
    };

    localStorage.setItem('storico_vendite', JSON.stringify(storico));
    alert("Ricevuta aggiornata con successo!");
    openModule('storico_ricevute');
}
async function condividiRicevuta(index) {
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
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
    const storico = JSON.parse(localStorage.getItem('storico_vendite') || '[]');
    if(storico.length === 0) { alert("Nessuna vendita registrata."); return; }
    let csvContent = "data:text/csv;charset=utf-8,Data,Acquirente,Specie,Peso,Importo\n";
    storico.forEach(r => { csvContent += `${r.data},"${r.acquirente}","${r.specie}",${r.peso},${r.importo}\n`; });
    var encodedUri = encodeURI(csvContent);
    var link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "report_tartufi.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function esportaBackupJSON() {
    const backupData = { 
        tesserino: localStorage.getItem('tesserino_data'), 
        pagopa: localStorage.getItem('pagopa_data'),
        f24: localStorage.getItem('f24_data'),
        storicoVendite: localStorage.getItem('storico_vendite'), 
        poiList: localStorage.getItem('poi_list'),
        dogsList: localStorage.getItem('dogs_list'),
        polizzeList: localStorage.getItem('polizze_list'),
        storicoRaccolta: localStorage.getItem('storico_raccolta_giornaliera'),
        rubricaClienti: localStorage.getItem('rubrica_clienti')
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr); downloadAnchor.setAttribute("download", "backup_truffle.json");
    document.body.appendChild(downloadAnchor); downloadAnchor.click(); downloadAnchor.remove();
}

function importBackupData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if(data.tesserino) localStorage.setItem('tesserino_data', data.tesserino);
            if(data.pagopa) localStorage.setItem('pagopa_data', data.pagopa);
            if(data.f24) localStorage.setItem('f24_data', data.f24);
            if(data.storicoVendite) localStorage.setItem('storico_vendite', data.storicoVendite);
            if(data.poiList) localStorage.setItem('poi_list', data.poiList);
            if(data.dogsList) localStorage.setItem('dogs_list', data.dogsList);
            if(data.polizzeList) localStorage.setItem('polizze_list', data.polizzeList);
            if(data.storicoRaccolta) localStorage.setItem('storico_raccolta_giornaliera', data.storicoRaccolta);
            if(data.rubricaClienti) localStorage.setItem('rubrica_clienti', data.rubricaClienti);
            alert("Backup ripristinato con successo!"); location.reload();
        } catch(err) { alert("Errore durante la lettura del file di backup."); }
    };
    reader.readAsText(file);
}

function toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) { drawer.classList.toggle('drawer-open'); backdrop.classList.toggle('active'); }
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
    const appUrl = window.location.href;
    if (navigator.share) { navigator.share({ title: 'Truffle App', url: appUrl }).catch(() => {}); }
    else { navigator.clipboard.writeText(appUrl).then(() => alert("Link copiato!")); }
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
