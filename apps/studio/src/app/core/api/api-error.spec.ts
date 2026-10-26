import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { msg, resetLocaleForTests, t, tFor, tm } from '@studioflow/i18n';
import { ERROR_CODES } from '@studioflow/scene-model';
import {
  ApiError,
  ERROR_CODE_MESSAGES,
  HTTP_STATUS_MESSAGES,
  parseRetryAfter,
  toUserMessage,
  toUserMsg,
  waitMinutes,
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
        title: 'Invalid input',
        detail: 'Please check.',
        code: 'validation_failed',
        errors: { name: ['The name is missing.'], x: ['too large', 42] },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_failed');
    expect(error.title).toBe('Invalid input');
    expect(error.detail).toBe('Please check.');
    expect(error.fieldErrors).toEqual({ name: ['The name is missing.'], x: ['too large'] });
    expect(error.firstFieldError).toBe('The name is missing.');
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

describe('toUserMessage', () => {
  it('has a text for every code of the contract', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const message = toUserMessage(new ApiError({ status: 400, code }));
      expect(message.length).toBeGreaterThan(5);
      expect(message).not.toContain('errors.');
    }
  });

  it('uses the text of the code', () => {
    expect(toUserMessage(new ApiError({ status: 409, code: 'scene_is_live' }))).toBe(
      'The live scene cannot be deleted.',
    );
    expect(toUserMessage(new ApiError({ status: 0, code: 'network' }))).toBe(
      'No connection to the server. Please try again.',
    );
  });

  it('never shows the field errors or the detail of a known code (D7)', () => {
    const validation = new ApiError({
      status: 400,
      code: 'validation_failed',
      detail: 'Name is too long.',
      fieldErrors: { name: ['Too long.'] },
    });
    expect(toUserMessage(validation)).toBe('The input is not valid.');
    expect(
      toUserMessage(
        new ApiError({ status: 409, code: 'limit_reached', detail: 'At most 99 scenes.' }),
      ),
    ).toBe('The limit has been reached.');
  });

  it('falls back to the status text, then to a generic text', () => {
    expect(toUserMessage(new ApiError({ status: 503 }))).toBe(
      'The server is not reachable right now. Please try again shortly.',
    );
    expect(toUserMessage(new ApiError({ status: 504 }))).toBe(
      'The server did not respond in time. Please try again.',
    );
    expect(toUserMessage(new ApiError({ status: 413, code: 'unsupported_media' }))).toBe(
      'The file is too large. Images may be at most 25 MB, videos at most 1 GB.',
    );
    expect(toUserMessage(new ApiError({ status: 418 }))).toBe('That did not work (error 418).');
  });

  it('explains a refused production file in its own words, a 413 of a file too large included', () => {
    expect(toUserMessage(new ApiError({ status: 413, code: 'archive_too_large' }))).toBe(
      toUserMessage(new ApiError({ status: 0, code: 'archive_too_large' })),
    );
    expect(toUserMessage(new ApiError({ status: 413, code: 'archive_too_large' }))).not.toContain(
      'Images may be at most',
    );
    expect(toUserMessage(new ApiError({ status: 400, code: 'invalid_archive' }))).toContain(
      'StudioFlow',
    );
    expect(toUserMessage(new ApiError({ status: 400, code: 'unsupported_format' }))).toContain(
      'newer',
    );
  });

  it('shows the server detail only for an unknown code without a text of its own', () => {
    expect(
      toUserMessage(new ApiError({ status: 418, code: 'teapot', detail: 'I am a teapot.' })),
    ).toBe('I am a teapot.');
    expect(toUserMessage(new ApiError({ status: 409, code: 'teapot', detail: 'Not shown.' }))).toBe(
      'That is not possible right now because the state has changed.',
    );
  });

  it('mentions the wait for rate limits', () => {
    expect(
      toUserMessage(new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds: 600 })),
    ).toBe('Too many attempts. Please try again in 10 minutes.');
    expect(
      toUserMessage(new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds: 30 })),
    ).toBe('Too many attempts. Please try again in 1 minute.');
    expect(toUserMessage(new ApiError({ status: 429, code: 'rate_limited' }))).toBe(
      'Too many attempts. Please try again later.',
    );
  });

  it('applies caller overrides by code and by status, as text or as message', () => {
    const error = new ApiError({ status: 409, code: 'asset_in_use' });
    expect(toUserMessage(error, { asset_in_use: 'in use' })).toBe('in use');
    expect(toUserMessage(error, { asset_in_use: msg('common.cancel') })).toBe('Cancel');
    expect(toUserMessage(new ApiError({ status: 404 }), { '404': 'gone' })).toBe('gone');
  });

  it('prefers an override by code over one by status', () => {
    const error = new ApiError({ status: 409, code: 'conflict' });
    expect(toUserMessage(error, { conflict: 'by code', '409': 'by status' })).toBe('by code');
  });
});

describe('toUserMsg', () => {
  it('stays correct when the language changes while it is shown', () => {
    const message = toUserMsg(new ApiError({ status: 0, code: 'network' }));
    expect(tm(message)).toBe('No connection to the server. Please try again.');
    resetLocaleForTests('de-CH');
    expect(tm(message)).toBe(tFor('de-CH')('errors.code.network'));
  });

  it('keeps the table keys in line with the contract', () => {
    for (const key of Object.values(ERROR_CODE_MESSAGES)) {
      expect(tFor('en')(key)).not.toBe(key);
    }
    for (const key of Object.values(HTTP_STATUS_MESSAGES)) {
      expect(tFor('en')(key)).not.toBe(key);
    }
    expect(t('errors.status.unknown', { status: 1 })).toContain('1');
  });
});

describe('waitMinutes', () => {
  it('rounds up to whole minutes, at least one', () => {
    expect(waitMinutes(30)).toBe(1);
    expect(waitMinutes(60)).toBe(1);
    expect(waitMinutes(61)).toBe(2);
    expect(waitMinutes(900)).toBe(15);
    expect(waitMinutes(0)).toBe(1);
  });
});
