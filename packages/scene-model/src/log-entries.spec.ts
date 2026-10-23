import { tFor } from '@studioflow/i18n';
import type { LogCode, LogEntryDto } from './contracts';
import { formatDowntime } from './format';
import { LOG_MESSAGE_KEYS, logEntryText } from './log-entries';
import { logFixture } from './testing/fixtures';

const entry = (
  code: LogCode,
  params: Record<string, string> = {},
  text = 'English fallback',
): LogEntryDto => logFixture('x', { code, params, text });

describe('logEntryText', () => {
  it('writes the message of the code with the parameters of the entry', () => {
    expect(logEntryText(entry('sceneLive', { scene: 'Break' }))).toBe('Scene “Break” is live');
    expect(logEntryText(entry('devicePaired', { subject: 'S1, S2 Laptop Mia' }))).toBe(
      'S1, S2 Laptop Mia paired',
    );
    expect(logEntryText(entry('pairingDenied', { name: 'Lea' }))).toBe('Request from Lea denied');
    expect(logEntryText(entry('assetUploaded', { code: 'M1', name: 'Pause' }))).toBe(
      'M1 “Pause” uploaded',
    );
    expect(logEntryText(entry('broadcastStarted'))).toBe('Broadcast started');
    expect(logEntryText(entry('screenEnded', { code: 'S1' }))).toBe('S1 sharing stopped');
    expect(logEntryText(entry('cameraEnded', { code: 'K1' }))).toBe('K1 camera stopped');
  });

  it('formats the downtime of a recovered source from downSeconds', () => {
    expect(logEntryText(entry('sourceRecovered', { code: 'K2', downSeconds: '9' }))).toBe(
      'K2 is back, was gone for 9 s',
    );
    expect(logEntryText(entry('sourceRecovered', { code: 'K2', downSeconds: '170' }))).toBe(
      'K2 is back, was gone for 3 min',
    );
  });

  it('follows the active language', () => {
    const live = entry('sceneLive', { scene: 'Pause' });
    expect(logEntryText(live)).toBe('Scene “Pause” is live');
    expect(tFor('de-CH')('regie.log.sceneLive', { scene: 'Pause' })).toContain('«Pause»');
  });

  it('falls back to the English text for a code this client does not know', () => {
    const unknown = { ...entry('sceneLive'), code: 'somethingNew' } as unknown as LogEntryDto;
    expect(logEntryText(unknown)).toBe('English fallback');
  });

  it('has a message key for every code of the API', () => {
    expect(Object.keys(LOG_MESSAGE_KEYS)).toHaveLength(21);
    for (const [code, key] of Object.entries(LOG_MESSAGE_KEYS)) {
      expect(key).toBe(`regie.log.${code}`);
    }
  });
});

describe('formatDowntime', () => {
  it.each([
    [0, '1 s'],
    [9, '9 s'],
    [59, '59 s'],
    [60, '1 min'],
    [90, '2 min'],
    [150, '2 min'],
    [170, '3 min'],
    [Number.NaN, '1 s'],
  ])('%s s → %s', (seconds, expected) => {
    expect(formatDowntime(seconds)).toBe(expected);
  });
});
