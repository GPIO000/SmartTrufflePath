// --- REGISTRAZIONE SERVICE WORKER (Per funzionamento Offline) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrato con successo:', reg.scope))
      .catch(err => console.error('Errore registrazione Service Worker:', err));
  });
}

// --- GENERAZIONE DINAMICA ICONA TRUFFLEGO PER HOME & FAVICON ---
function generateAppIcons() {
  const svgIcon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><rect width='512' height='512' rx='100' fill='%232b4c2b'/><text x='50%' y='68%' font-size='320' text-anchor='middle'>🍄</text></svg>`;
  const iconDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgIcon)}`;
  
  const appleIcon = document.getElementById('apple-touch-icon');
  const favicon = document.getElementById('favicon');
  if(appleIcon) appleIcon.href = iconDataUrl;
  if(favicon) favicon.href = iconDataUrl;
}
generateAppIcons();

// --- MONITORAGGIO STATO RETE (ONLINE / OFFLINE) ---
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
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// --- SIDEBAR E NAVIGAZIONE ---
const menuBtn = document.getElementById('menu-btn');
const closeSidebar = document.getElementById('close-sidebar');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');

function toggleSidebar() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}

menuBtn.addEventListener('click', toggleSidebar);
closeSidebar.addEventListener('click', toggleSidebar);
overlay.addEventListener('click', toggleSidebar);

function showSection(sectionId) {
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  
  const targetSection = document.getElementById(sectionId);
  if (targetSection) targetSection.classList.add('active');
  
  toggleSidebar();
  
  if (sectionId === 'map-section' && map) {
    setTimeout(() => map.invalidateSize(), 200);
  }
}

// --- MAPPA E GPS ---
let map, userMarker, carMarker;
let carCoords = JSON.parse(localStorage.getItem('car_coords')) || null;
let currentCoords = null;
let deviceHeading = 0;

function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  map = L.map('map').setView([41.9028, 12.4964], 13);

  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap'
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
    }, err => console.warn("GPS non disponibile:", err), { 
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  }

  if (carCoords) drawCarMarker();
  addFindingMarkersToMap();
}

window.addEventListener('deviceorientationabsolute', handleOrientation, true) ||
window.addEventListener('deviceorientation', handleOrientation, true);

function handleOrientation(event) {
  if (event.webkitCompassHeading) {
    deviceHeading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    deviceHeading = 360 - event.alpha;
  }
  updateCompass();
}

document.getElementById('recenter-btn').addEventListener('click', () => {
  if (currentCoords && map) {
    map.setView([currentCoords.lat, currentCoords.lng], 17);
  } else {
    alert("Segnale GPS non ancora disponibile.");
  }
});

document.getElementById('save-car-btn').addEventListener('click', () => {
  if (currentCoords) {
    carCoords = currentCoords;
    localStorage.setItem('car_coords', JSON.stringify(carCoords));
    drawCarMarker();
    alert("Posizione auto salvata!");
  } else {
    alert("Segnale GPS non ancora disponibile.");
  }
});

document.getElementById('clear-car-btn').addEventListener('click', () => {
  if (confirm("Vuoi rimuovere la posizione dell'auto?")) {
    carCoords = null;
    localStorage.removeItem('car_coords');
    if (carMarker) map.removeLayer(carMarker);
    document.getElementById('car-distance').innerText = '-- m';
    document.getElementById('car-bearing').innerText = '--°';
  }
});

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
  document.getElementById('car-distance').innerText = `${Math.round(dist)} m`;

  const bearing = getBearing(currentCoords.lat, currentCoords.lng, carCoords.lat, carCoords.lng);
  document.getElementById('car-bearing').innerText = `${Math.round(bearing)}°`;

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

// --- GESTIONE FISCO ---
let isTaxPaid = localStorage.getItem('tax_paid') === 'true';

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

// --- GESTIONE CANI ---
let dogs = JSON.parse(localStorage.getItem('tartufo_dogs')) || [
  { id: 1, name: 'Rex', breed: 'Lagotto Romagnolo', chip: '' }
];

document.getElementById('dog-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const name = document.getElementById('dog-name').value.trim();
  const breed = document.getElementById('dog-breed').value.trim() || 'Non specificata';
  const chip = document.getElementById('dog-chip').value.trim();

  if (!name) return;

  const newDog = { id: Date.now(), name: name, breed: breed, chip: chip };
  dogs.push(newDog);
  localStorage.setItem('tartufo_dogs', JSON.stringify(dogs));

  this.reset();
  renderDogs();
  populateDogSelect();
  alert(`Cane ${name} registrato!`);
});

