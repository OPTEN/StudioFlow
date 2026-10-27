import fs from 'node:fs';
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

// The machine load, the waiting for a quiet machine and the gate of the timing thresholds live in quiet.ts (issue #39).
export { QUIET_BUSY_PCT, judgeTiming, measureWhenQuiet, startCpuMonitor, timingGate, waitForQuietMachine } from './quiet';
export type { CpuUse, QuietMeasurement, TimingGate } from './quiet';
