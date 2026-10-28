import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AdminApi } from '../../support/api';
import { REPO_ROOT, imageNameOf, stackConfig } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { composeConfigZeroConfig } from '../../support/ops';
import { containerName, docker } from '../../support/stack';
import { exec } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * OPS - the parts of docs/testing.md 2.11 that read the compose files and the scripts of the images and do not change the
 * running stack: E2E-OPS-01 (compose files and .env.example, zero-config), -12 (network exposure), -13 (hardening),
 * -15 (the Regie account: reset-admin), -20 to -22 (backup service and its shell code), -31 to -33 (no host scripts, no
 * Docker socket, no port 80, the Caddy admin API stays inside).
 */

const read = (relative: string): string => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = (relative: string): boolean => fs.existsSync(path.join(REPO_ROOT, relative));

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.release.yml'] as const;
const RUNNING = ['caddy', 'api', 'livekit', 'postgres', 'backup'] as const;

interface ConfigService {
  image?: string;
  build?: { args?: Record<string, string> } | string;
  restart?: string;
  security_opt?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition: string }>;
  ports?: Array<{ target: number; published?: string; protocol?: string; host_ip?: string }>;
  profiles?: string[];
  environment?: Record<string, string>;
  read_only?: boolean;
  network_mode?: string;
  networks?: unknown;
  volumes?: Array<{ type: string; source?: string; target: string; read_only?: boolean }>;
}

/** The services of a compose file as a user gets them from `docker compose config` with no env file and an empty environment. */
async function configOf(file: (typeof COMPOSE_FILES)[number], profiles: string[] = []): Promise<Record<string, ConfigService>> {
  const result = await composeConfigZeroConfig({ file, profiles });
  expect(result.code, `${file}: ${result.output.slice(-1000)}`).toBe(0);
  return (JSON.parse(result.stdout) as { services: Record<string, ConfigService> }).services;
}

/** Names of the variables a compose file reads. Comments are not part of the contract. */
function composeVariables(file: string): { all: Set<string>; required: string[] } {
  const text = read(file)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const all = new Set<string>();
  const required: string[] = [];
  for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) all.add(match[1]!);
  for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)) required.push(match[1]!);
  return { all, required };
}

function envExampleKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of read('.env.example').split(/\r?\n/)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) keys.set(match[1]!, line.startsWith('#') ? `#${match[2]}` : match[2]!);
  }
  return keys;
}

