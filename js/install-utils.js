function getNavigatorUserAgent(navigatorLike = {}) {
  if (navigatorLike && typeof navigatorLike.userAgent === 'string') {
    return navigatorLike.userAgent;
  }
  return '';
}

export function getInstallUnavailableMessage(navigatorLike = {}) {
  const userAgent = getNavigatorUserAgent(navigatorLike);
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);

  if (isIOS) {
    return "Installazione non disponibile. Su iOS usa Safari > 'Aggiungi alla schermata Home'.";
  }

  if (isAndroid) {
    return "Installazione non disponibile al momento. Su Android apri il menu del browser e tocca 'Installa app' o 'Aggiungi a schermata Home'.";
  }

  return "Installazione non disponibile al momento. Usa il menu del browser per installare l'app o aggiungerla alla schermata Home.";
}

export function shouldShowInstallButton({ isInstalled } = {}) {
  return !isInstalled;
}
