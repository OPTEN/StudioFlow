import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { COMPOSE_FILES, ENV_FILE, PROJECT, REPO_ROOT, imageNameOf, parseEnvFile, stackConfig } from '../../support/env';
import { expect, knownBug, test } from '../../support/fixtures';
import { detectLanIPv4 } from '../../support/network-info';
import { OpsSandbox, bashPath, cleanComposeEnv, composeConfig } from '../../support/ops';
import { containerName, docker } from '../../support/stack';
import { exec } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * OPS - the parts of docs/testing.md 2.11 that read the compose file and the scripts and do not change the running
 * stack: E2E-OPS-01 (compose file and .env.example), -02 (setup.sh), -12 (network exposure), -13 (hardening),
 * -15 (the Regie account: reset-admin). Scripts run unmodified in an isolated copy (support/ops.ts).
 */

const read = (relative: string): string => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const bashPathOf = bashPath;

/** PowerShell 7 if there is one, else Windows PowerShell; undefined when neither starts. */
async function powerShell(): Promise<string | undefined> {
  for (const candidate of ['pwsh', 'powershell']) {
    const probe = await exec(candidate, ['-NoProfile', '-Command', 'exit 0']).catch(() => undefined);
    if (probe?.code === 0) return candidate;
  }
  return undefined;
}
const SERVICES = ['caddy', 'api', 'livekit', 'postgres'] as const;
const TLS_MODES = ['internal', 'acme', 'custom', 'dns-cloudflare'];

interface ConfigService {
  image?: string;
  build?: unknown;
  restart?: string;
  security_opt?: string[];
  cap_drop?: string[];
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition: string }>;
  ports?: Array<{ target: number; published?: string; protocol?: string; host_ip?: string }>;
  profiles?: string[];
  environment?: Record<string, string>;
  cap_add?: string[];
  read_only?: boolean;
  volumes?: Array<{ type: string; source?: string; target: string; read_only?: boolean }>;
}

async function configOf(profiles: string[] = []): Promise<Record<string, ConfigService>> {
  const result = await composeConfig({ profiles });
  expect(result.code, result.output.slice(-1000)).toBe(0);
  return (JSON.parse(result.stdout) as { services: Record<string, ConfigService> }).services;
}

/** Names of the variables `docker-compose.yml` reads, with the ones that are required (`:?`). */
function composeVariables(): { all: Set<string>; required: Map<string, string> } {
  // Comments (they mention ${VAR:?...} as an example) are not part of the contract.
  const text = read('docker-compose.yml')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const all = new Set<string>();
  const required = new Map<string, string>();
  for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) all.add(match[1]!);
  for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?([^}]*)\}/g)) required.set(match[1]!, match[2]!);
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

