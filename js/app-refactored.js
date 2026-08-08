/**
 * TRUFFLE MOBILE-FIRST APP - REFACTORED
 * =====================================
 * Versione migliorata con:
 * - Consolidamento funzioni duplicate
 * - Gestione errori centralizzata
 * - Modularizzazione logica
 * - PWA support
 */

// ============================================
// 1. UTILITY CENTRALIZZATE
// ============================================

const AppUtils = {
  /**
   * Legge file e lo converte in base64
   */
  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 1.5 * 1024 * 1024) {
        reject(new Error('File troppo grande. Massimo 1.5 MB.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Errore lettura file'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Salva dati nel localStorage con gestione errori
   */
  saveToStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        alert('Errore: Spazio di archiviazione esaurito!');
      }
      console.error(`Errore salvataggio ${key}:`, e);
      return false;
    }
  },

  /**
   * Legge dati dal localStorage con fallback
   */
  getFromStorage(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
      console.error(`Errore lettura ${key}:`, e);
      return defaultValue;
    }
  },

  /**
   * Gestisce il salvataggio generico di file
   */
  async saveFileData(storageKey, fieldsData, existingData = {}) {
    const newData = { ...existingData, ...fieldsData };
    if (this.saveToStorage(storageKey, newData)) {
      return { success: true, data: newData };
    }
    return { success: false, error: 'Salvataggio fallito' };
  }
};

// ============================================
// 2. GEOLOCATION & MAPPA
// ============================================