function populateDogSelect() {
  const select = document.getElementById('dog-select');
  if (!select) return;

  select.innerHTML = '<option value="Nessun cane">Nessun cane / Raccolta manuale</option>';
  dogs.forEach(dog => {
    const opt = document.createElement('option');
    opt.value = dog.name;
    opt.innerText = `${dog.name} (${dog.breed})`;
    select.appendChild(opt);
  });
}

function renderDogs() {
  const container = document.getElementById('dogs-list');
  if (!container) return;
  container.innerHTML = '';

  if (dogs.length === 0) {
    container.innerHTML = '<p style="color: #777; text-align: center;">Nessun cane inserito.</p>';
    return;
  }

  dogs.forEach(dog => {
    const dogFindings = findings.filter(f => f.dog === dog.name);
    const totalGrams = dogFindings.reduce((acc, f) => acc + (parseFloat(f.weight) || 0), 0);
    const totalCount = dogFindings.length;

    const card = document.createElement('div');
    card.className = 'dog-card';
    card.innerHTML = `
      <div class="dog-card-header">
        <span class="dog-name">🐶 ${dog.name}</span>
        <button class="delete-btn" onclick="deleteDog(${dog.id})">🗑️</button>
      </div>
      <div class="dog-info">
        <strong>Razza:</strong> ${dog.breed} ${dog.chip ? `<br><strong>Microchip:</strong> ${dog.chip}` : ''}
      </div>
      <div class="dog-stats">
        <div class="stat-box">
          <div class="stat-val">${totalGrams.toFixed(1)} g</div>
          <div class="stat-lbl">Tartufi Trovati</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${totalCount}</div>
          <div class="stat-lbl">Ritrovamenti</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function deleteDog(id) {
  const dog = dogs.find(d => d.id === id);
  if (confirm(`Vuoi davvero eliminare ${dog ? dog.name : 'questo cane'}?`)) {
    dogs = dogs.filter(d => d.id !== id);
    localStorage.setItem('tartufo_dogs', JSON.stringify(dogs));
    renderDogs();
    populateDogSelect();
  }
}

// --- GESTIONE BANCA DATI CLIENTI ---
let clients = JSON.parse(localStorage.getItem('tartufo_clients')) || [];

document.getElementById('client-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const name = document.getElementById('client-name').value.trim();
  const taxid = document.getElementById('client-taxid').value.trim();
  const phone = document.getElementById('client-phone').value.trim();

  if (!name) return;

  const newClient = { id: Date.now(), name: name, taxid: taxid, phone: phone };
  clients.push(newClient);
  localStorage.setItem('tartufo_clients', JSON.stringify(clients));

  this.reset();
  renderClients();
  populateReceiptClientSelect();
  alert(`Cliente ${name} salvato in banca dati!`);
});

function renderClients() {
  const container = document.getElementById('clients-list');
  if (!container) return;
  container.innerHTML = '';

  if (clients.length === 0) {
    container.innerHTML = '<p style="color: #777; text-align: center;">Nessun cliente salvato in banca dati.</p>';
    return;
  }

  clients.forEach(c => {
    const div = document.createElement('div');
    div.className = 'finding-item';
    div.innerHTML = `
      <div style="font-size: 24px; padding-right: 10px;">👤</div>
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
  const client = clients.find(c => c.id === id);
  if (confirm(`Vuoi davvero eliminare ${client ? client.name : 'questo cliente'}?`)) {
    clients = clients.filter(c => c.id !== id);
    localStorage.setItem('tartufo_clients', JSON.stringify(clients));
    renderClients();
    populateReceiptClientSelect();
  }
}

// --- COMPRESSIONE FOTO ---
function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve('');
    };
    reader.onerror = () => resolve('');
  });
}

// --- RITROVAMENTI ---
let findings = JSON.parse(localStorage.getItem('tartufo_findings')) || [];

