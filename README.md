# 🍄 SmartTruffle Path

SmartTruffle Path è una web app **mobile-first e PWA** per supportare il tartufaio durante raccolta, gestione documenti e contabilità, con dati salvati in locale (offline-first).

## Funzioni effettive dell'app

- **Mappa GPS con Leaflet**
  - Posizione utente in tempo reale
  - Salvataggio posizione auto
  - Salvataggio punti tartufaia (POI) con note
  - Navigazione verso auto o POI con distanza e direzione geografica calcolate via GPS
  - La navigazione non usa il magnetometro / la bussola hardware del telefono: aiuta a orientarsi confrontando mappa e spostamenti reali
  - Indicatore di connettività internet sull'indicatore di zoom: 📡 connesso, 📵 offline o rete tile non disponibile
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
  - Previsione uscita tartufi con indice euristico basato su meteo 15gg, fase lunare, umidità del suolo e storico locale

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
  - Backup automatico locale guidato in `Download/SmartTrufflePath/file backup`
  - Backup automatico avviabile anche manualmente dalla card dedicata
  - Service Worker con cache offline
  - Sincronizzazione `localStorage` ↔ `IndexedDB`

## Riferimento funzioni per modulo

### `js/fiscal-utils.js`
Utilità di calcolo fiscale per vendite occasionali.

| Funzione / Costante | Descrizione |
|---|---|
| `RITENUTA_ALIQUOTA` | Aliquota ritenuta d'acconto (0.23) |
| `RITENUTA_BASE_IMPONIBILE` | Percentuale base imponibile (0.78) |
| `SOGLIA_VENDITE_ANNUE` | Soglia annua vendite occasionali (7 000 €) |
| `calcolaImportoTotale(grammi, prezzoKg)` | Calcola l'importo lordo dalla quantità in grammi e dal prezzo al kg |
| `calcolaDettaglioRitenuta(importoTotale)` | Calcola imponibile, ritenuta e netto a partire dall'importo lordo |
| `parseDataItaliana(dataStringa)` | Converte una data in formato italiano (gg/mm/aaaa) in oggetto `Date` |
| `sommaVenditeAnno(storicoVendite, annoCorrente)` | Somma gli importi delle vendite per un anno specifico |
| `calcolaStatoSogliaVendite(storicoVendite, annoCorrente, nuovoImporto)` | Restituisce lo stato rispetto alla soglia annua, incluso margine residuo |
| `riepilogaAcquistiCliente(storicoVendite, nomeCliente)` | Aggrega gli acquisti di un singolo cliente dallo storico vendite |

---

### `js/poi-utils.js`
Utilità per la gestione dei punti di interesse (POI) sulla mappa.

| Funzione / Costante | Descrizione |
|---|---|
| `CUSTOM_POI_MARKERS` | Array di emoji disponibili come marker personalizzati |
| `DEFAULT_GENERIC_POI_MARKER` | Marker predefinito per POI generici |
| `DEFAULT_SHARED_POI_MARKER` | Marker per POI condivisi da altri utenti |
| `DEFAULT_MAP_LONG_PRESS_MOVE_TOLERANCE_PX` | Tolleranza in pixel per il long-press sulla mappa |
| `DEFAULT_MAP_LONG_PRESS_DUPLICATE_WINDOW_MS` | Finestra temporale (ms) per rilevare long-press duplicati |
| `DEFAULT_MAP_LONG_PRESS_DUPLICATE_COORD_TOLERANCE` | Tolleranza coordinata per long-press duplicati |
| `parseLegacyDateToTimestamp(dateText)` | Converte una data legacy testuale in timestamp ISO |
| `formatPoiDisplayDate(savedAtIso)` | Formatta la data di salvataggio per la visualizzazione |
| `normalizePoiAltitude(altitude)` | Normalizza il valore di quota di un POI |
| `formatPoiAltitude(altitude)` | Formatta la quota in stringa leggibile |
| `getDefaultMarkerForPoiType(type)` | Restituisce l'emoji marker predefinita per un tipo di POI |
| `normalizePoiMarker(marker, type)` | Normalizza il marker di un POI (fallback al default per tipo) |
| `buildGoogleMapsUrl(lat, lng)` | Costruisce l'URL di navigazione Google Maps |
| `buildAppleMapsUrl(lat, lng, label)` | Costruisce l'URL di navigazione Apple Maps |
| `buildMapsLinksText(lat, lng, label)` | Genera il testo con i link a entrambe le mappe |
| `buildSharedPoiMessage(poi, senderName)` | Crea il messaggio testuale per la condivisione di un POI |
| `buildEmergencyLocationMessage(title, lat, lng, senderName, label)` | Crea il messaggio SOS con coordinate |
| `normalizePoiList(rawPoiList)` | Normalizza e migra l'elenco POI da formato legacy |
| `resolvePoiCoords(forceLat, forceLng, userMarker)` | Risolve le coordinate finali di un POI (forzate o da marker utente) |
| `extractPointerClientPoint(event)` | Estrae le coordinate schermo da un evento pointer/touch/mouse |
| `shouldConfirmMapLongPressOnTimeout(event)` | Controlla se il long-press deve essere confermato al timeout |
| `toMapContainerPoint(clientPoint, containerRect)` | Converte coordinate schermo in coordinate relative al contenitore mappa |
| `hasMapLongPressExceededTolerance(startPoint, currentPoint, tolerancePx)` | Verifica se il movimento durante il long-press supera la tolleranza |
| `isDuplicateMapLongPress(lastHandled, latlng, now, duplicateWindowMs, coordTolerance)` | Rileva se un long-press è duplicato di uno recente |
| `extractCoordsFromSharedMessage(text)` | Estrae latitudine e longitudine da un testo condiviso |

