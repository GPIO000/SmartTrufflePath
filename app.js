// --- STATO DELL'APPLICAZIONE ---
let map = null;
let userMarker = null;
let carMarker = null;
let carCoords = null;
let currentCoords = null;
let deviceHeading = 0;

let isTaxPaid = false;
let dogs = [];
let clients = [];
let findings = [];
let findingMarkers = [];

// --- AVVIO APP IN SICUREZZA ---
document.addEventListener('DOMContentLoaded', () => {
  loadStoredData();
  registerServiceWorker();
  initNavigation();
  initMap();
  initFormEvents();
  
  // Renderizzazione Interfaccia
  renderDogs();
  renderClients();
  renderFindings();
  populateDogSelect();
  populateReceiptFindingSelect();
  populateReceiptClientSelect();
  updateTaxUI();
  loadSavedSellerData();
  updateOnlineStatus();

  // Network Monitoring
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
});

// --- GESTIONE ARCHIVIO LOCALSTORAGE ---
function loadStoredData() {
  try {
    carCoords = JSON.parse(localStorage.getItem('car_coords')) || null;
    isTaxPaid = localStorage.getItem('tax_paid') === 'true';
    dogs = JSON.parse(localStorage.getItem('tartufo_dogs')) || [
      { id: 1, name: 'Rex', breed: 'Lagotto Romagnolo', chip: '' }
    ];
    clients = JSON.parse(localStorage.getItem('tartufo_clients')) || [];
    findings = JSON.parse(localStorage.getItem('tartufo_findings')) || [];
  } catch (e) {
    console.error("Errore lettura LocalStorage", e);
  }
}

// --- SERVICE WORKER ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW err:", err));
  }
}

// --- ONLINE STATUS ---
function updateOnlineStatus() {
  const netStatus = document.getElementById('net-status');
  if (!netStatus) return;
  if (navigator.onLine) {
    netStatus.innerText = "Online";
    netStatus.style.backgroundColor = "#4cae4c";
  } else {
    netStatus.innerText = "Offline OK";
    netStatus.style.backgroundColor = "#f0ad4e";
  }
}

// --- NAVIGAZIONE & SIDEBAR ---
function initNavigation() {
  const menuBtn = document.getElementById('menu-btn');
  const closeSidebar = document.getElementById('close-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuItems = document.querySelectorAll('.menu-item');

  if (menuBtn) menuBtn.onclick = toggleSidebar;
  if (closeSidebar) closeSidebar.onclick = toggleSidebar;
  if (overlay) overlay.onclick = toggleSidebar;

  menuItems.forEach(item => {
    item.onclick = () => {
      const targetId = item.getAttribute('data-target');
      showSection(targetId, item);
    };
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  }
}

function showSection(sectionId, activeBtn) {
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  
  const targetSection = document.getElementById(sectionId);
  if (targetSection) targetSection.classList.add('active');
  if (activeBtn) activeBtn.classList.add('active');
  
  toggleSidebar();
  
  if (sectionId === 'map-section' && map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 350);
  }
}

// --- MAPPA E GPS ---
function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  map = L.map('map', { zoomControl: true }).setView([41.9028, 12.4964], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(position => {
      currentCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      if (!userMarker) {
        userMarker = L.marker([currentCoords.lat, currentCoords.lng]).addTo(map).bindPopup("Tu sei qui");
        map.setView([currentCoords.lat, currentCoords.lng], 16);
      } else {
        userMarker.setLatLng([currentCoords.lat, currentCoords.lng]);
      }

      updateCompass();
    }, err => console.warn("GPS non pronto:", err), { 
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  }

  if (carCoords) drawCarMarker();
  addFindingMarkersToMap();
}

// --- BUSSOLA COMPATIBILE IOS/ANDROID ---
function initCompassPermission() {
  const btn = document.getElementById('enable-compass-btn');
  
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation, true);
          if (btn) btn.style.display = 'none';
        } else {
          alert('Permesso bussola negato.');
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    if (btn) btn.style.display = 'none';
  }
}

function handleOrientation(event) {
  if (event.webkitCompassHeading) {
    deviceHeading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    deviceHeading = 360 - event.alpha;
  }
  updateCompass();
}

