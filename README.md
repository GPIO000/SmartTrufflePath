# 🍄 SmartTruffle Path

**SmartTruffle Path** è un'applicazione web mobile-first avanzata, progettata specificamente per i cercatori di tartufi. Combina una mappa interattiva offline-first con strumenti di geolocalizzazione, gestione delle tartufaie, utilità per i cani da tartufo e moduli per la conformità burocratica e fiscale italiana (Legge 145/2018 e normative correlate)[span_0](start_span)[span_0](end_span)[span_1](start_span)[span_1](end_span).

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
* **Gestione Cani & Salute**: Anagrafica cani da tartufo (con numero di microchip), diario di ricerca e libretti sanitari cani digitali (scadenze vaccini e antiparassitari).
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

## 🔄 Come Funziona lo Storage Offline-First

Il modulo `js/storage-sync.js` è il cuore della persistenza dati dell'applicazione. Di seguito una descrizione del suo funzionamento passo per passo:

### 1. Inizializzazione (`init`)
All'avvio dell'app, `init()` apre (o crea) un database **IndexedDB** chiamato `truffle-storage-db` con un unico object store a chiave-valore (`kv`). Poi:
- Se il database contiene già dati (sessioni precedenti), li **idratta nel `localStorage`** sovrascrivendo i valori presenti in memoria → `hydrateLocalStorageFromDb()`.
- Se invece il database è vuoto (prima installazione), copia **tutti i dati già presenti nel `localStorage` verso IndexedDB** → `migrateLocalStorageToDb()`.

### 2. Patch del `localStorage` (`patchLocalStorage`)
Dopo l'inizializzazione, i metodi `setItem`, `removeItem` e `clear` del `localStorage` vengono **sostituiti con versioni sincronizzate**:
- Ogni scrittura aggiorna sia il `localStorage` (sincrono, per compatibilità con il codice esistente) sia IndexedDB (asincrono, per la persistenza duratura).
- Questo approccio è trasparente: il resto dell'applicazione continua a usare `localStorage` normalmente senza modifiche.

### 3. Backup Automatico Locale (`saveAutomaticBackupSnapshot`)
Quando l'utente esce dall'app (evento `beforeunload` / `pagehide`), viene creato uno **snapshot completo dei dati**:
```json
{
  "schemaVersion": 1,
  "savedAt": "2025-...",
  "reason": "app-exit",
  "data": { /* tutti i dati dell'utente */ }
}
```
Lo snapshot viene salvato sia in `localStorage` (chiave `local_auto_backup_snapshot`) sia in IndexedDB per la massima ridondanza. Un secondo record (`local_auto_backup_status`) tiene traccia dell'esito dell'operazione (ok/errore, timestamp).

### 4. Ripristino
Al successivo avvio, l'app può leggere lo snapshot tramite `getLatestAutomaticBackupSnapshot()` e proporre il ripristino dei dati all'utente, garantendo che nessun dato venga perso anche in caso di chiusura improvvisa del browser.

> **Nessun cloud, nessun server**: tutti i dati restano esclusivamente sul dispositivo dell'utente.

---

## 📁 Struttura del Progetto

> Nota: il bootstrap applicativo ora usa `js/app.js` come modulo ES e `js/storage-sync.js` per l'inizializzazione dello storage offline-first.


```text
├── index.html              # Struttura principale dell'app e interfaccia UI
├── css/
│   └── style.css           # Foglio di stile (UI scura, drawer, modali e overlay)
├── js/
│   ├── app.js              # Logica di geolocalizzazione, mappa, moduli e salvataggio dati
│   ├── storage-sync.js     # Sincronizzazione localStorage ↔ IndexedDB e backup automatico
│   └── fiscal-utils.js     # Utilità per calcoli fiscali (F24 ELIDE, ricevute, CSV)
├── manifest.json           # Manifest della PWA
└── sw.js                   # Service Worker per la gestione della cache e offline-first
