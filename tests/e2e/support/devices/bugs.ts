import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { E2E_DIR } from '../env';

/**
 * Local wrapper of `knownBug` (support/fixtures.ts) for the DEV-nn entries of this folder. The shared registry
 * (`tests/e2e/known-bugs.json`) only learns the entries of `specs/devices/bugs.json` when the orchestrator merges them, so
 * `knownBug('DEV-01', ...)` alone would find no entry and the test would turn red instead of being an expected failure.
 * This wrapper reads both files (the merged registry wins), then behaves exactly like `knownBug`:
 * - status `open`: the test keeps its full assertions and is expected to fail (`test.fail`), it turns red the day the
 *   product is fixed (set the entry to `fixed` then);
 * - status `fixed`: only annotates the test, which then guards against regressions;
 * - `E2E_BUG_REPORT=1` runs the marked tests as plain tests (the raw failures are the evidence quoted in the entry).
 */

interface Entry {
  status: 'open' | 'fixed';
  title?: string;
}

function readRegistry(file: string): Record<string, Entry> {
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { bugs?: Record<string, Entry> }).bugs ?? {};
  } catch {
    return {};
  }
}

let merged: Record<string, Entry> | undefined;

function entryOf(id: string): Entry | undefined {
  merged ??= {
    ...readRegistry(path.join(E2E_DIR, 'specs', 'devices', 'bugs.json')),
    ...readRegistry(path.join(E2E_DIR, 'known-bugs.json')),
  };
  return merged[id];
}

/** Marks the running test as a confirmed product bug (see the module comment). */
export function knownDevBug(id: string, description: string): void {
  const entry = entryOf(id);
  test.info().annotations.push({ type: 'bug', description: `${id} (${entry?.status ?? 'unregistered'}): ${description}` });
  if (process.env['E2E_BUG_REPORT'] === '1') return;
  if (entry?.status === 'open') test.fail(true, `${id}: ${description}`);
}
