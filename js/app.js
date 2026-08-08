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
// PWA INSTALL PROMPT
// ============================================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-installa-app');
    if (btn) btn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('btn-installa-app');
    if (btn) btn.style.display = 'none';
});

function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
        deferredInstallPrompt = null;
        const btn = document.getElementById('btn-installa-app');
        if (btn) btn.style.display = 'none';
        console.log(choiceResult.outcome === 'accepted' ? 'Installazione PWA accettata' : 'Installazione PWA rifiutata');
    });
}

function updateInstallButtonVisibility() {
    const btn = document.getElementById('btn-installa-app');
    if (!btn) return;
    btn.style.display = deferredInstallPrompt ? 'block' : 'none';
}

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

// resto del file invariato...