---

### `js/poi-forecast.js`
Previsione e scoring dei POI basato sullo storico e sul calendario.

| Funzione / Costante | Descrizione |
|---|---|
| `POI_SCORE_MAX` | Punteggio massimo composito di un POI |
| `POI_SCORE_HIGH_THRESHOLD` | Soglia punteggio alto |
| `POI_SCORE_MID_THRESHOLD` | Soglia punteggio medio |
| `HARVEST_SPECIES_TO_ID` | Mappa nome specie → ID per lo storico raccolta |
| `normalizeLocationText(str)` | Normalizza il testo di una locazione (minuscolo, accenti, punteggiatura) |
| `poiMatchesLuogo(poiNote, luogo)` | Verifica se le note di un POI corrispondono a un luogo di raccolta |
| `cyclicMonthDistance(m1, m2)` | Calcola la distanza ciclica in mesi tra due mesi dell'anno |
| `computePoiHistoryScore(poiNote, harvestHistory, feedbackHistory, today)` | Calcola lo score basato sullo storico raccolte per un POI |
| `getSpeciesAtPoi(poiNote, harvestHistory)` | Restituisce le specie trovate in un POI |
| `computePoiSeasonScore(poiNote, harvestHistory, regionCalendar, today)` | Calcola lo score stagionale del POI rispetto al calendario regionale |
| `computePoiFreshnessScore(poiNote, harvestHistory, today)` | Calcola lo score di "freschezza" del POI (giorni dall'ultima visita) |
| `computePoiCompositeScore(poi, harvestHistory, feedbackHistory, regionCalendar, today)` | Calcola il punteggio composito finale di un POI |
| `buildPoiScoreList(poiList, harvestHistory, feedbackHistory, regionCalendar, today)` | Costruisce la lista POI ordinata per punteggio |
| `getScoreLevel(score)` | Restituisce il livello testuale corrispondente a un punteggio |
| `getScoreEmoji(score)` | Restituisce l'emoji corrispondente a un livello di punteggio |

---

### `js/truffle-forecast.js`
Previsione euristiche per la raccolta tartufi (meteo, luna, umidità, storico).

| Funzione / Costante | Descrizione |
|---|---|
| `TRUFFLE_SPECIES_FORECAST` | Array con profili di tutte le specie di tartufo supportate |
| `getFeedbackClassesForSpecies(speciesId)` | Restituisce le classi di feedback disponibili per una specie |
| `getOpenSpeciesForRegion(regionCalendar, date)` | Elenca le specie in stagione aperta per la regione e data correnti |
| `resolveFeedbackEntryClass(speciesId, feedbackEntry)` | Risolve la classe di feedback di una voce, gestendo il formato legacy |
| `getAreaProfiles()` | Restituisce i profili di area (altitudine) disponibili |
| `isDateWithinPeriod(periodStr, date)` | Verifica se una data cade all'interno di un periodo stagionale |
| `aggregateHourlyToDaily(hourly)` | Aggrega dati meteo orari in valori giornalieri |
| `fetchTruffleForecastDataset(lat, lng, options)` | Scarica e combina archivio meteo + previsioni per il calcolo euristico |
| `buildTruffleForecastCalendar(...)` | Costruisce il calendario previsionale per ogni specie a partire dal dataset |

---

### `js/weather-moon.js`
Widget meteo e fase lunare.

| Funzione / Costante | Descrizione |
|---|---|
| `calcMoonPhase(date)` | Calcola la fase lunare per una data |
| `updateWeatherMoon(lat, lng, label, force)` | Aggiorna il widget meteo+luna per la posizione corrente |
| `updateWeatherMoonComparison(currentLocation, destinationLocation)` | Aggiorna il widget di confronto meteo tra due locazioni |
| `refreshMoonOnly()` | Aggiorna solo la sezione fase lunare nel widget esistente |

---

### `js/storage-sync.js`
Sincronizzazione bidirezionale `localStorage` ↔ `IndexedDB` e snapshot backup.

| Funzione / Costante | Descrizione |
|---|---|
| `init()` | Inizializza la sincronizzazione: idrata `localStorage` da IndexedDB o migra in direzione opposta, poi applica il patch |
| `saveAutomaticBackupSnapshot(data, reason)` | Salva uno snapshot completo dei dati come backup automatico locale |
| `getLatestAutomaticBackupSnapshot()` | Legge lo snapshot di backup automatico da `localStorage` (sincrono) |
| `getLatestAutomaticBackupSnapshotAsync()` | Legge lo snapshot di backup automatico con fallback su IndexedDB (asincrono) |
| `getAutomaticBackupStatus()` | Restituisce lo stato dell'ultimo backup automatico |
| `setDataChangeListener(fn)` | Registra un callback invocato ad ogni modifica di `localStorage` |
| `notifyDataChange(key)` | Notifica manualmente una modifica per una chiave specifica |
| `saveDirectoryHandle(key, handle)` | Salva un `FileSystemDirectoryHandle` in IndexedDB |
| `loadDirectoryHandle(key)` | Carica un `FileSystemDirectoryHandle` da IndexedDB |
| `setItemSilent(key, value)` | Scrive un valore in `localStorage`+IndexedDB senza notificare il listener |
| `removeItemSilent(key)` | Rimuove un valore da `localStorage`+IndexedDB senza notificare il listener |

---

### `js/backup-utils.js`
Utilità per la costruzione e il ripristino dei backup.

| Funzione | Descrizione |
|---|---|
| `normalizeBackupEntry(entryValue, fallbackValue)` | Normalizza una singola voce di backup (parse JSON con fallback) |
| `buildAutomaticBackupPathLabel(rootFolderName)` | Genera l'etichetta del percorso di backup automatico |
| `extractValidBackupEntries(content, backupMap)` | Estrae le voci valide da un file di backup |
| `buildBackupRestorePlan(content, backupMap)` | Costruisce il piano di ripristino da un file di backup |

---

### `js/offline-cache-utils.js`
Utilità per la gestione della cache tile offline.

| Funzione | Descrizione |
|---|---|
| `normalizeTileUrls(tileUrls)` | Normalizza un array di URL tile in un `Set` |
| `countCachedTileUrls(cachedUrls, tileUrls)` | Conta quante tile richieste sono presenti in cache |
| `isOfflineRegionFullyCached(cachedUrls, tileUrls)` | Verifica se una regione è completamente in cache |
| `shouldRestoreOfflineMapCache(cachedUrls, preferredTileUrls)` | Determina se è necessario ripristinare la cache tile |
| `getMissingTileUrls(cachedUrls, tileUrls)` | Restituisce le tile mancanti dalla cache |
| `summarizeTileCoverage(cachedUrls, tileUrls)` | Restituisce un riepilogo percentuale della copertura cache |

---

### `js/offline-map-download-utils.js`
Download e recovery delle tile per le mappe offline.

| Funzione | Descrizione |
|---|---|
| `isOpenStreetMapTileUrl(url)` | Verifica se un URL appartiene a OpenStreetMap |
| `isQuotaExceededError(error)` | Verifica se un errore indica quota storage esaurita |
| `isOpaqueTileResponse(response)` | Verifica se la risposta è opaca (tipo `opaque`) |
| `isImageTileResponse(response)` | Verifica se la risposta è un'immagine tile |
| `hasValidTileLengthHeader(response, minValidSize)` | Verifica se l'header `Content-Length` indica una tile valida |
| `isValidTileResponse(response, minValidSize)` | Verifica se una risposta è una tile valida per il caching |
| `isValidCachedTileResponse(response, minValidSize)` | Verifica se una tile in cache è ancora valida |
| `isValidDownloadedTileResponse(response, minValidSize, options)` | Verifica se una tile appena scaricata è valida |
| `parseRetryAfterMs(rawRetryAfter, nowMs)` | Converte l'header `Retry-After` in millisecondi |
| `getRetryAfterMs(response, nowMs)` | Legge il delay di retry da una risposta HTTP |
| `isProviderThrottledResponse(response)` | Verifica se il provider ha risposto con throttling (429/503) |
| `buildTileDownloadFailureResult(options)` | Costruisce l'oggetto risultato di un fallimento di download tile |
| `mergeTileDownloadFailureResult(currentFailure, candidateFailure)` | Unisce due risultati di fallimento mantenendo il più grave |
| `sleep(ms, sleepImpl)` | Attende un numero di millisecondi |
| `getRetryDelay(attempt, baseRetryDelayMs, maxRetryDelayMs, options)` | Calcola il delay di retry con backoff esponenziale opzionale |
| `applyRetryDelayIfNeeded(attempt, resolvedMaxAttempts, options)` | Applica il delay di retry se non è l'ultimo tentativo |
| `summarizeTileDownloadResults(results)` | Riepiloga i risultati di un batch di download tile |
| `getAdaptiveBatchPauseMs(consecutiveProviderErrors, options)` | Calcola la pausa adattiva tra batch in base agli errori di throttling |
| `getProviderCooldownMs(consecutiveThrottledErrors, options)` | Calcola il cooldown in caso di throttling prolungato |
| `downloadTileBatchesWithRecovery(levels, options)` | Scarica tile a livelli con gestione retry, quota e recovery |
| `downloadTileWithRetry(cache, url, options)` | Scarica una singola tile con logica di retry |

---

### `js/sw-utils.js`
Utilità condivise con il Service Worker.

| Funzione | Descrizione |
|---|---|
| `canonicalizeOsmTileUrl(url)` | Normalizza un URL OSM con sottodominio nella forma canonica senza sottodominio |

---

### `js/cache-version.js`
Gestione versione cache PWA.

| Costante | Descrizione |
|---|---|
| `globalThis.SMARTTRUFFLE_CACHE_VERSION` | Stringa di versione della cache Service Worker (aggiornata ad ogni build) |

---

### `js/app.js`
Modulo principale dell'applicazione. Contiene la logica UI, la gestione della mappa, i moduli e tutte le funzioni di coordinamento.

<details>
<summary>Funzioni principali (clicca per espandere)</summary>

**Service Worker e aggiornamenti**
- `monitorInstallingServiceWorker(worker)` — monitora lo stato di un Service Worker in installazione
- `forceAppServiceWorkerUpdateCheck()` — forza il controllo aggiornamento SW
- `registerAppServiceWorker()` — registra il Service Worker dell'app

**Mappa e GPS**
- `isOfflineMapModeActive()` — verifica se la modalità mappa offline è attiva
- `getOfflinePreferences()` / `getOfflinePreferredMaxZoom()` / `getAdaptiveFocusZoom(defaultZoom)` — lettura preferenze offline
- `updateZoomIndicator()` — aggiorna l'indicatore di zoom/connettività
- `applyMapConnectivityZoomCap(options)` — limita lo zoom in base alla connettività
- `clampMapZoomForOffline()` — vincola lo zoom ai livelli cached offline
- `updateOfflineMapRuntimeStatusIndicator()` — aggiorna l'indicatore di stato mappa offline a runtime
- `renderAllPoiMarkers()` — renderizza tutti i marker POI sulla mappa
- `calculateDistanceAndBearing(lat1, lon1, lat2, lon2)` — calcola distanza e direzione tra due coordinate
- `updateCompass(currentLat, currentLng)` — aggiorna il compass di navigazione
- `saveCarPosition()` — salva la posizione auto
- `savePoiPosition(forceLat, forceLng)` — salva un POI con dialogo note e marker
- `navigateToPoi(index)` — avvia la navigazione verso un POI
- `stopNavigation()` — interrompe la navigazione attiva
- `sharePoi(index)` — condivide un POI via share nativo o WhatsApp
- `deletePoi(index)` / `editPoi(index)` / `savePoiEdit(index)` — CRUD POI
- `importSharedPoint()` — importa un POI da testo condiviso
- `triggerSOS()` — invia SMS SOS con coordinate correnti

**Geolocalizzazione inversa e quota**
- `fetchElevationFallback(lat, lng)` — ottiene la quota via API esterna
- `buildUserMarkerPopupHtml(altitude)` — costruisce l'HTML del popup utente
- `updateGpsStatusTextFromLocation(locationData, lat, lng)` — aggiorna il testo di stato GPS
- `reverseGeocodePosition(lat, lng)` — geocodifica inversa con cache e fallback
- `resolveRegionNameForCoordinates(lat, lng, fallbackRegion)` — risolve il nome della regione da coordinate
- `fetchLocationDataFromCoordinates(lat, lng)` — ottiene dati di locazione completi da coordinate

**Previsione tartufi**
- `getTruffleForecastLocationChoices()` — costruisce le scelte di locazione per la previsione
- `suggestAreaProfileFromAltitude(altitude)` — suggerisce un profilo area dall'altitudine corrente
- `renderTruffleForecastSpeciesOptions(speciesSelect, openSpecies, preferredSpeciesId)` — popola il select specie
- `renderTruffleForecastResults(forecast, regionName, feedbackEntries, options)` — renderizza i risultati previsione
- `loadTruffleForecastModule()` — carica e renderizza il modulo previsione
- `saveTruffleForecastFeedback(date, outcomeClassId)` — salva il feedback su un'uscita

**UI generica**
- `showToast(message, type)` — mostra un toast informativo/errore
- `appAlert(message)` / `appConfirm(message)` / `appPrompt(message, defaultValue)` — dialoghi custom
- `appSelect(message, options, defaultValue)` — dialogo selezione da lista
- `appChoosePoiSaveSource(message)` — dialogo scelta sorgente posizione POI
- `appChooseSendMethod(message)` / `appChooseCallMethod(message, hasTel, hasCell)` — dialoghi di scelta metodo invio/chiamata
- `printPage()` — stampa la pagina corrente
- `openModule(moduleName, editMode)` — apre un modulo dell'app
- `closeActiveModule()` — chiude il modulo attivo
- `clearData(storageKey, moduleName)` — cancella i dati di un modulo

**Documenti**
- `saveTesserino()` — salva i dati del tesserino tartufaio
- `saveF24WithFile()` / `savePagoPAWithFile()` — salva F24 / PagoPA con allegato
- `saveArchivioDocumenti()` / `editArchivioDocumento(index)` / `deleteArchivioDocumento(index)` — CRUD archivio documenti
- `viewArchivioDocumentoImage(index, imageType)` — visualizza l'immagine allegata a un documento

**Vendite e ricevute**
- `calcolaTotale()` — ricalcola il totale nella form ricevuta
- `calcolaRitenutaAcconto()` — ricalcola ritenuta e netto nella form
- `registraVenditaConPrezzoKg()` — registra una vendita e genera la ricevuta
- `visualizzaRicevutaSalvata(index)` — visualizza il dettaglio di una ricevuta salvata
- `modificaRicevuta(index)` / `salvaModificaRicevuta(index)` — modifica ricevuta
- `eliminaRicevutaConDoppiaConferma(index)` — elimina ricevuta con doppia conferma
- `condividiRicevuta(index)` / `condividiRicevutaEmail(index)` — condivide ricevuta via share nativo o email
- `chiudiDettaglioRicevuta()` — chiude il pannello dettaglio ricevuta
- `esportaDatiCSV()` — esporta contabilità in CSV

**Rubrica clienti**
- `addClienteInRubrica()` / `editCliente(index)` / `deleteCliente(index)` — CRUD clienti
- `mostraRicevuteCliente(nomeCliente)` / `mostraRicevuteClienteByIndex(index)` — filtra ricevute per cliente
- `creaRicevutaPerCliente(index)` — pre-compila la form ricevuta per un cliente
- `salvaClienteInRubrica(nuovaRicevuta)` — aggiorna la rubrica dopo una vendita
- `autocompilaDatiCliente(nomeInserito)` — autocompila i dati cliente nella form ricevuta
- `salvaNotaCliente(index, testoNota)` / `salvaNotaClienteDaInput(index)` — salva nota per un cliente

**Registro raccolta**
- `saveRaccoltaGiornaliera()` / `deleteRaccoltaGiornaliera(index)` — CRUD registro giornaliero
- `updateRegDataMoonPhase()` — aggiorna la fase lunare nella form registro
- `salvaLuogoRaccoltaNuovo()` / `eliminaLuogoRaccoltaDaArchivio(index)` / `aggiornaLuogoRaccoltaInArchivio(index)` — CRUD luoghi di raccolta
- `salvaArchivioRegionaleTartufi(regione)` / `esportaCalendariJSON()` / `importaCalendariJSON(event)` — gestione calendario raccolta regionale
- `elaboraTestoIncollato()` / `estraiDateTartufiDaTesto()` — estrazione date tartufi da testo incollato

**Cani e veterinari**
- `saveNewCane()` / `updateDog()` / `saveDogRecord(index)` / `editDog(index)` / `deleteDog(index)` — CRUD cani
- `saveVetClinic()` / `editVetClinic(index)` / `deleteVetClinic(index)` — CRUD cliniche veterinarie
- `shareLocationToVet(telNumber)` / `shareLocationToVetByIndex(index)` — condivisione posizione con veterinario
- `callVetClinicByIndex(index)` / `whatsappVetClinicByIndex(index)` / `navigateToVetClinicByIndex(index)` — contatto e navigazione verso clinica
- `saveVetUnifiedEntry()` / `deleteVetHistoryItem(index)` / `deleteHeatEntry(index)` — CRUD libretto sanitario e diario calore
- `savePolizza()` / `deletePolizza(index)` — CRUD polizze assicurative
- `refreshVetBookletFilter(event)` / `printVetFilteredBooklet()` — filtro e stampa libretto

**Spese e bilancio**
- `saveSpesa()` / `deleteSpesa(index)` — CRUD spese

**Backup e ripristino**
- `buildCompleteBackupData()` — costruisce il payload completo del backup
- `configureAutomaticBackupFolder(forceReselect)` / `chooseAutomaticBackupFolder()` — configurazione cartella backup automatico
- `downloadBackupFile(data, options)` — scarica il file di backup (manuale o automatico)
- `forceLocalBackupNow()` — avvia un backup locale immediato
- `archiviaAnnoPrecedente()` — archivia e azzera i dati dell'anno precedente
- `ripristinaBackupDaFile(event)` — ripristina i dati da un file di backup
- `runAutomaticLocalBackup()` — esegue il ciclo di backup automatico
- `setupAutomaticBackupLifecycle()` — configura i trigger del backup automatico (focus, visibility, timer)

**Mappa offline**
- `latlngToTile(lat, lng, zoom)` — converte coordinate in indici tile
- `getTileUrls(bbox, minZoom, maxZoom)` — genera tutti gli URL tile per un'area e range di zoom
- `saveOfflinePreferences(preferenze)` — salva le preferenze mappa offline
- `salvaPreferenzeMappaOffline()` — salva le preferenze dalla UI e aggiorna l'analisi copertura
- `verificaCoperturaMappaOffline(options)` — verifica e mostra la copertura cache
- `scaricaRegioniOffline()` — avvia il download delle tile per le regioni selezionate
- `fermaDownloadOffline()` — interrompe il download in corso
- `aggiornaStatoCacheRegioni()` — aggiorna l'UI con lo stato della cache per ogni regione
- `eliminaCacheMappaOffline()` — elimina tutta la cache mappa offline
- `cleanupInvalidCachedTiles()` — rimuove le tile non valide dalla cache
- `runOfflineMapRecovery(options)` — esegue il recovery della cache mappa offline
- `riprendiRecuperoMappaOfflineSeInAttesa()` / `autoRiscaricaRegioniOfflineSeNecessario()` — recovery automatico all'avvio

**PWA e installazione**
- `shareAppUrl()` — condivide l'URL dell'app
- `isPwaInstalled()` — verifica se l'app è installata come PWA
- `updateInstallCallToAction()` — aggiorna il pulsante di installazione PWA
- `installApp()` — avvia il prompt di installazione PWA
- `updateDrawerVersionDisplay()` — aggiorna la versione visualizzata nel drawer

</details>

---

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
