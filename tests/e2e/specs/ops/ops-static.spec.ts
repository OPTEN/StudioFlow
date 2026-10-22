import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { COMPOSE_FILES, ENV_FILE, PROJECT, REPO_ROOT, TEST_ADMIN, imageNameOf, parseEnvFile, stackConfig } from '../../support/env';
import { expect, knownBug, test } from '../../support/fixtures';
import { detectLanIPv4 } from '../../support/network-info';
import { OPS_HASH_PROJECT, OpsSandbox, cleanComposeEnv, composeConfig } from '../../support/ops';
import { containerName, docker } from '../../support/stack';
import { exec } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * OPS - the parts of docs/testing.md 2.11 that read the compose file and the scripts and do not change the running
 * stack: E2E-OPS-01 (compose file and .env.example), -02 (setup.sh), -12 (network exposure), -13 (hardening),
 * -15 (admin hash path and startup validation). Scripts run unmodified in an isolated copy (support/ops.ts).
 */

const read = (relative: string): string => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
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
    expect(services['livekit']!.image, 'LiveKit image').toMatch(/^livekit\/livekit-server:v\d+\.\d+\.\d+$/);
    expect(services['postgres']!.image, 'PostgreSQL image').toMatch(/^postgres:17\.\d+-alpine$/);
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
    for (const name of ['ADMIN__PASSWORD', 'ADMIN__PASSWORDHASH', 'LIVEKIT_API_SECRET', 'POSTGRES_PASSWORD', 'CF_API_TOKEN', 'INFOMANIAK_API_TOKEN', 'HETZNER_API_TOKEN', 'DESEC_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'GANDI_BEARER_TOKEN', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY']) {
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
        expect(result.output, `message for ${name}`).toContain('fehlt in .env');
        expect(result.output).not.toContain(env['POSTGRES_PASSWORD'] ?? '(none)');
        void message;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test.describe('OPS setup.sh', () => {
  const sandboxes: OpsSandbox[] = [];
  const sandbox = (mode: 'none' | 'hash' = 'none') => {
    const created = OpsSandbox.create('setup', { mode });
    sandboxes.push(created);
    return created;
  };

  test.afterAll(async () => {
    for (const created of sandboxes) await created.cleanup();
    // `docker compose down` would need the whole .env; the project only left a network and the built image behind.
    const leftovers = (await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${OPS_HASH_PROJECT}`])).stdout.split(/\s+/).filter(Boolean);
    if (leftovers.length) await docker(['rm', '-f', ...leftovers]);
    await docker(['network', 'rm', `${OPS_HASH_PROJECT}_flowstudio`]).catch(() => undefined);
    const volumes = (await docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${OPS_HASH_PROJECT}`])).stdout.split(/\s+/).filter(Boolean);
    if (volumes.length) await docker(['volume', 'rm', ...volumes]).catch(() => undefined);
    await docker(['image', 'rm', `${OPS_HASH_PROJECT}-api`]).catch(() => undefined);
  });

  const secretsOf = (file: string) => {
    const env = parseEnvFile(file);
    return { livekit: env['LIVEKIT_API_SECRET']!, postgres: env['POSTGRES_PASSWORD']!, hash: env['ADMIN__PASSWORDHASH'] ?? '' };
  };
  const generated = (output: string) => /Passwort:\s+(\S+)/.exec(output)?.[1];

  test('E2E-OPS-02 [setup.sh] --generate-password writes a valid .env twice with different secrets; the password is shown once and stored as a hash', t.p0, async () => {
    test.setTimeout(900_000);
    const box = sandbox('hash');
    const runs: Array<{ file: string; output: string; password: string }> = [];
    for (const name of ['a', 'b']) {
      fs.mkdirSync(box.path(name));
      const file = box.path(name, '.env');
      const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--generate-password', '--env-file', file]);
      expect(result.code, result.output.slice(-1500)).toBe(0);
      const password = generated(result.stdout);
      expect(password, 'the generated password is displayed once').toMatch(/^[A-Za-z0-9]{24}$/);
      runs.push({ file, output: result.output, password: password! });
    }
    const [first, second] = runs as [(typeof runs)[number], (typeof runs)[number]];
    for (const run of runs) {
      const text = fs.readFileSync(run.file, 'utf8');
      const env = parseEnvFile(run.file);
      expect(env['FLOWSTUDIO_DOMAIN']).toBe('localhost');
      expect(env['FLOWSTUDIO_NODE_IP']).toBe('127.0.0.1');
      expect(env['FLOWSTUDIO_TLS_MODE']).toBe('internal');
      expect(env['ADMIN__USERNAME']).toBe('admin');
      expect(env['LIVEKIT_API_KEY'], 'the key is the non-secret id').toBe('flowstudio');
      expect(env['LIVEKIT_API_SECRET'], 'LiveKit secret: starts with a letter, at least 32 characters').toMatch(/^[A-Za-z][A-Za-z0-9]{31,}$/);
      expect(env['POSTGRES_PASSWORD'], 'database password').toMatch(/^[A-Za-z0-9]{32}$/);
      expect(env['ADMIN__PASSWORDHASH'], 'ASP.NET Identity v3 hash').toMatch(/^AQAAAA[A-Za-z0-9+/]{20,}={0,2}$/);
      expect(env['ADMIN__PASSWORD'] ?? '', 'no plain password next to the hash').toBe('');
      expect(env['FLOWSTUDIO_HSTS_MAX_AGE'], 'internal mode: short HSTS').toBe('3600');
      expect(text, 'no known default or placeholder').not.toMatch(/changeme|password123|devkey|=example|=secret\b/i);
      expect(text, 'the generated password is not in the file').not.toContain(run.password);
    }
    expect(first.password).not.toBe(second.password);
    expect(secretsOf(first.file).livekit).not.toBe(secretsOf(second.file).livekit);
    expect(secretsOf(first.file).postgres).not.toBe(secretsOf(second.file).postgres);
    expect(secretsOf(first.file).hash).not.toBe(secretsOf(second.file).hash);
    // The password appears exactly once in the output of its own run (the single display) and never in the other's.
    expect(first.output.split(first.password).length - 1, 'shown once').toBe(1);
    expect(second.output).not.toContain(first.password);
    // Generated by the script, the file is not tracked: .env is git-ignored.
    const ignored = await exec('git', ['check-ignore', '-q', '.env'], { cwd: REPO_ROOT });
    expect(ignored.code, '.env is git-ignored').toBe(0);
  });

  test('E2E-OPS-02 [setup.sh] --admin-password-stdin and --plain-password: the password is stored as the user chose and never printed', t.p0, async () => {
    const box = sandbox();
    const password = 'Stdin-Passwort-2026-xyz';
    fs.mkdirSync(box.path('plain'));
    const file = box.path('plain', '.env');
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--admin-password-stdin', '--plain-password', '--admin-user', 'regie', '--env-file', file], { input: `${password}\n` });
    expect(result.code, result.output.slice(-1500)).toBe(0);
    const env = parseEnvFile(file);
    expect(env['ADMIN__USERNAME']).toBe('regie');
    expect(env['ADMIN__PASSWORD'], '--plain-password stores the plain value').toBe(password);
    expect(env['ADMIN__PASSWORDHASH'] ?? '').toBe('');
    expect(result.output, 'the password is never printed').not.toContain(password);
    expect(result.stderr, 'the plain storage is flagged as local-only').toMatch(/Klartext/);
  });

  test('E2E-OPS-02 [setup.sh] without --node-ip the LAN IPv4 of the default route is detected', t.p1, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('auto'));
    const file = box.path('auto', '.env');
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', 'localhost', '--tls-mode', 'internal', '--admin-password-stdin', '--plain-password', '--env-file', file], { input: 'Auto-Passwort-2026-xyz\n' });
    expect(result.code, result.output.slice(-1500)).toBe(0);
    const ip = parseEnvFile(file)['FLOWSTUDIO_NODE_IP']!;
    expect(ip, 'a private IPv4').toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
    expect(ip, 'the address of the default route').toBe(await detectLanIPv4());
  });

  const invalid: Array<{ name: string; args: string[]; input?: string; message: RegExp }> = [
    { name: 'an empty domain for a certificate authority mode', args: ['--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'acme'], input: 'Passwort-2026-lang-genug\n', message: /Fehler: Ungültige oder fehlende Domain/ },
    { name: 'an invalid IP', args: ['--domain', 'localhost', '--node-ip', '300.1.1.1', '--tls-mode', 'internal'], input: 'Passwort-2026-lang-genug\n', message: /Fehler: Ungültige oder fehlende LAN-IPv4/ },
    { name: 'an unknown TLS mode', args: ['--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'foo'], input: 'Passwort-2026-lang-genug\n', message: /Fehler: Unbekannter TLS-Modus/ },
    { name: 'a password shorter than 12 characters', args: ['--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--plain-password'], input: 'kurz\n', message: /Fehler: Das Admin-Passwort braucht mindestens 12 Zeichen/ },
    { name: 'an unknown option', args: ['--domain', 'localhost', '--bogus'], message: /Fehler: Unbekannte Option/ },
    { name: 'an IP address as domain with a public CA mode', args: ['--domain', '192.0.2.10', '--node-ip', '127.0.0.1', '--tls-mode', 'acme'], input: 'Passwort-2026-lang-genug\n', message: /Fehler: Für eine IP-Adresse gibt es kein Zertifikat/ },
  ];
  for (const entry of invalid) {
    test(`E2E-OPS-02 [setup.sh] ${entry.name}: exit 1 with a German «Fehler:» and no file`, t.p1, async () => {
      const box = sandbox();
      fs.mkdirSync(box.path('bad'));
      const file = box.path('bad', '.env');
      const result = await box.run('setup.sh', ['--non-interactive', ...entry.args, '--admin-password-stdin', '--env-file', file], { input: entry.input ?? '' });
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
    const result = await box.run('setup.sh', ['--non-interactive', '--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--admin-password-stdin', '--plain-password', '--env-file', file], { input: 'Passwort-2026-lang-genug\n' });
    expect(result.code, result.output.slice(-600)).toBe(0);
    expect(parseEnvFile(file)['FLOWSTUDIO_DOMAIN'], 'the node IP is the domain').toBe('127.0.0.1');

    fs.mkdirSync(box.path('emptydomain-acme'));
    const acme = box.path('emptydomain-acme', '.env');
    const refused = await box.run('setup.sh', ['--non-interactive', '--domain', '', '--node-ip', '127.0.0.1', '--tls-mode', 'acme', '--admin-password-stdin', '--plain-password', '--env-file', acme], { input: 'Passwort-2026-lang-genug\n' });
    expect(refused.code, 'a public TLS mode needs a real domain').not.toBe(0);
    expect(fs.existsSync(acme), 'no .env written').toBe(false);
  });

  test('E2E-OPS-02 [setup.sh] an existing .env is replaced only with --force; the copy and the secrets are kept', t.p0, async () => {
    const box = sandbox();
    fs.mkdirSync(box.path('force'));
    const file = box.path('force', '.env');
    const common = ['--non-interactive', '--domain', 'localhost', '--node-ip', '127.0.0.1', '--tls-mode', 'internal', '--admin-password-stdin', '--plain-password', '--env-file', file];
    expect((await box.run('setup.sh', common, { input: 'Erstes-Passwort-2026\n' })).code).toBe(0);
    const original = fs.readFileSync(file, 'utf8');
    const refused = await box.run('setup.sh', common, { input: 'Zweites-Passwort-2026\n' });
    expect(refused.code, 'second run without --force').toBe(1);
    expect(refused.stderr).toMatch(/Fehler: .*existiert bereits/);
    expect(fs.readFileSync(file, 'utf8'), 'the file is unchanged').toBe(original);
    const forced = await box.run('setup.sh', [...common, '--force', '--frame-ancestors', 'https://embed.example.ch'], { input: 'Zweites-Passwort-2026\n' });
    expect(forced.code, forced.output.slice(-1000)).toBe(0);
    const before = parseEnvFile(file);
    const backups = fs.readdirSync(box.path('force')).filter((name) => name.startsWith('.env.backup-'));
    expect(backups, 'a timestamped copy of the old file').toHaveLength(1);
    expect(fs.readFileSync(box.path('force', backups[0]!), 'utf8')).toBe(original);
    const old = parseEnvFile(box.path('force', backups[0]!));
    expect(before['LIVEKIT_API_SECRET'], 'LiveKit secret kept').toBe(old['LIVEKIT_API_SECRET']);
    expect(before['POSTGRES_PASSWORD'], 'database password kept (PostgreSQL is initialised with it)').toBe(old['POSTGRES_PASSWORD']);
    expect(before['ADMIN__PASSWORD'], 'the new password was taken').toBe('Zweites-Passwort-2026');
    expect(before['FLOWSTUDIO_FRAME_ANCESTORS']).toBe('https://embed.example.ch');
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

test.describe('OPS admin hash path', () => {
  const IMAGE = imageNameOf('api');

  test('E2E-OPS-15 [image] hash-password reads the password from stdin, prints a salted Identity v3 hash and never echoes the password', t.p1, async () => {
    const password = 'Hash-Test-Passwort-2026';
    const run = () => exec('docker', ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'dotnet', IMAGE, 'Opten.FlowStudio.Web.dll', 'hash-password'], { input: password, timeoutMs: 120_000 });
    const [first, second] = [await run(), await run()];
    for (const result of [first, second]) {
      expect(result.code, result.output).toBe(0);
      const hash = result.stdout.trim().split(/\r?\n/).pop()!;
      expect(hash).toMatch(/^AQAAAA[A-Za-z0-9+/]{20,}={0,2}$/);
      expect(result.output, 'the password is not echoed').not.toContain(password);
    }
    expect(first.stdout.trim(), 'salted: two runs differ').not.toBe(second.stdout.trim());
  });

  test('E2E-OPS-15 [image] the API refuses to start without Admin:PasswordHash and Admin:Password, names the keys and leaks no secret', t.p1, async () => {
    const config = stackConfig();
    const result = await exec(
      'docker',
      [
        'run', '--rm', '--network', 'none',
        '-e', `CONNECTIONSTRINGS__FLOWSTUDIO=Host=nowhere;Database=flowstudio;Username=flowstudio;Password=${config.postgresPassword}`,
        '-e', `LIVEKIT__APIKEY=${config.livekit.apiKey}`,
        '-e', `LIVEKIT__APISECRET=${config.livekit.apiSecret}`,
        '-e', `ADMIN__USERNAME=${TEST_ADMIN.username}`,
        IMAGE,
      ],
      { timeoutMs: 120_000 },
    );
    expect(result.code, 'the process exits with an error').not.toBe(0);
    expect(result.output, 'names the missing keys').toMatch(/Admin:PasswordHash|Admin:Password/);
    expect(result.output).not.toContain(config.postgresPassword);
    expect(result.output).not.toContain(config.livekit.apiSecret);
  });
});