test.describe('OPS compose files (zero-config)', () => {
  for (const file of COMPOSE_FILES) {
    test(`E2E-OPS-01 [static] ${file} needs no .env and no variable: docker compose config works with an empty environment`, t.p0, async () => {
      expect(composeVariables(file).required, 'no variable is required (`${VAR:?...}`)').toEqual([]);
      const services = await configOf(file, ['chaos']);
      expect(Object.keys(services).filter((name) => name !== 'netem').sort()).toEqual(['api', 'backup', 'caddy', 'init', 'livekit', 'postgres']);
      // The defaults a user gets: HTTPS on 8443 (tcp and udp), media on 7881/tcp and 7882/udp, the image tag "latest" (release file).
      const ports = (name: string) => (services[name]?.ports ?? []).map((port) => `${port.published}/${port.protocol ?? 'tcp'}`).sort();
      expect(ports('caddy')).toEqual(['8443/tcp', '8443/udp']);
      expect(ports('livekit')).toEqual(['7881/tcp', '7882/udp']);
      if (file === 'docker-compose.release.yml') {
        for (const name of ['caddy', 'api', 'livekit', 'backup']) expect(services[name]!.image, `${name} image`).toMatch(/^ghcr\.io\/opten\/studioflow-(web|api|livekit|backup):latest$/);
      }
    });
  }

  test('E2E-OPS-01 [static] the build file and the release file describe the same stack', t.p1, async () => {
    const build = await configOf('docker-compose.yml');
    const release = await configOf('docker-compose.release.yml');
    expect(Object.keys(release).sort()).toEqual(Object.keys(build).sort());
    for (const name of Object.keys(release)) {
      const strip = ({ image: _image, build: _build, ...rest }: ConfigService) => rest;
      // Only the image lines and the build sections may differ.
      expect(strip(release[name]!), `${name}: release file against build file`).toEqual(strip(build[name]!));
    }
  });

  test('E2E-OPS-01 [static] images are pinned; every service restarts, is health-checked, hardened and ordered', t.p1, async () => {
    const services = await configOf('docker-compose.release.yml');
    expect(services['postgres']!.image, 'PostgreSQL image').toMatch(/^postgres:17\.\d+-alpine(@sha256:[0-9a-f]{64})?$/);
    expect(services['init']!.image, 'the init service uses the PostgreSQL image (no extra image)').toBe(services['postgres']!.image);
    // The upstream images are pinned in the Dockerfiles of the images StudioFlow builds on them.
    expect(read('infra/livekit/Dockerfile'), 'LiveKit upstream version').toMatch(/^ARG LIVEKIT_VERSION=v\d+\.\d+\.\d+/m);
    expect(read('infra/livekit/Dockerfile')).toMatch(/FROM livekit\/livekit-server:\$\{LIVEKIT_VERSION\}/);
    for (const service of RUNNING) {
      const entry = services[service]!;
      expect(entry.restart, `${service} restart policy`).toBe('unless-stopped');
      expect(entry.security_opt ?? [], `${service} no-new-privileges`).toContain('no-new-privileges:true');
      expect(entry.cap_drop ?? [], `${service} cap_drop`).toContain('ALL');
    }
    for (const service of ['api', 'livekit', 'postgres', 'backup'] as const) expect(services[service]!.healthcheck?.test, `${service} healthcheck`).toBeTruthy();
    const caddyImage = await docker(['inspect', '-f', '{{json .Config.Healthcheck}}', containerName('caddy')]);
    expect(caddyImage.stdout.trim(), 'Caddy healthcheck (from the image)').not.toBe('null');
    const depends = (service: string, on: string) => services[service]!.depends_on?.[on]?.condition;
    expect(depends('caddy', 'api'), 'caddy waits for api').toBe('service_healthy');
    expect(depends('api', 'postgres'), 'api waits for postgres').toBe('service_healthy');
    for (const service of RUNNING) expect(depends(service, 'init'), `${service} waits for the secrets`).toBe('service_completed_successfully');
    expect(services['init']!.restart, 'init runs once per start').toBe('no');
  });

  test('E2E-OPS-01 [static] .env.example documents every variable of both compose files with an empty value and holds no secret', t.p1, async () => {
    const documented = envExampleKeys();
    for (const file of COMPOSE_FILES) {
      const missing = [...composeVariables(file).all].filter((name) => !documented.has(name));
      expect(missing, `variables read by ${file} but not documented in .env.example`).toEqual([]);
    }
    for (const [name, value] of documented) {
      // A commented-out line is an example of an override the Compose files do not pass on (the API time limits, the import
      // limits); a line that is not commented must stay empty: every value is an optional override.
      if (value.startsWith('#')) continue;
      expect(value, `${name} has no value in .env.example (every value is an optional override)`).toBe('');
    }
    expect(read('.env.example'), 'no placeholder secret').not.toMatch(/changeme|devkey|password123/i);
    for (const legacy of ['STUDIOFLOW_DOMAIN', 'STUDIOFLOW_NODE_IP', 'STUDIOFLOW_TLS_MODE', 'CF_API_TOKEN', 'STUDIOFLOW_FRAME_ANCESTORS', 'COMPOSE_PROFILES', 'BACKUP_SCHEDULE']) {
      expect(documented.has(legacy), `${legacy} is a setting of the wizard now, not a variable`).toBe(false);
    }
  });
});

