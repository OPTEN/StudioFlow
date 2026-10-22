import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('retries immediately the first time', () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(-3)).toBe(0);
  });

  it('doubles from 300 ms and caps at 5 s', () => {
    const noJitter = (): number => 0;
    expect([1, 2, 3, 4, 5, 6, 7, 50].map((count) => backoffDelay(count, noJitter))).toEqual([
      300, 600, 1200, 2400, 4800, 5000, 5000, 5000,
    ]);
  });

  it('adds up to 250 ms of jitter', () => {
    expect(backoffDelay(1, () => 0.999)).toBe(550);
    expect(backoffDelay(10, () => 1)).toBe(5250);
    for (let count = 1; count < 20; count += 1) {
      const delay = backoffDelay(count);
      expect(delay).toBeGreaterThanOrEqual(300);
      expect(delay).toBeLessThanOrEqual(5250);
    }
  });

  it('stays finite for huge retry counts', () => {
    expect(backoffDelay(Number.MAX_SAFE_INTEGER, () => 0)).toBe(5000);
  });
});