const MapManager = {
  map: null,
  userMarker: null,
  carMarker: null,
  carCoordinates: null,
  poiList: [],
  poiMapMarkers: {},
  targetNavigation: null,

  init() {
    this.map = L.map('map', { zoomControl: false }).setView([41.8719, 12.5674], 6);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 300);
    setTimeout(() => {
      this.map.invalidateSize();
      this.startGPS();
    }, 400);
  },

  startGPS() {
    this.carCoordinates = AppUtils.getFromStorage('car_coords');
    this.poiList = AppUtils.getFromStorage('poi_list', []);

    if (!navigator.geolocation) {
      console.warn('Geolocation non supportata');
      return;
    }

    navigator.geolocation.watchPosition(
      (pos) => this.onGPSSuccess(pos),
      (err) => this.onGPSError(err),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
  },

  onGPSSuccess(position) {
    const { latitude: lat, longitude: lng } = position.coords;
    this.updateGPSStatus(lat, lng);

    if (!this.userMarker) {
      this.userMarker = L.marker([lat, lng])
        .addTo(this.map)
        .bindPopup('<b>Sei qui</b>')
        .openPopup();
      this.map.setView([lat, lng], 16);

      if (this.carCoordinates) {
        this.carMarker = L.marker([this.carCoordinates.lat, this.carCoordinates.lng])
          .addTo(this.map)
          .bindPopup('<b>🚗 La tua Auto</b>');
      }
      this.renderAllPoiMarkers();
    } else {
      this.userMarker.setLatLng([lat, lng]);
    }
    this.updateCompass(lat, lng);
  },

  onGPSError(error) {
    console.warn('Errore GPS:', error.message);
    const dot = document.getElementById('gps-status-dot');
    if (dot) dot.style.backgroundColor = '#ef4444';
  },

  updateGPSStatus(lat, lng) {
    const dot = document.getElementById('gps-status-dot');
    if (dot) {
      dot.style.backgroundColor = '#22c55e';
      dot.title = `GPS Attivo: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    const gpsText = document.getElementById('gps-status-text');
    if (!gpsText) return;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
      { headers: { 'Accept-Language': 'it' } }
    )
      .then((res) => res.json())
      .then((data) => {
        if (data?.address) {
          const regione = data.address.region || data.address.state || '';
          const provincia = data.address.province || data.address.county || '';
          const comune = data.address.city || data.address.town || data.address.village || '';

          let parti = [];
          if (regione) parti.push(`<b>${regione}</b>`);
          if (provincia) parti.push(`<b>${provincia}</b>`);
          if (comune) parti.push(`<b>${comune}</b>`);

          gpsText.innerHTML =
            parti.length > 0
              ? `GPS: ${parti.join(' > ')}`
              : `GPS Attivo: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
      })
      .catch((err) => console.log('Errore geocodifica:', err));
  },

  calculateDistanceAndBearing(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    let brng = (Math.atan2(y, x) * 180) / Math.PI;
    brng = (brng + 360) % 360;

    const arrows = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
    const directions = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ovest', 'Ovest', 'Nord-Ovest'];
    const index = Math.round(brng / 45) % 8;

    return {
      distance: distance > 1000 ? (distance / 1000).toFixed(2) + ' km' : Math.round(distance) + ' m',
      arrow: arrows[index],
      direction: directions[index]
    };
  },

  updateCompass(currentLat, currentLng) {
    const compassText = document.getElementById('compass-box');
    if (!compassText) return;

    let target = null;
    let label = '';

    if (this.targetNavigation === 'car' && this.carCoordinates) {
      target = this.carCoordinates;
      label = '🚗 Auto';
    } else if (typeof this.targetNavigation === 'string' && this.targetNavigation.startsWith('poi_')) {
      const index = parseInt(this.targetNavigation.split('_')[1]);
      if (this.poiList[index]) {
        target = this.poiList[index];
        label = `📍 ${this.poiList[index].note || 'Punto'}`;
      }
    }

    if (target) {
      const res = this.calculateDistanceAndBearing(currentLat, currentLng, target.lat, target.lng);
      compassText.innerHTML = `🧭 <b>${label}:</b> ${res.arrow} ${res.distance} (${res.direction})`;
    } else {
      compassText.innerHTML = '🧭 Seleziona una destinazione (Auto o Punto)';
    }
  },

  renderAllPoiMarkers() {
    Object.values(this.poiMapMarkers).forEach((marker) => this.map.removeLayer(marker));
    this.poiMapMarkers = {};

    this.poiList.forEach((poi, index) => {
      const marker = L.marker([poi.lat, poi.lng])
        .addTo(this.map)
        .bindPopup(`<b>📍 Tartufo / Punto</b><br>Nota: ${poi.note || 'Nessuna nota'}<br><small>${poi.date}</small>`);
      this.poiMapMarkers[index] = marker;
    });
  },

  saveCarPosition() {
    if (!this.userMarker) {
      alert('Segnale GPS non ancora disponibile per marcare l\'auto.');
      return;
    }

    const pos = this.userMarker.getLatLng();
    this.carCoordinates = { lat: pos.lat, lng: pos.lng };
    AppUtils.saveToStorage('car_coords', this.carCoordinates);

    if (this.carMarker) {
      this.carMarker.setLatLng([pos.lat, pos.lng]);
    } else {
      this.carMarker = L.marker([pos.lat, pos.lng])
        .addTo(this.map)
        .bindPopup('<b>🚗 La tua Auto</b>');
    }
    alert('🚗 Posizione dell\'auto salvata con successo!');
  },

  deleteCarPosition() {
    if (!this.carCoordinates) {
      alert('Nessuna posizione dell\'auto attualmente salvata.');
      return;
    }

    if (confirm('Vuoi davvero eliminare la posizione dell\'auto salvata?')) {
      if (this.carMarker) {
        this.map.removeLayer(this.carMarker);
        this.carMarker = null;
      }
      this.carCoordinates = null;
      localStorage.removeItem('car_coords');
      if (this.targetNavigation === 'car') this.targetNavigation = null;
      alert('🚗 Posizione dell\'auto rimossa con successo!');
    }
  },

  returnToCar() {
    if (!this.carCoordinates) {
      alert('Nessun parcheggio salvato. Clicca prima su "Auto".');
      return;
    }
    this.targetNavigation = 'car';
    this.map.setView([this.carCoordinates.lat, this.carCoordinates.lng], 18);
    if (this.carMarker) this.carMarker.openPopup();
  },

  savePoiPosition() {
    if (!this.userMarker) {
      alert('Segnale GPS non ancora disponibile per marcare il punto.');
      return;
    }

    const pos = this.userMarker.getLatLng();
    const note = prompt('Inserisci una nota per questo punto (es. Tartufaia bianca sotto quercia):', 'Tartufaia');
    if (note === null) return;

    const newPoi = {
      lat: pos.lat,
      lng: pos.lng,
      note: note.trim() || 'Punto di interesse',
      date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    this.poiList.push(newPoi);
    AppUtils.saveToStorage('poi_list', this.poiList);

    const newIndex = this.poiList.length - 1;
    this.renderAllPoiMarkers();
    this.targetNavigation = `poi_${newIndex}`;
    this.map.setView([pos.lat, pos.lng], 18);
    if (this.poiMapMarkers[newIndex]) this.poiMapMarkers[newIndex].openPopup();
    alert('📍 Punto salvato con successo e impostato sulla bussola!');
  },

  navigateToPoi(index) {
    if (this.poiList[index]) {
      this.targetNavigation = `poi_${index}`;
      this.map.setView([this.poiList[index].lat, this.poiList[index].lng], 18);
      if (this.poiMapMarkers[index]) this.poiMapMarkers[index].openPopup();
      UIManager.closeActiveModule();
      alert(`🧭 Destinazione impostata sulla bussola: ${this.poiList[index].note}`);
    }
  },

  sharePoi(index) {
    if (this.poiList[index]) {
      const p = this.poiList[index];
      const msg = `📍 TARTUFAIA CONDIVISA\nNota: ${p.note}\nData: ${p.date}\nGoogle Maps: https://maps.google.com/?q=${p.lat},${p.lng}`;

      if (navigator.share) {
        navigator.share({ title: 'Tartufaia', text: msg }).catch(() => {});
      } else {
        window.location.href = `whatsapp://send?text=${encodeURIComponent(msg)}`;
      }
    }
  },

  deletePoi(index) {
    if (confirm('Vuoi davvero eliminare questo punto salvato?')) {
      if (this.poiMapMarkers[index]) {
        this.map.removeLayer(this.poiMapMarkers[index]);
        delete this.poiMapMarkers[index];
      }
      this.poiList.splice(index, 1);
      AppUtils.saveToStorage('poi_list', this.poiList);
      this.renderAllPoiMarkers();
      UIManager.openModule('poilist');
    }
  },

  centerOnUser() {
    if (this.userMarker) {
      const pos = this.userMarker.getLatLng();
      this.map.setView([pos.lat, pos.lng], 16);
      this.userMarker.openPopup();
    } else {
      alert('Posizione GPS non disponibile.');
    }
  },

  triggerSOS() {
    if (this.userMarker) {
      const pos = this.userMarker.getLatLng();
      const msg = `EMERGENZA TARTUFAIA! Coordinate GPS: Lat: ${pos.lat}, Lng: ${pos.lng}.`;
      window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
    } else {
      alert('Impossibile rilevare le coordinate GPS.');
    }
  }
};

