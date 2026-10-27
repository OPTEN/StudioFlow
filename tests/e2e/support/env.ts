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
export const DEFAULT_PROJECT = 'sf-e2e';
/** Numbered stacks E2E_STACK=1..MAX_STACK run side by side on one machine (README, "Parallel stacks"). */
export const MAX_STACK = 5;

/** Everything that tells one stack from another on a machine: names, host ports and subnets. */
export interface StackSettings {
  /** The N of E2E_STACK, undefined for the default stack or a hand-made E2E_PROJECT. */
  stack: number | undefined;
  /** Compose project: container names `<project>-<service>-1`, network `<project>_studioflow`, volumes `<project>_<name>`. */
  project: string;
  /** The one port Caddy publishes (tcp and udp, STUDIOFLOW_HTTPS_PORT); nothing listens on port 80. */
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
}

/**
 * Port and subnet set of numbered stack N (1..4), disjoint from the default stack (80/443/7881/7882/18081/17880/15432,
 * 172.31.250.0/24) and from each other:
 *
 *   N  project     https rtc tcp/udp api   livekit postgres subnet
 *   1  sf-e2e-1    8491  7901/7902   18091 17891   15491    172.31.201.0/24
 *   2  sf-e2e-2    8492  7903/7904   18092 17892   15492    172.31.202.0/24
 *   3  sf-e2e-3    8493  7905/7906   18093 17893   15493    172.31.203.0/24
 *   4  sf-e2e-4    8494  7907/7908   18094 17894   15494    172.31.204.0/24
 */
export function numberedStack(n: number): StackSettings {
  if (!Number.isInteger(n) || n < 1 || n > MAX_STACK) throw new Error(`E2E_STACK must be an integer from 1 to ${MAX_STACK}, got ${n}`);
  return {
    stack: n,
    project: `${DEFAULT_PROJECT}-${n}`,
    httpsPort: 8490 + n,
    rtcTcpPort: 7899 + 2 * n,
    rtcUdpPort: 7900 + 2 * n,
    apiPort: 18090 + n,
    livekitPort: 17890 + n,
    postgresPort: 15490 + n,
    subnet: `172.31.${200 + n}.0/24`,
  };
}

const DEFAULT_SETTINGS: StackSettings = {
  stack: undefined,
  project: DEFAULT_PROJECT,
  httpsPort: 443,
  rtcTcpPort: 7881,
  rtcUdpPort: 7882,
  apiPort: 18081,
  livekitPort: 17880,
  postgresPort: 15432,
  subnet: '172.31.250.0/24',
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
 * the defaults of the single-stack setup apply unchanged. `E2E_PROJECT=sf-e2e-N` (N = 1..4) alone selects the numbered
 * set as well, so a project named like a numbered stack never runs on the ports of another stack.
 *
 *   E2E_PROJECT  compose project (default sf-e2e)
 *   E2E_HTTPS_PORT, E2E_API_PORT, E2E_LIVEKIT_PORT, E2E_POSTGRES_PORT  host ports
 *   E2E_RTC_TCP_PORT, E2E_RTC_UDP_PORT  LiveKit media ports (STUDIOFLOW_RTC_TCP_PORT / STUDIOFLOW_RTC_UDP_PORT)
 *   E2E_SUBNET   /24 of the compose network
 */
export function resolveStackSettings(env: NodeJS.ProcessEnv = process.env): StackSettings {
  const rawStack = env['E2E_STACK']?.trim();
  const projectStack = /^sf-e2e-([1-5])$/.exec(env['E2E_PROJECT']?.trim() ?? '')?.[1];
  const base = rawStack ? numberedStack(Number(rawStack)) : projectStack ? numberedStack(Number(projectStack)) : DEFAULT_SETTINGS;
  const project = env['E2E_PROJECT']?.trim() || base.project;
  // Compose project names: lower-case letters, digits, "-" and "_", starting with a letter or digit.
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error(`E2E_PROJECT "${project}" is not a valid compose project name (lower-case letters, digits, - and _)`);
  const subnet = env['E2E_SUBNET']?.trim() || base.subnet;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/24$/.test(subnet)) throw new Error(`E2E_SUBNET must be a /24 such as 172.31.250.0/24, got "${subnet}"`);
  return {
    stack: base.stack,
    project,
    httpsPort: portOf(env, 'E2E_HTTPS_PORT', base.httpsPort),
    rtcTcpPort: portOf(env, 'E2E_RTC_TCP_PORT', base.rtcTcpPort),
    rtcUdpPort: portOf(env, 'E2E_RTC_UDP_PORT', base.rtcUdpPort),
    apiPort: portOf(env, 'E2E_API_PORT', base.apiPort),
    livekitPort: portOf(env, 'E2E_LIVEKIT_PORT', base.livekitPort),
    postgresPort: portOf(env, 'E2E_POSTGRES_PORT', base.postgresPort),
    subnet,
  };
}

/** The settings of this process. */
export const SETTINGS: StackSettings = resolveStackSettings();
/** Compose project of the stack under test. */
export const PROJECT = SETTINGS.project;
/** True for the unchanged single-stack setup (sf-e2e): its files keep their historical locations. */
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
  return `${project}_studioflow`;
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
  shortLivekit: path.join(E2E_DIR, 'docker-compose.short-livekit.yml'),
} as const;

