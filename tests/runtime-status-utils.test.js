import { describe, expect, it } from 'vitest';

import {
    formatMinutesAgo,
    getAppReadinessStatus,
    getGpsSignalStatus,
    getInternetStatus
} from '../js/runtime-status-utils.js';

describe('getGpsSignalStatus', () => {
    it('classifica un fix ottimo sotto i 30 metri', () => {
        expect(getGpsSignalStatus(12)).toEqual({
            tone: 'ok',
            label: 'GPS ottimo',
            detail: 'Precisione ~12 m'
        });
    });

    it('copre i rami sconosciuto, utilizzabile e borderline', () => {
        expect(getGpsSignalStatus(Number.NaN)).toEqual({
            tone: 'ok',
            label: 'GPS attivo',
            detail: 'Precisione non disponibile'
        });

        expect(getGpsSignalStatus(55)).toEqual({
            tone: 'warning',
            label: 'GPS utilizzabile',
            detail: 'Precisione ~55 m'
        });

        expect(getGpsSignalStatus(95)).toEqual({
            tone: 'warning',
            label: 'GPS borderline',
            detail: 'Precisione ~95 m'
        });
    });

    it('classifica un fix debole oltre i 100 metri', () => {
        expect(getGpsSignalStatus(135)).toEqual({
            tone: 'error',
            label: 'GPS debole',
            detail: 'Precisione ridotta ~135 m'
        });
    });
});

describe('getInternetStatus', () => {
    it('distingue l offline dalla rete limitata', () => {
        expect(getInternetStatus({ online: false, tileNetworkUnavailable: false })).toEqual({
            tone: 'warning',
            label: 'Internet assente',
            detail: 'Uso dati locali e cache offline'
        });

        expect(getInternetStatus({ online: true, tileNetworkUnavailable: true })).toEqual({
            tone: 'warning',
            label: 'Internet limitata',
            detail: 'Rete attiva ma tile mappa non disponibili'
        });
    });

    it('mostra lo stato online quando la rete è sana', () => {
        expect(getInternetStatus({ online: true, tileNetworkUnavailable: false })).toEqual({
            tone: 'ok',
            label: 'Internet disponibile',
            detail: 'Servizi online raggiungibili'
        });
    });
});

describe('getAppReadinessStatus', () => {
    it('mostra l app offline pronta solo con controller attivo', () => {
        expect(getAppReadinessStatus({
            serviceWorkerSupported: true,
            hasController: true,
            registrationFailed: false
        })).toEqual({
            tone: 'ok',
            label: 'App offline pronta',
            detail: 'Cache iniziale collegata a questa schermata'
        });
    });

    it('copre browser non supportati, registrazione fallita e prima apertura', () => {
        expect(getAppReadinessStatus({
            serviceWorkerSupported: false,
            hasController: false,
            registrationFailed: false
        })).toEqual({
            tone: 'error',
            label: 'Offline non supportato',
            detail: 'Browser senza Service Worker'
        });

        expect(getAppReadinessStatus({
            serviceWorkerSupported: true,
            hasController: false,
            registrationFailed: true
        })).toEqual({
            tone: 'error',
            label: 'Cache offline non pronta',
            detail: 'Apri o ricarica l’app con internet'
        });

        expect(getAppReadinessStatus({
            serviceWorkerSupported: true,
            hasController: false,
            registrationFailed: false
        })).toEqual({
            tone: 'warning',
            label: 'Prima apertura online',
            detail: 'Completa la cache iniziale e riapri l’app'
        });
    });
});

describe('formatMinutesAgo', () => {
    it('formatta adesso e minuti trascorsi', () => {
        expect(formatMinutesAgo(0)).toBe('adesso');
        expect(formatMinutesAgo(1)).toBe('1 min fa');
        expect(formatMinutesAgo(4)).toBe('4 min fa');
    });
});
