import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_FILE, OUTPUT_DIR, PROJECT, REPO_ROOT, SETTINGS, STATE_FILE, containerNameOf, renderEnvFile, stackConfig } from './support/env';
import { generateSamples, missingMediaSamples } from './support/media-samples';
import { detectLanIPv4 } from './support/network-info';
import { assertFfmpeg, assertStackFree } from './support/preflight';
import { exec } from './support/shell';
import { allHealthy, compose, ensureHealthy, docker, startEventLog } from './support/stack';

export interface StackState {
  reusedStack: boolean;
  keepStack: boolean;
  startedAt: string;
  /** Milliseconds from `compose up` to all containers healthy (0 when the stack was reused). */
  startToHealthyMs: number;
  nodeIp: string;
  screenMode: string;
  /** What was tested: the working tree and the images the containers run (results are only comparable per build). */
  build?: {
    gitHead: string;
    /** Number of modified or untracked paths in the working tree (the stack is built from the working tree). */
    dirtyPaths: number;
    /** SHA-256 over the status lines and the diff of tracked files, so two runs on the same tree compare equal. */
    treeHash: string;
    images: Record<string, string>;
    docker: string;
  };
  /** Snapshot of the stack right after a fresh start (E2E-OPS-04). */
  fresh?: {
    productions: unknown;
    active: unknown;
    activeSnapshot: unknown;
    systemInfo: unknown;
  };
}

function log(message: string): void {
  process.stdout.write(`[e2e setup] ${message}\n`);
}

async function recordBuild(): Promise<StackState['build']> {
  const git = async (args: string[]) => (await exec('git', args, { cwd: REPO_ROOT })).stdout;
  const status = await git(['status', '--porcelain']);
  const diff = await git(['diff', 'HEAD']);
  const images: Record<string, string> = {};
  for (const service of ['api', 'caddy', 'livekit', 'postgres', 'backup']) {
    const result = await docker(['inspect', '-f', '{{.Image}}', containerNameOf(service)]);
    images[service] = result.code === 0 ? result.stdout.trim().replace('sha256:', '').slice(0, 12) : 'unknown';
  }
  const version = await docker(['version', '--format', '{{.Server.Version}}']);
  return {
    gitHead: (await git(['rev-parse', '--short', 'HEAD'])).trim(),
    dirtyPaths: status.split('\n').filter(Boolean).length,
    treeHash: crypto.createHash('sha256').update(status).update(diff).digest('hex').slice(0, 16),
    images,
    docker: version.stdout.trim(),
  };
}