/** Throwaway values; they only protect a stack that lives for the duration of a test run. The admin is created in the first-run setup (support/stack.ts, ensureHarnessAccount). */
export const TEST_ADMIN = { username: 'e2e-admin', password: 'e2e-Admin-Passw0rd-2026' } as const;
/** The domain the harness enters in the wizard: the stack answers at https://localhost:<port> (and, as any name, by IP). */
export const TEST_DOMAIN = 'localhost';
/** Origins the harness enters as the embedding in the wizard; the UI tests embed the output on https://embed.test, the embedding specs on https://embed.e2e.test. */
export const TEST_FRAME_ANCESTORS = ['https://embed.e2e.test', 'https://embed.test'] as const;
/** The secrets the stack generated for itself (read from its volume by global setup, never invented by the harness). */
export const SECRETS_FILE = path.join(OUTPUT_DIR, 'stack-secrets.json');

export interface StackSecrets {
  livekitApiKey: string;
  livekitApiSecret: string;
  postgresPassword: string;
}

let secretsCache: { mtimeMs: number; value: StackSecrets } | undefined;

/** The secrets of the running stack (support/stack.ts writes the file when the stack is up; a rebuilt stack has new ones). */
export function readStackSecrets(): StackSecrets {
  if (!fs.existsSync(SECRETS_FILE)) throw new Error(`${SECRETS_FILE} does not exist: global setup has not read the secrets of the stack`);
  const mtimeMs = fs.statSync(SECRETS_FILE).mtimeMs;
  if (secretsCache?.mtimeMs !== mtimeMs) secretsCache = { mtimeMs, value: JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) as StackSecrets };
  return secretsCache.value;
}

export interface StackConfig {
  /** Compose project of this stack (`sf-e2e`, `sf-e2e-2`, ...). */
  project: string;
  /** https origin of Caddy, e.g. https://localhost or https://localhost:8492 */
  baseURL: string;
  host: string;
  httpsPort: number;
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
  /** The key pair and the database password the stack generated (read when used, because a rebuilt stack has new ones). */
  readonly livekit: { apiKey: string; apiSecret: string };
  readonly postgresPassword: string;
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
  const host = TEST_DOMAIN;
  const subnet = env['STUDIOFLOW_SUBNET'] ?? SETTINGS.subnet;
  const prefix = subnet.split('/')[0]!.split('.').slice(0, 3).join('.');
  cached = {
    project: PROJECT,
    baseURL: originFor(host, httpsPort),
    host,
    httpsPort,
    rtcTcpPort: Number(env['STUDIOFLOW_RTC_TCP_PORT'] ?? SETTINGS.rtcTcpPort),
    rtcUdpPort: Number(env['STUDIOFLOW_RTC_UDP_PORT'] ?? SETTINGS.rtcUdpPort),
    apiDirect: `http://127.0.0.1:${env['E2E_API_PORT'] ?? SETTINGS.apiPort}`,
    livekitAdmin: `http://127.0.0.1:${env['E2E_LIVEKIT_PORT'] ?? SETTINGS.livekitPort}`,
    postgresPort: Number(env['E2E_POSTGRES_PORT'] ?? SETTINGS.postgresPort),
    nodeIp: env['E2E_NODE_IP'] ?? '127.0.0.1',
    subnet,
    admin: { username: TEST_ADMIN.username, password: TEST_ADMIN.password },
    get livekit() {
      const secrets = readStackSecrets();
      return { apiKey: secrets.livekitApiKey, apiSecret: secrets.livekitApiSecret };
    },
    get postgresPassword() {
      return readStackSecrets().postgresPassword;
    },
    frameAncestors: TEST_FRAME_ANCESTORS.join(' '),
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
 * Content of the generated environment file: only what a real installation may override (the HTTPS port, the media
 * ports, the subnet, the media limits) plus the test-only ports and fixed addresses of docker-compose.e2e.yml. No
 * domain, no certificate mode, no secret: the stack generates its own secrets and the harness sets the rest in the
 * first-run wizard (support/stack.ts, ensureHarnessConfigured). `E2E_NODE_IP` is read by the tests only (compose
 * ignores it); it is the address the harness enters as the media address.
 */
export function renderEnvFile(nodeIp: string, overrides: Record<string, string> = {}, settings: StackSettings = SETTINGS): string {
  const subnet = overrides['STUDIOFLOW_SUBNET'] ?? settings.subnet;
  const prefix = subnet.split('/')[0]!.split('.').slice(0, 3).join('.');
  const values: Record<string, string> = {
    STUDIOFLOW_HTTPS_PORT: String(settings.httpsPort),
    STUDIOFLOW_SUBNET: subnet,
    STUDIOFLOW_RTC_TCP_PORT: String(settings.rtcTcpPort),
    STUDIOFLOW_RTC_UDP_PORT: String(settings.rtcUdpPort),
    // Small limits so oversize uploads are cheap (INT-MEDIA-04 / E2E-MEDIA-02): 1 MiB images, 2 MiB videos.
    MEDIA__MAXIMAGEBYTES: '1048576',
    MEDIA__MAXVIDEOBYTES: '2097152',
    E2E_NODE_IP: nodeIp,
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
  const lines = [
    `# Generated by tests/e2e/global-setup.ts - throwaway test values, never used outside the E2E stack (${settings.project}).`,
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ];
  return lines.join('\n');
}
