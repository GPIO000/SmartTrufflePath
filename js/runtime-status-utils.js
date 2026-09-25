export const GPS_SIGNAL_EXCELLENT_MAX_METERS = 30;
export const GPS_SIGNAL_USABLE_MAX_METERS = 80;
export const GPS_SIGNAL_WEAK_MIN_METERS = 100;

export function formatMinutesAgo(minutes) {
    const safeMinutes = Math.max(0, Number.isFinite(minutes) ? Math.round(minutes) : 0);
    if (safeMinutes === 0) return 'adesso';
    if (safeMinutes === 1) return '1 min fa';
    return `${safeMinutes} min fa`;
}

export function getGpsSignalStatus(accuracyMeters) {
    if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
        return {
            tone: 'ok',
            label: 'GPS attivo',
            detail: 'Precisione non disponibile'
        };
    }

    const roundedAccuracy = Math.round(accuracyMeters);
    if (accuracyMeters < GPS_SIGNAL_EXCELLENT_MAX_METERS) {
        return {
            tone: 'ok',
            label: 'GPS ottimo',
            detail: `Precisione ~${roundedAccuracy} m`
        };
    }

    if (accuracyMeters <= GPS_SIGNAL_USABLE_MAX_METERS) {
        return {
            tone: 'warning',
            label: 'GPS utilizzabile',
            detail: `Precisione ~${roundedAccuracy} m`
        };
    }

    if (accuracyMeters >= GPS_SIGNAL_WEAK_MIN_METERS) {
        return {
            tone: 'error',
            label: 'GPS debole',
            detail: `Precisione ridotta ~${roundedAccuracy} m`
        };
    }

    return {
        tone: 'warning',
        label: 'GPS borderline',
        detail: `Precisione ~${roundedAccuracy} m`
    };
}

export function getInternetStatus({ online, tileNetworkUnavailable }) {
    if (!online) {
        return {
            tone: 'warning',
            label: 'Internet assente',
            detail: 'Uso dati locali e cache offline'
        };
    }

    if (tileNetworkUnavailable) {
        return {
            tone: 'warning',
            label: 'Internet limitata',
            detail: 'Rete attiva ma tile mappa non disponibili'
        };
    }

    return {
        tone: 'ok',
        label: 'Internet disponibile',
        detail: 'Servizi online raggiungibili'
    };
}

export function getAppReadinessStatus({ serviceWorkerSupported, hasController, registrationFailed }) {
    if (!serviceWorkerSupported) {
        return {
            tone: 'error',
            label: 'Offline non supportato',
            detail: 'Browser senza Service Worker'
        };
    }

    if (hasController) {
        return {
            tone: 'ok',
            label: 'App offline pronta',
            detail: 'Cache iniziale collegata a questa schermata'
        };
    }

    if (registrationFailed) {
        return {
            tone: 'error',
            label: 'Cache offline non pronta',
            detail: 'Apri o ricarica l’app con internet'
        };
    }

    return {
        tone: 'warning',
        label: 'Prima apertura online',
        detail: 'Completa la cache iniziale e riapri l’app'
    };
}
