import fs from 'node:fs';
import path from 'node:path';
import type { StackState } from './global-setup';
import { OUTPUT_DIR, PROJECT, STATE_FILE } from './support/env';
import { compose, dumpLogs } from './support/stack';

function log(message: string): void {
  process.stdout.write(`[e2e teardown] ${message}\n`);
}

/**
 * Keeps the container logs of the run (evidence for failures) and removes the stack with its volumes, unless
 * E2E_KEEP_STACK=1 (or the stack was reused with E2E_REUSE_STACK=1, which implies keeping it).
 */
export default async function globalTeardown(): Promise<void> {
  const state: StackState | undefined = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : undefined;
  try {
    await dumpLogs(path.join(OUTPUT_DIR, 'logs'));
    log(`container logs written to ${path.join(OUTPUT_DIR, 'logs')}`);
  } catch (error) {
    log(`could not collect logs: ${String(error)}`);
  }
  if (process.env['E2E_KEEP_STACK'] === '1' || process.env['E2E_REUSE_STACK'] === '1' || state?.keepStack) {
    log(`keeping the stack ${PROJECT} (E2E_KEEP_STACK=1 / E2E_REUSE_STACK=1)`);
    return;
  }
  log(`removing containers, networks and volumes of the ${PROJECT} project`);
  await compose(['down', '--volumes', '--remove-orphans', '--timeout', '30'], { profiles: ['chaos', 'tools'] });
}
