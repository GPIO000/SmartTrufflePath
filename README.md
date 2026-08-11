# 🍄 Truffle Mobil First

**Truffle Mobil First** è un'applicazione web mobile-first avanzata, progettata specificamente per i cercatori di tartufi. Combina una mappa interattiva offline-first con strumenti di geolocalizzazione, gestione delle tartufaie, utilità per i cani da tartufo e moduli per la conformità burocratica e fiscale italiana (Legge 145/2018 e normative correlate)[span_0](start_span)[span_0](end_span)[span_1](start_span)[span_1](end_span).

---

## ✨ Caratteristiche Principali

* **Mappa Interattiva & GPS in Tempo Reale**: Sviluppata con *Leaflet.js*, traccia la posizione dell'utente, gestisce i marker delle tartufaie e salva la posizione del veicolo.
* **Bussola e Indicazione Direzionale Dinamica**: Calcola in tempo reale la distanza e l'orientamento (freccia e direzione cardinale) per tornare all'auto o raggiungere un punto di interesse salvato.
* **Gestione Punti di Interesse (POI / Tartufaie)**: Salvataggio rapido di coordinate con note personalizzate, data, opzioni di condivisione rapida (WhatsApp/Native Share) ed eliminazione.
* **Tesserino Digitale & PagoPA**: Anagrafica del cercatore e gestione della quietanza di pagamento regionale con generazione automatica di un **QR Code** dedicato per i controlli delle autorità forestali.
* **Fiscale & Vendita Occasionale**: 
  * Generatore di ricevute di vendita conformi (Reg. CE 178/02 & DPR 633/1972) con supporto alla stampa e salvataggio in PDF.
  * Gestione dell'imposta sostitutiva F24 ELIDE (Codice Tributo 1853 - Legge 145/2018).
  * Contabilità e bilancio annuo con esportazione dei dati in formato **CSV** per il commercialista.
* **Gestione Cani & Salute**: Profilo del cane da tartufo (con numero di microchip), diario di ricerca e libretto sanitario digitale (scadenze vaccini e antiparassitari).
* **Sicurezza & Emergenze**: 
  * Pulsante **SOS** rapido per l'invio immediato di SMS con le coordinate GPS correnti.
  * Sezione di pronto soccorso cinofilo H24 (esche avvelenate/vipere) e numeri utili (112, CNSAS, Forestali).
* **Backup & Ripristino**: Esportazione/importazione backup JSON, backup automatico locale in uscita dall'app e salvataggio periodico senza API cloud.
* **Architettura PWA (Progressive Web App)**: Funzionamento *Offline-First* con Service Worker e persistenza dati su `IndexedDB` (sincronizzata con storage locale runtime).

---

## 🛠️ Stack Tecnologico

* **Frontend**: HTML5, CSS3 (Layout No-Scroll responsive)
* **Librerie & Mapping**: 
  * [Leaflet.js](https://leafletjs.com/) (Mappe interattive OpenStreetMap)
* **Storage & Offline**: `IndexedDB`, local storage runtime e Service Worker API

---

## 📁 Struttura del Progetto

> Nota: il bootstrap applicativo ora usa `js/app.js` come modulo ES e `js/storage-sync.js` per l'inizializzazione dello storage offline-first.


```text
├── index.html          # Struttura principale dell'app e interfaccia UI
├── css/
│   └── style.css       # Foglio di stile (UI scura, drawer, modali e overlay)
├── js/
│   └── app.js          # Logica di geolocalizzazione, mappa, moduli e salvataggio dati
├── manifest.json       # Manifest della PWA
└── sw.js               # Service Worker per la gestione della cache e offline-first
