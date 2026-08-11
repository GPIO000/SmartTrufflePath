# 🍄 SmartTruffle Path

SmartTruffle Path è una web app **mobile-first e PWA** per supportare il tartufaio durante raccolta, gestione documenti e contabilità, con dati salvati in locale (offline-first).

## Funzioni effettive dell'app

- **Mappa GPS con Leaflet**
  - Posizione utente in tempo reale
  - Salvataggio posizione auto
  - Salvataggio punti tartufaia (POI) con note
  - Navigazione verso auto o POI con bussola direzionale e distanza
  - Condivisione POI (share nativo/WhatsApp)
  - SOS rapido via SMS con coordinate

- **Documenti tartufaio**
  - Dati personali e tesserino (con allegato immagine/PDF)
  - Ricevuta PagoPA (con allegato)
  - F24 ELIDE (con allegato)

- **Vendita occasionale e fiscale**
  - Creazione ricevute di vendita
  - Calcolo importo, ritenuta e netto
  - Archivio ricevute con visualizzazione, modifica, eliminazione e condivisione
  - Rubrica clienti con storico acquisti e note

- **Registro attività**
  - Registro giornaliero ritrovamenti (specie, peso, note)
  - Filtri per anno e specie
  - Archivio date di raccolta per regione (personalizzabile)
  - Calendario raccolta basato su regione rilevata e periodi salvati

- **Cani e sicurezza**
  - Anagrafica cani (incluso microchip)
  - Libretti sanitari e storico trattamenti
  - Diario calore per femmine
  - Gestione polizze assicurative
  - Rubrica cliniche veterinarie H24 con invio posizione
  - Chiamata rapida al 112

- **Spese e bilancio**
  - Gestione spese per categoria
  - Bilancio annuo con separazione regimi fiscali
  - Monitoraggio soglia annuale di occasionalità

- **Backup, export e offline**
  - Export contabilità in CSV
  - Backup completo JSON (manuale)
  - Backup automatico locale
  - Import backup JSON e ripristino
  - Service Worker con cache offline
  - Sincronizzazione `localStorage` ↔ `IndexedDB`

## Stack

- HTML, CSS, JavaScript (ES Modules)
- [Leaflet](https://leafletjs.com/) + OpenStreetMap
- IndexedDB + localStorage
- Service Worker (PWA)
- Vite, ESLint, Vitest

## Avvio progetto

```bash
npm install
npm run dev
```

## Script disponibili

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test
```

## Privacy

L'app non usa backend proprietari: i dati restano sul dispositivo dell'utente.
