import os from 'node:os';
import type { TestInfo } from '@playwright/test';

/**
 * Timing tests on a machine that has no headroom (issue #39).
 *
 * A latency or frame-rate figure is only comparable with its threshold if the machine had CPU to spare while it was taken:
 * the senders (software H.264 encoders), the stack and the browsers of the test share the cores, and on a 2-vCPU runner they
 * never get quiet. This module does three things for such tests: it measures how busy the machine is, it waits for a quiet
 * machine only as long as the time budget of the test allows (never into the test timeout), and it decides whether the
 * absolute thresholds of a measurement may be enforced. A measurement on a busy machine is recorded and reported as
 * "not comparable"; it neither passes nor fails against thresholds it cannot meet for reasons outside the product.
 */

/** Share of the whole machine (all cores) that may be busy while a figure is taken for the figure to count. */
export const QUIET_BUSY_PCT = 60;

/** The shortest window of CPU use that says anything (a shorter wait is not worth starting). */
const MIN_WINDOW_MS = 1000;

export interface CpuUse {
  busyPct: number;
  cores: number;
}

/**
 * Average CPU use of the whole machine from now until the returned function is called (the OUT numbers are taken on a
 * shared machine, so a latency figure is only meaningful next to the load it was taken under).
 */
export function startCpuMonitor(): () => CpuUse {
  const snapshot = () => os.cpus().map((cpu) => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) }));
  const first = snapshot();
  return () => {
    const last = snapshot();
    let idle = 0;
    let total = 0;
    last.forEach((cpu, index) => {
      idle += cpu.idle - first[index]!.idle;
      total += cpu.total - first[index]!.total;
    });
    return { busyPct: total === 0 ? 0 : Math.round((1 - idle / total) * 1000) / 10, cores: last.length };
  };
}

/** The clock of the waiting; the unit tests bring their own, so that minutes of waiting take no time. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface QuietWait {
  quiet: boolean;
  /** How long it waited. */
  waitedMs: number;
  /** CPU use of the last window, null if it did not wait at all. */
  busyPct: number | null;
}

export interface QuietWaitOptions {
  maxBusyPct?: number;
  windowMs?: number;
  timeoutMs?: number;
  clock?: Clock;
}

/**
 * Waits until the whole machine is reasonably idle: `windowMs` windows of CPU use, started again until one is at or below
 * `maxBusyPct`. It never waits longer than `timeoutMs` in total (the last window is shortened to fit); with less than a
 * second left it does not wait at all. Returns `quiet: false` when the time ran out (the measurement then runs under load and
 * says so).
 */
export async function waitForQuietMachine(options: QuietWaitOptions = {}): Promise<QuietWait> {
  const { maxBusyPct = 40, windowMs = 6000, timeoutMs = 240_000, clock = realClock } = options;
  const started = clock.now();
  let busyPct: number | null = null;
  for (;;) {
    const window = Math.min(windowMs, timeoutMs - (clock.now() - started));
    if (window < MIN_WINDOW_MS) return { quiet: false, waitedMs: clock.now() - started, busyPct };
    const stop = startCpuMonitor();
    await clock.sleep(window);
    busyPct = stop().busyPct;
    if (busyPct <= maxBusyPct) return { quiet: true, waitedMs: clock.now() - started, busyPct };
  }
}

/** What `planAttempt` needs to know to decide about the next attempt of a measurement. */
export interface AttemptPlanInput {
  /** Timeout of the test in ms, 0 for none. */
  testTimeoutMs: number;
  /** How long the test has run so far (fixtures included, they count against the timeout). */
  elapsedMs: number;
  /** How long one run of the measurement takes. */
  runMs: number;
  /** Time the test keeps for what follows the measurement (recording, assertions, clean-up). */
  reserveMs: number;
  /** Attempts made so far and allowed in all. */
  attemptsDone: number;
  attempts: number;
  /** Time spent waiting for a quiet machine so far, the most it may spend in all, and what one attempt wants. */
  waitedMs: number;
  maxWaitMs: number;
  wantedWaitMs: number;
}

export type AttemptPlan = { run: true; waitMs: number } | { run: false; reason: 'attempts' | 'time' };

