import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMPOSE_FILES, ENV_FILE, PROJECT, REPO_ROOT, SETTINGS } from './env';
import { exec, type ExecOptions, type ExecResult } from './shell';

/**
 * Isolated copies of the operations scripts (docs/testing.md 2.11: «an isolated copy of the repository»).
 *
 * The scripts are copied unchanged into a temporary directory and run there with bash, so `backups/`, `.env.backup-*`
 * and the git state of an update never touch the working tree. They find the stack through the environment variables
 * that docker compose itself reads (COMPOSE_PROJECT_NAME, COMPOSE_FILE, COMPOSE_ENV_FILES), so the scripts need no
 * test hooks and the repository is not modified.
 */

const SCRIPTS = ['setup.sh', 'backup.sh', 'restore.sh', 'update.sh', 'infra/scripts/common.sh'] as const;
export type OpsScript = 'setup.sh' | 'backup.sh' | 'restore.sh' | 'update.sh';

const fwd = (value: string): string => value.replace(/\\/g, '/');

/** Git Bash on Windows (the WSL launcher on the PATH is not what the scripts target), plain bash elsewhere. */
export function bashPath(): string {
  const configured = process.env['E2E_BASH'];
  if (configured) return configured;
  if (process.platform !== 'win32') return 'bash';
  for (const candidate of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'bin', 'bash.exe')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Git Bash was not found; set E2E_BASH to the bash executable that runs the scripts.');
}

/** Path of the docker CLI as bash will find it (used by the fault-injection shim to call the real one). */
export async function realDocker(): Promise<string> {
  const result = await exec(process.platform === 'win32' ? 'where' : 'which', ['docker']);
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim() && /docker(\.exe)?$/i.test(line.trim()));
  if (!first) throw new Error('docker was not found on the PATH');
  return fwd(first.trim());
}

export interface SandboxOptions {
  /**
   * Which docker compose project the scripts see:
   * - `stack` (default): the running stack of this process (project `sf-e2e`, `sf-e2e-N` with E2E_STACK=N), with the
   *   same files and env file the harness uses;
   * - `hash`: a separate project `<project>-ops` on the base compose file only (setup.sh builds the API image and runs
   *   `hash-password` in it; it has its own subnet, so it collides neither with the running stack nor with the OPS
   *   scratch stack of another numbered stack);
   * - `none`: no compose environment.
   */
  mode?: 'stack' | 'hash' | 'none';
}

export const OPS_HASH_PROJECT = `${PROJECT}-ops`;
export const OPS_HASH_SUBNET = SETTINGS.opsSubnet;

export class OpsSandbox {
  readonly bash = bashPath();
  private shimDir: string | undefined;

  private constructor(
    readonly root: string,
    readonly options: SandboxOptions,
  ) {}

