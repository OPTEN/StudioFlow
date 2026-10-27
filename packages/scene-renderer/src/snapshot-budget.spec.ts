import { SNAPSHOT_TIME_SHARE, SnapshotBudget } from './snapshot-budget';

describe('SnapshotBudget', () => {
  let time = 0;
  const clock = () => time;

  beforeEach(() => {
    time = 1000;
  });

  it('allows copies that cost next to nothing, however often', () => {
    const budget = new SnapshotBudget(0.04, clock);
    for (let index = 0; index < 100; index++) {
      expect(budget.allows()).toBe(true);
      budget.measure(() => {
        time += 0.2;
      });
      time += 10;
    }
  });

  it('holds the next copy back until the passing time has paid for an expensive one', () => {
    const budget = new SnapshotBudget(0.04, clock);
    budget.measure(() => {
      time += 80;
    });
    expect(budget.allows()).toBe(false);
    // 80 ms at 4 % of the time: paid off after 2 s.
    time += 1999;
    expect(budget.allows()).toBe(false);
    time += 1;
    expect(budget.allows()).toBe(true);
  });

  it('charges a copy that throws, too', () => {
    const budget = new SnapshotBudget(0.04, clock);
    expect(() =>
      budget.measure(() => {
        time += 50;
        throw new Error('refused');
      }),
    ).toThrow('refused');
    expect(budget.allows()).toBe(false);
  });

  it('returns what the copy returns', () => {
    expect(new SnapshotBudget(0.04, clock).measure(() => 42)).toBe(42);
  });

  it('does not let one outlier stop the copies for long', () => {
    const budget = new SnapshotBudget(0.04, clock);
    budget.charge(60_000);
    expect(budget.allows()).toBe(false);
    // At most 150 ms of debt at 4 %: 3.75 s.
    time += 3750;
    expect(budget.allows()).toBe(true);
  });

  it('ignores nonsense charges and forgets everything on reset', () => {
    const budget = new SnapshotBudget(0.04, clock);
    budget.charge(Number.NaN);
    budget.charge(-5);
    budget.charge(Number.POSITIVE_INFINITY);
    expect(budget.allows()).toBe(true);
    budget.charge(100);
    expect(budget.allows()).toBe(false);
    budget.reset();
    expect(budget.allows()).toBe(true);
  });

  it('limits the copies to the share of the time over a long run', () => {
    const budget = new SnapshotBudget(SNAPSHOT_TIME_SHARE, clock);
    let spent = 0;
    for (let tick = 0; tick < 10_000; tick++) {
      time += 10;
      if (budget.allows()) {
        budget.measure(() => {
          time += 60;
          spent += 60;
        });
      }
    }
    const share = spent / (time - 1000);
    expect(share).toBeLessThan(SNAPSHOT_TIME_SHARE * 1.3);
    expect(share).toBeGreaterThan(SNAPSHOT_TIME_SHARE * 0.5);
  });
});
