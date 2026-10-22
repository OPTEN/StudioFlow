import {
  MISSING_VALUE,
  formatBytes,
  formatCheckCode,
  formatClock,
  formatDecimal,
  formatDuration,
  formatHm,
  formatItemCount,
  formatKbpsAsMbit,
  formatPercent,
  formatRate,
  formatRuntime,
  formatSeconds,
  incidentWord,
  pluralize,
  statusWord,
} from './format';

describe('formatDecimal', () => {
  it.each([
    [0.45, 2, '0,45'],
    [0.9, 2, '0,9'],
    [2, 2, '2'],
    [10, 2, '10'],
    [100, 1, '100'],
    [1.25, 1, '1,3'],
    [-3840, 2, '-3840'],
    [-0.0001, 2, '0'],
  ])('%s with %s digits → %s', (value, digits, expected) => {
    expect(formatDecimal(value, digits)).toBe(expected);
  });

  it('renders unknown values as a dash', () => {
    expect(formatDecimal(Number.NaN)).toBe(MISSING_VALUE);
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe(MISSING_VALUE);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [9_000, '00:09'],
    [61_000, '01:01'],
    [3_599_999, '59:59'],
    [3_600_000, '1:00:00'],
    [36_061_000, '10:01:01'],
  ])('%s ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([-5000, Number.NaN, Number.NEGATIVE_INFINITY])('clamps %s to 00:00', (ms) => {
    expect(formatDuration(ms)).toBe('00:00');
  });
});

describe('formatRuntime', () => {
  it.each([
    [0, '00:00:00'],
    [(42 * 60 + 13) * 1000, '00:42:13'],
    [(3 * 3600 + 5) * 1000, '03:00:05'],
    [100 * 3600 * 1000, '100:00:00'],
    [-1, '00:00:00'],
  ])('%s ms → %s', (ms, expected) => {
    expect(formatRuntime(ms)).toBe(expected);
  });
});

describe('formatClock / formatHm', () => {
  it('formats local time with leading zeros in 24 h', () => {
    const date = new Date(2026, 9, 22, 7, 5, 9);
    expect(formatClock(date)).toBe('07:05:09');
    expect(formatHm(date)).toBe('07:05');
    expect(formatClock(new Date(2026, 9, 22, 23, 59, 59))).toBe('23:59:59');
  });

  it('shows placeholders for invalid dates', () => {
    expect(formatClock(new Date(Number.NaN))).toBe('--:--:--');
    expect(formatHm(new Date('kaputt'))).toBe('--:--');
  });
});

describe('formatSeconds', () => {
  it.each([
    [300, '0,3 s'],
    [200, '0,2 s'],
    [1500, '1,5 s'],
    [2000, '2 s'],
    [0, '0 s'],
    [1234, '1,234 s'],
  ])('%s ms → %s', (ms, expected) => {
    expect(formatSeconds(ms)).toBe(expected);
  });

  it('renders unknown values as a dash', () => {
    expect(formatSeconds(Number.NaN)).toBe(MISSING_VALUE);
  });
});

describe('formatRate / formatKbpsAsMbit', () => {
  it('uses one decimal with a comma', () => {
    expect(formatRate(2.8)).toBe('2,8');
    expect(formatRate(3)).toBe('3,0');
    expect(formatRate(2.85)).toMatch(/^2,(8|9)$/);
    expect(formatKbpsAsMbit(2800)).toBe('2,8');
    expect(formatKbpsAsMbit(0)).toBe('0,0');
  });

  it('renders unknown values as a dash', () => {
    expect(formatRate(null)).toBe(MISSING_VALUE);
    expect(formatRate(undefined)).toBe(MISSING_VALUE);
    expect(formatKbpsAsMbit(null)).toBe(MISSING_VALUE);
    expect(formatKbpsAsMbit(Number.NaN)).toBe(MISSING_VALUE);
  });
});

describe('formatCheckCode', () => {
  it('splits a four digit code', () => {
    expect(formatCheckCode('4712')).toBe('47 12');
    expect(formatCheckCode('0007')).toBe('00 07');
  });

  it.each(['', '471', '47123', '47a2', '47 12'])('returns %j unchanged', (code) => {
    expect(formatCheckCode(code)).toBe(code);
  });
});

describe('formatPercent', () => {
  it('formats a percentage', () => {
    expect(formatPercent(78)).toBe('78 %');
    expect(formatPercent(0.4, 1)).toBe('0,4 %');
    expect(formatPercent(0, 1)).toBe('0,0 %');
    expect(formatPercent(null)).toBe(MISSING_VALUE);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1,5 KB'],
    [1_258_291, '1,2 MB'],
    [25 * 1024 * 1024, '25 MB'],
    [1024 * 1024 * 1024, '1 GB'],
    [1024 * 1024 - 1, '1 MB'],
    [5 * 1024 ** 5, '5120 TB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('renders %s as a dash', (bytes) => {
    expect(formatBytes(bytes)).toBe(MISSING_VALUE);
  });
});

describe('statusWord / incidentWord', () => {
  it.each([
    ['reconnecting', 'verbindet neu'],
    ['ended', 'Teilen beendet'],
    ['blocked', 'gesperrt'],
    ['connecting', 'verbindet …'],
    ['lost', 'kein Bild'],
    ['offline', 'nicht verbunden'],
    ['ok', ''],
  ] as const)('%s → %j', (status, word) => {
    expect(statusWord(status)).toBe(word);
  });

  it('uses the status word for incidents', () => {
    expect(incidentWord('reconnecting')).toBe('verbindet neu');
    expect(incidentWord('ended')).toBe('Teilen beendet');
    expect(incidentWord('lost')).toBe('kein Bild');
  });
});

describe('pluralize / formatItemCount', () => {
  it('picks singular only for exactly one', () => {
    expect(formatItemCount(1)).toBe('1 Element');
    expect(formatItemCount(3)).toBe('3 Elemente');
    expect(formatItemCount(0)).toBe('0 Elemente');
    expect(pluralize(1, 'Störung', 'Störungen')).toBe('1 Störung');
    expect(pluralize(2, 'Störung', 'Störungen')).toBe('2 Störungen');
  });
});
