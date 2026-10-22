import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { E2E_DIR } from '../env';

/**
 * `knownBug` for the a11y specs. The shared `knownBug` (support/fixtures.ts) only reads `known-bugs.json`; the A11Y-nn
 * entries of this area live in `specs/a11y/bugs.json` until the orchestrator merges them. This wrapper reads both files
 * (the shared registry wins when an id exists in both, so nothing changes after the merge) and behaves exactly like
 * the shared one: while an entry is `open` the test keeps its full assertions and is expected to fail (`test.fail`), and
 * `E2E_BUG_REPORT=1` runs it as a plain test (the raw failure is the evidence of the entry).
 */

interface BugEntry {
  status: 'open' | 'fixed';
  severity?: string;
  area?: string;
  title?: string;
}

let registry: Record<string, BugEntry> | undefined;

function load(file: string): Record<string, BugEntry> {
  if (!fs.existsSync(file)) return {};
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { bugs?: Record<string, BugEntry> }).bugs ?? {};
}

function lookup(id: string): BugEntry | undefined {
  registry ??= {
    ...load(path.join(E2E_DIR, 'specs', 'a11y', 'bugs.json')),
    ...load(path.join(E2E_DIR, 'known-bugs.json')),
  };
  return registry[id];
}

/** Marks the running test as a confirmed product bug (see the file comment). */
export function knownBug(id: string, description: string): void {
  const entry = lookup(id);
  test.info().annotations.push({ type: 'bug', description: `${id} (${entry?.status ?? 'unregistered'}): ${description}` });
  if (process.env['E2E_BUG_REPORT'] === '1') return;
  if (entry?.status === 'open') test.fail(true, `${id}: ${description}`);
}

/** True while the entry is registered as `open` (and the run is not an E2E_BUG_REPORT run, where nothing is excused). */
export function isOpenBug(id: string): boolean {
  if (process.env['E2E_BUG_REPORT'] === '1') return false;
  return lookup(id)?.status === 'open';
}