// ============================================
// 3. UI MANAGER
// ============================================

const UIManager = {
  activeModule: null,

  openModule(moduleName, editMode = false) {
    this.toggleDrawer();

    let activeView = document.getElementById('active-module-view');
    if (!activeView) {
      activeView = document.createElement('div');
      activeView.id = 'active-module-view';
      document.getElementById('app-container').appendChild(activeView);
    }

    let contentHTML = this.renderModuleContent(moduleName, editMode);

    activeView.innerHTML = `
      <div class="module-header-bar" style="display: flex; justify-content: space-between; align-items: center;">
        <button onclick="UIManager.closeActiveModule()" class="back-map-btn">← Torna alla Mappa</button>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button onclick="UIManager.showModuleInfo('${moduleName}')" class="back-map-btn" style="background: #334155; color: #38bdf8;">ℹ️</button>
          <button onclick="UIManager.toggleDrawer(); UIManager.closeActiveModule();" class="back-map-btn">☰ Menu</button>
        </div>
      </div>
      <div class="module-body-content">${contentHTML}</div>
    `;

    activeView.style.display = 'flex';
    this.activeModule = moduleName;

    // Callback per moduli specifici
    if (moduleName === 'ricevute') {
      setTimeout(() => ReceiptManager.toggleRegimeFiscaleFields(), 50);
    }
  },

  closeActiveModule() {
    const activeView = document.getElementById('active-module-view');
    if (activeView) activeView.style.display = 'none';
    this.activeModule = null;
  },

  toggleDrawer() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer && backdrop) {
      drawer.classList.toggle('drawer-open');
      backdrop.classList.toggle('active');
    }
  },

  renderModuleContent(moduleName, editMode) {
    const moduleRenderers = {
      poilist: () => this.renderPoiListModule(),
      tesserino: () => this.renderTesserinoModule(editMode),
      pagopa: () => this.renderPagopaModule(editMode),
      ricevute: () => this.renderReceiptModule(),
      storico_ricevute: () => this.renderHistoryModule(),
      canidiary: () => this.renderDogModule(),
      polizze: () => this.renderPoliciesModule(),
      vet: () => this.renderVetModule(),
      // ... altri moduli
      default: () => '<h2>Modulo</h2><p>In fase di sviluppo.</p>'
    };

    const renderer = moduleRenderers[moduleName] || moduleRenderers.default;
    return renderer();
  },

  renderPoiListModule() {
    let html = '<h2>Elenco Punti & Tartufaie</h2><p>I tuoi punti di ricerca salvati:</p>';

    if (MapManager.poiList.length === 0) {
      html += '<div class="module-card"><p>Nessun punto salvato.</p></div>';
    } else {
      MapManager.poiList.forEach((poi, idx) => {
        html += `
          <div class="module-card" style="margin-bottom:12px;">
            <strong style="color:#60a5fa;">📍 ${poi.note}</strong>
            <p style="font-size:0.8rem; color:#cbd5e1; margin:4px 0;">Data: ${poi.date}</p>
            <p style="font-size:0.8rem;">Lat: ${poi.lat.toFixed(4)}, Lng: ${poi.lng.toFixed(4)}</p>
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
              <button class="overlay-btn" style="background:#16a34a;" onclick="MapManager.navigateToPoi(${idx})">🧭 Vai</button>
              <button class="overlay-btn" style="background:#0284c7;" onclick="MapManager.sharePoi(${idx})">📤 Condividi</button>
              <button class="overlay-btn" style="background:#dc2626;" onclick="MapManager.deletePoi(${idx})">🗑️ Elimina</button>
            </div>
          </div>`;
      });
    }
    return html;
  },

  renderTesserinoModule(editMode) {
    const tData = AppUtils.getFromStorage('tesserino_data', {});
    // ... implementare il rendering
    return '<h2>Tesserino</h2><p>Modulo in sviluppo</p>';
  },

  renderPagopaModule(editMode) {
    const pData = AppUtils.getFromStorage('pagopa_data', {});
    // ... implementare il rendering
    return '<h2>PagoPA</h2><p>Modulo in sviluppo</p>';
  },

  renderReceiptModule() {
    // ... implementare il rendering
    return '<h2>Ricevuta</h2><p>Modulo in sviluppo</p>';
  },

  renderHistoryModule() {
    // ... implementare il rendering
    return '<h2>Storico</h2><p>Modulo in sviluppo</p>';
  },

  renderDogModule() {
    const dogsList = AppUtils.getFromStorage('dogs_list', []);
    // ... implementare il rendering
    return '<h2>Cani</h2><p>Modulo in sviluppo</p>';
  },

  renderPoliciesModule() {
    const polizzeList = AppUtils.getFromStorage('polizze_list', []);
    // ... implementare il rendering
    return '<h2>Polizze</h2><p>Modulo in sviluppo</p>';
  },

  renderVetModule() {
    const vetHistory = AppUtils.getFromStorage('vet_history_list', []);
    // ... implementare il rendering
    return '<h2>Veterinario</h2><p>Modulo in sviluppo</p>';
  },

  showModuleInfo(moduleName) {
    const guides = {
      poilist: 'Visualizza e gestisci i tuoi punti di interesse per la ricerca dei tartufi.',
      tesserino: 'Gestisci il tuo tesserino di raccolta e carica una copia digitale.',
      pagopa: 'Registra il pagamento della tassa annuale tramite PagoPA.',
      ricevute: 'Emetti ricevute di vendita conformi alla normativa.',
      // ... altri
    };
    alert('ℹ️ ' + (guides[moduleName] || 'Guida non disponibile'));
  }
};

