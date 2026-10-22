import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';
import { OUTPUT_DIR } from '../env';
import { percentile } from '../helpers';

/** p50 / p95 / p99 / max / mean / min / count of a numeric sample (NaN-free input expected). */
export interface Summary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(values: readonly number[]): Summary {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return { count: 0, min: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  return {
    count: clean.length,
    min: Math.min(...clean),
    p50: percentile([...clean], 50),
    p95: percentile([...clean], 95),
    p99: percentile([...clean], 99),
    max: Math.max(...clean),
    mean: clean.reduce((sum, value) => sum + value, 0) / clean.length,
  };
}

export function fmt(summary: Summary, digits = 0): string {
  const f = (value: number) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');
  return `n=${summary.count} p50 ${f(summary.p50)} p95 ${f(summary.p95)} p99 ${f(summary.p99)} max ${f(summary.max)} mean ${f(summary.mean)}`;
}

/** Folder for the numbers of the OUT specs (kept after the run, git-ignored with .output). */
export const RESULTS_DIR = path.join(OUTPUT_DIR, 'results');

/**
 * Records a measurement: an annotation of the test (visible in the reporters), an attachment and a JSON file in
 * `.output/<project>/results/out-<name>.json` (numbers are recorded even when the test passes, docs/testing.md 1.9).
 */
export async function recordMeasurement(testInfo: TestInfo, name: string, data: Record<string, unknown>, summary?: string): Promise<void> {
  const body = JSON.stringify({ name, test: testInfo.title, at: new Date().toISOString(), ...data }, null, 2);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `out-${name}.json`), body);
  await testInfo.attach(`out-${name}.json`, { body, contentType: 'application/json' });
  if (summary) testInfo.annotations.push({ type: 'measurement', description: `${name}: ${summary}` });
}

/**
 * Average CPU use of the whole machine while a measurement runs (the OUT numbers are taken on a shared machine: three other
 * stacks and their browsers run at the same time, so a latency figure is only meaningful next to the load it was taken under).
 */
export function startCpuMonitor(): () => { busyPct: number; cores: number } {
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

/**
 * Waits until the whole machine is reasonably idle (the other test stacks run at the same time): `windowMs` windows of CPU
 * use, started again until one is at or below `maxBusyPct`. Returns how long it waited and the last figure; after `timeoutMs`
 * it gives up and returns `quiet: false` (the measurement then runs under load and says so).
 */
export async function waitForQuietMachine(options: { maxBusyPct?: number; windowMs?: number; timeoutMs?: number } = {}): Promise<{ quiet: boolean; waitedMs: number; busyPct: number }> {
  const { maxBusyPct = 40, windowMs = 6000, timeoutMs = 240_000 } = options;
  const started = Date.now();
  for (;;) {
    const stop = startCpuMonitor();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const { busyPct } = stop();
    if (busyPct <= maxBusyPct) return { quiet: true, waitedMs: Date.now() - started, busyPct };
    if (Date.now() - started > timeoutMs) return { quiet: false, waitedMs: Date.now() - started, busyPct };
  }
}

/**
 * Runs a timed measurement up to `attempts` times until the machine was not saturated while it ran (CPU use of the whole
 * machine at or below `maxBusyPct`); returns the first such attempt, else the one with the lowest load. Every attempt is
 * kept for the record.
 */
export async function measureWhenQuiet<T>(
  measure: () => Promise<T>,
  options: { attempts?: number; maxBusyPct?: number; quiet?: Parameters<typeof waitForQuietMachine>[0] } = {},
): Promise<{ chosen: T & { cpu: { busyPct: number; cores: number } }; attempts: Array<T & { cpu: { busyPct: number; cores: number }; waitedMs: number }> }> {
  const { attempts = 3, maxBusyPct = 60 } = options;
  const all: Array<T & { cpu: { busyPct: number; cores: number }; waitedMs: number }> = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const waited = await waitForQuietMachine(options.quiet);
    const stop = startCpuMonitor();
    const result = await measure();
    const cpu = stop();
    const entry = Object.assign(result as object, { cpu, waitedMs: waited.waitedMs }) as T & { cpu: { busyPct: number; cores: number }; waitedMs: number };
    all.push(entry);
    if (cpu.busyPct <= maxBusyPct) return { chosen: entry, attempts: all };
  }
  const best = [...all].sort((a, b) => a.cpu.busyPct - b.cpu.busyPct)[0]!;
  return { chosen: best, attempts: all };
}
