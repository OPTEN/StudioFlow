import { QUIET_BUSY_PCT, elapsedInTest, judgeTiming, markTestStart, measureWhenQuiet, planAttempt, timingGate, waitForQuietMachine, type AttemptPlanInput, type Clock } from './quiet';

/** UNIT-PERF-06 (docs/testing.md 2.18): the budget of the tests that wait for a quiet machine and the gate of their thresholds (issue #39). */

const SECOND = 1000;

function input(overrides: Partial<AttemptPlanInput> = {}): AttemptPlanInput {
  return {
    testTimeoutMs: 900 * SECOND,
    elapsedMs: 0,
    runMs: 66 * SECOND,
    reserveMs: 60 * SECOND,
    attemptsDone: 0,
    attempts: 3,
    waitedMs: 0,
    maxWaitMs: 240 * SECOND,
    wantedWaitMs: 240 * SECOND,
    ...overrides,
  };
}

describe('planAttempt', () => {
  it('runs the first attempt even when it hardly fits, and does not wait then', () => {
    expect(planAttempt(input({ testTimeoutMs: 100 * SECOND, elapsedMs: 95 * SECOND }))).toEqual({ run: true, waitMs: 0 });
  });

  it('starts no further attempt that would not fit before the timeout, less the reserve', () => {
    expect(planAttempt(input({ attemptsDone: 1, elapsedMs: 780 * SECOND }))).toEqual({ run: false, reason: 'time' });
    expect(planAttempt(input({ attemptsDone: 1, elapsedMs: 700 * SECOND }))).toMatchObject({ run: true });
  });

  it('stops when the attempts are used', () => {
    expect(planAttempt(input({ attemptsDone: 3 }))).toEqual({ run: false, reason: 'attempts' });
  });

  it('caps the waiting for a quiet machine over the whole test, not per attempt', () => {
    expect(planAttempt(input({ maxWaitMs: 30 * SECOND }))).toEqual({ run: true, waitMs: 30 * SECOND });
    expect(planAttempt(input({ maxWaitMs: 30 * SECOND, waitedMs: 25 * SECOND, attemptsDone: 1 }))).toEqual({ run: true, waitMs: 5 * SECOND });
    expect(planAttempt(input({ maxWaitMs: 30 * SECOND, waitedMs: 30 * SECOND, attemptsDone: 1 }))).toEqual({ run: true, waitMs: 0 });
  });

  it('never lets the waiting eat into the time the run itself needs', () => {
    // 300 s timeout, 100 s gone, 60 s reserve, 66 s run: 74 s are left for waiting.
    expect(planAttempt(input({ testTimeoutMs: 300 * SECOND, elapsedMs: 100 * SECOND }))).toEqual({ run: true, waitMs: 74 * SECOND });
  });

  it('has no time limit when the test has no timeout', () => {
    expect(planAttempt(input({ testTimeoutMs: 0, elapsedMs: 10_000 * SECOND, attemptsDone: 2 }))).toEqual({ run: true, waitMs: 240 * SECOND });
  });

  it('keeps every sequence of attempts inside the timeout (the runs of issue #39: 900 s and 600 s, 66 s and 35 s per run)', () => {
    for (const [testTimeoutMs, runMs] of [
      [900 * SECOND, 66 * SECOND],
      [600 * SECOND, 35 * SECOND],
      [900 * SECOND, 150 * SECOND],
      [300 * SECOND, 66 * SECOND],
    ] as const) {
      for (const maxWaitMs of [30 * SECOND, 240 * SECOND]) {
        let elapsedMs = 20 * SECOND; // the fixtures and the set-up of the test
        let waitedMs = 0;
        let attemptsDone = 0;
        for (;;) {
          const plan = planAttempt(input({ testTimeoutMs, elapsedMs, runMs, attemptsDone, waitedMs, maxWaitMs }));
          if (!plan.run) break;
          elapsedMs += plan.waitMs + runMs;
          waitedMs += plan.waitMs;
          attemptsDone += 1;
        }
        const label = `timeout ${testTimeoutMs / SECOND} s, run ${runMs / SECOND} s, wait cap ${maxWaitMs / SECOND} s`;
        expect(attemptsDone, label).toBeGreaterThanOrEqual(1);
        expect(elapsedMs, `${label}: ends with the reserve left`).toBeLessThanOrEqual(testTimeoutMs - 60 * SECOND);
        expect(waitedMs, label).toBeLessThanOrEqual(maxWaitMs);
      }
    }
  });
});