// ============================================
// 4. RECEIPT MANAGER
// ============================================

const ReceiptManager = {
  toggleRegimeFiscaleFields() {
    const regime = document.getElementById('r-regime')?.value || 'sostitutiva';
    const containerF24 = document.getElementById('container-f24-field');
    const containerRitenuta = document.getElementById('container-ritenuta');

    if (regime === 'ritenuta') {
      if (containerF24) containerF24.style.display = 'none';
      if (containerRitenuta) containerRitenuta.style.display = 'block';
      this.calculateWithholding();
    } else {
      if (containerF24) containerF24.style.display = 'block';
      if (containerRitenuta) containerRitenuta.style.display = 'none';
    }
  },

  calculateWithholding() {
    const regime = document.getElementById('r-regime')?.value || 'sostitutiva';
    if (regime !== 'ritenuta') return;

    const importoTotale = parseFloat(document.getElementById('importoTotale')?.value) || 0;
    const baseImponibile = importoTotale * 0.78;
    const ritenuta = baseImponibile * 0.23;
    const netto = importoTotale - ritenuta;

    const elRitenuta = document.getElementById('r-importo-ritenuta');
    const elNetto = document.getElementById('r-netto-pagare');

    if (elRitenuta) elRitenuta.value = ritenuta.toFixed(2);
    if (elNetto) elNetto.value = netto.toFixed(2);
  },

  calculateTotal() {
    const grammi = parseFloat(document.getElementById('pesoGrammi')?.value) || 0;
    const prezzoKg = parseFloat(document.getElementById('prezzoKg')?.value) || 0;

    if (grammi > 0 && prezzoKg > 0) {
      const totale = (grammi / 1000) * prezzoKg;
      const el = document.getElementById('importoTotale');
      if (el) el.value = totale.toFixed(2);
      this.calculateWithholding();
    }
  }
};

// ============================================
// 5. INITIALIZATION
// ============================================

window.addEventListener('DOMContentLoaded', () => {
  // Inizializza mappa
  MapManager.init();

  // Inizializza PWA
  PWAManager.init();

  // Mostra disclaimer
  if (typeof mostraDisclaimerIniziale === 'function') {
    mostraDisclaimerIniziale();
  }
});

// Esportazioni globali per compatibilità
window.MapManager = MapManager;
window.UIManager = UIManager;
window.ReceiptManager = ReceiptManager;
window.AppUtils = AppUtils;
