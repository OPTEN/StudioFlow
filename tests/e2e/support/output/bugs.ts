import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { E2E_DIR } from '../env';
import { knownBug } from '../fixtures';

/**
 * Marks the running test as a confirmed product bug of the OUT area. The entries live in `specs/output/bugs.json`
 * (same schema as `known-bugs.json`; the orchestrator merges them). Until they are merged `knownBug()` does not know the
 * ids, so this wrapper reads the local file; once an id is in the main registry the registry wins and this calls
 * `knownBug()` itself. An `open` entry makes the test an expected failure (it turns red the day the product is fixed);
 * `E2E_BUG_REPORT=1` runs it as a plain test.
 */

interface Entry {
  status: 'open' | 'fixed';
  title: string;
}

function readBugs(file: string): Record<string, Entry> {
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { bugs?: Record<string, Entry> }).bugs ?? {};
  } catch {
    return {};
  }
}

/**
 * For a confirmed bug that shows up only in some runs (a hard limit missed in one window of several): the test is not an
 * expected failure (it would turn red whenever the run is lucky); it notes the bug and returns whether it is still open,
 * so the test asserts the hard limit only once the bug is fixed and what holds in every run before that.
 */
export function intermittentOutBug(id: string, description: string): boolean {
  const entry = readBugs(path.join(E2E_DIR, 'specs', 'output', 'bugs.json'))[id];
  test.info().annotations.push({ type: 'bug', description: `${id} (${entry?.status ?? 'unregistered'}, intermittent, specs/output/bugs.json): ${description}` });
  if (process.env['E2E_BUG_REPORT'] === '1') return false;
  return entry?.status === 'open';
}

export function outBug(id: string, description: string): void {
  if (readBugs(path.join(E2E_DIR, 'known-bugs.json'))[id]) {
    knownBug(id, description);
    return;
  }
  const entry = readBugs(path.join(E2E_DIR, 'specs', 'output', 'bugs.json'))[id];
  test.info().annotations.push({ type: 'bug', description: `${id} (${entry?.status ?? 'unregistered'}, specs/output/bugs.json): ${description}` });
  if (process.env['E2E_BUG_REPORT'] === '1') return;
  if (entry?.status === 'open') test.fail(true, `${id}: ${description}`);
}
