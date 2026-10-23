import { resetLocaleForTests } from '@studioflow/i18n';
import { ApiError, toApiError } from './api-error';

describe('ApiError.userMessage in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('words the failures for people at a phone or laptop', () => {
    expect(new ApiError(403, 'device_blocked', 'x').userMessage).toBe(
      'Dieses Gerät ist gesperrt. Die Regie kann es wieder freigeben.',
    );
    expect(new ApiError(0, null, 'x').userMessage).toBe(
      'Der Server ist nicht erreichbar. Bitte WLAN prüfen.',
    );
    expect(new ApiError(0, null, 'x', null, {}, true).userMessage).toBe(
      'Der Server antwortet nicht. Bitte WLAN prüfen.',
    );
    expect(new ApiError(410, 'pairing_expired', 'x').userMessage).toBe(
      'Diese Einladung ist abgelaufen oder wurde schon verwendet.',
    );
  });

  it('counts the wait of a rate limit', () => {
    const wait = (seconds: number | null): string =>
      new ApiError(429, 'rate_limited', 'x', seconds).userMessage;
    expect(wait(1)).toBe('Zu viele Versuche. Bitte in 1 Sekunde noch einmal versuchen.');
    expect(wait(40)).toBe('Zu viele Versuche. Bitte in 40 Sekunden noch einmal versuchen.');
    expect(wait(61)).toBe('Zu viele Versuche. Bitte in 2 Minuten noch einmal versuchen.');
    expect(wait(null)).toBe('Zu viele Versuche. Bitte später noch einmal versuchen.');
  });

  it('follows the language while the message is kept, but the diagnostic stays English', () => {
    resetLocaleForTests('en');
    const error = toApiError(new TypeError('boom'));
    expect(error.message).toBe('The server is not reachable. Please check the Wi-Fi.');
    expect(error.userMessage).toBe('The server is not reachable. Please check the Wi-Fi.');
    resetLocaleForTests('de-CH');
    expect(error.message).toBe('The server is not reachable. Please check the Wi-Fi.');
    expect(error.userMessage).toBe('Der Server ist nicht erreichbar. Bitte WLAN prüfen.');
  });
});
