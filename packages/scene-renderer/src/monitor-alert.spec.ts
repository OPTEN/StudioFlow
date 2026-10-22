import { alertPresentation, formatElapsed, isAlertStatus } from './monitor-alert';

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [12_000, '00:12'],
    [61_500, '01:01'],
    [3_600_000, '60:00'],
    [-5000, '00:00'],
    [Number.NaN, '00:00'],
  ])('formats %s ms as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe('alertPresentation', () => {
  it('has no alert for healthy or waiting sources', () => {
    for (const status of ['ok', 'connecting', 'offline', undefined] as const) {
      expect(isAlertStatus(status)).toBe(false);
      expect(alertPresentation(status, 'K1', 0, 400)).toBeNull();
    }
  });

  it('shows the running hold timer in amber while reconnecting', () => {
    expect(alertPresentation('reconnecting', 'K2', 12_400, 400)).toEqual({
      color: '#e3b341',
      text: 'K2 · Standbild 00:12',
      timed: true,
    });
  });

  it('uses red and fixed words for the other outages', () => {
    expect(alertPresentation('ended', 'S1', 0, 400)).toEqual({
      color: '#f85149',
      text: 'S1 · Teilen beendet',
      timed: false,
    });
    expect(alertPresentation('blocked', 'K3', 0, 400)?.text).toBe('K3 · gesperrt');
    expect(alertPresentation('lost', 'K4', 0, 400)?.text).toBe('K4 · kein Bild');
  });

  it('uses short variants below 190 screen pixels', () => {
    expect(alertPresentation('reconnecting', 'K2', 75_000, 189)?.text).toBe('K2 · 01:15');
    expect(alertPresentation('ended', 'S1', 0, 120)?.text).toBe('S1 · beendet');
    expect(alertPresentation('blocked', 'K3', 0, 120)?.text).toBe('K3 · gesperrt');
    expect(alertPresentation('reconnecting', 'K2', 0, 190)?.text).toBe('K2 · Standbild 00:00');
  });

  it('omits an unknown code', () => {
    expect(alertPresentation('ended', undefined, 0, 400)?.text).toBe('Teilen beendet');
  });
});
