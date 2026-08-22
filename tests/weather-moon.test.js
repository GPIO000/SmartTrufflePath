// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CURRENT_WIDGET_ID = 'weather-moon-widget';
const DESTINATION_WIDGET_ID = 'weather-destination-widget';

function makeWidgets() {
    const current = document.createElement('div');
    current.id = CURRENT_WIDGET_ID;
    document.body.appendChild(current);

    const destination = document.createElement('div');
    destination.id = DESTINATION_WIDGET_ID;
    document.body.appendChild(destination);

    return { current, destination };
}

function fakeWeatherResponse(overrides = {}) {
    return {
        current: {
            temperature_2m: 18,
            weather_code: 0,
            wind_speed_10m: 10,
            relative_humidity_2m: 55,
            ...overrides.current,
        },
        daily: {
            weather_code: [0, 1, 2, 3],
            temperature_2m_max: [20, 21, 22, 23],
            temperature_2m_min: [10, 11, 12, 13],
            precipitation_sum: [0, 0.5, 1, 2],
            wind_speed_10m_max: [15, 12, 10, 8],
            soil_temperature_0cm: [12, 13, 14, 15],
            et0_fao_evapotranspiration: [2.1, 1.8, 1.5, 1.2],
            ...overrides.daily,
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Reimporta il modulo con stato fresco (azzera le variabili di modulo)
async function freshImport() {
    vi.resetModules();
    return import('../js/weather-moon.js');
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let widget;
let destinationWidget;

beforeEach(() => {
    localStorage.clear();
    const widgets = makeWidgets();
    widget = widgets.current;
    destinationWidget = widgets.destination;
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('updateWeatherMoon — argomenti non validi', () => {
    it('non fa nulla con coordinate NaN', async () => {
        const { updateWeatherMoon } = await freshImport();
        await updateWeatherMoon(NaN, 10);
        expect(widget.style.display).toBe(''); // invariato
    });

    it('non fa nulla con coordinate Infinity', async () => {
        const { updateWeatherMoon } = await freshImport();
        await updateWeatherMoon(Infinity, 10);
        expect(widget.style.display).toBe('');
    });
});

describe('updateWeatherMoon — fetch riuscito', () => {
    it('mostra il widget dopo fetch riuscito', async () => {
        const mockData = fakeWeatherResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.style.display).toBe('block');
        expect(widget.innerHTML).toContain('wm-compact');
    });

    it('mostra la temperatura nella compact bar', async () => {
        const mockData = fakeWeatherResponse({ current: { temperature_2m: 22, weather_code: 0, wind_speed_10m: 5, relative_humidity_2m: 60 } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.innerHTML).toContain('22°');
    });

    it('mostra il label della posizione se fornito', async () => {
        const mockData = fakeWeatherResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, 'Pineta Sud', true);

        expect(widget.innerHTML).toContain('Pineta Sud');
    });

    it('mostra il badge "Aggiornato" dopo fetch riuscito', async () => {
        const mockData = fakeWeatherResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.innerHTML).toContain('wm-data-badge--live');
        expect(widget.innerHTML).toContain('Aggiornato');
    });
});

describe('updateWeatherMoonComparison', () => {
    it('mostra il confronto meteo tra posizione attuale e destinazione', async () => {
        const mockFetch = vi.fn((url) => {
            if (url.includes('latitude=44.0000')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(fakeWeatherResponse({ current: { temperature_2m: 21 } })),
                });
            }
            if (url.includes('latitude=45.0000')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(fakeWeatherResponse({ current: { temperature_2m: 16 } })),
                });
            }
            throw new Error(`unexpected url ${url}`);
        });
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoonComparison } = await freshImport();

        await updateWeatherMoonComparison(
            { lat: 44, lng: 11, label: 'Sei qui' },
            { lat: 45, lng: 12, label: '📍 Bosco Nord' }
        );

        expect(widget.innerHTML).toContain('Sei qui');
        expect(widget.innerHTML).toContain('📍 Bosco Nord');
        expect(widget.innerHTML).toContain('21°');
        expect(widget.innerHTML).toContain('16°');

        expect(destinationWidget.style.display).toBe('block');
        expect(destinationWidget.innerHTML).toContain('📍 Bosco Nord');

        widget.querySelector('.wm-compact').click();
        destinationWidget.querySelector('.wm-compact').click();

        expect(widget.innerHTML).toContain('wm-days-list');
        expect(destinationWidget.innerHTML).toContain('wm-days-list');
        expect(destinationWidget.innerHTML).toContain('📍 Bosco Nord');
    });
});