async function recordFreshState(): Promise<StackState['fresh']> {
  const config = stackConfig();
  const login = await fetch(`${config.baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config.admin),
  });
  if (login.status !== 200) throw new Error(`smoke login failed with ${login.status}`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const get = async (route: string) => (await fetch(`${config.baseURL}${route}`, { headers: { Cookie: cookie } })).json();
  const productions = await get('/api/productions/');
  const active = await get('/api/productions/active');
  const activeSnapshot = await get(`/api/productions/${(active as { id: string }).id}/snapshot`);
  const systemInfo = await get('/api/system/info');
  return { productions, active, activeSnapshot, systemInfo };
}

export default async function globalSetup(): Promise<void> {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  startEventLog(path.join(OUTPUT_DIR, 'logs', 'docker-events.jsonl'));
  const keepStack = process.env['E2E_KEEP_STACK'] === '1';
  const reuse = process.env['E2E_REUSE_STACK'] === '1';

  // ffmpeg is needed only for media that are not generated yet (CI restores them from its cache).
  if (missingMediaSamples().length > 0) await assertFfmpeg();
  await generateSamples();

  if (reuse && fs.existsSync(ENV_FILE) && (await allHealthy())) {
    log(`reusing the running stack ${PROJECT}`);
    await ensureHealthy(60_000);
    const previous: StackState | undefined = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : undefined;
    const state: StackState = {
      reusedStack: true,
      keepStack: true,
      startedAt: new Date().toISOString(),
      startToHealthyMs: 0,
      nodeIp: stackConfig().nodeIp,
      screenMode: process.env['E2E_SCREEN_MODE'] ?? 'canvas',
      build: await recordBuild().catch(() => undefined),
      fresh: previous?.fresh ?? (await recordFreshState().catch(() => undefined)),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return;
  }

  const docker_ok = await docker(['info', '--format', '{{.ServerVersion}}']);
  if (docker_ok.code !== 0) throw new Error(`Docker is not running:\n${docker_ok.output}`);

  const nodeIp = await detectLanIPv4();
  fs.writeFileSync(ENV_FILE, renderEnvFile(nodeIp));
  log(`wrote ${path.relative(process.cwd(), ENV_FILE)} (node IP ${nodeIp})`);

  log(`removing an old ${PROJECT} stack, if any`);
  await compose(['down', '--volumes', '--remove-orphans', '--timeout', '30'], { profiles: ['chaos'] });
  log(`stack ${PROJECT}: https ${SETTINGS.httpsPort}, media ${SETTINGS.rtcTcpPort}/tcp ${SETTINGS.rtcUdpPort}/udp, api ${SETTINGS.apiPort}, livekit ${SETTINGS.livekitPort}, postgres ${SETTINGS.postgresPort}, subnet ${SETTINGS.subnet}`);
  await assertStackFree();

  const build = process.env['E2E_NO_BUILD'] === '1' ? [] : ['--build'];
  log(`docker compose -p ${PROJECT} up -d ${build.join(' ')} --wait (first build can take several minutes)`);
  const started = Date.now();
  let up = await compose(['up', '-d', ...build, '--wait', '--wait-timeout', '900'], { echo: false, timeoutMs: 1_500_000 });
  if (up.code !== 0) {
    // The Caddy image builds the frontends from the working tree, which other engineers edit in parallel: retry once.
    log('docker compose up failed, retrying once in 20 s');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'compose-up-attempt1.log'), up.output);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    up = await compose(['up', '-d', ...build, '--wait', '--wait-timeout', '900'], { echo: false, timeoutMs: 1_500_000 });
  }
  if (up.code !== 0) {
    fs.writeFileSync(path.join(OUTPUT_DIR, 'compose-up-attempt2.log'), up.output);
    const errors = up.output.split(/\r?\n/).filter((line) => /error|failed|cannot|denied/i.test(line)).slice(0, 25).join('\n');
    await compose(['ps', '-a']).then((ps) => process.stdout.write(ps.output));
    throw new Error(`docker compose up failed (exit ${up.code}); full output in .output/compose-up-attempt2.log\n${errors}\n--- tail ---\n${up.output.slice(-2500)}`);
  }
  const startToHealthyMs = Date.now() - started;
  log(`stack healthy after ${Math.round(startToHealthyMs / 1000)} s (includes image builds)`);
  // The account and the settings of the first-run wizard (media address, address, embedding) are entered through the API.
  await ensureHealthy(120_000);
  log(`first-run wizard done (media address ${nodeIp}, domain localhost); the stack generated its own secrets`);

  // The chaos sidecar is built here so impairment tests do not pay for it (best effort: it needs NET_ADMIN modules).
  const netem = await compose(['build', 'netem'], { profiles: ['chaos'] });
  if (netem.code !== 0) log(`netem sidecar build failed (impairment tests will fail with a clear message): ${netem.output.slice(-400)}`);

  const state: StackState = {
    reusedStack: false,
    keepStack,
    startedAt: new Date().toISOString(),
    startToHealthyMs,
    nodeIp,
    screenMode: process.env['E2E_SCREEN_MODE'] ?? 'canvas',
    build: await recordBuild().catch(() => undefined),
    fresh: await recordFreshState(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const version = await exec('docker', ['version', '--format', '{{.Server.Version}}']);
  log(`docker ${version.stdout.trim()}; baseURL ${stackConfig().baseURL}`);
}
