import { describe, expect, it } from 'vitest';
import {
  getInstallButtonLabel,
  getInstallPlatform,
  getInstallUiState,
  getInstallUnavailableMessage,
  isStandaloneMode,
  shouldShowInstallButton
} from '../js/install-utils.js';

describe('getInstallPlatform', () => {
  it('riconosce iOS su iPhone/iPad', () => {
    expect(getInstallPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
    })).toBe('ios');
  });

  it('riconosce Android', () => {
    expect(getInstallPlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'
    })).toBe('android');
  });

  it('usa other come fallback', () => {
    expect(getInstallPlatform({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'
    })).toBe('other');
  });
});

describe('getInstallUnavailableMessage', () => {
  it('mostra le istruzioni iOS su iPhone/iPad', () => {
    const message = getInstallUnavailableMessage({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    });

    expect(message).toContain('Aggiungi alla schermata Home');
  });

  it('mostra le istruzioni Android su Chrome Android', () => {
    const message = getInstallUnavailableMessage({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
    });

    expect(message).toContain('Su Android apri il menu del browser');
    expect(message).toContain("'Installa app'");
  });

  it('mostra un fallback generico sugli altri browser', () => {
    const message = getInstallUnavailableMessage({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    });

    expect(message).toContain('Usa il menu del browser');
  });
});

describe('getInstallButtonLabel', () => {
  it('usa il testo diretto quando il prompt è disponibile', () => {
    expect(getInstallButtonLabel({ canPrompt: true })).toBe('📲 Installa App');
  });

  it('mostra guida iPhone quando il prompt non è disponibile su iOS', () => {
    expect(getInstallButtonLabel({
      canPrompt: false,
      navigatorLike: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }
    })).toContain('iPhone');
  });
});

describe('shouldShowInstallButton', () => {
  it("mostra il pulsante quando l'app non è installata", () => {
    expect(shouldShowInstallButton({ isInstalled: false })).toBe(true);
  });

  it("nasconde il pulsante quando l'app è installata", () => {
    expect(shouldShowInstallButton({ isInstalled: true })).toBe(false);
  });
});

describe('getInstallUiState', () => {
  it('mostra badge e nasconde pulsante quando l’app è già installata', () => {
    expect(getInstallUiState({ isInstalled: true })).toEqual({
      showButton: false,
      showBadge: true,
      buttonLabel: "📲 Come installare l'app"
    });
  });
});

describe('isStandaloneMode', () => {
  it('riconosce display-mode standalone', () => {
    const result = isStandaloneMode({
      navigator: {},
      matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' })
    });

    expect(result).toBe(true);
  });

  it('riconosce navigator.standalone su iOS', () => {
    const result = isStandaloneMode({
      navigator: { standalone: true },
      matchMedia: () => ({ matches: false })
    });

    expect(result).toBe(true);
  });
});
