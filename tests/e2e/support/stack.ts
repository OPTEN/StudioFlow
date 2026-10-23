import fs from 'node:fs';
import { COMPOSE_FILES, ENV_FILE, PROJECT, REPO_ROOT, containerNameOf, stackConfig } from './env';
import { exec, sleep, waitUntil, type ExecOptions, type ExecResult } from './shell';

export const SERVICES = ['postgres', 'livekit', 'api', 'caddy'] as const;
export type Service = (typeof SERVICES)[number];

export interface ComposeOptions extends ExecOptions {
  /** Extra compose files after base + e2e (e.g. the short-ttl override). */
  extraFiles?: string[];
  profiles?: string[];
}

/** Arguments that select the compose project of the stack (E2E_PROJECT, default sf-e2e), its env file and compose files. */
export function composeBaseArgs(options: Pick<ComposeOptions, 'extraFiles' | 'profiles'> = {}): string[] {
  const args = ['compose', '-p', PROJECT, '--env-file', ENV_FILE, '-f', COMPOSE_FILES.base, '-f', COMPOSE_FILES.e2e];
  for (const file of options.extraFiles ?? []) args.push('-f', file);
  for (const profile of options.profiles ?? []) args.push('--profile', profile);
  return args;
}

/** `docker compose -p <project> ...` from the repository root. */
export function compose(args: string[], options: ComposeOptions = {}): Promise<ExecResult> {
  const { extraFiles, profiles, ...rest } = options;
  return exec('docker', [...composeBaseArgs({ extraFiles, profiles }), ...args], { cwd: REPO_ROOT, ...rest });
}

export function docker(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return exec('docker', args, { cwd: REPO_ROOT, ...options });
}

/** Container name of a service of the stack's project (compose v2 naming). */
export function containerName(service: Service | string): string {
  return containerNameOf(service);
}

export interface ContainerState {
  service: string;
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  status: string;
  startedAt: string;
  restartCount: number;
  exitCode: number;
  id: string;
}

export async function inspectService(service: Service | string): Promise<ContainerState | undefined> {
  const result = await docker(['inspect', containerName(service)]);
  if (result.code !== 0) return undefined;
  const info = JSON.parse(result.stdout)[0];
  return {
    service,
    running: Boolean(info.State?.Running),
    health: info.State?.Health?.Status ?? 'none',
    status: info.State?.Status,
    startedAt: info.State?.StartedAt,
    restartCount: info.RestartCount ?? 0,
    exitCode: info.State?.ExitCode ?? 0,
    id: info.Id,
  };
}

export async function allHealthy(): Promise<boolean> {
  const states = await Promise.all(SERVICES.map((service) => inspectService(service)));
  return states.every((state) => state?.running && state.health === 'healthy');
}

/** Starts every container that is not running (a `docker kill` or `stop` leaves it down; the restart policy does not apply). */
export async function startStopped(): Promise<void> {
  for (const service of SERVICES) {
    const state = await inspectService(service);
    if (state && !state.running && state.status !== 'restarting') await compose(['start', service]);
  }
}

/** Waits until all four containers report `healthy`; containers that stay down are started once. */
export async function waitHealthy(timeoutMs = 180_000): Promise<void> {
  let started = false;
  await waitUntil(
    'all four containers healthy',
    async () => {
      if (await allHealthy()) return true;
      if (!started) {
        // Give the restart policy a few seconds first: a crashed container comes back by itself.
        const states = await Promise.all(SERVICES.map((service) => inspectService(service)));
        if (states.some((state) => state && !state.running && state.status === 'exited')) {
          await sleep(5000);
          started = true;
          await startStopped();
        }
      }
      return false;
    },
    { timeoutMs, intervalMs: 1000 },
  );
}

/** Fetches a URL once; any HTTP status counts as an answer, network errors resolve to undefined. */
export async function tryFetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response | undefined> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(init?.timeoutMs ?? 5000) });
  } catch {
    return undefined;
  }
}

/** API readiness on the direct port (the health endpoints are not reachable through Caddy). */
export async function apiReady(): Promise<boolean> {
  return (await tryFetch(`${stackConfig().apiDirect}/health/ready`))?.status === 200;
}

/**
 * Waits until the stack is usable again after a disruption: containers healthy, /health/ready 200 and the admin login
 * works through Caddy.
 */
export async function ensureHealthy(timeoutMs = 240_000): Promise<void> {
  await waitHealthy(timeoutMs);
  await waitUntil('/health/ready 200', apiReady, { timeoutMs: 60_000, intervalMs: 500 });
  const config = stackConfig();
  await waitUntil(
    'admin login through Caddy',
    async () => {
      const response = await tryFetch(`${config.baseURL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.admin),
      });
      return response?.status === 200;
    },
    { timeoutMs: 60_000, intervalMs: 1000 },
  );
}

/** Appends the output of `docker compose logs` of one service (or all) since a time stamp. */
export async function serviceLogs(service?: Service | string, since?: string): Promise<string> {
  const args = ['logs', '--no-color', '--no-log-prefix'];
  if (since) args.push('--since', since);
  if (service) args.push(service);
  const result = await compose(args);
  return result.output;
}

/** Recreates the api container with/without extra compose files (short-TTL profile). */
export async function recreateApi(extraFiles: string[] = []): Promise<void> {
  await compose(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '240', 'api'], { extraFiles, check: true });
  await waitUntil('/health/ready 200', apiReady, { timeoutMs: 120_000, intervalMs: 500 });
}

export async function recreateLiveKit(extraFiles: string[] = []): Promise<void> {
  await compose(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '240', 'livekit'], { extraFiles, check: true });
}

/** Writes stack logs of every service to a directory (global teardown, failures). */
export async function dumpLogs(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  for (const service of SERVICES) {
    const result = await compose(['logs', '--no-color', '--timestamps', service]);
    fs.writeFileSync(`${dir}/${service}.log`, result.output);
  }
}

export { sleep };