describe('timingGate', () => {
  it('enforces the thresholds on a machine with headroom', () => {
    expect(timingGate(35)).toMatchObject({ enforce: true, busyPct: 35 });
    expect(timingGate(QUIET_BUSY_PCT).enforce, 'the limit itself still counts').toBe(true);
  });

  it('does not enforce them on a busy machine and says why (the 2-vCPU runner of issue #39)', () => {
    const gate = timingGate(93.3);
    expect(gate.enforce).toBe(false);
    expect(gate.reason).toContain('93.3 %');
    expect(gate.reason).toContain('not comparable');
    expect(timingGate(100).enforce).toBe(false);
  });

  it('does not judge a load it does not know', () => {
    expect(timingGate(null).enforce).toBe(false);
    expect(timingGate(undefined).enforce).toBe(false);
    expect(timingGate(Number.NaN).enforce).toBe(false);
  });

  it('takes the limit of the caller', () => {
    expect(timingGate(75, 80).enforce).toBe(true);
    expect(timingGate(75, 40).enforce).toBe(false);
  });
});

describe('judgeTiming', () => {
  const fake = () => ({ annotations: [] as Array<{ type: string; description?: string }>, skip: vi.fn() });
  const failing = () => {
    throw new Error('\u001b[2mT-LATENCY p50\u001b[22m (acceptance < 200 ms)\n\nExpected: < 200\nReceived: 412');
  };

  it('lets a failure through on a machine with headroom', async () => {
    const testInfo = fake();
    await expect(judgeTiming(testInfo as never, timingGate(20), failing)).rejects.toThrow('T-LATENCY p50');
    expect(testInfo.skip).not.toHaveBeenCalled();
  });

  it('lets a failure of a figure from a busy machine end in a skip that says what failed (the 2-vCPU runner of issue #39)', async () => {
    const testInfo = fake();
    const gate = timingGate(98);
    await judgeTiming(testInfo as never, gate, failing);
    expect(testInfo.skip).toHaveBeenCalledTimes(1);
    const description = testInfo.skip.mock.calls[0]![1] as string;
    expect(description).toContain('98 %');
    expect(description).toContain('not comparable');
    expect(description).toContain('T-LATENCY p50 (acceptance < 200 ms)');
    expect(description, 'no colour codes, one line').not.toMatch(/\u001b|\n/);
    expect(testInfo.annotations).toEqual([{ type: 'not-comparable', description }]);
  });

  it('keeps a pass a pass, also on a busy machine', async () => {
    const testInfo = fake();
    await judgeTiming(testInfo as never, timingGate(98), async () => {
      expect(1).toBe(1);
    });
    expect(testInfo.skip).not.toHaveBeenCalled();
    expect(testInfo.annotations).toEqual([]);
  });

  it('does not judge a load it does not know', async () => {
    const testInfo = fake();
    await judgeTiming(testInfo as never, timingGate(undefined), failing);
    expect(testInfo.skip).toHaveBeenCalledTimes(1);
  });
});

/** A clock that only moves when somebody sleeps or the measurement says so: minutes of waiting take no time in the test. */
function fakeClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

describe('waiting for a quiet machine', () => {
  it('does not wait at all without time', async () => {
    const clock = fakeClock();
    expect(await waitForQuietMachine({ timeoutMs: 0, clock })).toEqual({ quiet: false, waitedMs: 0, busyPct: null });
    expect(await waitForQuietMachine({ timeoutMs: 500, clock })).toEqual({ quiet: false, waitedMs: 0, busyPct: null });
  });

  it('returns at the first window when the machine is quiet', async () => {
    const clock = fakeClock();
    expect(await waitForQuietMachine({ maxBusyPct: 100, windowMs: 2 * SECOND, timeoutMs: 60 * SECOND, clock })).toMatchObject({ quiet: true, waitedMs: 2 * SECOND });
  });

  it('gives up at the timeout, not a window later, when the machine never gets quiet', async () => {
    const clock = fakeClock();
    const result = await waitForQuietMachine({ maxBusyPct: -1, windowMs: 2 * SECOND, timeoutMs: 5 * SECOND, clock });
    expect(result.quiet).toBe(false);
    // Two windows of 2 s and one of 1 s; the 0 s that are left are not worth a window.
    expect(result.waitedMs).toBe(5 * SECOND);
  });
});

