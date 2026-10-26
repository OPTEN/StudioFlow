import { resetLocaleForTests, tFor } from '@studioflow/i18n';
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

  it('writes the entries of the audit log', () => {
    expect(logEntryText(entry('loginFailed', { username: 'root' }))).toBe(
      'Sign-in failed for “root”',
    );
    expect(logEntryText(entry('loginLocked'))).toBe(
      'Sign-in locked after too many failed attempts',
    );
    expect(logEntryText(entry('productionRenamed', { from: 'Spring', name: 'Autumn' }))).toBe(
      'Production “Spring” renamed to “Autumn”',
    );
    expect(
      logEntryText(
        entry('canvasChanged', { from: '1920 × 1080 (16:9)', to: '1080 × 1920 (9:16)' }),
      ),
    ).toBe('Output changed from 1920 × 1080 (16:9) to 1080 × 1920 (9:16)');
    expect(logEntryText(entry('deviceRenamed', { subject: 'K1 Phone', name: 'Stage' }))).toBe(
      'K1 Phone renamed to “Stage”',
    );
    expect(logEntryText(entry('standbySlateChanged'))).toBe('Slate before the broadcast changed');
    expect(
      logEntryText(entry('auditRetention', { days: '365', deleted: '142', anonymised: '7' })),
    ).toBe('Audit retention (365 days): entries deleted 142, IP addresses removed 7');
    expect(logEntryText(entry('auditExported', { format: 'csv', rows: '42' }))).toBe(
      'Audit log exported as csv, 42 rows',
    );
  });

  it('names the lens of a lens switch in the language of the camera panel', () => {
    const params = { subject: 'K1 Phone' };
    expect(logEntryText(entry('cameraLensSwitched', { ...params, lens: 'ultraWide' }))).toBe(
      'K1 Phone: lens switched to Wide-angle',
    );
    expect(logEntryText(entry('cameraLensSwitched', { ...params, lens: 'front' }))).toBe(
      'K1 Phone: lens switched to Front',
    );
    expect(logEntryText(entry('cameraLensSwitched', { ...params, lens: 'other' }))).toBe(
      'K1 Phone: lens switched to Other',
    );
    resetLocaleForTests('de-CH');
    const german = tFor('de-CH');
    expect(logEntryText(entry('cameraLensSwitched', { ...params, lens: 'tele' }))).toBe(
      german('regie.log.cameraLensSwitched', {
        subject: 'K1 Phone',
        lens: german('regie.camera.lens.tele'),
      }),
    );
  });

  it('uses the English text of an audit entry without a code', () => {
    expect(logEntryText({ code: null, params: {}, text: 'scene.live' })).toBe('scene.live');
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
    const english = tFor('en')('regie.log.sceneLive', { scene: 'Pause' });
    const german = tFor('de-CH')('regie.log.sceneLive', { scene: 'Pause' });
    expect(logEntryText(live)).toBe(english);
    resetLocaleForTests('de-CH');
    expect(logEntryText(live)).toBe(german);
    expect(german).not.toBe(english);
  });

  it('falls back to the English text for a code this client does not know', () => {
    const unknown = { ...entry('sceneLive'), code: 'somethingNew' } as unknown as LogEntryDto;
    expect(logEntryText(unknown)).toBe('English fallback');
  });

  it('has a message key for every code of the API', () => {
    expect(Object.keys(LOG_MESSAGE_KEYS)).toHaveLength(52);
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
