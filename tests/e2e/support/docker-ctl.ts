import { stackConfig, PROJECT } from './env';
import { compose, containerName, docker, ensureHealthy, inspectService, type Service } from './stack';
import { sleep, waitUntil } from './shell';

/** Lifecycle and fault injection for the services of the sf-e2e project (docs/testing.md 1.6). */
export const dockerCtl = {
  pause: (service: Service) => docker(['pause', containerName(service)], { check: true }),
  unpause: (service: Service) => docker(['unpause', containerName(service)], { check: true }),
  /** `docker compose stop` (graceful). */
  stop: (service: Service) => compose(['stop', service], { check: true }),
  /** `docker compose start` after a stop. */
  start: (service: Service) => compose(['start', service], { check: true }),
  /** `docker compose restart`. */
  restart: (service: Service) => compose(['restart', service], { check: true }),
  /**
   * `docker kill`. Since Docker 29 the daemon counts it as a manual stop: a container with `restart: unless-stopped`
   * (or `always`) is NOT restarted afterwards (verified with a plain alpine container on 29.8.2). Use `crash` for a
   * failure the restart policy has to answer; `kill` is for tests that want the container to stay down.
   */
  kill: (service: Service) => docker(['kill', containerName(service)], { check: true }),
  /**
   * The process of the container ends by itself (what a crash looks like to Docker): a signal sent from inside the
   * container, so the restart policy applies. PID 1 ignores SIGKILL from its own namespace, hence SIGTERM for the
   * API, Caddy and LiveKit (they exit on it) and SIGQUIT (immediate shutdown, no clean checkpoint) for PostgreSQL.
   * The PostgreSQL container drops all capabilities (BUG-22) and its server runs as the `postgres` user, so root
   * (without CAP_KILL) may not signal it: the signal is sent as the `postgres` user.
   */
  crash: (service: Service) =>
    docker(['exec', ...(service === 'postgres' ? ['--user', 'postgres'] : []), containerName(service), 'kill', service === 'postgres' ? '-QUIT' : '-TERM', '1'], { check: true }),
  /** Removes the container from the compose network: no RST for new packets, published ports keep their mapping. */
  networkDisconnect: (service: Service) => docker(['network', 'disconnect', stackConfig().network, containerName(service)], { check: true }),
  /** Reconnects with the previous address and the service name as alias. */
  networkConnect: (service: Service) => {
    const config = stackConfig();
    return docker(['network', 'connect', '--ip', config.ips[service], '--alias', service, config.network, containerName(service)], { check: true });
  },
  /** `docker stats --no-stream` of one service: resident memory in bytes and CPU percent. */
  async stats(service: Service): Promise<{ memBytes: number; cpuPct: number; raw: string }> {
    const result = await docker(['stats', '--no-stream', '--format', '{{json .}}', containerName(service)], { check: true });
    const json = JSON.parse(result.stdout.trim().split('\n')[0]!);
    const used = String(json.MemUsage).split('/')[0]!.trim();
    const match = /^([\d.]+)\s*([KMG]i?B|B)$/i.exec(used);
    const factor: Record<string, number> = { b: 1, kib: 1024, kb: 1000, mib: 1024 ** 2, mb: 1e6, gib: 1024 ** 3, gb: 1e9 };
    const memBytes = match ? Number(match[1]) * (factor[match[2]!.toLowerCase()] ?? 1) : 0;
    return { memBytes, cpuPct: parseFloat(String(json.CPUPerc)) || 0, raw: result.stdout.trim() };
  },
  /** Runs a command inside a running service container. */
  exec: (service: Service, command: string[], input?: string) => compose(['exec', '-T', service, ...command], { input }),
  /** Health status of a service container. */
  health: async (service: Service) => (await inspectService(service))?.health,
  /** Waits until the service container reports `unhealthy` (healthcheck proves the broken function). */
  async waitUnhealthy(service: Service, timeoutMs = 90_000): Promise<number> {
    const started = Date.now();
    await waitUntil(`${service} unhealthy`, async () => (await inspectService(service))?.health === 'unhealthy', { timeoutMs, intervalMs: 1000 });
    return Date.now() - started;
  },
  ensureHealthy,
};

export interface NetemProfile {
  delayMs?: number;
  jitterMs?: number;
  lossPct?: number;
  /** e.g. "1mbit", "400kbit" */
  rate?: string;
}

/**
 * LiveKit specific fault injection: freezing, disconnecting and shaping the media server.
 * `netem` shares LiveKit's network namespace (compose profile chaos) and shapes ingress and egress.
 */
export const livekitCtl = {
  pause: () => dockerCtl.pause('livekit'),
  unpause: () => dockerCtl.unpause('livekit'),
  disconnect: () => dockerCtl.networkDisconnect('livekit'),
  connect: () => dockerCtl.networkConnect('livekit'),
  async netem(profile: NetemProfile): Promise<string> {
    const args = ['run', '--rm', 'netem', 'apply', String(profile.delayMs ?? 0), String(profile.jitterMs ?? 0), String(profile.lossPct ?? 0)];
    if (profile.rate) args.push(profile.rate);
    const result = await compose(args, { profiles: ['chaos'] });
    if (result.code !== 0) throw new Error(`netem apply failed - tool unavailable (sch_netem/ifb/act_mirred missing?):\n${result.output.slice(-800)}`);
    return result.output;
  },
  /** Removes the shaping; throws when `docker compose run` fails, so a shaping that stays on is not mistaken for a slow network. */
  async clearNetem(): Promise<void> {
    await compose(['run', '--rm', 'netem', 'clear'], { profiles: ['chaos'], check: true });
  },
  async showNetem(): Promise<string> {
    return (await compose(['run', '--rm', 'netem', 'show'], { profiles: ['chaos'], check: true })).output;
  },
};

/** Puts everything back after a test that disturbed LiveKit or the network (idempotent). */
export async function restoreNetwork(): Promise<void> {
  await docker(['unpause', containerName('livekit')]);
  await docker(['unpause', containerName('postgres')]);
  await docker(['unpause', containerName('api')]);
  const config = stackConfig();
  for (const service of ['livekit', 'api', 'postgres', 'caddy'] as const) {
    const info = await docker(['inspect', '-f', `{{ json .NetworkSettings.Networks }}`, containerName(service)]);
    if (info.code === 0 && !info.stdout.includes(`"${PROJECT}_studioflow"`)) {
      await docker(['network', 'connect', '--ip', config.ips[service], '--alias', service, config.network, containerName(service)]);
    }
  }
  await livekitCtl.clearNetem().catch(() => undefined);
  await sleep(100);
}
