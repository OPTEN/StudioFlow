import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

// Docker Desktop on Windows publishes [::]:443 but nothing listens on ::1 (connections hang): prefer IPv4 for "localhost".
dns.setDefaultResultOrder('ipv4first');

/** tests/e2e */
export const E2E_DIR = path.resolve(__dirname, '..');
/** Repository root (docker compose runs here). */
export const REPO_ROOT = path.resolve(E2E_DIR, '..', '..');

/** Compose project of the default stack (no E2E_STACK / E2E_PROJECT). */
export const DEFAULT_PROJECT = 'fs-e2e';
/** Numbered stacks E2E_STACK=1..MAX_STACK run side by side on one machine (README, "Parallel stacks"). */
export const MAX_STACK = 4;

/** Everything that tells one stack from another on a machine: names, host ports and subnets. */
export interface StackSettings {
  /** The N of E2E_STACK, undefined for the default stack or a hand-made E2E_PROJECT. */
  stack: number | undefined;
  /** Compose project: container names `<project>-<service>-1`, network `<project>_flowstudio`, volumes `<project>_<name>`. */
  project: string;
  httpPort: number;
  httpsPort: number;
  /** LiveKit media ports; host and container port are the same number (docker-compose.yml). */
  rtcTcpPort: number;
  rtcUdpPort: number;
  /** Direct API, LiveKit signalling and PostgreSQL on 127.0.0.1 (docker-compose.e2e.yml). */
  apiPort: number;
  livekitPort: number;
  postgresPort: number;
  /** /24 of the compose network; the services take .10 (LiveKit), .11 (API), .12 (PostgreSQL), .13 (Caddy). */
  subnet: string;
  /** /24 of the scratch stack of the OPS specs (setup.sh builds the API image and hashes a password in it). */
  opsSubnet: string;
}

/**
 * Port and subnet set of numbered stack N (1..4), disjoint from the default stack (80/443/7881/7882/18081/17880/15432,
 * 172.31.250.0/24) and from each other:
 *
 *   N  project     https http rtc tcp/udp api   livekit postgres subnet
 *   1  fs-e2e-1    8491  8091 7901/7902  18091 17891   15491    172.31.201.0/24
 *   2  fs-e2e-2    8492  8092 7903/7904  18092 17892   15492    172.31.202.0/24
 *   3  fs-e2e-3    8493  8093 7905/7906  18093 17893   15493    172.31.203.0/24
 *   4  fs-e2e-4    8494  8094 7907/7908  18094 17894   15494    172.31.204.0/24
 */
export function numberedStack(n: number): StackSettings {
  if (!Number.isInteger(n) || n < 1 || n > MAX_STACK) throw new Error(`E2E_STACK must be an integer from 1 to ${MAX_STACK}, got ${n}`);
  return {
    stack: n,
    project: `${DEFAULT_PROJECT}-${n}`,
    httpPort: 8090 + n,
    httpsPort: 8490 + n,
    rtcTcpPort: 7899 + 2 * n,
    rtcUdpPort: 7900 + 2 * n,
    apiPort: 18090 + n,
    livekitPort: 17890 + n,
    postgresPort: 15490 + n,
    subnet: `172.31.${200 + n}.0/24`,
    opsSubnet: `172.31.${210 + n}.0/24`,
  };
}

const DEFAULT_SETTINGS: StackSettings = {
  stack: undefined,
  project: DEFAULT_PROJECT,
  httpPort: 80,
  httpsPort: 443,
  rtcTcpPort: 7881,
  rtcUdpPort: 7882,
  apiPort: 18081,
  livekitPort: 17880,
  postgresPort: 15432,
  subnet: '172.31.250.0/24',
  opsSubnet: '172.31.251.0/24',
};

