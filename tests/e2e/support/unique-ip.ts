/**
 * Fake client addresses for the direct API port (X-Forwarded-For), so rate limits are per test, not per machine.
 *
 * Scheme (documented in tests/e2e/README.md): every address is `10.a.b.c` with `a` in 100..199, `b` in 0..255 and `c` in
 * 1..254 (so never a network, broadcast or out-of-range octet). One global index maps injectively onto that range:
 *
 *   index = (runSlot * WORKERS_PER_RUN + workerIndex) * ADDRESSES_PER_WORKER + counter
 *
 * - `workerIndex` is Playwright's `TEST_WORKER_INDEX` (unique per run, also for a worker restarted after a failure),
 *   `counter` counts the calls of that worker process, so two workers can never hand out the same address;
 * - `runSlot` (0..3, `E2E_RUN_SLOT`, set by global setup from the start time) moves consecutive runs against a reused
 *   stack (`E2E_REUSE_STACK=1`) onto different ranges, so counters of an earlier run do not meet again at once.
 *
 * Running out of the range throws instead of wrapping around, because a wrapped address is a duplicate.
 */
export const WORKERS_PER_RUN = 200;
export const ADDRESSES_PER_WORKER = 8128; // 32 third-octet values of 254 host numbers each
export const RUN_SLOTS = 4;
const FIRST_OCTET = 100;
const HOSTS_PER_NETWORK = 254;
const NETWORKS = 256;
const TOTAL = RUN_SLOTS * WORKERS_PER_RUN * ADDRESSES_PER_WORKER;

/** The address for a position; pure, so its uniqueness can be proven by a unit test. */
export function ipAt(runSlot: number, workerIndex: number, counter: number): string {
  if (!Number.isInteger(runSlot) || runSlot < 0 || runSlot >= RUN_SLOTS) throw new RangeError(`run slot ${runSlot} is outside 0..${RUN_SLOTS - 1}`);
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= WORKERS_PER_RUN) throw new RangeError(`worker index ${workerIndex} is outside 0..${WORKERS_PER_RUN - 1}`);
  if (!Number.isInteger(counter) || counter < 0 || counter >= ADDRESSES_PER_WORKER) throw new RangeError(`the worker used up its ${ADDRESSES_PER_WORKER} addresses (counter ${counter})`);
  const index = (runSlot * WORKERS_PER_RUN + workerIndex) * ADDRESSES_PER_WORKER + counter;
  if (index >= TOTAL) throw new RangeError('address index out of range');
  const host = (index % HOSTS_PER_NETWORK) + 1;
  const network = Math.floor(index / HOSTS_PER_NETWORK);
  return `10.${FIRST_OCTET + Math.floor(network / NETWORKS)}.${network % NETWORKS}.${host}`;
}

function intFromEnv(name: string): number {
  const value = Number(process.env[name] ?? '0');
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

let counter = 0;

/** The next unused address of this worker process. */
export function uniqueIp(): string {
  return ipAt(intFromEnv('E2E_RUN_SLOT') % RUN_SLOTS, intFromEnv('TEST_WORKER_INDEX'), counter++);
}

/** Test hook: restart the counter of this process. */
export function resetUniqueIpCounter(): void {
  counter = 0;
}
