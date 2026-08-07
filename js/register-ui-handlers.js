// Registrazione centralizzata degli handler UI (refactor: rimuovere onclick inline)
function registerUIHandlers() {
  const safeCall = (fn) => (e) => {
    try { fn(e); } catch (err) { console.error('Errore esecuzione handler:', err); }
  };

  const actionMap = {
    centerOnUser: typeof centerOnUser === 'function' ? centerOnUser : null,
    saveCarPosition: typeof saveCarPosition === 'function' ? saveCarPosition : null,
    returnToCar: typeof returnToCar === 'function' ? returnToCar : null,
    deleteCarPosition: typeof deleteCarPosition === 'function' ? deleteCarPosition : null,
    savePoiPosition: typeof savePoiPosition === 'function' ? savePoiPosition : null,
    triggerSOS: typeof triggerSOS === 'function' ? triggerSOS : null,
    shareAppUrl: typeof shareAppUrl === 'function' ? shareAppUrl : null,
    toggleDrawer: typeof toggleDrawer === 'function' ? toggleDrawer : null
  };

  document.querySelectorAll('[data-action]').forEach(el => {
    const act = el.dataset.action;
    const fn = actionMap[act];
    if (fn) el.addEventListener('click', safeCall(fn));
    else el.addEventListener('click', () => console.warn(`Azione non implementata: ${act}`));
  });

  document.querySelectorAll('[data-module]').forEach(el => {
    const moduleName = el.dataset.module;
    el.addEventListener('click', safeCall(() => {
      if (typeof openModule === 'function') openModule(moduleName);
      else console.warn('openModule non definita');
    }));
  });

  // Backdrop e drawer toggles (in caso non usino data-action)
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => { if (typeof toggleDrawer === 'function') toggleDrawer(); });

  const menuBtn = document.getElementById('menu-toggle-btn');
  if (menuBtn && typeof toggleDrawer === 'function') menuBtn.addEventListener('click', toggleDrawer);
}

// Se il DOM è già pronto (app.js incluso a fine body) registriamo subito
try { registerUIHandlers(); } catch (e) { console.error('registerUIHandlers failed', e); }

// Stubs leggeri per evitare errori se alcune funzioni non sono ancora implementate
(function createStubs(keys){
  keys.forEach(k => {
    if (typeof window[k] !== 'function') {
      window[k] = function(...args) {
        console.warn(`Stub eseguito per funzione non implementata: ${k}`, ...args);
        // fallback minimo: non interrompere l'app
      };
    }
  });
})(['centerOnUser','saveCarPosition','returnToCar','deleteCarPosition','savePoiPosition','triggerSOS','shareAppUrl','openModule','toggleDrawer']);