function portOf(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} must be a port number (1-65535), got "${raw}"`);
  return value;
}

/**
 * The stack this process works with, from the environment (a pure function, so the runner and every worker agree):
 * `E2E_STACK=N` selects a numbered set, each explicit variable overrides one value of it, and without any of them
 * the defaults of the single-stack setup apply unchanged. `E2E_PROJECT=fs-e2e-N` (N = 1..4) alone selects the numbered
 * set as well, so a project named like a numbered stack never runs on the ports of another stack.
 *
 *   E2E_PROJECT  compose project (default fs-e2e)
 *   E2E_HTTPS_PORT, E2E_HTTP_PORT, E2E_API_PORT, E2E_LIVEKIT_PORT, E2E_POSTGRES_PORT  host ports
 *   E2E_RTC_TCP_PORT, E2E_RTC_UDP_PORT  LiveKit media ports (FLOWSTUDIO_RTC_TCP_PORT / FLOWSTUDIO_RTC_UDP_PORT)
 *   E2E_SUBNET   /24 of the compose network, E2E_OPS_SUBNET the one of the OPS scratch stack
 */
export function resolveStackSettings(env: NodeJS.ProcessEnv = process.env): StackSettings {
  const rawStack = env['E2E_STACK']?.trim();
  const projectStack = /^fs-e2e-([1-4])$/.exec(env['E2E_PROJECT']?.trim() ?? '')?.[1];
  const base = rawStack ? numberedStack(Number(rawStack)) : projectStack ? numberedStack(Number(projectStack)) : DEFAULT_SETTINGS;
  const project = env['E2E_PROJECT']?.trim() || base.project;
  // Compose project names: lower-case letters, digits, "-" and "_", starting with a letter or digit.
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error(`E2E_PROJECT "${project}" is not a valid compose project name (lower-case letters, digits, - and _)`);
  const subnet = env['E2E_SUBNET']?.trim() || base.subnet;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/24$/.test(subnet)) throw new Error(`E2E_SUBNET must be a /24 such as 172.31.250.0/24, got "${subnet}"`);
  return {
    stack: base.stack,
    project,
    httpPort: portOf(env, 'E2E_HTTP_PORT', base.httpPort),
    httpsPort: portOf(env, 'E2E_HTTPS_PORT', base.httpsPort),
    rtcTcpPort: portOf(env, 'E2E_RTC_TCP_PORT', base.rtcTcpPort),
    rtcUdpPort: portOf(env, 'E2E_RTC_UDP_PORT', base.rtcUdpPort),
    apiPort: portOf(env, 'E2E_API_PORT', base.apiPort),
    livekitPort: portOf(env, 'E2E_LIVEKIT_PORT', base.livekitPort),
    postgresPort: portOf(env, 'E2E_POSTGRES_PORT', base.postgresPort),
    subnet,
    opsSubnet: env['E2E_OPS_SUBNET']?.trim() || base.opsSubnet,
  };
}

/** The settings of this process. */
export const SETTINGS: StackSettings = resolveStackSettings();
/** Compose project of the stack under test. */
export const PROJECT = SETTINGS.project;
/** True for the unchanged single-stack setup (fs-e2e): its files keep their historical locations. */
export const IS_DEFAULT_PROJECT = PROJECT === DEFAULT_PROJECT;

/** Generated, git-ignored environment file with throwaway test credentials (`.env.e2e`, `.env.e2e.<project>`). */
export const ENV_FILE = path.join(E2E_DIR, IS_DEFAULT_PROJECT ? '.env.e2e' : `.env.e2e.${PROJECT}`);
/** Results, logs, generated assets (git-ignored): `.output`, for another project `.output/<project>`. */
export const OUTPUT_DIR = IS_DEFAULT_PROJECT ? path.join(E2E_DIR, '.output') : path.join(E2E_DIR, '.output', PROJECT);
export const ASSET_DIR = path.join(OUTPUT_DIR, 'assets');
export const STATE_FILE = path.join(OUTPUT_DIR, 'stack-state.json');

/** Container, network, volume and image names of a compose project (Compose v2 naming). */
export function containerNameOf(service: string, project: string = PROJECT): string {
  return `${project}-${service}-1`;
}
export function networkNameOf(project: string = PROJECT): string {
  return `${project}_flowstudio`;
}
export function volumeNameOf(name: string, project: string = PROJECT): string {
  return `${project}_${name}`;
}
/** Image built for a service (`<project>-<service>`). */
export function imageNameOf(service: string, project: string = PROJECT): string {
  return `${project}-${service}`;
}

export const COMPOSE_FILES = {
  base: path.join(REPO_ROOT, 'docker-compose.yml'),
  e2e: path.join(E2E_DIR, 'docker-compose.e2e.yml'),
  shortTtl: path.join(E2E_DIR, 'docker-compose.short-ttl.yml'),
} as const;

/** Throwaway values; they only protect a stack that lives for the duration of a test run. */
export const TEST_ADMIN = { username: 'e2e-admin', password: 'e2e-Admin-Passw0rd-2026' } as const;
export const TEST_LIVEKIT = {
  apiKey: 'e2e_lk_key',
  // 'sk' + 40 hex characters: starts with a letter, 42 characters (docs/architecture/implementation-spec.md section 7).
  apiSecret: 'sk3f9a1c07b2d84e6a95f0c1e7d3b8a4026c9e1f7d',
} as const;
export const TEST_POSTGRES_PASSWORD = 'e2ePostgresPassw0rd2026abcdefghij';

export interface StackConfig {
  /** Compose project of this stack (`fs-e2e`, `fs-e2e-2`, ...). */
  project: string;
  /** https origin of Caddy, e.g. https://localhost or https://localhost:8492 */
  baseURL: string;
  host: string;
  httpsPort: number;
  httpPort: number;
  /** LiveKit media ports published on the node IP (host port = container port). */
  rtcTcpPort: number;
  rtcUdpPort: number;
  /** Direct API (bypasses Caddy), published on 127.0.0.1 by docker-compose.e2e.yml. */
  apiDirect: string;
  /** LiveKit signalling/Twirp published on 127.0.0.1 (tests only). */
  livekitAdmin: string;
  postgresPort: number;
  nodeIp: string;
  subnet: string;
  admin: { username: string; password: string };
  livekit: { apiKey: string; apiSecret: string };
  postgresPassword: string;
  frameAncestors: string;
  ips: { livekit: string; api: string; postgres: string; caddy: string };
  network: string;
  mediaMaxImageBytes: number;
  mediaMaxVideoBytes: number;
}

export function parseEnvFile(file: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!;
    if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1);
    result[match[1]!] = value;
  }
  return result;
}

/** https origin of Caddy on `httpsPort` (the default port 443 is left out). */
export function originFor(host: string, httpsPort: number): string {
  return `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`;
}

let cached: StackConfig | undefined;

/** Reads the env file of the stack (tests/e2e/.env.e2e[.<project>], written by global setup). */
export function stackConfig(): StackConfig {
  if (cached) return cached;
  if (!fs.existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} does not exist: global setup has not run`);
  const env = parseEnvFile(ENV_FILE);
  const httpsPort = Number(env['E2E_HTTPS_PORT'] ?? SETTINGS.httpsPort);
  const host = env['FLOWSTUDIO_DOMAIN'] ?? 'localhost';
  const subnet = env['FLOWSTUDIO_SUBNET'] ?? SETTINGS.subnet;
  const prefix = subnet.split('/')[0]!.split('.').slice(0, 3).join('.');
  cached = {
    project: PROJECT,
    baseURL: env['FLOWSTUDIO_PUBLIC_BASE_URL'] || originFor(host, httpsPort),
    host,
    httpsPort,
    httpPort: Number(env['E2E_HTTP_PORT'] ?? SETTINGS.httpPort),
    rtcTcpPort: Number(env['FLOWSTUDIO_RTC_TCP_PORT'] ?? SETTINGS.rtcTcpPort),
    rtcUdpPort: Number(env['FLOWSTUDIO_RTC_UDP_PORT'] ?? SETTINGS.rtcUdpPort),
    apiDirect: `http://127.0.0.1:${env['E2E_API_PORT'] ?? SETTINGS.apiPort}`,
    livekitAdmin: `http://127.0.0.1:${env['E2E_LIVEKIT_PORT'] ?? SETTINGS.livekitPort}`,
    postgresPort: Number(env['E2E_POSTGRES_PORT'] ?? SETTINGS.postgresPort),
    nodeIp: env['FLOWSTUDIO_NODE_IP'] ?? '127.0.0.1',
    subnet,
    admin: { username: env['ADMIN__USERNAME'] ?? TEST_ADMIN.username, password: env['ADMIN__PASSWORD'] ?? TEST_ADMIN.password },
    livekit: { apiKey: env['LIVEKIT_API_KEY'] ?? TEST_LIVEKIT.apiKey, apiSecret: env['LIVEKIT_API_SECRET'] ?? TEST_LIVEKIT.apiSecret },
    postgresPassword: env['POSTGRES_PASSWORD'] ?? TEST_POSTGRES_PASSWORD,
    frameAncestors: env['FLOWSTUDIO_FRAME_ANCESTORS'] ?? '',
    ips: {
      livekit: env['E2E_IP_LIVEKIT'] ?? `${prefix}.10`,
      api: env['E2E_IP_API'] ?? `${prefix}.11`,
      postgres: env['E2E_IP_POSTGRES'] ?? `${prefix}.12`,
      caddy: env['E2E_IP_CADDY'] ?? `${prefix}.13`,
    },
    network: networkNameOf(),
    mediaMaxImageBytes: Number(env['MEDIA__MAXIMAGEBYTES'] ?? 1_048_576),
    mediaMaxVideoBytes: Number(env['MEDIA__MAXVIDEOBYTES'] ?? 2_097_152),
  };
  return cached;
}

