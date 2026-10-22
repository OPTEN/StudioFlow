import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

// Docker Desktop on Windows publishes [::]:443 but nothing listens on ::1 (connections hang): prefer IPv4 for "localhost".
dns.setDefaultResultOrder('ipv4first');

/** tests/e2e */
export const E2E_DIR = path.resolve(__dirname, '..');
/** Repository root (docker compose runs here). */
export const REPO_ROOT = path.resolve(E2E_DIR, '..', '..');
/** Generated, git-ignored environment file with throwaway test credentials. */
export const ENV_FILE = path.join(E2E_DIR, '.env.e2e');
/** Compose project of the stack under test. */
export const PROJECT = 'fs-e2e';
/** Results, logs, generated assets (git-ignored). */
export const OUTPUT_DIR = path.join(E2E_DIR, '.output');
export const ASSET_DIR = path.join(OUTPUT_DIR, 'assets');
export const STATE_FILE = path.join(OUTPUT_DIR, 'stack-state.json');

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
  /** https origin of Caddy, e.g. https://localhost */
  baseURL: string;
  host: string;
  httpsPort: number;
  httpPort: number;
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

let cached: StackConfig | undefined;

/** Reads tests/e2e/.env.e2e (written by global-setup). */
export function stackConfig(): StackConfig {
  if (cached) return cached;
  if (!fs.existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} does not exist: global setup has not run`);
  const env = parseEnvFile(ENV_FILE);
  const httpsPort = Number(env['E2E_HTTPS_PORT'] ?? 443);
  const host = env['FLOWSTUDIO_DOMAIN'] ?? 'localhost';
  cached = {
    baseURL: env['FLOWSTUDIO_PUBLIC_BASE_URL'] || `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`,
    host,
    httpsPort,
    httpPort: Number(env['E2E_HTTP_PORT'] ?? 80),
    apiDirect: `http://127.0.0.1:${env['E2E_API_PORT'] ?? 18081}`,
    livekitAdmin: `http://127.0.0.1:${env['E2E_LIVEKIT_PORT'] ?? 17880}`,
    postgresPort: Number(env['E2E_POSTGRES_PORT'] ?? 15432),
    nodeIp: env['FLOWSTUDIO_NODE_IP'] ?? '127.0.0.1',
    subnet: env['FLOWSTUDIO_SUBNET'] ?? '172.31.250.0/24',
    admin: { username: env['ADMIN__USERNAME'] ?? TEST_ADMIN.username, password: env['ADMIN__PASSWORD'] ?? TEST_ADMIN.password },
    livekit: { apiKey: env['LIVEKIT_API_KEY'] ?? TEST_LIVEKIT.apiKey, apiSecret: env['LIVEKIT_API_SECRET'] ?? TEST_LIVEKIT.apiSecret },
    postgresPassword: env['POSTGRES_PASSWORD'] ?? TEST_POSTGRES_PASSWORD,
    frameAncestors: env['FLOWSTUDIO_FRAME_ANCESTORS'] ?? '',
    ips: {
      livekit: env['E2E_IP_LIVEKIT'] ?? '172.31.250.10',
      api: env['E2E_IP_API'] ?? '172.31.250.11',
      postgres: env['E2E_IP_POSTGRES'] ?? '172.31.250.12',
      caddy: env['E2E_IP_CADDY'] ?? '172.31.250.13',
    },
    network: `${PROJECT}_flowstudio`,
    mediaMaxImageBytes: Number(env['MEDIA__MAXIMAGEBYTES'] ?? 1_048_576),
    mediaMaxVideoBytes: Number(env['MEDIA__MAXVIDEOBYTES'] ?? 2_097_152),
  };
  return cached;
}

/** Content of the generated environment file. */
export function renderEnvFile(nodeIp: string, overrides: Record<string, string> = {}): string {
  const subnet = overrides['FLOWSTUDIO_SUBNET'] ?? process.env['E2E_SUBNET'] ?? '172.31.250.0/24';
  const prefix = subnet.split('/')[0]!.split('.').slice(0, 3).join('.');
  const values: Record<string, string> = {
    FLOWSTUDIO_DOMAIN: 'localhost',
    FLOWSTUDIO_TLS_MODE: 'internal',
    // The same site under the IPv4 address: WebKit on Windows resolves "localhost" to ::1, where Docker Desktop accepts
    // the connection and never answers; https://127.0.0.1 reaches the stack (webkit project).
    FLOWSTUDIO_EXTRA_HOSTS: '127.0.0.1',
    FLOWSTUDIO_NODE_IP: nodeIp,
    FLOWSTUDIO_SUBNET: subnet,
    FLOWSTUDIO_FRAME_ANCESTORS: 'https://embed.e2e.test',
    ADMIN__USERNAME: TEST_ADMIN.username,
    ADMIN__PASSWORD: TEST_ADMIN.password,
    ADMIN__PASSWORDHASH: '',
    LIVEKIT_API_KEY: TEST_LIVEKIT.apiKey,
    LIVEKIT_API_SECRET: TEST_LIVEKIT.apiSecret,
    POSTGRES_PASSWORD: TEST_POSTGRES_PASSWORD,
    // Small limits so oversize uploads are cheap (INT-MEDIA-04 / E2E-MEDIA-02): 1 MiB images, 2 MiB videos.
    MEDIA__MAXIMAGEBYTES: '1048576',
    MEDIA__MAXVIDEOBYTES: '2097152',
    E2E_HTTP_PORT: process.env['E2E_HTTP_PORT'] ?? '80',
    E2E_HTTPS_PORT: process.env['E2E_HTTPS_PORT'] ?? '443',
    E2E_API_PORT: process.env['E2E_API_PORT'] ?? '18081',
    E2E_LIVEKIT_PORT: process.env['E2E_LIVEKIT_PORT'] ?? '17880',
    E2E_POSTGRES_PORT: process.env['E2E_POSTGRES_PORT'] ?? '15432',
    E2E_IP_LIVEKIT: `${prefix}.10`,
    E2E_IP_API: `${prefix}.11`,
    E2E_IP_POSTGRES: `${prefix}.12`,
    E2E_IP_CADDY: `${prefix}.13`,
    ...overrides,
  };
  if (process.env['E2E_HTTPS_PORT'] && process.env['E2E_HTTPS_PORT'] !== '443') {
    values['FLOWSTUDIO_PUBLIC_BASE_URL'] = `https://localhost:${process.env['E2E_HTTPS_PORT']}`;
  }
  const lines = [
    '# Generated by tests/e2e/global-setup.ts - throwaway test values, never used outside the E2E stack (fs-e2e).',
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ];
  return lines.join('\n');
}