document.getElementById('finding-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('save-finding-btn');
  saveBtn.disabled = true;
  saveBtn.innerText = "Salvataggio in corso...";

  try {
    const type = document.getElementById('tartufo-type').value;
    const weight = parseFloat(document.getElementById('tartufo-weight').value);
    const dog = document.getElementById('dog-select').value;
    const photoInput = document.getElementById('tartufo-photo');

    let photoBase64 = '';
    if (photoInput.files && photoInput.files[0]) {
      photoBase64 = await compressImage(photoInput.files[0]);
    }

    const coords = currentCoords ? { lat: currentCoords.lat, lng: currentCoords.lng } : null;

    const newFinding = {
      id: Date.now(),
      date: new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      type: type,
      weight: weight,
      dog: dog,
      photo: photoBase64,
      coords: coords
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
    console.error(err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = "💾 Salva Ritrovamento (con GPS)";
  }
});

function renderFindings() {
  const container = document.getElementById('findings-list');
  if (!container) return;
  container.innerHTML = '';

  if (findings.length === 0) {
    container.innerHTML = '<p style="color: #777; text-align: center;">Nessun ritrovamento registrato.</p>';
    return;
  }

  findings.forEach(item => {
    const div = document.createElement('div');
    div.className = 'finding-item';
    
    const imgHtml = item.photo 
      ? `<img src="${item.photo}" class="finding-thumb" alt="Foto">`
      : `<div class="finding-thumb" style="display:flex;align-items:center;justify-content:center;font-size:24px;">🍄</div>`;

    div.innerHTML = `
      ${imgHtml}
      <div class="finding-details">
        <div class="finding-title">${item.type} (${item.weight}g)</div>
        <div class="finding-meta">🐶 Cane: ${item.dog}</div>
        <div class="finding-meta">📅 ${item.date}</div>
        ${item.coords ? '<div class="finding-meta">📍 GPS Registrato</div>' : ''}
      </div>
      <button class="delete-btn" onclick="deleteFinding(${item.id})">🗑️</button>
    `;

    container.appendChild(div);
  });
}

function deleteFinding(id) {
  if (confirm("Vuoi eliminare questo ritrovamento?")) {
    findings = findings.filter(f => f.id !== id);
    localStorage.setItem('tartufo_findings', JSON.stringify(findings));
    renderFindings();
    renderDogs();
    populateReceiptFindingSelect();
    addFindingMarkersToMap();
  }
}

let findingMarkers = [];
function addFindingMarkersToMap() {
  if (!map) return;
  findingMarkers.forEach(m => map.removeLayer(m));
  findingMarkers = [];

  findings.forEach(item => {
    if (item.coords) {
      const marker = L.marker([item.coords.lat, item.coords.lng]).addTo(map).bindPopup(`
        <strong>🍄 ${item.type}</strong><br>Peso: ${item.weight}g<br>Cane: ${item.dog}<br>Data: ${item.date}
      `);
      findingMarkers.push(marker);
    }
  });
}

// --- GENERATORE RICEVUTE NORMATIVA TARTUFI ---
function populateReceiptFindingSelect() {
  const select = document.getElementById('receipt-finding-select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Inserimento Manuale --</option>';
  findings.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.innerText = `${f.date} - ${f.type} (${f.weight}g)`;
    select.appendChild(opt);
  });
}

function populateReceiptClientSelect() {
  const select = document.getElementById('receipt-client-select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Inserimento Manuale --</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = `${c.name} ${c.taxid ? `(${c.taxid})` : ''}`;
    select.appendChild(opt);
  });
}

function autoFillReceiptClient() {
  const selectVal = document.getElementById('receipt-client-select').value;
  if (!selectVal) {
    document.getElementById('buyer-name').value = '';
    document.getElementById('buyer-taxid').value = '';
    return;
  }

  const selectedClient = clients.find(c => c.id == selectVal);
  if (selectedClient) {
    document.getElementById('buyer-name').value = selectedClient.name;
    document.getElementById('buyer-taxid').value = selectedClient.taxid || '';
  }
}

function autoFillReceiptFromFinding() {
  const selectVal = document.getElementById('receipt-finding-select').value;
  if (!selectVal) return;

  const selectedFinding = findings.find(f => f.id == selectVal);
  if (selectedFinding) {
    document.getElementById('receipt-desc').value = selectedFinding.type;
    document.getElementById('receipt-weight').value = selectedFinding.weight;
    calculateReceiptTotal();
  }
}

function calculateReceiptTotal() {
  const weight = parseFloat(document.getElementById('receipt-weight').value) || 0;
  const pricePerG = parseFloat(document.getElementById('receipt-price-per-g').value) || 0;
  const total = (weight * pricePerG).toFixed(2);

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
    alert("Compila tutti i campi prima di stampare la ricevuta.");
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
  document.getElementById('p-t