/**
 * Content of the generated environment file. The ports, the subnet and the fixed container addresses come from the
 * stack settings (E2E_STACK / E2E_* variables); LiveKit's media ports are written as FLOWSTUDIO_RTC_TCP_PORT and
 * FLOWSTUDIO_RTC_UDP_PORT, the names docker-compose.yml reads (host and container port are the same number).
 */
export function renderEnvFile(nodeIp: string, overrides: Record<string, string> = {}, settings: StackSettings = SETTINGS): string {
  const subnet = overrides['FLOWSTUDIO_SUBNET'] ?? settings.subnet;
  const prefix = subnet.split('/')[0]!.split('.').slice(0, 3).join('.');
  const values: Record<string, string> = {
    FLOWSTUDIO_DOMAIN: 'localhost',
    FLOWSTUDIO_TLS_MODE: 'internal',
    // The same site under the IPv4 address: WebKit on Windows resolves "localhost" to ::1, where Docker Desktop accepts
    // the connection and never answers; https://127.0.0.1 reaches the stack (webkit project).
    FLOWSTUDIO_EXTRA_HOSTS: '127.0.0.1',
    FLOWSTUDIO_NODE_IP: nodeIp,
    FLOWSTUDIO_SUBNET: subnet,
    FLOWSTUDIO_RTC_TCP_PORT: String(settings.rtcTcpPort),
    FLOWSTUDIO_RTC_UDP_PORT: String(settings.rtcUdpPort),
    // 'self' is always allowed by Caddy; the UI tests embed the output on https://embed.test (fake origin served with
    // page.route), the embedding specs on https://embed.e2e.test.
    FLOWSTUDIO_FRAME_ANCESTORS: 'https://embed.e2e.test https://embed.test',
    ADMIN__USERNAME: TEST_ADMIN.username,
    ADMIN__PASSWORD: TEST_ADMIN.password,
    ADMIN__PASSWORDHASH: '',
    LIVEKIT_API_KEY: TEST_LIVEKIT.apiKey,
    LIVEKIT_API_SECRET: TEST_LIVEKIT.apiSecret,
    POSTGRES_PASSWORD: TEST_POSTGRES_PASSWORD,
    // Small limits so oversize uploads are cheap (INT-MEDIA-04 / E2E-MEDIA-02): 1 MiB images, 2 MiB videos.
    MEDIA__MAXIMAGEBYTES: '1048576',
    MEDIA__MAXVIDEOBYTES: '2097152',
    E2E_HTTP_PORT: String(settings.httpPort),
    E2E_HTTPS_PORT: String(settings.httpsPort),
    E2E_API_PORT: String(settings.apiPort),
    E2E_LIVEKIT_PORT: String(settings.livekitPort),
    E2E_POSTGRES_PORT: String(settings.postgresPort),
    E2E_IP_LIVEKIT: `${prefix}.10`,
    E2E_IP_API: `${prefix}.11`,
    E2E_IP_POSTGRES: `${prefix}.12`,
    E2E_IP_CADDY: `${prefix}.13`,
    ...overrides,
  };
  // The API builds absolute links (pairing, output) from this; Caddy keeps the Host header with the published port.
  if (settings.httpsPort !== 443) values['FLOWSTUDIO_PUBLIC_BASE_URL'] = `https://localhost:${settings.httpsPort}`;
  const lines = [
    `# Generated by tests/e2e/global-setup.ts - throwaway test values, never used outside the E2E stack (${settings.project}).`,
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ];
  return lines.join('\n');
}
