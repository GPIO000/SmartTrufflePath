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
    else el.addEventListener('click', () => {
      // show non-blocking user feedback for unimplemented actions
      showUserMessage(`Funzione non ancora implementata: ${act}`);
      console.warn(`Azione non implementata: ${act}`);
    });
  });

  document.querySelectorAll('[data-module]').forEach(el => {
    const moduleName = el.dataset.module;
    el.addEventListener('click', safeCall(() => {
      if (typeof openModule === 'function') openModule(moduleName);
      else {
        showUserMessage(`Modulo non disponibile: ${moduleName}`);
        console.warn('openModule non definita');
      }
    }));
  });

  // Backdrop e drawer toggles (in caso non usino data-action)
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => { if (typeof toggleDrawer === 'function') toggleDrawer(); });

  const menuBtn = document.getElementById('menu-toggle-btn');
  if (menuBtn && typeof toggleDrawer === 'function') menuBtn.addEventListener('click', toggleDrawer);
}

// Utility: show a transient non-blocking message (toast) to the user
function showUserMessage(message, timeout = 3000) {
  try {
    let toast = document.getElementById('tmf-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'tmf-toast';
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15,23,42,0.95)',
        color: '#fff',
        padding: '10px 14px',
        borderRadius: '8px',
        zIndex: 99999,
        fontSize: '0.95rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        opacity: '0',
        transition: 'opacity 200ms ease-in-out'
      });
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    // force reflow for transition
    void toast.offsetWidth;
    toast.style.opacity = '1';
    clearTimeout(toast._tmf_hide_timeout);
    toast._tmf_hide_timeout = setTimeout(() => {
      toast.style.opacity = '0';
    }, timeout);
  } catch (e) {
    // fallback: console and alert as last resort
    console.warn('showUserMessage fallback', e);
    try { alert(message); } catch (e2) { /* ignore */ }
  }
}

// Se il DOM è già pronto (app.js incluso a fine body) registriamo subito
try { registerUIHandlers(); } catch (e) { console.error('registerUIHandlers failed', e); }

// Stubs lievi sostituiti: mostrano feedback utente invece di silenzio
(function createStubs(keys){
  keys.forEach(k => {
    if (typeof window[k] !== 'function') {
      window[k] = function(...args) {
        console.warn(`Stub eseguito per funzione non implementata: ${k}`, ...args);
        showUserMessage(`Funzione in sviluppo: ${k}`);
      };
    }
  });
})(['centerOnUser','saveCarPosition','returnToCar','deleteCarPosition','savePoiPosition','triggerSOS','shareAppUrl','openModule','toggleDrawer']);
