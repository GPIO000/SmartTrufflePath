function getNavigatorUserAgent(navigatorLike = {}) {
  if (navigatorLike && typeof navigatorLike.userAgent === 'string') {
    return navigatorLike.userAgent;
  }
  return '';
}

export function getInstallPlatform(navigatorLike = {}) {
  const userAgent = getNavigatorUserAgent(navigatorLike);

  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    return 'ios';
  }

  if (/Android/i.test(userAgent)) {
    return 'android';
  }

  return 'other';
}

export function isStandaloneMode(windowLike = {}) {
  const matchMedia = typeof windowLike.matchMedia === 'function'
    ? windowLike.matchMedia.bind(windowLike)
    : null;
  const navigatorLike = windowLike.navigator ?? {};

  return Boolean(
    matchMedia?.('(display-mode: standalone)')?.matches
    || matchMedia?.('(display-mode: fullscreen)')?.matches
    || matchMedia?.('(display-mode: minimal-ui)')?.matches
    || navigatorLike.standalone === true
  );
}

export function getInstallUnavailableMessage(navigatorLike = {}) {
  const platform = getInstallPlatform(navigatorLike);

  if (platform === 'ios') {
    return "Installazione automatica non disponibile. Su iPhone o iPad apri Safari, tocca Condividi e poi 'Aggiungi alla schermata Home'.";
  }

  if (platform === 'android') {
    return "Installazione automatica non disponibile. Su Android apri il menu del browser e tocca 'Installa app' o 'Aggiungi a schermata Home'.";
  }

  return "Installazione automatica non disponibile. Usa il menu del browser per installare l'app o aggiungerla alla schermata Home.";
}

export function getInstallButtonLabel({ canPrompt = false, navigatorLike = {} } = {}) {
  if (canPrompt) {
    return '📲 Installa App';
  }

  const platform = getInstallPlatform(navigatorLike);

  if (platform === 'ios') {
    return '📲 Come installare su iPhone';
  }

  if (platform === 'android') {
    return '📲 Come installare su Android';
  }

  return "📲 Come installare l'app";
}

export function shouldShowInstallButton({ isInstalled } = {}) {
  return !isInstalled;
}

export function getInstallUiState({ isInstalled = false, canPrompt = false, navigatorLike = {} } = {}) {
  const showButton = shouldShowInstallButton({ isInstalled });

  return {
    showButton,
    showBadge: !showButton,
    buttonLabel: getInstallButtonLabel({ canPrompt, navigatorLike })
  };
}