describe('measureWhenQuiet', () => {
  const testInfo = (clock: Clock, timeout: number) => {
    const info = { timeout };
    markTestStart(info, clock.now());
    return info;
  };

  it('takes the first run on a quiet machine', async () => {
    const clock = fakeClock();
    const measure = vi.fn(async () => ({ p50: 80 }));
    const measured = await measureWhenQuiet(measure, { testInfo: testInfo(clock, 900 * SECOND), runMs: 60 * SECOND, maxBusyPct: 100, quiet: { timeoutMs: 0 }, clock });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measured).toMatchObject({ quiet: true, stoppedBecause: 'quiet', waitedMs: 0 });
    expect(measured.chosen.p50).toBe(80);
  });

  it('repeats up to the attempts on a busy machine, keeps all of them and takes the one with the lowest load', async () => {
    const clock = fakeClock();
    let call = 0;
    const measure = async () => ({ run: (call += 1) });
    const measured = await measureWhenQuiet(measure, { testInfo: testInfo(clock, 0), runMs: 60 * SECOND, maxBusyPct: -1, attempts: 3, quiet: { timeoutMs: 0 }, clock });
    expect(measured.attempts.map((attempt) => attempt.run)).toEqual([1, 2, 3]);
    expect(measured.quiet).toBe(false);
    expect(measured.stoppedBecause).toBe('attempts');
    expect(measured.chosen.cpu.busyPct).toBe(Math.min(...measured.attempts.map((attempt) => attempt.cpu.busyPct)));
  });

  it('starts no attempt that does not fit into the timeout and never waits into it (issue #39: 3 x 312 s in a 900 s test)', async () => {
    // A machine that never gets quiet: every wait takes what it is allowed, every run 66 s of the (fake) clock.
    const clock = fakeClock();
    const info = testInfo(clock, 900 * SECOND);
    const measure = async () => {
      clock.advance(66 * SECOND);
      return { p50: 120 };
    };
    const measured = await measureWhenQuiet(measure, { testInfo: info, runMs: 66 * SECOND, maxBusyPct: -1, attempts: 3, maxWaitMs: 240 * SECOND, quiet: { maxBusyPct: -1, windowMs: 6 * SECOND }, clock });
    const spent = elapsedInTest(info, clock.now());
    expect(measured.quiet).toBe(false);
    expect(measured.attempts).toHaveLength(3);
    expect(measured.waitedMs, 'the waiting is capped for the whole test, not per attempt').toBeLessThanOrEqual(240 * SECOND);
    expect(spent, 'the old code needed 3 x (246 + 66) s').toBeLessThanOrEqual(240 * SECOND + 3 * 66 * SECOND);
    expect(spent).toBeLessThanOrEqual(900 * SECOND - 60 * SECOND);
  });

  it('on a runner with a short wait cap a busy machine costs the cap and the runs, not the whole test', async () => {
    const clock = fakeClock();
    const info = testInfo(clock, 600 * SECOND);
    const measure = async () => {
      clock.advance(35 * SECOND);
      return { p50: 150 };
    };
    const measured = await measureWhenQuiet(measure, { testInfo: info, runMs: 35 * SECOND, maxBusyPct: -1, attempts: 3, maxWaitMs: 30 * SECOND, quiet: { maxBusyPct: -1, windowMs: 6 * SECOND }, clock });
    expect(measured.waitedMs).toBe(30 * SECOND);
    expect(elapsedInTest(info, clock.now())).toBe(30 * SECOND + 3 * 35 * SECOND);
  });

  it('stops attempting when the next one would not fit and says why', async () => {
    const clock = fakeClock();
    const info = testInfo(clock, 200 * SECOND);
    const measure = async () => {
      clock.advance(66 * SECOND);
      return { p50: 120 };
    };
    const measured = await measureWhenQuiet(measure, { testInfo: info, runMs: 66 * SECOND, maxBusyPct: -1, attempts: 5, maxWaitMs: 0, clock });
    // 200 s - 60 s reserve = 140 s: two runs of 66 s fit, a third does not.
    expect(measured.attempts).toHaveLength(2);
    expect(measured.stoppedBecause).toBe('time');
    expect(measured.quiet).toBe(false);
  });
});
