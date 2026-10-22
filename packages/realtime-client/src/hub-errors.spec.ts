import { hubErrorCode } from './hub-errors';

describe('hubErrorCode', () => {
  it('reads the code of a HubException as the SignalR client reports it', () => {
    const error = new Error(
      "An unexpected error occurred invoking 'Subscribe' on the server. HubException: not_found: Die Produktion gibt es nicht.",
    );
    expect(hubErrorCode(error)).toBe('not_found');
  });

  it('reads a bare server message and strings', () => {
    expect(
      hubErrorCode(new Error('service_unavailable: Die Datenbank ist nicht erreichbar.')),
    ).toBe('service_unavailable');
    expect(hubErrorCode('device_blocked: Das Gerät ist gesperrt.')).toBe('device_blocked');
    expect(hubErrorCode({ message: 'HubException: forbidden' })).toBeNull();
    expect(hubErrorCode({ message: 'HubException: forbidden: nein' })).toBe('forbidden');
  });

  it('is null for errors without a code', () => {
    expect(
      hubErrorCode(new Error('Invocation canceled due to the underlying connection being closed.')),
    ).toBeNull();
    expect(hubErrorCode(new Error('HubException: production not found'))).toBeNull();
    expect(hubErrorCode(new Error('Status code: 503'))).toBeNull();
    expect(hubErrorCode(undefined)).toBeNull();
    expect(hubErrorCode(42)).toBeNull();
    expect(hubErrorCode({ message: 7 })).toBeNull();
  });
});
