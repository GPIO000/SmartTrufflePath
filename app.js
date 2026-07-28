document.addEventListener('DOMContentLoaded', () => {
    // 1. Inizializzazione della Mappa GPS sulla Dashboard
    // Coordinate centrali di esempio (Appennino / Zona Tartufigena)
    const defaultLat = 44.4949;
    const defaultLng = 11.3426;

    const map = L.map('map', {
        zoomControl: false // Rimosso zoom standard per pulizia mobile
    }).setView([defaultLat, defaultLng], 15);

    // Layer cartografico (utilizzabile anche offline se memorizzato nella cache del service worker)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Geolocalizzazione utente in tempo reale
    if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 16);
            
            // Aggiunta marcatore posizione attuale
            L.marker([lat, lng]).addTo(map)
                .bindPopup("Sei qui").openPopup();
        }, (error) => {
            console.warn("GPS non disponibile o permessi negati: ", error.message);
        }, {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000
        });
    }

    // 2. Gestione Apertura/Chiusura Menu Drawer
    const menuBtn = document.getElementById('menu-btn');
    const closeDrawerBtn = document.getElementById('close-drawer');
    const drawer = document.getElementById('drawer-menu');

    menuBtn.addEventListener('click', () => {
        drawer.classList.remove('hidden');
    });

    closeDrawerBtn.addEventListener('click', () => {
        drawer.classList.add('hidden');
    });

    // Chiusura automatica del drawer se si clicca fuori o su una voce
    drawer.querySelectorAll('li').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetModule = e.target.getAttribute('data-target');
            alert(`Apertura modulo: ${targetModule.toUpperCase()} (Funzionalità in sviluppo)`);
            drawer.classList.add('hidden');
        });
    });

    // 3. Pulsanti HUD Rapidi
    document.getElementById('btn-car').addEventListener('click', () => {
        alert("Funzione 'Ritorno all'Auto': Tracciamento inverso attivato.");
    });

    document.getElementById('btn-find').addEventListener('click', () => {
        alert("Aggiornamento coordinate GPS di campo in corso...");
    });

    // 4. Pulsante SOS d'Emergenza
    document.getElementById('sos-btn').addEventListener('click', () => {
        if (confirm("ATTENZIONE: Stai per attivare il protocollo di emergenza SOS con invio coordinate e numeri di soccorso. Continuare?")) {
            alert("Segnale SOS inviato! (Simulazione chiamata rapida CNSAS / 112)");
        }
    });
});
