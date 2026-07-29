# 🍄 Truffle Mobil Frist

**Truffle Mobil Frist** è un'applicazione web mobile-first avanzata, progettata specificamente per i cercatori di tartufi. Combina una mappa interattiva offline-first con strumenti di geolocalizzazione, gestione delle tartufaie, utilità per i cani da tartufo e moduli per la conformità burocratica e fiscale italiana (Legge 145/2018 e normative correlate)[span_5](start_span)[span_5](end_span)[span_6](start_span)[span_6](end_span).

---

## ✨ Caratteristiche Principali

* **Mappa Interattiva & GPS in Tempo Reale**: Sviluppata con *Leaflet.js*, traccia la posizione dell'utente, gestisce i marker delle tartufaie e salva la posizione del veicolo[span_7](start_span)[span_7](end_span).
* **Bussola e Indicazione Direzionale Dinamica**: Calcola in tempo reale la distanza e l'orientamento (freccia e direzione cardinale) per tornare all'auto o raggiungere un punto di interesse salvato[span_8](start_span)[span_8](end_span).
* **Gestione Punti di Interesse (POI / Tartufaie)**: Salvataggio rapido di coordinate con note personalizzate, data, opzioni di condivisione rapida (WhatsApp/Native Share) ed eliminazione[span_9](start_span)[span_9](end_span).
* **Tesserino Digitale & PagoPA**: Anagrafica del cercatore e gestione della quietanza di pagamento regionale con generazione automatica di un **QR Code** dedicato per i controlli delle autorità forestali[span_10](start_span)[span_10](end_span)[span_11](start_span)[span_11](end_span).
* **Fiscale & Vendita Occasionale**: 
  * Generatore di ricevute di vendita conformi (Reg. CE 178/02 & DPR 633/1972) con supporto alla stampa e salvataggio in PDF[span_12](start_span)[span_12](end_span).
  * Gestione dell'imposta sostitutiva F24 ELIDE (Codice Tributo 1853 - Legge 145/2018)[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span).
  * Contabilità e bilancio annuo con esportazione dei dati in formato **CSV** per il commercialista[span_15](start_span)[span_15](end_span).
* **Gestione Cani & Salute**: Profilo del cane da tartufo (con numero di microchip), diario di ricerca e libretto sanitario digitale (scadenze vaccini e antiparassitari)[span_16](start_span)[span_16](end_span)[span_17](start_span)[span_17](end_span).
* **Sicurezza & Emergenze**: 
  * Pulsante **SOS** rapido per l'invio immediato di SMS con le coordinate GPS correnti[span_18](start_span)[span_18](end_span).
  * Sezione di pronto soccorso cinofilo H24 (esche avvelenate/vipere) e numeri utili (112, CNSAS, Forestali)[span_19](start_span)[span_19](end_span)[span_20](start_span)[span_20](end_span).
* **Backup & Ripristino**: Possibilità di esportare ed importare l'intero database dell'applicazione tramite file **JSON**[span_21](start_span)[span_21](end_span).
* **Architettura PWA (Progressive Web App)**: Funzionamento garantito *Offline-First* grazie all'uso di un Service Worker dedicato e memorizzazione dei dati tramite `localStorage`[span_22](start_span)[span_22](end_span)[span_23](start_span)[span_23](end_span)[span_24](start_span)[span_24](end_span).

---

## 🛠️ Stack Tecnologico

* **Frontend**: HTML5, CSS3 (Layout No-Scroll responsive)[span_25](start_span)[span_25](end_span)[span_26](start_span)[span_26](end_span)
* **Librerie & Mapping**: 
  * [Leaflet.js](https://leafletjs.com/) (Mappe interattive OpenStreetMap)[span_27](start_span)[span_27](end_span)[span_28](start_span)[span_28](end_span)
  * [QRCode.js](https://davidshimjs.github.io/qrcodejs/) (Generazione QR Code per quietanze)[span_29](start_span)[span_29](end_span)
* **Storage & Offline**: HTML5 `localStorage` & Service Worker API[span_30](start_span)[span_30](end_span)[span_31](start_span)[span_31](end_span)

---

## 📁 Struttura del Progetto

```text
├── index.html          # Struttura principale dell'app e interfaccia UI
├── css/
│   └── style.css       # Foglio di stile (UI scura, drawer, modali e overlay)[span_32](start_span)[span_32](end_span)
├── js/
│   └── app.js          # Logica di geolocalizzazione, mappa, moduli e salvataggio dati[span_33](start_span)[span_33](end_span)
├── manifest.json       # Manifest della PWA[span_34](start_span)[span_34](end_span)
└── sw.js               # Service Worker per la gestione della cache e offline-first[span_35](start_span)[span_35](end_span)