describe('updateWeatherMoon — fetch fallito', () => {
    it('mostra renderError quando fetch fallisce e non ci sono dati precedenti', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.style.display).toBe('block');
        expect(widget.innerHTML).toContain('wm-data-badge--error');
        expect(widget.innerHTML).toContain('Meteo n.d.');
        expect(widget.innerHTML).toContain('Rete non disponibile');
    });

    it('mostra un messaggio specifico per errore HTTP', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, 'Bosco Nord', true);

        expect(widget.innerHTML).toContain('Meteo n.d.');
        expect(widget.innerHTML).toContain('Errore API 400');
        expect(widget.innerHTML).toContain('Bosco Nord');
    });
});

describe('updateWeatherMoon — cache', () => {
    it('usa la cache localStorage se valida senza fetch', async () => {
        const mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);

        const mockData = fakeWeatherResponse();
        const cacheKey = 'wm_cache_44.00_11.00';
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: mockData }));

        const { updateWeatherMoon } = await freshImport();
        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(mockFetch).not.toHaveBeenCalled();
        expect(widget.style.display).toBe('block');
    });

    it('mostra il badge "Cache" quando i dati vengono dalla cache', async () => {
        vi.stubGlobal('fetch', vi.fn());

        const mockData = fakeWeatherResponse();
        const cacheKey = 'wm_cache_44.00_11.00';
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: mockData }));

        const { updateWeatherMoon } = await freshImport();
        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.innerHTML).toContain('wm-data-badge--cache');
        expect(widget.innerHTML).toContain('Cache');
    });

    it('non usa la cache scaduta', async () => {
        const mockData = fakeWeatherResponse();
        const cacheKey = 'wm_cache_44.00_11.00';
        // Timestamp di 2 ore fa (> 30 min TTL)
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now() - 2 * 60 * 60 * 1000, payload: mockData }));

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        });
        vi.stubGlobal('fetch', mockFetch);

        const { updateWeatherMoon } = await freshImport();
        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(mockFetch).toHaveBeenCalledOnce();
    });
});

describe('updateWeatherMoon — campi opzionali e concorrenza', () => {
    it('renderizza anche se i campi daily extra non sono presenti', async () => {
        const mockData = fakeWeatherResponse({
            daily: {
                soil_temperature_0cm: undefined,
                et0_fao_evapotranspiration: undefined,
            },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, 'Pineta Sud', true);
        widget.querySelector('.wm-compact').click();

        expect(widget.innerHTML).toContain('Pineta Sud');
        expect(widget.innerHTML).not.toContain('🪱');
        expect(widget.innerHTML).not.toContain('ET₀');
    });

    it('consente fetch concorrenti su coordinate diverse senza bloccare la richiesta più recente', async () => {
        const firstFetch = deferred();
        const secondFetch = deferred();
        const mockFetch = vi.fn((url) => {
            if (url.includes('latitude=44.0000')) return firstFetch.promise;
            if (url.includes('latitude=45.0000')) return secondFetch.promise;
            throw new Error(`unexpected url ${url}`);
        });
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        const firstCall = updateWeatherMoon(44.0, 11.0, 'GPS', true);
        const secondCall = updateWeatherMoon(45.0, 12.0, 'POI', true);

        expect(mockFetch).toHaveBeenCalledTimes(2);

        firstFetch.resolve({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse({ current: { temperature_2m: 18 } })),
        });
        await firstCall;

        expect(widget.innerHTML).not.toContain('GPS');

        secondFetch.resolve({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse({ current: { temperature_2m: 24 } })),
        });
        await secondCall;

        expect(widget.innerHTML).toContain('POI');
        expect(widget.innerHTML).toContain('24°');
    });

    it('mantiene i dati precedenti quando un fetch successivo fallisce', async () => {
        const mockData = fakeWeatherResponse({ current: { temperature_2m: 19 } });
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockData),
            })
            .mockRejectedValueOnce(new Error('network error'));
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, 'Prima posizione', true);
        await updateWeatherMoon(45.0, 12.0, 'Seconda posizione', true);
        widget.querySelector('.wm-compact').click();

        expect(widget.innerHTML).toContain('19°');
        expect(widget.innerHTML).toContain('Seconda posizione');
        expect(widget.innerHTML).toContain('wm-data-badge--stale');
        expect(widget.innerHTML).toContain('Dati precedenti');
        expect(widget.innerHTML).toContain('Rete non disponibile');
    });
});

