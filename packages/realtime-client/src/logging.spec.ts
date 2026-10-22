import { LogLevel } from '@microsoft/signalr';
import { consoleLogger, describeError, logSafely, redactSecrets, redactingLogger } from './logging';
import { RecordingLogger } from './testing/fakes';

describe('redactSecrets', () => {
  it('redacts hub tokens and output keys in URLs', () => {
    // Device tokens contain a dot ({id}.{secret}), so a sentence-final dot is redacted together with the token.
    expect(
      redactSecrets('WebSocket connected to wss://h/hubs/device?id=abc&access_token=dev_1.s3cr3t.'),
    ).toBe('WebSocket connected to wss://h/hubs/device?id=abc&access_token=REDACTED');
    expect(redactSecrets('https://h/o/webinar?k=KEY_123&debug=1')).toBe(
      'https://h/o/webinar?k=REDACTED&debug=1',
    );
    expect(redactSecrets("'https://h/x?ACCESS_TOKEN=abc'")).toBe(
      "'https://h/x?ACCESS_TOKEN=REDACTED'",
    );
  });

  it('leaves other parameters and plain text alone', () => {
    expect(redactSecrets('https://h/x?kind=1&id=2')).toBe('https://h/x?kind=1&id=2');
    expect(redactSecrets('access_token is missing')).toBe('access_token is missing');
  });
});

describe('redactingLogger', () => {
  it('passes redacted messages to the inner logger', () => {
    const inner = new RecordingLogger();
    redactingLogger(inner).log(LogLevel.Information, 'url ?access_token=abc');
    expect(inner.lines).toEqual([
      { level: LogLevel.Information, message: 'url ?access_token=REDACTED' },
    ]);
  });
});

describe('consoleLogger', () => {
  it('drops lines below the minimum and maps levels to console methods', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = consoleLogger(LogLevel.Information);
    logger.log(LogLevel.Debug, 'debug');
    logger.log(LogLevel.Information, 'info');
    logger.log(LogLevel.Warning, 'warn');
    logger.log(LogLevel.Critical, 'critical');
    logger.log(LogLevel.None, 'none');
    consoleLogger(LogLevel.Trace).log(LogLevel.Trace, 'trace');
    expect(debug).toHaveBeenCalledWith('[FlowStudio realtime] trace');
    expect(info).toHaveBeenCalledWith('[FlowStudio realtime] info');
    expect(warn).toHaveBeenCalledWith('[FlowStudio realtime] warn');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[FlowStudio realtime] critical');
    expect(debug).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe('describeError', () => {
  it('describes errors, strings and other values, redacted', () => {
    expect(describeError(new Error('boom ?k=secret'))).toBe('boom ?k=REDACTED');
    expect(describeError(new TypeError(''))).toBe('TypeError');
    expect(describeError('text')).toBe('text');
    expect(describeError(undefined)).toBe('no error');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
  });
});

describe('logSafely', () => {
  it('ignores a missing logger and swallows logger errors', () => {
    expect(() => logSafely(undefined, LogLevel.Error, 'x')).not.toThrow();
    const broken = {
      log: () => {
        throw new Error('disk full');
      },
    };
    expect(() => logSafely(broken, LogLevel.Error, 'x')).not.toThrow();
  });

  it('redacts what it logs', () => {
    const logger = new RecordingLogger();
    logSafely(logger, LogLevel.Warning, 'see ?access_token=abc');
    expect(logger.messages()).toEqual(['see ?access_token=REDACTED']);
  });
});
