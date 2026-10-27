import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

/** True while the Regie has no account (the first-run setup is open); undefined when the API does not answer. */
export async function setupRequired(): Promise<boolean | undefined> {
  const response = await tryFetch(`${stackConfig().apiDirect}/api/auth/setup`);
  return response?.status === 200 ? ((await response.json()) as { setupRequired: boolean }).setupRequired : undefined;
}

/** The setup code the API logged last, or undefined when its newest line says the account exists (or it logged neither). */
export async function readSetupCode(): Promise<string | undefined> {
  const lines = (await serviceLogs('api')).split(/\r?\n/).filter((line) => /Setup code: [A-Z0-9]{4}-[A-Z0-9]{4}|The Regie account exists/.test(line));
  return /Setup code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(lines.at(-1) ?? '')?.[1];
}

/** Waits for the setup code of the running API (it writes the line while it starts). */
export async function waitForSetupCode(timeoutMs = 60_000): Promise<string> {
  let code: string | undefined;
  await waitUntil('the setup code in the API log', async () => (code = await readSetupCode()) !== undefined, { timeoutMs, intervalMs: 1000 });
  return code!;
}

/**
 * Creates the Regie account of the harness (`stackConfig().admin`) in the first-run setup when the stack has none, with
 * the code from the API log. A stack that has the account is left alone.
 */
export async function ensureHarnessAccount(): Promise<void> {
  if ((await setupRequired()) !== true) return;
  const config = stackConfig();
  const setupCode = await waitForSetupCode();
  const response = await tryFetch(`${config.apiDirect}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupCode, username: config.admin.username, password: config.admin.password }),
  });
  if (response?.status !== 200) throw new Error(`the first-run setup of the harness account failed with ${response?.status}: ${await response?.text()}`);
}

/** Runs `reset-admin --yes` inside the api container: the account is deleted and the running API reopens the first-run setup. */
export async function resetAdminAccount(): Promise<ExecResult> {
  return compose(['exec', '-T', 'api', 'dotnet', 'Opten.StudioFlow.Web.dll', 'reset-admin', '--yes'], { check: true });
}

/**
 * Waits until the stack is usable again after a disruption: containers healthy, /health/ready 200, the harness account
 * exists (the first-run setup of a fresh stack is done here) and its login works through Caddy.
 */
export async function ensureHealthy(timeoutMs = 240_000): Promise<void> {
  await waitHealthy(timeoutMs);
  await waitUntil('/health/ready 200', apiReady, { timeoutMs: 60_000, intervalMs: 500 });
  await ensureHarnessAccount();
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
  // The state of every container at the end of the run: restarts, memory and CPU limits, the last exit.
  const states: Record<string, unknown> = {};
  for (const service of SERVICES) {
    const result = await docker(['inspect', containerName(service)]);
    if (result.code !== 0) continue;
    const info = JSON.parse(result.stdout)[0];
    states[service] = {
      restartCount: info.RestartCount,
      state: info.State,
      memoryLimit: info.HostConfig?.Memory,
      nanoCpus: info.HostConfig?.NanoCpus,
      restartPolicy: info.HostConfig?.RestartPolicy,
    };
  }
  fs.writeFileSync(`${dir}/containers.json`, JSON.stringify(states, null, 2));
}

let eventLog: ChildProcess | undefined;

/**
 * Records the events of the containers of the stack (start, kill, die with the exit code, oom, restart, stop) in a file, one
 * JSON object per line, until stopEventLog. A container with a restart policy that dies by itself leaves no other trace:
 * `docker inspect` forgets the exit code as soon as it runs again, its own log has no last words after a SIGKILL, and the
 * daemon keeps only the last 256 events, which the health checks fill within minutes (issue 33).
 */
export function startEventLog(file: string): void {
  stopEventLog();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.openSync(file, 'w');
  const args = ['events', '--format', '{{json .}}', '--filter', 'type=container', '--filter', `label=com.docker.compose.project=${PROJECT}`];
  for (const event of ['start', 'kill', 'die', 'oom', 'restart', 'stop']) args.push('--filter', `event=${event}`);
  // The end time is a safety net: a runner that is killed does not leave the process behind for ever.
  args.push('--until', String(Math.floor(Date.now() / 1000) + 8 * 3600));
  eventLog = spawn('docker', args, { stdio: ['ignore', out, 'ignore'], windowsHide: true });
  eventLog.on('error', () => undefined);
  fs.closeSync(out);
}

export function stopEventLog(): void {
  eventLog?.kill();
  eventLog = undefined;
}

export { sleep };
