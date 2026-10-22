import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { knownBug } from '../fixtures';

/**
 * Registry mechanism for the bugs of the Regie specs. The orchestrator merges `specs/regie/bugs.json` into
 * `tests/e2e/known-bugs.json`; until then the shared `knownBug()` does not know the REGIE-nn ids, so this wrapper reads
 * the local file as well. Same semantics: while an entry is `open` the test keeps its full assertions and is expected
 * to fail (`test.fail`), the day the product is fixed it turns red and the entry is set to `fixed`.
 * `E2E_BUG_REPORT=1` runs the marked tests as plain tests (raw failures as evidence).
 */

interface LocalBug {
  status: 'open' | 'fixed';
  title: string;
}

let local: Record<string, LocalBug> | undefined;

function localBugs(): Record<string, LocalBug> {
  if (!local) {
    const file = path.join(__dirname, '..', '..', 'specs', 'regie', 'bugs.json');
    local = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { bugs: Record<string, LocalBug> }).bugs
      : {};
  }
  return local;
}

/** Marks the running test as a confirmed product bug of `specs/regie/bugs.json` (and of known-bugs.json once merged). */
export function regieBug(id: string, description: string): void {
  knownBug(id, description);
  if (process.env['E2E_BUG_REPORT'] === '1') return;
  const entry = localBugs()[id];
  if (entry?.status === 'open') test.fail(true, `${id}: ${description}`);
}