test.describe('OPS compose file', () => {
  test('E2E-OPS-01 [static] images are pinned; every service restarts, is health-checked, hardened and ordered', t.p1, async () => {
    const services = await configOf();
    // Renovate pins the images by digest (tag@sha256:...), so a digest is allowed behind the tag.
    expect(services['livekit']!.image, 'LiveKit image').toMatch(/^livekit\/livekit-server:v\d+\.\d+\.\d+(@sha256:[0-9a-f]{64})?$/);
    expect(services['postgres']!.image, 'PostgreSQL image').toMatch(/^postgres:17\.\d+-alpine(@sha256:[0-9a-f]{64})?$/);
    for (const service of SERVICES) {
      const entry = services[service]!;
      expect(entry.restart, `${service} restart policy`).toBe('unless-stopped');
      expect(entry.security_opt ?? [], `${service} no-new-privileges`).toContain('no-new-privileges:true');
    }
    for (const service of ['caddy', 'api', 'livekit'] as const) expect(services[service]!.cap_drop ?? [], `${service} cap_drop`).toContain('ALL');
    // Healthchecks: in the compose file, or (Caddy) from the image.
    for (const service of ['api', 'livekit', 'postgres'] as const) expect(services[service]!.healthcheck?.test, `${service} healthcheck`).toBeTruthy();
    const caddyImage = await docker(['inspect', '-f', '{{json .Config.Healthcheck}}', containerName('caddy')]);
    expect(caddyImage.stdout.trim(), 'Caddy healthcheck (from the image)').not.toBe('null');
    const depends = (service: string, on: string) => services[service]!.depends_on?.[on]?.condition;
    expect(depends('caddy', 'api'), 'caddy waits for api').toBe('service_healthy');
    expect(depends('caddy', 'livekit'), 'caddy waits for livekit').toBe('service_healthy');
    expect(depends('api', 'postgres'), 'api waits for postgres').toBe('service_healthy');
  });

  test('E2E-OPS-01 [static] .env.example documents every variable of the compose file and holds no secret value', t.p1, async () => {
    const documented = envExampleKeys();
    const { all } = composeVariables();
    const missing = [...all].filter((name) => !documented.has(name));
    expect(missing, 'variables read by docker-compose.yml but not documented in .env.example').toEqual([]);
    for (const name of ['LIVEKIT_API_SECRET', 'POSTGRES_PASSWORD', 'BACKUP_RCLONE_CONFIG', 'CF_API_TOKEN', 'INFOMANIAK_API_TOKEN', 'HETZNER_API_TOKEN', 'DESEC_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'GANDI_BEARER_TOKEN', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY']) {
      expect(documented.get(name), `${name} has no value in .env.example`).toBe('');
    }
    expect(read('.env.example'), 'no placeholder secret').not.toMatch(/changeme|devkey|password123/i);
  });

  const { required } = composeVariables();
  for (const [name, message] of required) {
    test(`E2E-OPS-01 [static] ${name} missing: docker compose config fails fast with the German hint`, t.p1, async () => {
      const env = parseEnvFile(ENV_FILE);
      delete env[name];
      const dir = fs.mkdtempSync(path.join(path.dirname(ENV_FILE), '.ops-env-'));
      try {
        const file = path.join(dir, 'env');
        fs.writeFileSync(file, Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n');
        const result = await exec('docker', ['compose', '-p', `${PROJECT}-cfg`, '-f', COMPOSE_FILES.base, '--env-file', file, 'config', '--quiet'], { cwd: REPO_ROOT, env: cleanComposeEnv([name]) });
        expect(result.code, `${name} removed`).not.toBe(0);
        expect(result.output, `message for ${name}`).toContain('set it in .env');
        expect(result.output).not.toContain(env['POSTGRES_PASSWORD'] ?? '(none)');
        void message;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test.describe('OPS backup service (static)', () => {
  test('E2E-OPS-20 [static] the backup service is opt-in (profile backup), hardened, publishes nothing and reads the volumes read-only', t.p1, async () => {
    expect((await configOf())['backup'], 'not part of the default stack').toBeUndefined();
    const services = await configOf(['backup']);
    const backup = services['backup']!;
    expect(backup.restart).toBe('unless-stopped');
    expect(backup.security_opt ?? []).toContain('no-new-privileges:true');
    expect(backup.cap_drop ?? []).toContain('ALL');
    expect(backup.cap_add, 'the only capability: read access to the Caddy volume').toEqual(['DAC_READ_SEARCH']);
    expect(backup.read_only, 'read-only root file system').toBe(true);
    expect(backup.healthcheck?.test, 'healthcheck').toBeTruthy();
    expect(backup.depends_on?.['postgres']?.condition).toBe('service_healthy');
    expect(backup.ports ?? [], 'publishes nothing').toEqual([]);
    const mount = (service: ConfigService, source: string) => service.volumes?.find((volume) => volume.source === source);
    for (const volume of ['media', 'keys', 'caddy_data']) expect(mount(backup, volume)?.read_only, `${volume} is mounted read-only`).toBe(true);
    for (const volume of ['backups', 'backup_status']) expect(mount(backup, volume)?.read_only ?? false, `${volume} is writable`).toBe(false);
    expect(mount(backup, 'backups'), 'backups volume').toBeTruthy();
    // The tools match the server: the image is built from the PostgreSQL image of the stack.
    const build = backup.build as { args?: Record<string, string> };
    expect(build.args?.['POSTGRES_IMAGE']).toBe(services['postgres']!.image);
    // The API sees the status file only, read-only; never the backups themselves.
    const api = services['api']!;
    expect(mount(api, 'backup_status')?.read_only, 'API: status volume read-only').toBe(true);
    expect(mount(api, 'backups'), 'API: no access to the backups').toBeUndefined();
    expect(api.environment?.['BACKUP__STATUSFILE']).toBe('/data/backup-status/backup-status.json');
  });

  const SHELL_FILES = ['backup.sh', 'restore.sh', 'update.sh', 'setup.sh', 'infra/scripts/common.sh', 'infra/scripts/backup-core.sh', 'infra/backup/entrypoint.sh', 'infra/backup/backup-job.sh', 'infra/backup/status.sh', 'infra/backup/healthcheck.sh'];
  const ASCII_FILES = [...SHELL_FILES, 'backup.ps1', 'restore.ps1', 'update.ps1', 'setup.ps1', 'infra/scripts/StudioFlow.psm1', 'infra/backup/Dockerfile', '.env.example', 'docker-compose.yml', '.github/renovate.json5'];

  test('E2E-OPS-20 [static] scripts and configuration are ASCII only, the shell scripts have valid syntax and are executable by the image', t.p1, async () => {
    for (const file of ASCII_FILES) {
      const bad = [...read(file)].filter((character) => character.charCodeAt(0) > 126);
      expect(bad, `${file}: non-ASCII characters (docs/architecture/i18n-design.md D9)`).toEqual([]);
    }
    for (const file of SHELL_FILES) {
      const result = await exec(bashPathOf(), ['-n', file], { cwd: REPO_ROOT });
      expect(result.code, `${file}: ${result.output}`).toBe(0);
      expect(read(file), `${file}: LF line endings`).not.toContain('\r');
    }
  });

  test('E2E-OPS-20 [static] the PowerShell scripts parse', t.p2, async () => {
    const shell = await powerShell();
    test.skip(!shell, 'no PowerShell on this machine');
    const files = ['backup.ps1', 'restore.ps1', 'update.ps1', 'setup.ps1', 'infra/scripts/StudioFlow.psm1'];
    const script = `$bad = 0; foreach ($f in @('${files.join("','")}')) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $f), [ref]$t, [ref]$e); foreach ($x in $e) { Write-Output ($f + ': ' + $x.Message + ' (line ' + $x.Extent.StartLineNumber + ')'); $bad++ } }; exit $bad`;
    const result = await exec(shell!, ['-NoProfile', '-NonInteractive', '-Command', script], { cwd: REPO_ROOT });
    expect(result.code, result.output).toBe(0);
  });
});

/** Runs a bash script that sources the shared backup code (no Docker involved). */
async function bashScript(script: string) {
  return exec(bashPathOf(), ['-s'], { cwd: REPO_ROOT, input: `set -euo pipefail\n. infra/scripts/common.sh\n. infra/scripts/backup-core.sh\n${script}\n`, timeoutMs: 60_000 });
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
first="$(sf_backup_unique_dir "$dir" 2026-10-23_0300)"; mkdir "$first"
echo "unique: $(basename "$(sf_backup_unique_dir "$dir" 2026-10-23_0300)")"`;
      const result = await bashScript(script);
      expect(result.code, result.output).toBe(0);
      expect(result.stdout).toContain('intact: ok');
      expect(result.stdout).toContain('tampered: Checksum mismatch: keys.tar.gz (the backup is damaged)');
      expect(result.stdout).toContain('missing: File listed in SHA256SUMS is missing: backup-info.txt');
      expect(result.stdout).toContain('escape: Invalid entry in SHA256SUMS: ../escape');
      expect(result.stdout).toContain('unique: 2026-10-23_0300-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('OPS setup.sh', () => {
  const sandboxes: OpsSandbox[] = [];
  const sandbox = () => {
    const created = OpsSandbox.create('setup', { mode: 'none' });
    sandboxes.push(created);
    return created;
  };

  test.afterAll(async () => {
    for (const created of sandboxes) await created.cleanup();
  });

  const secretsOf = (file: string) => {
    const env = parseEnvFile(file);
    return { livekit: env['LIVEKIT_API_SECRET']!, postgres: env['POSTGRES_PASSWORD']! };
  };

  test('E2E-OPS-02 [setup.sh] writes a valid .env twice with different secrets and without any account setting; the Regie account is left to the first-run setup', t.p0, async () => {
    const box = sandbox();
    const runs: Array<{ file: string; output: string }> = [];
    for (const name of ['a', 'b']) {
      fs.mkdirSync(box.path(name));
      const file = box.path(name, '.env');
      const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--env-file', file]);
      expect(result.code, result.output.slice(-1500)).toBe(0);
      runs.push({ file, output: result.output });
    }
    const [first, second] = runs as [(typeof runs)[number], (typeof runs)[number]];
    for (const run of runs) {
      const text = fs.readFileSync(run.file, 'utf8');
      const env = parseEnvFile(run.file);
      expect(env['STUDIOFLOW_DOMAIN']).toBe('localhost');
      expect(env['STUDIOFLOW_NODE_IP']).toBe('127.0.0.1');
      expect(env['STUDIOFLOW_TLS_MODE']).toBe('internal');
      expect(env['LIVEKIT_API_KEY'], 'the key is the non-secret id').toBe('studioflow');
      expect(env['LIVEKIT_API_SECRET'], 'LiveKit secret: starts with a letter, at least 32 characters').toMatch(/^[A-Za-z][A-Za-z0-9]{31,}$/);
      expect(env['POSTGRES_PASSWORD'], 'database password').toMatch(/^[A-Za-z0-9]{32}$/);
      expect(Object.keys(env).filter((key) => key.startsWith('ADMIN__')), 'no account setting').toEqual([]);
      expect(env['STUDIOFLOW_HSTS_MAX_AGE'], 'internal mode: short HSTS').toBe('3600');
      expect(text, 'no known default or placeholder').not.toMatch(/changeme|password123|devkey|=example|=secret\b/i);
      expect(run.output, 'no password is asked for or shown').not.toMatch(/password:/i);
      expect(run.output, 'the next steps name the setup code').toContain('Setup code');
    }
    expect(secretsOf(first.file).livekit).not.toBe(secretsOf(second.file).livekit);
    expect(secretsOf(first.file).postgres).not.toBe(secretsOf(second.file).postgres);
    // Generated by the script, the file is not tracked: .env is git-ignored.
    const ignored = await exec('git', ['check-ignore', '-q', '.env'], { cwd: REPO_ROOT });
    expect(ignored.code, '.env is git-ignored').toBe(0);
  });

  test('E2E-OPS-02 [setup.sh] the account settings of older versions are not carried over, with a notice', t.p0, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('legacy'));
    const file = box.path('legacy', '.env');
    fs.writeFileSync(file, ['STUDIOFLOW_DOMAIN=localhost', 'ADMIN__USERNAME=regie', 'ADMIN__PASSWORD=Altes-Passwort-2026', 'ADMIN__PASSWORDHASH=AQAAAAEAACcQAAAAEExample', ''].join('\n'));
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--force', '--env-file', file]);
    expect(result.code, result.output.slice(-1500)).toBe(0);
    const text = fs.readFileSync(file, 'utf8');
    expect(text, 'the old account settings are gone').not.toMatch(/ADMIN__/);
    expect(text, 'the old password is gone').not.toContain('Altes-Passwort-2026');
    expect(result.stdout, 'the notice says they are no longer used').toMatch(/no longer used/);
    expect(result.output, 'the old password is never printed').not.toContain('Altes-Passwort-2026');
  });

  test('E2E-OPS-02 [setup.sh] the options of older versions that asked for a password are unknown now', t.p1, async () => {
    const box = sandbox();
    for (const option of ['--admin-password-stdin', '--generate-password', '--plain-password']) {
      fs.mkdirSync(box.path(option.slice(2)));
      const file = box.path(option.slice(2), '.env');
      const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', option, '--env-file', file]);
      expect(result.code, option).toBe(1);
      expect(result.stderr, option).toMatch(/Error: Unknown option/);
      expect(fs.existsSync(file), 'no .env written').toBe(false);
    }
  });

  test('E2E-OPS-02 [setup.sh] without --node-ip the LAN IPv4 of the default route is detected', t.p1, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('auto'));
    const file = box.path('auto', '.env');
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--tls-mode', 'internal', '--env-file', file]);
    expect(result.code, result.output.slice(-1500)).toBe(0);
    const ip = parseEnvFile(file)['STUDIOFLOW_NODE_IP']!;
    expect(ip, 'a private IPv4').toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
    expect(ip, 'the address of the default route').toBe(await detectLanIPv4());
  });

  const invalid: Array<{ name: string; args: string[]; message: RegExp }> = [
    { name: 'an empty domain for a certificate authority mode', args: ['--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'acme'], message: /Error: Invalid or missing domain/ },
    { name: 'an invalid IP', args: ['--domain', 'localhost', '--node-ip', '300.1.1.1', '--tls-mode', 'internal'], message: /Error: Invalid or missing LAN IPv4/ },
    { name: 'an unknown TLS mode', args: ['--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'foo'], message: /Error: Unknown TLS mode/ },
    { name: 'an unknown option', args: ['--domain', 'localhost', '--bogus'], message: /Error: Unknown option/ },
    { name: 'an IP address as domain with a public CA mode', args: ['--domain', '192.0.2.10', '--node-ip', '127.0.0.1', '--tls-mode', 'acme'], message: /Error: No certificate can be issued for an IP address/ },
  ];
  for (const entry of invalid) {
    test(`E2E-OPS-02 [setup.sh] ${entry.name}: exit 1 with an error message and no file`, t.p1, async () => {
      const box = sandbox();
      fs.mkdirSync(box.path('bad'));
      const file = box.path('bad', '.env');
      const result = await box.run('setup.sh', ['--non-interactive', ...entry.args, '--env-file', file]);
      expect(result.code, result.output).toBe(1);
      expect(result.stderr).toMatch(entry.message);
      expect(fs.existsSync(file), 'no .env written').toBe(false);
      expect(fs.readdirSync(box.path('bad')), 'nothing left behind (no temp file)').toEqual([]);
    });
  }

  test('E2E-OPS-02 [setup.sh] an empty domain in internal mode uses the node IP as the domain; with a public TLS mode it is an error (DOC-05)', t.p2, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('emptydomain'));
    const file = box.path('emptydomain', '.env');
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--env-file', file]);
    expect(result.code, result.output.slice(-600)).toBe(0);
    expect(parseEnvFile(file)['STUDIOFLOW_DOMAIN'], 'the node IP is the domain').toBe('127.0.0.1');

    fs.mkdirSync(box.path('emptydomain-acme'));
    const acme = box.path('emptydomain-acme', '.env');
    const refused = await box.run('setup.sh', ['--non-interactive', '--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'acme', '--env-file', acme]);
    expect(refused.code, 'a public TLS mode needs a real domain').not.toBe(0);
    expect(fs.existsSync(acme), 'no .env written').toBe(false);
  });

  test('E2E-OPS-02 [setup.sh] an existing .env is replaced only with --force; the copy and the secrets are kept', t.p0, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('force'));
    const file = box.path('force', '.env');
    const common = ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--env-file', file];
    expect((await box.run('setup.sh', common)).code).toBe(0);
    const original = fs.readFileSync(file, 'utf8');
    const refused = await box.run('setup.sh', common);
    expect(refused.code, 'second run without --force').toBe(1);
    expect(refused.stderr).toMatch(/Error: .*already exists/);
    expect(fs.readFileSync(file, 'utf8'), 'the file is unchanged').toBe(original);
    const forced = await box.run('setup.sh', [...common, '--force', '--frame-ancestors', 'https://embed.example.ch']);
    expect(forced.code, forced.output.slice(-1000)).toBe(0);
    const before = parseEnvFile(file);
    const backups = fs.readdirSync(box.path('force')).filter((name) => name.startsWith('.env.backup-'));
    expect(backups, 'a timestamped copy of the old file').toHaveLength(1);
    expect(fs.readFileSync(box.path('force', backups[0]!), 'utf8')).toBe(original);
    const old = parseEnvFile(box.path('force', backups[0]!));
    expect(before['LIVEKIT_API_SECRET'], 'LiveKit secret kept').toBe(old['LIVEKIT_API_SECRET']);
    expect(before['POSTGRES_PASSWORD'], 'database password kept (PostgreSQL is initialised with it)').toBe(old['POSTGRES_PASSWORD']);
    expect(before['STUDIOFLOW_FRAME_ANCESTORS']).toBe('https://embed.example.ch');
  });

  test('E2E-OPS-02 [setup.sh] TLS mode names equal those of .env.example and the compose file', t.p2, async () => {
    const example = read('.env.example');
    for (const mode of TLS_MODES) expect(example, `mode ${mode} documented`).toContain(mode);
    const script = read('setup.sh');
    const listed = /readonly TLS_MODES="([^"]+)"/.exec(script)![1]!.split(/\s+/);
    for (const mode of listed) expect(example, `setup.sh mode ${mode} documented in .env.example`).toContain(mode);
  });
});

test.describe('OPS network and hardening', () => {
  test('E2E-OPS-12 [static] only Caddy (80, 443 tcp+udp) and the LiveKit media ports (7881 tcp, 7882 udp) are published; helper services publish nothing', t.p0, async () => {
    // The base file alone (no e2e override): Caddy on 80/443, LiveKit's media ports from the env file (7881/7882 by default).
    const services = await configOf(['chaos', 'tools']);
    const config = stackConfig();
    const published = (name: string) => (services[name]?.ports ?? []).map((port) => `${port.published}/${port.protocol ?? 'tcp'}`).sort();
    expect(published('caddy')).toEqual(['443/tcp', '443/udp', '80/tcp']);
    expect(published('livekit')).toEqual([`${config.rtcTcpPort}/tcp`, `${config.rtcUdpPort}/udp`].sort());
    expect(published('api'), 'api 8080 not published').toEqual([]);
    expect(published('postgres'), 'postgres 5432 not published').toEqual([]);
    for (const [name, service] of Object.entries(services)) {
      if (SERVICES.includes(name as (typeof SERVICES)[number])) continue;
      expect(service.ports ?? [], `profile service ${name} publishes nothing`).toEqual([]);
    }
  });

  test('E2E-OPS-12 [stack] from the LAN address the internal ports (API 8080, LiveKit 7880, PostgreSQL 5432, Caddy 2020/2019) are closed and 443 and 7881 are open', t.p0, async () => {
    const host = stackConfig().nodeIp;
    const probe = (port: number) =>
      new Promise<boolean>((resolve) => {
        const socket = net.connect({ host, port, timeout: 1500 });
        socket.on('connect', () => (socket.destroy(), resolve(true)));
        socket.on('timeout', () => (socket.destroy(), resolve(false)));
        socket.on('error', () => resolve(false));
      });
    for (const port of [8080, 7880, 5432, 2020, 2019]) expect(await probe(port), `port ${port} on ${host}`).toBe(false);
    const config = stackConfig();
    expect(await probe(config.httpsPort), String(config.httpsPort)).toBe(true);
    expect(await probe(config.rtcTcpPort), String(config.rtcTcpPort)).toBe(true);
  });

  test('E2E-OPS-13 [stack] every container runs with no-new-privileges and cap_drop ALL; the API runs as a non-root user', t.p1, async () => {
    for (const service of SERVICES) {
      const info = JSON.parse((await docker(['inspect', containerName(service)], { check: true })).stdout)[0] as { HostConfig: { SecurityOpt: string[]; CapDrop: string[]; Privileged: boolean } };
      expect(info.HostConfig.SecurityOpt ?? [], `${service} no-new-privileges`).toContain('no-new-privileges:true');
      if (service !== 'postgres') expect(info.HostConfig.CapDrop ?? [], `${service} cap_drop`).toContain('ALL');
      expect(info.HostConfig.Privileged, `${service} not privileged`).toBe(false);
    }
    const uid = (await docker(['exec', containerName('api'), 'id', '-u'], { check: true })).stdout.trim();
    expect(Number(uid), `API uid ${uid}`).toBeGreaterThan(0);
    for (const service of ['caddy', 'postgres'] as const) {
      const user = (await docker(['exec', containerName(service), 'id', '-u'])).stdout.trim();
      test.info().annotations.push({ type: 'measurement', description: `${service} runs as uid ${user}` });
    }
  });

  test('E2E-OPS-13 [stack] PostgreSQL drops all capabilities like the other services', t.p1, async () => {
    knownBug('BUG-22', 'the postgres service has no cap_drop: ALL (caddy, api and livekit have it); docs/testing.md E2E-OPS-01 and -13 require it for every service');
    const services = await configOf();
    expect(services['postgres']!.cap_drop ?? [], 'postgres cap_drop in docker-compose.yml').toContain('ALL');
    const info = JSON.parse((await docker(['inspect', containerName('postgres')], { check: true })).stdout)[0] as { HostConfig: { CapDrop: string[] } };
    expect(info.HostConfig.CapDrop ?? [], 'postgres CapDrop of the running container').toContain('ALL');
  });

  test('E2E-OPS-13 [stack] secrets live only in the environment of the services that need them and in no image layer', t.p1, async () => {
    const config = stackConfig();
    const secrets = { admin: config.admin.password, livekit: config.livekit.apiSecret, postgres: config.postgresPassword };
    const environment = async (service: string) => (await docker(['inspect', '-f', '{{json .Config.Env}}', containerName(service)], { check: true })).stdout;
    const has = (env: string, secret: string) => env.includes(secret);
    const caddy = await environment('caddy');
    expect(has(caddy, secrets.admin), 'caddy: admin password').toBe(false);
    expect(has(caddy, secrets.livekit), 'caddy: LiveKit secret').toBe(false);
    expect(has(caddy, secrets.postgres), 'caddy: database password').toBe(false);
    const livekit = await environment('livekit');
    expect(has(livekit, secrets.admin), 'livekit: admin password').toBe(false);
    expect(has(livekit, secrets.postgres), 'livekit: database password').toBe(false);
    const postgres = await environment('postgres');
    expect(has(postgres, secrets.admin), 'postgres: admin password').toBe(false);
    expect(has(postgres, secrets.livekit), 'postgres: LiveKit secret').toBe(false);
    // Images: no secret in the config or the history of the images the stack is built from.
    for (const image of [imageNameOf('api'), imageNameOf('caddy')]) {
      const inspect = (await docker(['image', 'inspect', image], { check: true })).stdout;
      const history = (await docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', image], { check: true })).stdout;
      for (const [name, secret] of Object.entries(secrets)) {
        expect(inspect.includes(secret), `${image} config contains the ${name} secret`).toBe(false);
        expect(history.includes(secret), `${image} history contains the ${name} secret`).toBe(false);
      }
    }
    const ignore = read('.dockerignore').split(/\r?\n/).map((line) => line.trim());
    for (const entry of ['.env', '.git', '**/node_modules']) expect(ignore, `.dockerignore excludes ${entry}`).toContain(entry);
    const apiIgnore = fs.existsSync(path.join(REPO_ROOT, 'apps/api/.dockerignore')) ? read('apps/api/.dockerignore') : '';
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
