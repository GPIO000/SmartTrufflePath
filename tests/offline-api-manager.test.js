// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshImport() {
    vi.resetModules();
    return import('../js/offline-api-manager.js');
}

afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('getStatusString', () => {
    it('non mostra il tempo trascorso online', async () => {
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
        const { getStatusString } = await freshImport();

        expect(getStatusString()).toBe('🟢 Online');
        expect(getStatusString()).not.toContain('online da');
    });

    it('mostra lo stato offline senza uptime', async () => {
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
        const { getStatusString } = await freshImport();

        expect(getStatusString()).toBe('🔴 Offline');
    });
});
