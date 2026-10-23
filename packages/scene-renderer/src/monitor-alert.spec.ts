import { alertPresentation, isAlertStatus } from './monitor-alert';

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
      text: 'K2 · Freeze frame 00:12',
      timed: true,
    });
  });

  it('uses red and fixed words for the other outages', () => {
    expect(alertPresentation('ended', 'S1', 0, 400)).toEqual({
      color: '#f85149',
      text: 'S1 · sharing stopped',
      timed: false,
    });
    expect(alertPresentation('blocked', 'K3', 0, 400)?.text).toBe('K3 · blocked');
    expect(alertPresentation('lost', 'K4', 0, 400)?.text).toBe('K4 · no picture');
  });

  it('formats the hold timer like every other Regie timer', () => {
    expect(alertPresentation('reconnecting', 'K2', 999, 400)?.text).toBe('K2 · Freeze frame 00:00');
    expect(alertPresentation('reconnecting', 'K2', 61_500, 400)?.text).toBe(
      'K2 · Freeze frame 01:01',
    );
    expect(alertPresentation('reconnecting', 'K2', 3_600_000, 400)?.text).toBe(
      'K2 · Freeze frame 1:00:00',
    );
    expect(alertPresentation('reconnecting', 'K2', -5000, 400)?.text).toBe(
      'K2 · Freeze frame 00:00',
    );
    expect(alertPresentation('reconnecting', 'K2', Number.NaN, 400)?.text).toBe(
      'K2 · Freeze frame 00:00',
    );
  });

  it('names an ended camera “camera stopped” and an ended screen “sharing stopped”', () => {
    expect(alertPresentation('ended', 'K1', 0, 400, 'camera')?.text).toBe('K1 · camera stopped');
    expect(alertPresentation('ended', 'S1', 0, 400, 'screen')?.text).toBe('S1 · sharing stopped');
    expect(alertPresentation('ended', 'K1', 0, 120, 'camera')?.text).toBe('K1 · ended');
    expect(alertPresentation('lost', 'K1', 0, 400, 'camera')?.text).toBe('K1 · no picture');
  });

  it('uses short variants below 190 screen pixels', () => {
    expect(alertPresentation('reconnecting', 'K2', 75_000, 189)?.text).toBe('K2 · 01:15');
    expect(alertPresentation('ended', 'S1', 0, 120)?.text).toBe('S1 · ended');
    expect(alertPresentation('blocked', 'K3', 0, 120)?.text).toBe('K3 · blocked');
    expect(alertPresentation('reconnecting', 'K2', 0, 190)?.text).toBe('K2 · Freeze frame 00:00');
  });

  it('omits an unknown code', () => {
    expect(alertPresentation('ended', undefined, 0, 400)?.text).toBe('sharing stopped');
  });
});