/**
 * Decides whether another attempt fits and how long it may wait for a quiet machine first. The first attempt always runs
 * (a test that cannot even fit one is mis-sized, and timing out says so); a further one only if a whole run still fits
 * before the timeout, less the reserve; the wait never eats into the time the run itself needs.
 */
export function planAttempt(input: AttemptPlanInput): AttemptPlan {
  if (input.attemptsDone >= input.attempts) return { run: false, reason: 'attempts' };
  const left = input.testTimeoutMs > 0 ? input.testTimeoutMs - input.elapsedMs - input.reserveMs : Number.POSITIVE_INFINITY;
  if (input.attemptsDone > 0 && left < input.runMs) return { run: false, reason: 'time' };
  return { run: true, waitMs: Math.max(0, Math.min(input.wantedWaitMs, input.maxWaitMs - input.waitedMs, left - input.runMs)) };
}

/** How long a whole test may wait for a quiet machine: a runner has nothing else that could go quiet, a shared machine has. */
export const defaultMaxWaitMs = (): number => (process.env['CI'] ? 30_000 : 240_000);

const startedAt = new WeakMap<object, number>();

/**
 * Notes when a test started. Playwright knows it but does not tell: `TestInfo` has the timeout, not the time that is gone.
 * A spec that waits for a quiet machine calls this from `test.beforeEach`, so that `measureWhenQuiet` knows how much of
 * the timeout is left after the set-up (cameras that go live take a minute).
 */
export function markTestStart(testInfo: object, at: number = Date.now()): void {
  startedAt.set(testInfo, at);
}

/** How long the test has run; 0 if `markTestStart` was not called (the reserve then has to cover the set-up). */
export function elapsedInTest(testInfo: object, now: number = Date.now()): number {
  return now - (startedAt.get(testInfo) ?? now);
}

export interface MeasureWhenQuietOptions {
  /** The running test: its timeout, and the time that is gone since `markTestStart`, bound the waiting and the attempts. */
  testInfo: Pick<TestInfo, 'timeout'>;
  /** How long one run of the measurement takes (without any waiting). */
  runMs: number;
  /** Time the test keeps for what follows the measurement. Default 60 s. */
  reserveMs?: number;
  /** Attempts at most; the first one at or below `maxBusyPct` counts. Default 3. */
  attempts?: number;
  /** CPU use of the whole machine during a run at or below which the run counts as taken on a quiet machine. */
  maxBusyPct?: number;
  /** What one attempt waits for a quiet machine before it starts (`maxBusyPct` here is the one for the idle machine). */
  quiet?: Omit<QuietWaitOptions, 'clock'>;
  /** The clock, for the unit tests. */
  clock?: Clock;
  /** The most the whole test waits for a quiet machine. Default: 30 s on CI, 240 s on a shared machine. */
  maxWaitMs?: number;
}

export type Measured<T> = T & { cpu: CpuUse; waitedMs: number };

export interface QuietMeasurement<T> {
  /** The first run that was taken on a quiet machine, else the one with the lowest load. */
  chosen: Measured<T>;
  /** Every attempt, kept for the record. */
  attempts: Array<Measured<T>>;
  /** True if `chosen` was taken on a quiet machine: its figures may be held against the thresholds. */
  quiet: boolean;
  /** Time spent waiting for a quiet machine in all. */
  waitedMs: number;
  /** Why it stopped: a quiet run, no attempts left or no time left. */
  stoppedBecause: 'quiet' | 'attempts' | 'time';
}

/**
 * Runs a timed measurement up to `attempts` times until the machine was not saturated while it ran (CPU use of the whole
 * machine at or below `maxBusyPct`); returns the first such attempt, else the one with the lowest load. It waits for a
 * quiet machine before an attempt only as long as the budget of the test allows, and starts no attempt that would not fit
 * into the test timeout: a machine that never gets quiet costs a bounded amount of time and ends in a measurement that
 * says `quiet: false`, not in a timeout.
 */