describe('refreshMoonOnly', () => {
    it('non lancia errori se chiamato prima di qualsiasi dato', async () => {
        const { refreshMoonOnly } = await freshImport();
        expect(() => refreshMoonOnly()).not.toThrow();
    });

    it('ri-renderizza il widget usando i dati precedenti', async () => {
        const mockData = fakeWeatherResponse({ current: { temperature_2m: 17, weather_code: 0, wind_speed_10m: 5, relative_humidity_2m: 50 } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon, refreshMoonOnly } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);
        const htmlAfterFetch = widget.innerHTML;

        widget.innerHTML = '';
        refreshMoonOnly();

        expect(widget.innerHTML).toBe(htmlAfterFetch);
    });
});

describe('updateWeatherMoon — soglia spostamento GPS', () => {
    it('non esegue un nuovo fetch se lo spostamento è < 5 km', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse()),
        });
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        // Prima chiamata: label=null, force=true — registra le coordinate
        await updateWeatherMoon(44.0, 11.0, null, true);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Seconda chiamata: coordinate quasi identiche (< 5 km), label=null → deve saltare il fetch
        await updateWeatherMoon(44.001, 11.001, null, false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('esegue un nuovo fetch se lo spostamento è ≥ 5 km', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse()),
        });
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // ~110 km di distanza → supera la soglia di 5 km
        await updateWeatherMoon(45.0, 11.0, null, false);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('con label non null ignora la soglia di spostamento GPS e ri-renderizza con dati dalla cache', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse()),
        });
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        // Prima chiamata: registra _lastFetchLat/Lng e salva in cache
        await updateWeatherMoon(44.0, 11.0, null, true);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Seconda chiamata: stessa posizione (< 5 km), con label → il controllo
        // spostamento GPS è saltato; la cache è valida → viene usata (no nuovo fetch)
        await updateWeatherMoon(44.0, 11.0, 'POI', false);
        // Il fetch non viene ripetuto perché la cache è valida, ma il widget mostra il label
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(widget.innerHTML).toContain('POI');
    });
});

describe('updateWeatherMoon — deduplicazione fetch in volo', () => {
    it('due chiamate concorrenti con le stesse coordinate usano la stessa Promise', async () => {
        const d = deferred();
        const mockFetch = vi.fn().mockReturnValue(d.promise);
        vi.stubGlobal('fetch', mockFetch);
        const { updateWeatherMoon } = await freshImport();

        const p1 = updateWeatherMoon(44.0, 11.0, 'A', true);
        const p2 = updateWeatherMoon(44.0, 11.0, 'B', true);

        // fetch deve essere chiamato una sola volta
        expect(mockFetch).toHaveBeenCalledTimes(1);

        d.resolve({
            ok: true,
            json: () => Promise.resolve(fakeWeatherResponse()),
        });
        await Promise.all([p1, p2]);

        expect(widget.style.display).toBe('block');
    });
});

describe('updateWeatherMoon — timeout fetch', () => {
    it('mostra errore di timeout quando il fetch supera il limite', async () => {
        vi.useFakeTimers();

        const d = deferred();
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(d.promise));

        try {
            const { updateWeatherMoon } = await freshImport();
            const call = updateWeatherMoon(44.0, 11.0, null, true);

            // Avanza oltre il timeout (8000 ms)
            await vi.advanceTimersByTimeAsync(9000);
            await call;

            expect(widget.style.display).toBe('block');
            expect(widget.innerHTML).toContain('wm-data-badge--error');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('updateWeatherMoon — pannello espandibile', () => {
    it('al click sul compact mostra il pannello espanso', async () => {
        const mockData = fakeWeatherResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.querySelector('.wm-panel')).toBeNull();

        widget.querySelector('.wm-compact').click();

        expect(widget.querySelector('.wm-panel')).not.toBeNull();
        expect(widget.innerHTML).toContain('wm-days-list');
        expect(widget.innerHTML).toContain('wm-moon-row');
    });

    it('doppio click chiude il pannello espanso', async () => {
        const mockData = fakeWeatherResponse();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockData),
        }));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);
        widget.querySelector('.wm-compact').click();
        widget.querySelector('.wm-compact').click();

        expect(widget.querySelector('.wm-panel')).toBeNull();
    });
});
