import {
  compareText,
  countCharacters,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  lowerCase,
} from './format';
import { resetLocaleForTests } from './store';

describe('formatNumber', () => {
  it('uses a decimal point in English and a decimal comma in German (D3)', () => {
    expect(formatNumber(2.8, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('2.8');
    resetLocaleForTests('de-CH');
    expect(formatNumber(2.8, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('2,8');
  });

  it('rounds to the maximum and pads to the minimum number of fraction digits', () => {
    expect(formatNumber(0.45, { maximumFractionDigits: 1 })).toBe('0.5');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(2, { minimumFractionDigits: 2 })).toBe('2.00');
    expect(formatNumber(1.5, { maximumFractionDigits: 3 })).toBe('1.5');
  });

  it('writes no thousands separators unless asked to', () => {
    expect(formatNumber(1234.5, { maximumFractionDigits: 1 })).toBe('1234.5');
    resetLocaleForTests('de-CH');
    expect(formatNumber(1234.5, { maximumFractionDigits: 1 })).toBe('1234,5');
    expect(formatNumber(1234.5, { maximumFractionDigits: 1, useGrouping: true })).toBe('1.234,5');
  });

  it('never shows a minus sign for a value that rounds to zero', () => {
    expect(formatNumber(-0.04, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('0.0');
    expect(formatNumber(-0, { minimumFractionDigits: 1 })).toBe('0.0');
    expect(formatNumber(-0.5, { maximumFractionDigits: 1 })).toBe('-0.5');
  });

  it('honours an explicit sign display', () => {
    expect(formatNumber(3, { signDisplay: 'always' })).toBe('+3');
  });
});

describe('formatTime', () => {
  const afternoon = new Date(2026, 9, 23, 14, 5, 9);
  const midnight = new Date(2026, 9, 23, 0, 5, 9);

  it('shows hours and minutes in 24 h, in both locales', () => {
    expect(formatTime(afternoon)).toBe('14:05');
    resetLocaleForTests('de-CH');
    expect(formatTime(afternoon)).toBe('14:05');
  });

  it('adds seconds on request', () => {
    expect(formatTime(afternoon, { seconds: true })).toBe('14:05:09');
    resetLocaleForTests('de-CH');
    expect(formatTime(afternoon, { seconds: true })).toBe('14:05:09');
  });

  it('writes midnight as 00, never 24', () => {
    expect(formatTime(midnight, { seconds: true })).toBe('00:05:09');
    resetLocaleForTests('de-CH');
    expect(formatTime(midnight, { seconds: true })).toBe('00:05:09');
  });
});

describe('formatDate and formatDateTime', () => {
  const date = new Date(2026, 9, 23, 14, 5, 9);

  it('writes the date the way the locale does', () => {
    expect(formatDate(date)).toBe('23 Oct 2026');
    resetLocaleForTests('de-CH');
    expect(formatDate(date)).toBe('23.10.2026');
  });

  it('adds a 24 h time', () => {
    expect(formatDateTime(date)).toContain('14:05');
    expect(formatDateTime(date)).toContain('23 Oct 2026');
    resetLocaleForTests('de-CH');
    expect(formatDateTime(date)).toContain('14:05');
    expect(formatDateTime(date)).toContain('23.10.2026');
  });

  it('adds the seconds on request', () => {
    expect(formatDateTime(date)).not.toContain('14:05:09');
    expect(formatDateTime(date, { seconds: true })).toContain('14:05:09');
    resetLocaleForTests('de-CH');
    expect(formatDateTime(date, { seconds: true })).toContain('14:05:09');
  });
});

describe('compareText', () => {
  it('ignores case and accents', () => {
    expect(compareText('abc', 'ABC')).toBe(0);
    expect(compareText('e', 'é')).toBe(0);
    expect(compareText('a', 'b')).toBeLessThan(0);
  });

  it('orders numbers naturally when asked to', () => {
    expect(compareText('K2', 'K10', { numeric: true })).toBeLessThan(0);
    expect(compareText('K2', 'K10')).toBeGreaterThan(0);
    resetLocaleForTests('de-CH');
    expect(compareText('K2', 'K10', { numeric: true })).toBeLessThan(0);
  });

  it('can sort with Array.sort', () => {
    const codes = ['M1', 'K10', 'K2', 'S1', 'K1'];
    expect([...codes].sort((a, b) => compareText(a, b, { numeric: true }))).toEqual([
      'K1',
      'K2',
      'K10',
      'M1',
      'S1',
    ]);
  });
});

describe('lowerCase', () => {
  it('lower-cases text', () => {
    expect(lowerCase('Scene K2')).toBe('scene k2');
    resetLocaleForTests('de-CH');
    expect(lowerCase('GRÖSSE')).toBe('grösse');
  });
});