function drawCarMarker() {
  if (!map || !carCoords) return;
  if (carMarker) map.removeLayer(carMarker);
  
  const carIcon = L.divIcon({
    className: 'custom-car-icon',
    html: `<div class="car-marker-pin">🚗</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  carMarker = L.marker([carCoords.lat, carCoords.lng], { icon: carIcon }).addTo(map).bindPopup("La tua Auto");
  updateCompass();
}

function updateCompass() {
  if (!currentCoords || !carCoords) return;

  const dist = getDistance(currentCoords.lat, currentCoords.lng, carCoords.lat, carCoords.lng);
  const distEl = document.getElementById('car-distance');
  if (distEl) distEl.innerText = `${Math.round(dist)} m`;

  const bearing = getBearing(currentCoords.lat, currentCoords.lng, carCoords.lat, carCoords.lng);
  const bearingEl = document.getElementById('car-bearing');
  if (bearingEl) bearingEl.innerText = `${Math.round(bearing)}°`;

  const arrow = document.getElementById('compass-arrow');
  if (arrow) {
    const relativeAngle = (bearing - deviceHeading + 360) % 360;
    arrow.style.transform = `rotate(${relativeAngle}deg)`;
  }
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180, Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2-lon1)*Math.PI/180) * Math.cos(lat2*Math.PI/180);
  const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) - Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos((lon2-lon1)*Math.PI/180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// --- FORM ED EVENTI ---
function initFormEvents() {
  const compassBtn = document.getElementById('enable-compass-btn');
  if (compassBtn) compassBtn.onclick = initCompassPermission;

  document.getElementById('recenter-btn').onclick = () => {
    if (currentCoords && map) map.setView([currentCoords.lat, currentCoords.lng], 17);
    else alert("In attesa del segnale GPS...");
  };

  document.getElementById('save-car-btn').onclick = () => {
    if (currentCoords) {
      carCoords = currentCoords;
      localStorage.setItem('car_coords', JSON.stringify(carCoords));
      drawCarMarker();
      alert("Posizione auto salvata!");
    } else alert("Segnale GPS non disponibile.");
  };

  document.getElementById('clear-car-btn').onclick = () => {
    if (confirm("Rimuovere la posizione salvata dell'auto?")) {
      carCoords = null;
      localStorage.removeItem('car_coords');
      if (carMarker && map) map.removeLayer(carMarker);
      document.getElementById('car-distance').innerText = '-- m';
      document.getElementById('car-bearing').innerText = '--°';
    }
  };

  // Form Cane
  document.getElementById('dog-form').onsubmit = function(e) {
    e.preventDefault();
    const name = document.getElementById('dog-name').value.trim();
    const breed = document.getElementById('dog-breed').value.trim() || 'Meticcio';
    const chip = document.getElementById('dog-chip').value.trim();

    if (!name) return;

    dogs.push({ id: Date.now(), name, breed, chip });
    localStorage.setItem('tartufo_dogs', JSON.stringify(dogs));

    this.reset();
    renderDogs();
    populateDogSelect();
    alert(`Cane ${name} salvato!`);
  };

  // Form Clienti
  document.getElementById('client-form').onsubmit = function(e) {
    e.preventDefault();
    const name = document.getElementById('client-name').value.trim();
    const taxid = document.getElementById('client-taxid').value.trim();
    const phone = document.getElementById('client-phone').value.trim();

    if (!name) return;

    clients.push({ id: Date.now(), name, taxid, phone });
    localStorage.setItem('tartufo_clients', JSON.stringify(clients));

    this.reset();
    renderClients();
    populateReceiptClientSelect();
    alert(`Cliente ${name} salvato!`);
  };

  // Form Ritrovamento
  document.getElementById('finding-form').onsubmit = async function(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-finding-btn');
    saveBtn.disabled = true;

    try {
      const type = document.getElementById('tartufo-type').value;
      const weight = parseFloat(document.getElementById('tartufo-weight').value);
      const dog = document.getElementById('dog-select').value;
      const photoInput = document.getElementById('tartufo-photo');

      let photoBase64 = '';
      if (photoInput.files && photoInput.files[0]) {
        photoBase64 = await compressImage(photoInput.files[0]);
      }

      const newFinding = {
        id: Date.now(),
        date: new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        type, weight, dog,
        photo: photoBase64,
        coords: currentCoords ? { lat: currentCoords.lat, lng: currentCoords.lng } : null
      };

      findings.unshift(newFinding);
      localStorage.setItem('tartufo_findings', JSON.stringify(findings));

      this.reset();
      renderFindings();
      renderDogs();
      populateReceiptFindingSelect();
      addFindingMarkersToMap();
      alert('Ritrovamento salvato!');
    } catch (err) {
      alert("Errore durante il salvataggio.");
    } finally {
      saveBtn.disabled = false;
    }
  };

  // Eventi Ricevute
  document.getElementById('receipt-client-select').onchange = autoFillReceiptClient;
  document.getElementById('receipt-finding-select').onchange = autoFillReceiptFromFinding;
  document.getElementById('receipt-weight').oninput = calculateReceiptTotal;
  document.getElementById('receipt-price-per-g').oninput = calculateReceiptTotal;
  document.getElementById('generate-receipt-btn').onclick = generateReceiptPDF;

  document.getElementById('tax-toggle-btn').onclick = toggleTaxStatus;
  document.getElementById('export-btn').onclick = exportDataBackup;
  document.getElementById('import-backup-file').onchange = importDataBackup;
}

// --- RENDER Dati ---
function updateTaxUI() {
  const btn = document.getElementById('tax-toggle-btn');
  if (!btn) return;
  if (isTaxPaid) {
    btn.innerText = "PAGATO (100 €)";
    btn.className = "btn btn-success";
  } else {
    btn.innerText = "NON PAGATO";
    btn.className = "btn btn-danger";
  }
}

function toggleTaxStatus() {
  isTaxPaid = !isTaxPaid;
  localStorage.setItem('tax_paid', JSON.stringify(isTaxPaid));
  updateTaxUI();
}

function populateDogSelect() {
  const select = document.getElementById('dog-select');
  if (!select) return;
  select.innerHTML = '<option value="Nessun cane">Raccolta manuale / Nessuno</option>';
  dogs.forEach(d => {
    select.innerHTML += `<option value="${d.name}">${d.name} (${d.breed})</option>`;
  });
}

function renderDogs() {
  const container = document.getElementById('dogs-list');
  if (!container) return;
  container.innerHTML = dogs.length === 0 ? '<p class="sub-text text-center">Nessun cane inserito.</p>' : '';

  dogs.forEach(dog => {
    const dogFindings = findings.filter(f => f.dog === dog.name);
    const totalGrams = dogFindings.reduce((acc, f) => acc + (parseFloat(f.weight) || 0), 0);

    const div = document.createElement('div');
    div.className = 'card-box';
    div.innerHTML = `
      <div class="dog-card-header">
        <strong>🐶 ${dog.name}</strong>
        <button class="delete-btn" onclick="deleteDog(${dog.id})">🗑️</button>
      </div>
      <p class="sub-text">Razza: ${dog.breed} ${dog.chip ? `| Chip: ${dog.chip}` : ''}</p>
      <div class="dog-stats">
        <div class="stat-box"><div class="stat-val">${totalGrams.toFixed(1)} g</div><div class="stat-lbl">Raccolti</div></div>
        <div class="stat-box"><div class="stat-val">${dogFindings.length}</div><div class="stat-lbl">Trovate</div></div>
      </div>
    `;
    container.appendChild(div);
  });
}

function deleteDog(id) {
  if (confirm("Eliminare questo cane?")) {
    dogs = dogs.filter(d => d.id !== id);
    localStorage.setItem('tartufo_dogs', JSON.stringify(dogs));
    renderDogs();
    populateDogSelect();
  }
}

function renderClients() {
  const container = document.getElementById('clients-list');
  if (!container) return;
  container.innerHTML = clients.length === 0 ? '<p class="sub-text text-center">Nessun cliente registrato.</p>' : '';

  clients.forEach(c => {
    const div = document.createElement('div');
    div.className = 'finding-item';
    div.innerHTML = `
      <div class="finding-thumb-placeholder">👤</div>
      <div class="finding-details">
        <div class="finding-title">${c.name}</div>
        ${c.taxid ? `<div class="finding-meta">📄 P.IVA/CF: ${c.taxid}</div>` : ''}
        ${c.phone ? `<div class="finding-meta">📞 Tel: ${c.phone}</div>` : ''}
      </div>
      <button class="delete-btn" onclick="deleteClient(${c.id})">🗑️</button>
    `;
    container.appendChild(div);
  });
}

function deleteClient(id) {
  if (confirm("Eliminare il cliente?")) {
    clients = clients.filter(c => c.id !== id);
    localStorage.setItem('tartufo_clients', JSON.stringify(clients));
    renderClients();
    populateReceiptClientSelect();
  }
}

function renderFindings() {
  const container = document.getElementById('findings-list');
  if (!container) return;
  container.innerHTML = findings.length === 0 ? '<p class="sub-text text-center">Nessun ritrovamento in memoria.</p>' : '';

  findings.forEach(item => {
    const div = document.createElement('div');
    div.className = 'finding-item';
    
    const thumbHtml = item.photo 
      ? `<img src="${item.photo}" class="finding-thumb" alt="Foto">`
      : `<div class="finding-thumb-placeholder">🍄</div>`;

    div.innerHTML = `
      ${thumbHtml}
      <div class="finding-details">
        <div class="finding-title">${item.type} (${item.weight}g)</div>
        <div class="finding-meta">🐶 Cane: ${item.dog}</div>
        <div class="finding-meta">📅 ${item.date}</div>
      </div>
      <button class="delete-btn" onclick="deleteFinding(${item.id})">🗑️</button>
    `;
    container.appendChild(div);
  });
}

function deleteFinding(id) {
  if (confirm("Eliminare questo ritrovamento?")) {
    findings = findings.filter(f => f.id !== id);
    localStorage.setItem('tartufo_findings', JSON.stringify(findings));
    renderFindings();
    renderDogs();
    populateReceiptFindingSelect();
    addFindingMarkersToMap();
  }
}

function addFindingMarkersToMap() {
  if (!map) return;
  findingMarkers.forEach(m => map.removeLayer(m));
  findingMarkers = [];

  findings.forEach(item => {
    if (item.coords) {
      const marker = L.marker([item.coords.lat, item.coords.lng]).addTo(map).bindPopup(`
        <strong>🍄 ${item.type}</strong><br>Peso: ${item.weight}g<br>Data: ${item.date}
      `);
      findingMarkers.push(marker);
    }
  });
}

// --- RICEVUTE ---
function populateReceiptFindingSelect() {
  const select = document.getElementById('receipt-finding-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Inserimento Manuale --</option>';
  findings.forEach(f => {
    select.innerHTML += `<option value="${f.id}">${f.date} - ${f.type} (${f.weight}g)</option>`;
  });
}

function populateReceiptClientSelect() {
  const select = document.getElementById('receipt-client-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Inserimento Manuale --</option>';
  clients.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

function autoFillReceiptClient() {
  const val = document.getElementById('receipt-client-select').value;
  const client = clients.find(c => c.id == val);
  document.getElementById('buyer-name').value = client ? client.name : '';
  document.getElementById('buyer-taxid').value = client ? (client.taxid || '') : '';
}

function autoFillReceiptFromFinding() {
  const val = document.getElementById('receipt-finding-select').value;
  const finding = findings.find(f => f.id == val);
  if (finding) {
    document.getElementById('receipt-desc').value = finding.type;
    document.getElementById('receipt-weight').value = finding.weight;
    calculateReceiptTotal();
  }
}

function calculateReceiptTotal() {
  const w = parseFloat(document.getElementById('receipt-weight').value) || 0;
  const p = parseFloat(document.getElementById('receipt-price-per-g').value) || 0;
  const total = (w * p).toFixed(2);
  document.getElementById('receipt-total').value = `${total} €`;
  return total;
}

function generateReceiptPDF() {
  const seller = document.getElementById('seller-name').value.trim();
  const sellerCf = document.getElementById('seller-cf').value.trim();
  const buyer = document.getElementById('buyer-name').value.trim();
  const buyerTaxId = document.getElementById('buyer-taxid').value.trim();
  const desc = document.getElementById('receipt-desc').value.trim();
  const weight = document.getElementById('receipt-weight').value;
  const priceG = document.getElementById('receipt-price-per-g').value;
  const total = calculateReceiptTotal();

  if (!seller || !buyer || !desc || !weight || !priceG) {
    alert("Compila tutti i campi obbligatori prima di generare la ricevuta.");
    return;
  }

  document.getElementById('p-date').innerText = new Date().toLocaleDateString('it-IT');
  document.getElementById('p-number').innerText = `${Date.now().toString().slice(-6)}`;
  document.getElementById('p-seller').innerText = seller;
  document.getElementById('p-seller-cf').innerText = sellerCf || 'N/D';
  document.getElementById('p-buyer').innerText = buyer;
  document.getElementById('p-buyer-taxid').innerText = buyerTaxId || 'N/D';
  document.getElementById('p-desc').innerText = desc;
  document.getElementById('p-weight').innerText = weight;
  document.getElementById('p-price-g').innerText = priceG;
  document.getElementById('p-total').innerText = total;

  document.getElementById('receipt-preview-card').style.display = 'block';

  localStorage.setItem('seller_name', seller);
  localStorage.setItem('seller_cf', sellerCf);

  window.print();
}

function loadSavedSellerData() {
  document.getElementById('seller-name').value = localStorage.getItem('seller_name') || '';
  document.getElementById('seller-cf').value = localStorage.getItem('seller_cf') || '';
}

// --- FOTO COMPRESSIONE & BACKUP ---
function compressImage(file) {
  return new Promise((resolve) => {
    const 