  static create(name: string, options: SandboxOptions = {}): OpsSandbox {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sf-ops-${name}-`));
    const sandbox = new OpsSandbox(root, { mode: 'stack', ...options });
    for (const script of SCRIPTS) {
      const target = path.join(root, script);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // LF only: .gitattributes pins it, but a checkout with autocrlf must not break the copy.
      fs.writeFileSync(target, fs.readFileSync(path.join(REPO_ROOT, script), 'utf8').replace(/\r\n/g, '\n'), { mode: 0o755 });
    }
    if (sandbox.options.mode === 'stack') fs.copyFileSync(ENV_FILE, path.join(root, '.env'));
    return sandbox;
  }

  path(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  /** The environment of the scripts: docker compose reads the project from it. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    if (this.options.mode === 'stack') {
      env['COMPOSE_PROJECT_NAME'] = PROJECT;
      env['COMPOSE_PATH_SEPARATOR'] = '|';
      env['COMPOSE_FILE'] = [COMPOSE_FILES.base, COMPOSE_FILES.e2e].map(fwd).join('|');
      env['COMPOSE_ENV_FILES'] = fwd(ENV_FILE);
    } else if (this.options.mode === 'hash') {
      env['COMPOSE_PROJECT_NAME'] = OPS_HASH_PROJECT;
      env['COMPOSE_FILE'] = fwd(COMPOSE_FILES.base);
      env['STUDIOFLOW_SUBNET'] = OPS_HASH_SUBNET;
    }
    if (this.shimDir) env['PATH'] = `${this.shimDir}${path.delimiter}${env['PATH'] ?? env['Path'] ?? ''}`;
    // The scripts ask a terminal when a decision is open; the tests never have one.
    delete env['TERM'];
    return env;
  }

  /** Runs a script of the sandbox (`bash <script> ...args`) and collects the output. */
  run(script: OpsScript, args: string[] = [], options: ExecOptions & { env?: Record<string, string | undefined> } = {}): Promise<ExecResult> {
    const { env, ...rest } = options;
    return exec(this.bash, [script, ...args], { cwd: this.root, env: this.env(env), timeoutMs: 900_000, ...rest });
  }

  /** `docker` in front of the real one on the PATH of the scripts: `handler` is a bash `case` body deciding what to fail. */
  async injectDockerFault(condition: string, message = 'E2E: injected failure'): Promise<void> {
    const real = await realDocker();
    const dir = this.path('shim');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docker'),
      ['#!/usr/bin/env bash', `if ${condition}; then echo '${message}' >&2; exit 1; fi`, `exec "${real}" "$@"`, ''].join('\n'),
      { mode: 0o755 },
    );
    this.shimDir = dir;
  }

  clearFault(): void {
    this.shimDir = undefined;
  }

  /** Turns the sandbox into a git work tree that tracks a local bare remote (for update.sh). */
  async initGit(): Promise<{ remote: string; pushExtraCommit(message: string): Promise<void> }> {
    const remote = this.path('..', `${path.basename(this.root)}-remote.git`);
    const git = (args: string[], cwd = this.root) =>
      exec('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, check: true });
    fs.mkdirSync(remote, { recursive: true });
    await git(['init', '--bare', '--initial-branch=main', remote], remote);
    fs.writeFileSync(this.path('.gitignore'), '.env\nbackups/\nshim/\n');
    await git(['init', '--initial-branch=main']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'initial']);
    await git(['remote', 'add', 'origin', fwd(remote)]);
    await git(['push', '-u', 'origin', 'main']);
    const clone = path.join(path.dirname(remote), `${path.basename(this.root)}-clone`);
    return {
      remote,
      pushExtraCommit: async (message) => {
        if (!fs.existsSync(clone)) await git(['clone', fwd(remote), fwd(clone)], path.dirname(remote));
        fs.appendFileSync(path.join(clone, 'CHANGELOG.txt'), `${message}\n`);
        await git(['add', '-A'], clone);
        await git(['commit', '-m', message], clone);
        await git(['push', 'origin', 'main'], clone);
      },
    };
  }

  async cleanup(): Promise<void> {
    const targets = [this.root, `${this.root}-remote.git`, `${this.root}-clone`];
    for (const target of targets) fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Runs a single bash script string in the sandbox (for helpers that need `tar`, `sha256sum` or `pg_restore`). */
export async function bashLine(sandbox: OpsSandbox, script: string, options: ExecOptions = {}): Promise<ExecResult> {
  return exec(sandbox.bash, ['-c', script], { cwd: sandbox.root, env: sandbox.env(), ...options });
}

/** The process environment without anything docker compose would pick up (so only the given env file counts). */
export function cleanComposeEnv(drop: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('COMPOSE_') || key.startsWith('STUDIOFLOW_') || key.startsWith('ADMIN__') || key.startsWith('E2E_') || drop.includes(key)) delete env[key];
  }
  for (const key of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'POSTGRES_PASSWORD', ...drop]) delete env[key];
  return env;
}

/** `docker compose config` on the production compose file (without the e2e override) with an explicit env file. */
export function composeConfig(options: { envFile?: string; profiles?: string[]; format?: 'json' | 'yaml' } = {}): Promise<ExecResult> {
  const args = ['compose', '-p', `${PROJECT}-cfg`, '-f', COMPOSE_FILES.base, '--env-file', options.envFile ?? ENV_FILE];
  for (const profile of options.profiles ?? []) args.push('--profile', profile);
  args.push('config');
  if (options.format !== 'yaml') args.push('--format', 'json');
  return exec('docker', args, { cwd: REPO_ROOT, env: cleanComposeEnv() });
}

/** Serial number of the certificate Caddy presents for SNI `localhost` (stays the same while caddy_data persists). */
export async function certSerial(host = '127.0.0.1', port = SETTINGS.httpsPort, servername = 'localhost'): Promise<string> {
  const tls = await import('node:tls');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false }, () => {
      const serial = socket.getPeerCertificate().serialNumber;
      socket.end();
      resolve(serial);
    });
    socket.setTimeout(8000, () => {
      socket.destroy();
      reject(new Error('TLS handshake timed out'));
    });
    socket.on('error', reject);
  });
}
