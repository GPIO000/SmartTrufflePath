import { describe, expect, it } from 'vitest';
import { getInstallUnavailableMessage } from '../js/install-utils.js';

describe('getInstallUnavailableMessage', () => {
  it('mostra le istruzioni iOS su iPhone/iPad', () => {
    const message = getInstallUnavailableMessage({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    });

    expect(message).toContain('Su iOS usa Safari');
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
