import { LossPlayout } from './loss-playout';

describe('LossPlayout', () => {
  it('keeps the base target on a clean link', () => {
    const playout = new LossPlayout(50);
    expect(playout.target).toBe(50);
    expect(playout.update(0)).toBe(50);
    expect(playout.update(0.01)).toBe(50);
    expect(playout.update(undefined)).toBe(50);
  });

  it('grows the buffer at once with the loss', () => {
    const playout = new LossPlayout(50);
    expect(playout.update(0.03)).toBe(200);
    expect(playout.update(0.2)).toBe(400);
  });

  it('shrinks to what the loss asks only after three calm intervals in a row', () => {
    const playout = new LossPlayout(50);
    playout.update(0.2);
    expect(playout.lossy).toBe(true);
    for (let interval = 0; interval < 2; interval += 1) {
      expect(playout.update(0.001)).toBe(400);
    }
    expect(playout.update(0.001)).toBe(50);
    expect(playout.lossy).toBe(false);
  });

  it('is not calm while the loss hovers around a threshold', () => {
    const playout = new LossPlayout(50);
    playout.update(0.03);
    for (let interval = 0; interval < 20; interval += 1) {
      playout.update(0.001);
      playout.update(0.015);
    }
    expect(playout.target).toBe(200);
  });

  it('ignores an interval without measurement', () => {
    const playout = new LossPlayout(50);
    playout.update(0.03);
    for (let interval = 0; interval < 10; interval += 1) {
      playout.update(undefined);
      playout.update(Number.NaN);
    }
    expect(playout.target).toBe(200);
  });

  it('never goes below the base target of the role', () => {
    expect(new LossPlayout(300).update(0.03)).toBe(300);
  });
});
