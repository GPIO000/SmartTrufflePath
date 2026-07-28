// Inizializzazione della mappa
const map = L.map('map', {
    zoomControl: false
}).setView([41.8719, 12.5674], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

let userMarker = null;

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
            } else {
                userMarker.setLatLng([lat, lng]);
            }
        },
        (error) => {
            console.warn("Errore GPS: " + error.message);
            const dot = document.getElementById('gps-status-dot');
            if (dot) dot.style.backgroundColor = '#ef4444';
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
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

// Pulsante Ritorno all'Auto
function returnToCar() {
    if (userMarker) {
        map.setView(userMarker.getLatLng(), 18);
    } else {
        alert("Segnale GPS non ancora disponibile.");
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
            contentHTML = `
                <h2>Libretto Sanitario & Vaccini</h2>
                <div class="module-card">
                    <p>Gestione profilassi sanitaria e antiparassitari.</p>
                    <label>Ultimo Antiparassitario (Data):</label>
                    <input type="date" id="v- antiparassitario" class="mod-input">
                    <label>Prossimo Vaccino (Scadenza):</label>
                    <input type="date" id="v-vaccino" class="mod-input">
                    <button class="overlay-btn" style="margin-top:15px; width:100%;" onclick="alert('Dati sanitari salvati!')">Salva Scadenze</button>
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
