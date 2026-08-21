// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

const WIDGET_ID = 'weather-moon-widget';

function makeWidget() {
    const el = document.createElement('div');
    el.id = WIDGET_ID;
    document.body.appendChild(el);
    return el;
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

// Reimporta il modulo con stato fresco (azzera le variabili di modulo)
async function freshImport() {
    vi.resetModules();
    return import('../js/weather-moon.js');
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let widget;

beforeEach(() => {
    localStorage.clear();
    widget = makeWidget();
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
});

describe('updateWeatherMoon — fetch fallito', () => {
    it('mostra renderError quando fetch fallisce e non ci sono dati precedenti', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
        const { updateWeatherMoon } = await freshImport();

        await updateWeatherMoon(44.0, 11.0, null, true);

        expect(widget.style.display).toBe('block');
        expect(widget.innerHTML).toContain('Meteo n.d.');
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

describe('refreshMoonOnly', () => {
    it('non lancia errori se chiamato prima di qualsiasi dato', async () => {
        const { refreshMoonOnly } = await freshImport();
        expect(() => refreshMoonOnly()).not.toThrow();
    });
});