export async function measureWhenQuiet<T>(measure: () => Promise<T>, options: MeasureWhenQuietOptions): Promise<QuietMeasurement<T>> {
  const { testInfo, runMs, reserveMs = 60_000, attempts = 3, maxBusyPct = QUIET_BUSY_PCT, maxWaitMs = defaultMaxWaitMs(), clock = realClock } = options;
  const wantedWaitMs = options.quiet?.timeoutMs ?? 240_000;
  const all: Array<Measured<T>> = [];
  let waitedTotal = 0;
  let stoppedBecause: QuietMeasurement<T>['stoppedBecause'] = 'attempts';
  for (;;) {
    const plan = planAttempt({
      testTimeoutMs: testInfo.timeout,
      elapsedMs: elapsedInTest(testInfo, clock.now()),
      runMs,
      reserveMs,
      attemptsDone: all.length,
      attempts,
      waitedMs: waitedTotal,
      maxWaitMs,
      wantedWaitMs,
    });
    if (!plan.run) {
      stoppedBecause = plan.reason;
      break;
    }
    const waited = await waitForQuietMachine({ ...options.quiet, timeoutMs: plan.waitMs, clock });
    waitedTotal += waited.waitedMs;
    const stop = startCpuMonitor();
    const result = await measure();
    const cpu = stop();
    const entry = Object.assign(result as object, { cpu, waitedMs: waited.waitedMs }) as Measured<T>;
    all.push(entry);
    if (cpu.busyPct <= maxBusyPct) {
      stoppedBecause = 'quiet';
      break;
    }
  }
  const chosen = all.find((entry) => entry.cpu.busyPct <= maxBusyPct) ?? [...all].sort((a, b) => a.cpu.busyPct - b.cpu.busyPct)[0]!;
  return { chosen, attempts: all, quiet: chosen.cpu.busyPct <= maxBusyPct, waitedMs: waitedTotal, stoppedBecause };
}

/** Whether the absolute thresholds of a timing measurement may be enforced, and why not. */
export interface TimingGate {
  enforce: boolean;
  /** CPU use of the whole machine while the figure was taken, null if unknown. */
  busyPct: number | null;
  maxBusyPct: number;
  /** One sentence for the annotation and the skip. */
  reason: string;
}

/**
 * The thresholds of a latency, frame-rate or switching-time measurement are enforced only if the machine had headroom
 * while it was taken (`busyPct` at or below `maxBusyPct`, 60 % of all cores by default). A figure from a machine that was
 * busier is recorded and annotated, not judged. An unknown load is not judged either.
 */
export function timingGate(busyPct: number | null | undefined, maxBusyPct: number = QUIET_BUSY_PCT): TimingGate {
  const known = typeof busyPct === 'number' && Number.isFinite(busyPct);
  if (known && busyPct <= maxBusyPct) return { enforce: true, busyPct, maxBusyPct, reason: `machine CPU ${busyPct} % (at most ${maxBusyPct} %): the timing thresholds apply` };
  return {
    enforce: false,
    busyPct: known ? busyPct : null,
    maxBusyPct,
    reason: known
      ? `the machine was at ${busyPct} % CPU while the figures were taken (more than ${maxBusyPct} %): they are recorded, the timing thresholds are not enforced (not comparable); repeat the test on a machine with headroom (docs/testing.md 6.8)`
      : 'the CPU use of the machine while the figures were taken is unknown: they are recorded, the timing thresholds are not enforced (not comparable)',
  };
}

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Runs the assertions that hold a measurement against its absolute timing thresholds. On a machine with headroom they are
 * enforced: a failure fails the test. On a busier machine a failure proves nothing about the product (the encoders of the
 * senders and the decoders of the output fight for the same cores), so the test is annotated `not-comparable` and skipped
 * with the reason and the first thing that failed, and the report shows "skipped", not a pass that checked less than it
 * says. A pass on a busy machine is a pass: it holds the thresholds under worse conditions. The assertions that do not
 * depend on the load (frames arrive, stamps increase, no incident) belong outside, before the call, and stay enforced.
 */
export async function judgeTiming(testInfo: Pick<TestInfo, 'annotations' | 'skip'>, gate: TimingGate, assertions: () => void | Promise<void>): Promise<void> {
  try {
    await assertions();
  } catch (error) {
    if (gate.enforce) throw error;
    const failed = (error instanceof Error ? error.message : String(error)).replace(ANSI, '').split('\n')[0]!.trim();
    const description = `${gate.reason}. It failed against the thresholds: ${failed}`;
    testInfo.annotations.push({ type: 'not-comparable', description });
    testInfo.skip(true, description);
  }
}
