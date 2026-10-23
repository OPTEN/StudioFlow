import { resetLocaleForTests } from '@studioflow/i18n';
import {
  MISSING_VALUE,
  formatBytes,
  formatClock,
  formatDecimal,
  formatHm,
  formatItemCount,
  formatKbpsAsMbit,
  formatPercent,
  formatRate,
  formatSeconds,
  incidentWord,
  statusWord,
} from './format';

describe('formatting in German (Switzerland)', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it.each([
    [0.45, 2, '0,45'],
    [0.9, 2, '0,9'],
    [2, 2, '2'],
    [1.25, 1, '1,3'],
    [-3840, 2, '-3840'],
    [-0.0001, 2, '0'],
    [1234.5, 1, '1234,5'],
  ])(
    'writes %s with %s digits as %s: decimal comma, no thousands separator',
    (value, digits, expected) => {
      expect(formatDecimal(value, digits)).toBe(expected);
    },
  );

  it('writes seconds, rates, percentages and sizes with a decimal comma', () => {
    expect(formatSeconds(300)).toBe('0,3 s');
    expect(formatSeconds(2000)).toBe('2 s');
    expect(formatSeconds(1234)).toBe('1,234 s');
    expect(formatRate(2.8)).toBe('2,8');
    expect(formatRate(3)).toBe('3,0');
    expect(formatRate(-0.04)).toBe('0,0');
    expect(formatKbpsAsMbit(2800)).toBe('2,8');
    expect(formatPercent(78)).toBe('78 %');
    expect(formatPercent(0.4, 1)).toBe('0,4 %');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(1_258_291)).toBe('1,2 MB');
  });

  it('keeps the dash for unknown values', () => {
    expect(formatRate(null)).toBe(MISSING_VALUE);
    expect(formatSeconds(Number.NaN)).toBe(MISSING_VALUE);
  });

  it('shows a 24 h clock', () => {
    expect(formatClock(new Date(2026, 9, 22, 7, 5, 9))).toBe('07:05:09');
    expect(formatClock(new Date(2026, 9, 22, 0, 5, 9))).toBe('00:05:09');
    expect(formatHm(new Date(2026, 9, 22, 23, 59, 0))).toBe('23:59');
  });

  it('has the German status words', () => {
    expect(statusWord('reconnecting')).toBe('verbindet neu');
    expect(statusWord('blocked')).toBe('gesperrt');
    expect(statusWord('connecting')).toBe('verbindet …');
    expect(statusWord('lost')).toBe('kein Bild');
    expect(statusWord('offline')).toBe('nicht verbunden');
    expect(statusWord('ok')).toBe('');
    expect(statusWord('ended', 'camera')).toBe('Kamera beendet');
    expect(statusWord('ended', 'screen')).toBe('Teilen beendet');
    expect(statusWord('ended', null)).toBe('Teilen beendet');
    expect(incidentWord('lost', 'camera')).toBe('kein Bild');
  });

  it('counts items in German', () => {
    expect(formatItemCount(0)).toBe('0 Elemente');
    expect(formatItemCount(1)).toBe('1 Element');
    expect(formatItemCount(3)).toBe('3 Elemente');
  });
});