test.describe('OPS no host scripts, no Docker socket, no port 80', () => {
  test('E2E-OPS-31 [static] the stack needs no script on the host: none ships, no compose file and no image refers to one', t.p0, async () => {
    for (const script of ['setup.sh', 'setup.ps1', 'update.sh', 'update.ps1', 'backup.sh', 'backup.ps1', 'restore.sh', 'restore.ps1', 'infra/scripts/common.sh', 'infra/scripts/StudioFlow.psm1']) {
      expect(exists(script), `${script} must not exist`).toBe(false);
    }
    const bundle = read('infra/release/build-bundle.sh');
    expect(bundle, 'the release assets carry no script').not.toMatch(/setup\.sh|update\.sh|backup\.sh|restore\.sh|\.ps1/);
    for (const file of COMPOSE_FILES) expect(read(file), `${file} does not refer to a host script`).not.toMatch(/\.\/(setup|update|backup|restore)\.(sh|ps1)/);
  });

  test('E2E-OPS-31 [static] no service mounts the Docker socket, runs privileged or joins the host network', t.p0, async () => {
    for (const file of COMPOSE_FILES) {
      expect(read(file), `${file} mentions the Docker socket`).not.toMatch(/docker\.sock/);
      const services = await configOf(file, ['chaos']);
      for (const [name, service] of Object.entries(services)) {
        if (name === 'netem') continue; // the chaos sidecar of the build file shares LiveKit's network namespace for tests only
        expect(service.network_mode ?? '', `${file} ${name}: network mode`).not.toBe('host');
        for (const volume of service.volumes ?? []) expect(volume.source ?? '', `${file} ${name}: ${volume.target}`).not.toMatch(/docker\.sock|^\/(var\/)?run\//);
      }
    }
  });

  test('E2E-OPS-31 [stack] no container of the stack has the Docker socket or runs privileged', t.p0, async () => {
    const ids = (await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${stackConfig().project}`], { check: true })).stdout.split(/\s+/).filter(Boolean);
    expect(ids.length, 'containers of the stack').toBeGreaterThanOrEqual(5);
    const inspected = JSON.parse((await docker(['inspect', ...ids], { check: true })).stdout) as Array<{ Name: string; HostConfig: { Privileged: boolean; NetworkMode: string }; Mounts: Array<{ Source: string; Destination: string }> }>;
    for (const info of inspected) {
      expect(info.HostConfig.Privileged, `${info.Name} privileged`).toBe(false);
      for (const mount of info.Mounts) {
        expect(`${mount.Source} ${mount.Destination}`, `${info.Name}: mount`).not.toMatch(/docker\.sock/);
      }
    }
  });

  test('E2E-OPS-31 [stack] nothing listens on port 80, and Caddy listens only on the HTTPS port (and on the health port inside); the admin API has no TCP listener', t.p0, async () => {
    const config = stackConfig();
    const listening = (await docker(['exec', containerName('caddy'), 'netstat', '-lnt'], { check: true })).stdout;
    const ports = [...listening.matchAll(/^tcp\s+\d+\s+\d+\s+(\S+):(\d+)\s/gm)].map((match) => ({ address: match[1]!, port: Number(match[2]) }));
    const caddyPorts = ports.filter((entry) => entry.address === '0.0.0.0' || entry.address === '::').map((entry) => entry.port).sort((a, b) => a - b);
    expect(caddyPorts, 'public listeners of Caddy: the HTTPS port only').toEqual([config.httpsPort]);
    expect(ports.map((entry) => entry.port), 'the admin API is not a network service (unix socket)').not.toContain(2019);
    expect(ports.map((entry) => entry.port), 'no listener on 80 or 443').not.toContain(80);
    expect(ports.map((entry) => entry.port)).not.toContain(443);
    // Nothing published on the host for 80, either.
    const published = (await docker(['inspect', '-f', '{{json .NetworkSettings.Ports}}', containerName('caddy')], { check: true })).stdout;
    expect(published).not.toContain('"80/tcp":[');
  });
});

test.describe('OPS backup service (static)', () => {
  test('E2E-OPS-20 [static] the backup service is part of the stack, hardened, publishes nothing and reads its settings from the API', t.p1, async () => {
    const services = await configOf('docker-compose.release.yml');
    const backup = services['backup']!;
    expect(backup.profiles ?? [], 'always on: no profile').toEqual([]);
    expect(backup.restart).toBe('unless-stopped');
    expect(backup.security_opt ?? []).toContain('no-new-privileges:true');
    expect(backup.cap_drop ?? []).toContain('ALL');
    expect([...(backup.cap_add ?? [])].sort(), 'the capabilities restore needs for the files of other users').toEqual(['CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER']);
    expect(backup.read_only, 'read-only root file system').toBe(true);
    expect(backup.healthcheck?.test, 'healthcheck').toBeTruthy();
    expect(backup.depends_on?.['postgres']?.condition).toBe('service_healthy');
    expect(backup.ports ?? [], 'publishes nothing').toEqual([]);
    const mount = (service: ConfigService, source: string) => service.volumes?.find((volume) => volume.source === source);
    for (const volume of ['backups', 'backup_status', 'media', 'keys', 'caddy_data']) expect(mount(backup, volume)?.read_only ?? false, `${volume} is writable (restore replaces it)`).toBe(false);
    expect(mount(backup, 'backup_config')?.read_only, 'the settings from the API are read-only').toBe(true);
    expect(mount(backup, 'secrets')?.read_only, 'the database password is read-only').toBe(true);
    // The tools match the server: the image is built from the PostgreSQL image of the stack.
    const build = (await configOf('docker-compose.yml'))['backup']!.build as { args?: Record<string, string> };
    expect(build.args?.['POSTGRES_IMAGE']).toBe(services['postgres']!.image);
    // The API sees the status file read-only and writes the settings; never the backups themselves.
    const api = services['api']!;
    expect(mount(api, 'backup_status')?.read_only, 'API: status volume read-only').toBe(true);
    expect(mount(api, 'backup_config')?.read_only ?? false, 'API: settings volume writable').toBe(false);
    expect(mount(api, 'backups'), 'API: no access to the backups').toBeUndefined();
    expect(api.environment?.['BACKUP__STATUSFILE']).toBe('/data/backup-status/backup-status.json');
  });

  const SHELL_FILES = ['infra/backup/common.sh', 'infra/backup/backup-core.sh', 'infra/backup/settings.sh', 'infra/backup/status.sh', 'infra/backup/serve.sh', 'infra/backup/backup-job.sh', 'infra/backup/restore.sh', 'infra/backup/entrypoint.sh', 'infra/backup/healthcheck.sh', 'infra/livekit/supervisor.sh', 'infra/caddy/validate.sh'];
  const ASCII_FILES = [...SHELL_FILES, 'infra/backup/Dockerfile', 'infra/livekit/Dockerfile', '.env.example', 'docker-compose.yml', 'docker-compose.release.yml', '.github/renovate.json5'];

  test('E2E-OPS-20 [static] scripts and configuration are ASCII only, the shell scripts have valid syntax, LF endings and the executable bit', t.p1, async () => {
    for (const file of ASCII_FILES) {
      const bad = [...read(file)].filter((character) => character.charCodeAt(0) > 126);
      expect(bad, `${file}: non-ASCII characters (docs/architecture/i18n-design.md D9)`).toEqual([]);
    }
    const modes = new Map((await exec('git', ['ls-files', '-s', '--', 'infra'], { cwd: REPO_ROOT, check: true })).stdout.split('\n').filter(Boolean).map((line) => [line.split('\t')[1]!, line.split(' ')[0]!]));
    for (const file of SHELL_FILES) {
      const result = await exec('bash', ['-n', file], { cwd: REPO_ROOT });
      expect(result.code, `${file}: ${result.output}`).toBe(0);
      expect(read(file), `${file}: LF line endings`).not.toContain('\r');
      expect(modes.get(file), `${file}: executable in git`).toBe('100755');
    }
  });
});

/** Runs a bash script that sources the shared backup code (no Docker involved). */
async function bashScript(script: string) {
  return exec('bash', ['-s'], { cwd: REPO_ROOT, input: `set -euo pipefail\n. infra/backup/common.sh\n. infra/backup/backup-core.sh\n${script}\n`, timeoutMs: 60_000 });
}

test.describe('OPS backup logic (unit)', () => {
  const dates = (last: string, days: number) => Array.from({ length: days }, (_, index) => new Date(Date.parse(`${last}T00:00:00Z`) - index * 86_400_000).toISOString().slice(0, 10));

  test('E2E-OPS-21 [unit] retention keeps the newest backup of the last N days and N weeks and nothing else', t.p1, async () => {
    // 30 daily backups at 03:00 up to Friday 2026-10-23, plus a second one on the last day and a foreign name.
    const names = [...dates('2026-10-23', 30).map((day) => `${day}_0300_auto`), '2026-10-23_1510_auto', 'meine-notizen'];
    const result = await bashScript(`printf '%s\\n' ${names.map((name) => `'${name}'`).join(' ')} | sf_backup_expired 7 4`);
    expect(result.code, result.output).toBe(0);
    const expired = new Set(result.stdout.split('\n').filter(Boolean));
    const kept = names.filter((name) => !expired.has(name) && name !== 'meine-notizen');
    expect(kept.sort(), 'last 7 days (newest of each) plus the newest of the 3 weeks before: Sundays 11 and 4 October').toEqual(
      ['2026-10-23_1510_auto', '2026-10-22_0300_auto', '2026-10-21_0300_auto', '2026-10-20_0300_auto', '2026-10-19_0300_auto', '2026-10-18_0300_auto', '2026-10-17_0300_auto', '2026-10-11_0300_auto', '2026-10-04_0300_auto'].sort(),
    );
    expect(expired.has('2026-10-23_0300_auto'), 'the older backup of a day is expired').toBe(true);
    expect(expired.has('meine-notizen'), 'a name that is not a backup is never listed').toBe(false);
  });

  test('E2E-OPS-21 [unit] retention counts days and weeks that have a backup, so a pause does not shorten the history', t.p1, async () => {
    const names = ['2026-10-23_0300_auto', '2026-10-01_0300_auto', '2026-09-20_0300_auto', '2026-08-01_0300_auto'];
    const result = await bashScript(`printf '%s\\n' ${names.map((name) => `'${name}'`).join(' ')} | sf_backup_expired 2 1`);
    expect(result.stdout.split('\n').filter(Boolean).sort()).toEqual(['2026-08-01_0300_auto', '2026-09-20_0300_auto']);
    const empty = await bashScript(`printf '' | sf_backup_expired 7 4`);
    expect(empty.code).toBe(0);
    expect(empty.stdout).toBe('');
  });

  test('E2E-OPS-22 [unit] the checksum check accepts an intact backup and names the first problem otherwise', t.p0, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sums-'));
    try {
      const folder = dir.replace(/\\/g, '/');
      const script = `
dir='${folder}'
printf 'dump' >"$dir/database.dump"; printf 'tar' >"$dir/keys.tar.gz"; printf 'info' >"$dir/backup-info.txt"
sf_backup_write_checksums "$dir" database.dump keys.tar.gz backup-info.txt
echo "intact: $(sf_backup_check_checksums "$dir" && echo ok)"
printf 'x' >>"$dir/keys.tar.gz"
echo "tampered: $(sf_backup_check_checksums "$dir" || true)"
printf 'tar' >"$dir/keys.tar.gz"; rm "$dir/backup-info.txt"
echo "missing: $(sf_backup_check_checksums "$dir" || true)"
printf 'info' >"$dir/backup-info.txt"; printf '%s  ../escape\\n' "$(printf 'x' | sha256sum | cut -d' ' -f1)" >>"$dir/SHA256SUMS"
echo "escape: $(sf_backup_check_checksums "$dir" || true)"
first="$(sf_backup_unique_dir "$dir" 2026-10-23_0300_auto)"; mkdir "$first"
echo "unique: $(basename "$(sf_backup_unique_dir "$dir" 2026-10-23_0300_auto)")"`;
      const result = await bashScript(script);
      expect(result.code, result.output).toBe(0);
      expect(result.stdout).toContain('intact: ok');
      expect(result.stdout).toContain('tampered: Checksum mismatch: keys.tar.gz (the backup is damaged)');
      expect(result.stdout).toContain('missing: File listed in SHA256SUMS is missing: backup-info.txt');
      expect(result.stdout).toContain('escape: Invalid entry in SHA256SUMS: ../escape');
      expect(result.stdout).toContain('unique: 2026-10-23_0300_auto-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('OPS network and hardening', () => {
  test('E2E-OPS-12 [static] the networks are split by need: LiveKit cannot reach PostgreSQL, the admin socket of Caddy is shared by Caddy and the API only', t.p0, async () => {
    const names = (service: ConfigService): string[] => Object.keys((service.networks ?? {}) as Record<string, unknown>).sort();
    for (const file of COMPOSE_FILES) {
      const services = await configOf(file);
      expect(names(services['caddy']!), `${file}: caddy`).toEqual(['studioflow']);
      expect(names(services['livekit']!), `${file}: livekit (the service that takes media traffic from the internet)`).toEqual(['studioflow']);
      expect(names(services['api']!), `${file}: api`).toEqual(['backend', 'studioflow']);
      expect(names(services['postgres']!), `${file}: postgres`).toEqual(['backend']);
      expect(names(services['backup']!), `${file}: backup`).toEqual(['backend']);
      const mounting = (volume: string) => Object.entries(services).filter(([, service]) => (service.volumes ?? []).some((entry) => entry.source === volume)).map(([name]) => name).sort();
      expect(mounting('caddy_admin'), `${file}: who mounts the admin socket of Caddy`).toEqual(['api', 'caddy', 'init']);
      expect(mounting('caddy_certs'), `${file}: who mounts the uploaded certificate and key`).toEqual(['api', 'caddy', 'init']);
      expect(services['api']!.environment?.['INSTALL__CADDYADMINSOCKET'], `${file}: the API uses the socket`).toBe('/run/caddy-admin/admin.sock');
      expect(services['api']!.environment?.['INSTALL__CADDYADMINURL'], `${file}: and no TCP address`).toBeUndefined();
      expect(services['caddy']!.ports?.map((port) => port.target).sort(), `${file}: caddy publishes only the HTTPS port`).not.toContain(2019);
    }
    // The admin API is never a TCP listener in any Caddy configuration.
    for (const file of ['infra/caddy/global.caddy', 'infra/caddy/Caddyfile', 'infra/caddy/studioflow.caddy', 'infra/caddy/servers.caddy']) {
      expect(read(file).replace(/^\s*#.*$/gm, ''), `${file}: no TCP admin listener`).not.toMatch(/^\s*admin\s+(?!unix\/\/)\S+/m);
    }
    expect(read('infra/caddy/global.caddy')).toMatch(/^admin unix\/\/run\/caddy-admin\/admin\.sock\|0660$/m);
  });

  test('E2E-OPS-12 [static] only Caddy (HTTPS tcp+udp) and the LiveKit media ports (7881 tcp, 7882 udp) are published; no helper publishes anything', t.p0, async () => {
    for (const file of COMPOSE_FILES) {
      const services = await configOf(file, ['chaos']);
      const published = (name: string) => (services[name]?.ports ?? []).map((port) => `${port.published}/${port.protocol ?? 'tcp'}`).sort();
      expect(published('caddy'), `${file}: caddy`).toEqual(['8443/tcp', '8443/udp']);
      expect(published('livekit'), `${file}: livekit`).toEqual(['7881/tcp', '7882/udp']);
      for (const name of ['api', 'postgres', 'backup', 'init']) expect(published(name), `${file}: ${name} publishes nothing`).toEqual([]);
      for (const [name, service] of Object.entries(services)) {
        if (!RUNNING.includes(name as (typeof RUNNING)[number]) && name !== 'init') expect(service.ports ?? [], `profile service ${name} publishes nothing`).toEqual([]);
      }
    }
  });

  test('E2E-OPS-12 [stack] from the LAN address the internal ports (API 8080, LiveKit 7880, PostgreSQL 5432, Caddy 2019/2020) and the ports 80 and 443 are closed; the HTTPS port and 7881 are open', t.p0, async () => {
    const config = stackConfig();
    const host = config.nodeIp;
    const probe = (port: number) =>
      new Promise<boolean>((resolve) => {
        const socket = net.connect({ host, port, timeout: 1500 });
        socket.on('connect', () => (socket.destroy(), resolve(true)));
        socket.on('timeout', () => (socket.destroy(), resolve(false)));
        socket.on('error', () => resolve(false));
      });
    for (const port of [8080, 7880, 5432, 2020, 2019]) expect(await probe(port), `port ${port} on ${host}`).toBe(false);
    expect(await probe(config.httpsPort), String(config.httpsPort)).toBe(true);
    expect(await probe(config.rtcTcpPort), String(config.rtcTcpPort)).toBe(true);
  });

  test('E2E-OPS-32 [stack] the Caddy admin API is a unix socket that only Caddy and the API mount: LiveKit, PostgreSQL and any other container of the networks cannot reach it', t.p0, async () => {
    const config = stackConfig();
    // The socket: Caddy's user owns it, the shared group and nobody else may use it (mode 660), in a folder of the API and the same group.
    const socket = (await docker(['exec', containerName('caddy'), 'stat', '-c', '%a %u:%g', '/run/caddy-admin/admin.sock', '/run/caddy-admin'], { check: true })).stdout.trim().split('\n');
    expect(socket, 'mode and owner of the socket and of its folder').toEqual(['660 10001:10002', '770 1654:10002']);
    // The volume is mounted into Caddy and the API (and the init service that sets its owner), into nothing else.
    const mounting = (await docker(['ps', '-a', '--filter', `volume=${config.project}_caddy_admin`, '--format', '{{.Names}}'], { check: true })).stdout.split(/\s+/).filter(Boolean).sort();
    expect(mounting, 'containers that mount the admin socket').toEqual([containerName('api'), containerName('caddy'), containerName('init')].sort());
    // Caddy answers on the socket (the API pushed the configuration this way: the server is named sf- and 12 hex characters).
    const status = await (await AdminApi.login()).getServerSettingsStatus();
    expect(status.body.caddy.applied, 'the API applied the configuration to Caddy through the socket').toBe(true);
    // Not from LiveKit (the one container that takes media traffic from the internet), not from a throw-away container on the
    // networks of the stack, not by name and not by address.
    const caddyAddress = JSON.parse((await docker(['inspect', containerName('caddy')], { check: true })).stdout)[0].NetworkSettings.Networks[config.network].IPAddress as string;
    const postgresImage = (await docker(['inspect', '-f', '{{.Config.Image}}', containerName('postgres')], { check: true })).stdout.trim();
    const probes: Array<{ from: string; run: string[] }> = [
      { from: 'livekit', run: ['exec', containerName('livekit')] },
      { from: 'a throw-away container on the studioflow network', run: ['run', '--rm', '--network', config.network, '--entrypoint', 'wget', postgresImage] },
    ];
    for (const probe of probes) {
      for (const target of ['caddy', caddyAddress]) {
        const answer = await docker([...probe.run, ...(probe.run[0] === 'exec' ? ['wget'] : []), '-T', '3', '-q', '-O', '-', `http://${target}:2019/config/`]);
        expect(answer.code, `${probe.from}: http://${target}:2019/config/ must not answer`).not.toBe(0);
        expect(answer.stdout, `${probe.from}: no configuration leaks`).not.toContain('"apps"');
      }
    }
    // LiveKit and any container on the studioflow network cannot reach the database either: it is on the backend network only.
    for (const probe of probes) {
      const answer = await docker([...probe.run, ...(probe.run[0] === 'exec' ? ['wget'] : []), '-T', '3', '-q', '-O', '-', 'http://postgres:5432/']);
      expect(answer.code, `${probe.from}: postgres is not resolvable or reachable`).not.toBe(0);
      expect(answer.output, `${probe.from}: the name does not resolve`).toMatch(/bad address|not found|resolve|timed out|can't connect|Network is unreachable/i);
    }
    // Not from the LAN address, not through the HTTPS port.
    const viaHttps = await fetch(`${config.baseURL}/config/`, { signal: AbortSignal.timeout(8000) });
    expect(viaHttps.headers.get('content-type') ?? '', 'the admin routes are not part of the public site: /config/ is just a page of the Regie').toContain('text/html');
    expect(await viaHttps.text()).not.toContain('"apps"');
    const lan = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: config.nodeIp, port: 2019, timeout: 1500 });
      socket.on('connect', () => (socket.destroy(), resolve(true)));
      socket.on('timeout', () => (socket.destroy(), resolve(false)));
      socket.on('error', () => resolve(false));
    });
    expect(lan, 'port 2019 is not published').toBe(false);
  });

  test('E2E-OPS-13 [stack] every container runs with no-new-privileges and cap_drop ALL; the API and LiveKit run as a non-root user', t.p1, async () => {
    for (const service of [...RUNNING, 'init']) {
      const info = JSON.parse((await docker(['inspect', containerName(service)], { check: true })).stdout)[0] as { HostConfig: { SecurityOpt: string[]; CapDrop: string[]; Privileged: boolean } };
      expect(info.HostConfig.SecurityOpt ?? [], `${service} no-new-privileges`).toContain('no-new-privileges:true');
      expect(info.HostConfig.CapDrop ?? [], `${service} cap_drop`).toContain('ALL');
      expect(info.HostConfig.Privileged, `${service} not privileged`).toBe(false);
    }
    const uid = (await docker(['exec', containerName('api'), 'id', '-u'], { check: true })).stdout.trim();
    expect(Number(uid), `API uid ${uid}`).toBeGreaterThan(0);
    for (const service of ['caddy', 'postgres', 'livekit', 'backup'] as const) {
      const user = (await docker(['exec', containerName(service), 'id', '-u'])).stdout.trim();
      test.info().annotations.push({ type: 'measurement', description: `${service} runs as uid ${user}` });
    }
  });

  test('E2E-OPS-13 [stack] PostgreSQL keeps only the capabilities its entrypoint needs', t.p1, async () => {
    const info = JSON.parse((await docker(['inspect', containerName('postgres')], { check: true })).stdout)[0] as { HostConfig: { CapDrop: string[]; CapAdd: string[] } };
    expect(info.HostConfig.CapDrop ?? [], 'postgres CapDrop').toContain('ALL');
    expect((info.HostConfig.CapAdd ?? []).map((name) => name.replace(/^CAP_/, '')).sort(), 'postgres CapAdd').toEqual(['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID']);
  });

  test('E2E-OPS-13 [stack] secrets live in files of a volume (mode 600, owned by the API), not in the environment of any container, any image layer or any log', t.p1, async () => {
    const config = stackConfig();
    const secrets = { admin: config.admin.password, livekit: config.livekit.apiSecret, postgres: config.postgresPassword };
    const environment = async (service: string) => (await docker(['inspect', '-f', '{{json .Config.Env}}', containerName(service)], { check: true })).stdout;
    for (const service of [...RUNNING, 'init']) {
      const env = await environment(service);
      for (const [name, secret] of Object.entries(secrets)) expect(env.includes(secret), `${service}: environment contains the ${name} secret`).toBe(false);
    }
    // The files: created by the init service, readable by the API only.
    const files = (await docker(['exec', containerName('api'), 'sh', '-c', 'stat -c "%n %a %u" /secrets/*'], { check: true })).stdout.trim().split('\n').sort();
    expect(files).toEqual(['/secrets/livekit-api-key 600 1654', '/secrets/livekit-api-secret 600 1654', '/secrets/postgres-password 600 1654']);
    expect(secrets.livekit.length, 'a long random LiveKit secret').toBeGreaterThanOrEqual(40);
    expect(secrets.postgres.length, 'a long random database password').toBeGreaterThanOrEqual(30);
    // Images: no secret in the config or the history of the images the stack is built from.
    for (const image of [imageNameOf('api'), imageNameOf('caddy'), imageNameOf('livekit'), imageNameOf('backup')]) {
      const inspect = (await docker(['image', 'inspect', image], { check: true })).stdout;
      const history = (await docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image], { check: true })).stdout;
      for (const [name, secret] of Object.entries(secrets)) {
        expect(inspect.includes(secret), `${image} config contains the ${name} secret`).toBe(false);
        expect(history.includes(secret), `${image} history contains the ${name} secret`).toBe(false);
      }
    }
    // Logs: never a secret (the init service prints names only).
    for (const service of [...RUNNING, 'init']) {
      const logs = (await docker(['logs', containerName(service)])).output;
      for (const [name, secret] of Object.entries(secrets)) expect(logs.includes(secret), `${service}: log contains the ${name} secret`).toBe(false);
    }
    const ignore = read('.dockerignore').split(/\r?\n/).map((line) => line.trim());
    for (const entry of ['.env', '.git', '**/node_modules']) expect(ignore, `.dockerignore excludes ${entry}`).toContain(entry);
    const apiIgnore = exists('apps/api/.dockerignore') ? read('apps/api/.dockerignore') : '';
    expect(apiIgnore, 'the API context has its own .dockerignore').toMatch(/bin|obj/);
  });
});

