import { resetLocaleForTests } from '@studioflow/i18n';
import { ApiError, toUserMessage } from './api-error';

describe('toUserMessage in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('uses the Swiss texts of the codes', () => {
    expect(toUserMessage(new ApiError({ status: 409, code: 'scene_is_live' }))).toBe(
      'Die Live-Szene lässt sich nicht löschen.',
    );
    expect(toUserMessage(new ApiError({ status: 0, code: 'network' }))).toBe(
      'Keine Verbindung zum Server. Bitte nochmals versuchen.',
    );
  });

  it('counts the minutes of a rate limit', () => {
    const error = (retryAfterSeconds: number): ApiError =>
      new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds });
    expect(toUserMessage(error(30))).toBe('Zu viele Versuche. Bitte in 1 Minute erneut versuchen.');
    expect(toUserMessage(error(600))).toBe(
      'Zu viele Versuche. Bitte in 10 Minuten erneut versuchen.',
    );
  });

  it('writes the generic fallback in German', () => {
    expect(toUserMessage(new ApiError({ status: 418 }))).toBe(
      'Das hat nicht geklappt (Fehler 418).',
    );
  });

  it('keeps Swiss spelling: no ß in any message', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 410, 413, 415, 429, 500, 503]) {
      expect(toUserMessage(new ApiError({ status }))).not.toContain('ß');
    }
  });
});
