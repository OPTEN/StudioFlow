import {
  MISSING_VALUE,
  formatBytes,
  formatCheckCode,
  formatClock,
  formatDb,
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
    [0.45, 2, '0.45'],
    [0.9, 2, '0.9'],
    [2, 2, '2'],
    [10, 2, '10'],
    [100, 1, '100'],
    [1.25, 1, '1.3'],
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
    expect(formatHm(new Date('broken'))).toBe('--:--');
  });
});

describe('formatSeconds', () => {
  it.each([
    [300, '0.3 s'],
    [200, '0.2 s'],
    [1500, '1.5 s'],
    [2000, '2 s'],
    [0, '0 s'],
    [1234, '1.234 s'],
  ])('%s ms → %s', (ms, expected) => {
    expect(formatSeconds(ms)).toBe(expected);
  });

  it('renders unknown values as a dash', () => {
    expect(formatSeconds(Number.NaN)).toBe(MISSING_VALUE);
  });
});

describe('formatRate / formatKbpsAsMbit', () => {
  it('uses one decimal', () => {
    expect(formatRate(2.8)).toBe('2.8');
    expect(formatRate(3)).toBe('3.0');
    expect(formatRate(2.85)).toMatch(/^2.(8|9)$/);
    expect(formatKbpsAsMbit(2800)).toBe('2.8');
    expect(formatKbpsAsMbit(0)).toBe('0.0');
    expect(formatRate(-0.04)).toBe('0.0');
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
    expect(formatPercent(78)).toBe('78%');
    expect(formatPercent(0.4, 1)).toBe('0.4%');
    expect(formatPercent(0, 1)).toBe('0.0%');
    expect(formatPercent(null)).toBe(MISSING_VALUE);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1_258_291, '1.2 MB'],
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
    ['reconnecting', 'reconnecting'],
    ['ended', 'sharing stopped'],
    ['blocked', 'blocked'],
    ['connecting', 'connecting…'],
    ['lost', 'no picture'],
    ['offline', 'not connected'],
    ['ok', ''],
  ] as const)('%s → %j', (status, word) => {
    expect(statusWord(status)).toBe(word);
  });

  it('uses the status word for incidents', () => {
    expect(incidentWord('reconnecting')).toBe('reconnecting');
    expect(incidentWord('ended')).toBe('sharing stopped');
    expect(incidentWord('lost')).toBe('no picture');
  });

  it('names an ended camera "camera stopped" and an ended screen "sharing stopped"', () => {
    expect(statusWord('ended', 'camera')).toBe('camera stopped');
    expect(statusWord('ended', 'screen')).toBe('sharing stopped');
    expect(statusWord('ended', null)).toBe('sharing stopped');
    expect(incidentWord('ended', 'camera')).toBe('camera stopped');
    expect(incidentWord('ended', 'screen')).toBe('sharing stopped');
    expect(statusWord('reconnecting', 'camera')).toBe('reconnecting');
    expect(incidentWord('lost', 'camera')).toBe('no picture');
  });
});

describe('microphones in statusWord', () => {
  it('names an ended microphone and a lost one by what is missing: the sound', () => {
    expect(statusWord('ended', 'audio')).toBe('microphone stopped');
    expect(statusWord('lost', 'audio')).toBe('no sound');
    expect(incidentWord('lost', 'audio')).toBe('no sound');
    expect(incidentWord('ended', 'audio')).toBe('microphone stopped');
    expect(statusWord('lost', 'camera')).toBe('no picture');
  });
});

describe('formatDb', () => {
  it.each([
    [0, '0.0'],
    [-0.04, '0.0'],
    [-6, '−6.0'],
    [-12.34, '−12.3'],
    [3.5, '+3.5'],
    [10, '+10.0'],
    [-99.9, '−99.9'],
    [-100, '−∞'],
    [-250, '−∞'],
    [Number.NEGATIVE_INFINITY, '−∞'],
  ])('%s → %s', (db, text) => {
    expect(formatDb(db)).toBe(text);
  });

  it('renders an unknown level as a dash', () => {
    expect(formatDb(null)).toBe(MISSING_VALUE);
    expect(formatDb(undefined)).toBe(MISSING_VALUE);
    expect(formatDb(Number.NaN)).toBe(MISSING_VALUE);
  });
});

describe('pluralize / formatItemCount', () => {
  it('picks singular only for exactly one', () => {
    expect(formatItemCount(1)).toBe('1 item');
    expect(formatItemCount(3)).toBe('3 items');
    expect(formatItemCount(0)).toBe('0 items');
    expect(pluralize(1, 'incident', 'incidents')).toBe('1 incident');
    expect(pluralize(2, 'incident', 'incidents')).toBe('2 incidents');
  });
});