test.describe('OPS Regie account', () => {
  const IMAGE = imageNameOf('api');

  test('E2E-OPS-15 [image] reset-admin without --yes asks first and an empty answer changes nothing', t.p1, async () => {
    const result = await exec('docker', ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'dotnet', IMAGE, 'Opten.StudioFlow.Web.dll', 'reset-admin'], { input: '', timeoutMs: 120_000 });
    expect(result.code, 'not confirmed: exit code 2').toBe(2);
    expect(result.stdout).toContain('Type yes to continue');
    expect(result.stderr).toMatch(/not changed/);
  });

  test('E2E-OPS-15 [image] reset-admin names no connection string when the database is not reachable', t.p1, async () => {
    const config = stackConfig();
    const result = await exec(
      'docker',
      [
        'run', '--rm', '--network', 'none',
        '-e', `CONNECTIONSTRINGS__STUDIOFLOW=Host=nowhere;Database=studioflow;Username=studioflow;Password=${config.postgresPassword};Timeout=2`,
        '--entrypoint', 'dotnet', IMAGE, 'Opten.StudioFlow.Web.dll', 'reset-admin', '--yes',
      ],
      { timeoutMs: 120_000 },
    );
    expect(result.code, 'the command fails').toBe(1);
    expect(result.output).not.toContain(config.postgresPassword);
  });

  test('E2E-OPS-15 [stack] Compose passes no account setting to the api container', t.p1, async () => {
    const env = (await docker(['inspect', '-f', '{{json .Config.Env}}', containerName('api')], { check: true })).stdout;
    expect(env, 'the api container has no account setting').not.toMatch(/ADMIN__(USERNAME|PASSWORD)/);
  });
});
