# Copilot Instructions — SmartTruffle Path

## Project overview

SmartTruffle Path is a **mobile-first PWA** (Progressive Web App) for truffle hunters (tartufai).  
It is an **offline-first** single-page application: all data lives in the browser (IndexedDB / localStorage) with no backend server.

The UI is plain HTML/CSS/JS with no frontend framework. The app uses [Leaflet](https://leafletjs.com/) for the GPS map.

## Tech stack

| Area | Technology |
|---|---|
| Language | Vanilla JavaScript (ES modules, no TypeScript) |
| Bundler | Vite |
| Linter | ESLint (`eslint.config.js`) |
| Tests | Vitest + jsdom |
| Maps | Leaflet (CDN, in `vendor/`) |
| Storage | IndexedDB (via `js/storage-sync.js`) + localStorage fallback |
| PWA | Service Worker (`sw.js`), Web App Manifest (`manifest.json`) |

## Repository structure

```
index.html          Single HTML shell (all sections rendered via JS)
js/
  app.js            Main application logic (~7000 lines)
  backup-utils.js   Backup/restore helpers (exported, unit-tested)
  cache-version.js  Service worker cache version constant
  fiscal-utils.js   Tax/revenue calculation helpers (exported, unit-tested)
  offline-cache-utils.js  Tile cache helpers (exported, unit-tested)
  offline-map-download-utils.js  Tile batch download (exported, unit-tested)
  poi-utils.js      POI data helpers (exported, unit-tested)
  storage-sync.js   IndexedDB storage layer (exported, unit-tested)
  sw-utils.js       Service worker message helpers
sw.js               Service Worker
css/                App stylesheets
tests/              Vitest unit tests (one file per utility module)
vendor/             Leaflet library (bundled locally)
```

## Key conventions

- **Language**: the codebase and comments are in **Italian**. Write all new user-facing strings, comments, variable names, and function names in Italian to match the existing style.
- **No framework**: do not add Vue, React, or any other UI framework. All DOM manipulation is done manually.
- **No new dependencies**: avoid adding `npm` packages unless strictly necessary. Check `package.json` before proposing new libraries.
- **ES modules**: all JS files use `import`/`export`. Do not use CommonJS `require()`.
- **Utility functions belong in their own module**: if a function is testable in isolation (no DOM dependency), extract it to one of the `*-utils.js` files and export it. Add corresponding Vitest tests in `tests/`.
- **Storage API**: always use functions from `js/storage-sync.js` (e.g. `TruffleStorage.getItem`, `TruffleStorage.setItem`) to read/write persistent data. Do not call `localStorage` directly.
- **Dialog helpers**: use the custom `appAlert`, `appConfirm`, `appPrompt`, and `appSelect` helpers defined in `app.js` instead of the native browser dialogs. These return Promises and are required for correct async flow.
- **Wait for dialog settle**: when programmatically confirming a dialog after opening it, always call `waitForDialogToSettle(dialog)` first to avoid race conditions.
- **Service Worker cache version**: when changing cached assets, bump the version in `js/cache-version.js` so the SW invalidates old caches.

## Running checks locally

```bash
npm run lint    # ESLint
npm test        # Vitest unit tests
npm run build   # Vite production build
```

All three must pass before opening a PR.

## Testing guidelines

- Tests live in `tests/` and use Vitest with a jsdom environment.
- Test only pure utility functions (files in `js/*-utils.js` and `js/storage-sync.js`).
- `app.js` is not unit-tested (DOM-heavy); cover it with integration/e2e tests if needed.
- Keep test descriptions in Italian to match the existing test files.
- Do not remove or weaken existing tests.

## Common pitfalls

- `app.js` is large and monolithic; be careful about scope and variable shadowing when editing it.
- The Service Worker uses a versioned cache name prefix (`APP_CACHE_NAME_PREFIX`). After modifying cached assets remember to bump `cache-version.js`.
- POI coordinates are stored as `{ lat, lng }` objects; use `resolvePoiCoords` from `poi-utils.js` to normalise them.
- Fiscal calculations (ritenuta, soglia annua) are in `fiscal-utils.js`; do not duplicate them in `app.js`.
