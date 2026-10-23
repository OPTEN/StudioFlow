import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ERROR_CODES } from '@studioflow/scene-model';
import {
  ApiError,
  ERROR_CODE_MESSAGES,
  HTTP_STATUS_MESSAGES,
  minutesText,
  parseRetryAfter,
  toGermanMessage,
} from './api-error';

function httpError(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: body,
    headers: new HttpHeaders(headers),
    url: '/api/x',
  });
}

describe('ApiError', () => {
  it('reads status, code, title, detail and field errors from a problem body', () => {
    const error = ApiError.from(
      httpError(400, {
        status: 400,
        title: 'Ungültige Eingabe',
        detail: 'Bitte prüfen.',
        code: 'validation_failed',
        errors: { name: ['Der Name fehlt.'], x: ['zu gross', 42] },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_failed');
    expect(error.title).toBe('Ungültige Eingabe');
    expect(error.detail).toBe('Bitte prüfen.');
    expect(error.fieldErrors).toEqual({ name: ['Der Name fehlt.'], x: ['zu gross'] });
    expect(error.firstFieldError).toBe('Der Name fehlt.');
    expect(error.is('validation_failed')).toBe(true);
  });

  it('parses a problem body sent as text', () => {
    const error = ApiError.from(httpError(409, JSON.stringify({ code: 'transition_running' })));
    expect(error.code).toBe('transition_running');
  });

  it('treats status 0 as network failure', () => {
    const error = ApiError.from(httpError(0, new ProgressEvent('error')));
    expect(error.status).toBe(0);
    expect(error.code).toBe('network');
  });

  it('ignores unknown codes', () => {
    expect(ApiError.from(httpError(418, { code: 'teapot' })).code).toBeNull();
  });

  it('reads Retry-After as seconds or HTTP date', () => {
    expect(
      ApiError.from(httpError(429, { code: 'rate_limited' }, { 'Retry-After': '840' }))
        .retryAfterSeconds,
    ).toBe(840);
    expect(
      parseRetryAfter('Thu, 22 Oct 2026 10:15:00 GMT', Date.parse('2026-10-22T10:00:00Z')),
    ).toBe(900);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('maps AbortError and unknown throwables', () => {
    expect(ApiError.from(new DOMException('x', 'AbortError')).code).toBe('aborted');
    expect(ApiError.from(new Error('boom')).code).toBe('network');
    const existing = new ApiError({ status: 404, code: 'not_found' });
    expect(ApiError.from(existing)).toBe(existing);
  });

  it('builds from a raw XHR response', () => {
    const error = ApiError.fromResponse(415, '{"code":"unsupported_media","detail":"SVG"}', null);
    expect(error.status).toBe(415);
    expect(error.code).toBe('unsupported_media');
  });
});

describe('toGermanMessage', () => {
  it('has a German text for every code of the contract', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const message = toGermanMessage(new ApiError({ status: 400, code }));
      expect(message.length).toBeGreaterThan(5);
      expect(message).not.toContain('ß');
    }
  });

  it('uses the code text', () => {
    expect(toGermanMessage(new ApiError({ status: 409, code: 'scene_is_live' }))).toBe(
      ERROR_CODE_MESSAGES.scene_is_live,
    );
    expect(toGermanMessage(new ApiError({ status: 0, code: 'network' }))).toBe(
      ERROR_CODE_MESSAGES.network,
    );
  });

  it('prefers the first field error for validation problems', () => {
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      fieldErrors: { name: ['Zu lang.'] },
    });
    expect(toGermanMessage(error)).toBe('Zu lang.');
  });

  it('prefers the server detail for limits and conflicts', () => {
    expect(
      toGermanMessage(
        new ApiError({ status: 409, code: 'limit_reached', detail: 'Höchstens 99 Szenen.' }),
      ),
    ).toBe('Höchstens 99 Szenen.');
  });

  it('falls back to the status text, then to a generic text', () => {
    expect(toGermanMessage(new ApiError({ status: 503 }))).toBe(HTTP_STATUS_MESSAGES[503]);
    expect(toGermanMessage(new ApiError({ status: 413, code: 'unsupported_media' }))).toBe(
      HTTP_STATUS_MESSAGES[413],
    );
    expect(toGermanMessage(new ApiError({ status: 418 }))).toBe(
      'Das hat nicht geklappt (Fehler 418).',
    );
  });

  it('mentions the wait for rate limits', () => {
    expect(
      toGermanMessage(new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds: 600 })),
    ).toBe('Zu viele Versuche. Bitte in 10 Minuten erneut versuchen.');
  });

  it('applies caller overrides by code and by status', () => {
    const error = new ApiError({ status: 409, code: 'asset_in_use' });
    expect(toGermanMessage(error, { asset_in_use: 'wird verwendet' })).toBe('wird verwendet');
    expect(toGermanMessage(new ApiError({ status: 404 }), { '404': 'weg' })).toBe('weg');
  });

  it('formats minutes', () => {
    expect(minutesText(30)).toBe('1 Minute');
    expect(minutesText(60)).toBe('1 Minute');
    expect(minutesText(61)).toBe('2 Minuten');
    expect(minutesText(900)).toBe('15 Minuten');
  });
});
