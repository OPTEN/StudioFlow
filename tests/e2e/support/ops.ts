import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COMPOSE_FILES, ENV_FILE, PROJECT, REPO_ROOT, SETTINGS } from './env';
import { exec, type ExecOptions, type ExecResult } from './shell';
import { compose, containerName, docker } from './stack';

/**
 * Helpers of the operations specs (docs/testing.md 2.11). Backups, restores and updates are commands of the stack itself
 * now (`docker compose run --rm backup backup-now | list | restore`, `docker compose pull && docker compose up -d`), so the
 * helpers call docker compose on the project of the stack under test, with the files and the env file the harness uses.
 * There are no scripts to copy and no host shell involved: the same commands run on Linux, macOS and Windows.
 */

export interface RunOptions extends ExecOptions {
  /** Environment variables of the one-off container (`-e NAME=value`), not of the process. */
  containerEnv?: Record<string, string>;
  /** Do not start the services the backup service depends on (they must be running already, or the call shows why not). */
  noDeps?: boolean;
}

function runArgs(options: RunOptions): { flags: string[]; rest: ExecOptions } {
  const { containerEnv, noDeps, ...rest } = options;
  const flags = ['run', '--rm', '-T'];
  if (noDeps) flags.push('--no-deps');
  for (const [name, value] of Object.entries(containerEnv ?? {})) flags.push('-e', `${name}=${value}`);
  return { flags, rest };
}

/** The backup service of the stack with a command: `docker compose run --rm -T backup <args>`. */
export function backupCommand(args: string[], options: RunOptions = {}): Promise<ExecResult> {
  const { flags, rest } = runArgs(options);
  return compose([...flags, 'backup', ...args], { timeoutMs: 600_000, ...rest });
}

/** A command inside a one-off container of the backup image with its volumes (`--entrypoint sh`), for looking into and changing the backups volume. */
export function backupShell(script: string, options: RunOptions = {}): Promise<ExecResult> {
  const { flags, rest } = runArgs(options);
  return compose([...flags, '--entrypoint', 'sh', 'backup', '-c', script], { timeoutMs: 120_000, ...rest });
}

/** One run of the backup job itself (what the scheduler starts): `backup-job.sh --label <label> [--now]`. */
export function backupJob(args: string[], options: RunOptions = {}): Promise<ExecResult> {
  const { flags, rest } = runArgs(options);
  return compose([...flags, '--entrypoint', '/opt/backup/backup-job.sh', 'backup', ...args], { timeoutMs: 600_000, ...rest });
}

/** Names of the backup folders, newest first, as `list` prints them (the first word of every line that starts with a date). */
export function parseBackupList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => /^(\d{4}-\d{2}-\d{2}_\d{4}\S*)\s/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** The folders of the backups volume (everything, also media/ and foreign folders). */
export async function backupFolders(): Promise<string[]> {
  const result = await backupShell('ls -1 /backups', { check: true });
  return result.stdout.split(/\s+/).filter(Boolean).sort();
}

/** The status file the backup service writes for the API (`/status/backup-status.json`). */
export interface BackupStatusFile {
  state: string;
  schedule: string | null;
  postponedSince: string | null;
  settingsSha256?: string | null;
  handledRequest?: string | null;
  lastAttempt: { at: string; ok: boolean; message: string | null } | null;
  lastSuccess: { at: string; name: string; bytes: number } | null;
  backups?: Array<{ name: string; at: string; bytes: number; kind: string }>;
  offsite: { configured: boolean; encrypted: boolean; lastAttempt: { ok: boolean; message?: string | null } | null; lastSuccess: { at: string; name: string } | null };
}

export async function backupStatusFile(): Promise<BackupStatusFile> {
  const result = await backupShell('cat /status/backup-status.json', { check: true });
  return JSON.parse(result.stdout) as BackupStatusFile;
}

/** The process environment without anything docker compose would pick up (so only what a test passes counts). */
export function cleanComposeEnv(drop: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('COMPOSE_') || key.startsWith('STUDIOFLOW_') || key.startsWith('ADMIN__') || key.startsWith('E2E_') || drop.includes(key)) delete env[key];
  }
  for (const key of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'POSTGRES_PASSWORD', 'BACKUP_SCHEDULE', ...drop]) delete env[key];
  return env;
}

/**
 * `docker compose config` on a compose file of the repository with NO env file and a clean environment: what a user gets
 * who downloads the file and runs `docker compose up -d`. `env` adds variables of the process (not of a file).
 */
export function composeConfigZeroConfig(options: { file?: 'docker-compose.yml' | 'docker-compose.release.yml'; env?: Record<string, string>; profiles?: string[]; format?: 'json' | 'yaml' } = {}): Promise<ExecResult> {
  const args = ['compose', '-p', `${PROJECT}-cfg`, '-f', path.join(REPO_ROOT, options.file ?? 'docker-compose.yml')];
  for (const profile of options.profiles ?? []) args.push('--profile', profile);
  args.push('config');
  if (options.format !== 'yaml') args.push('--format', 'json');
  // A directory without a .env: compose reads .env from the working directory of the project.
  const cwd = fs.mkdtempSync(path.join(path.dirname(ENV_FILE), '.ops-zero-'));
  return exec('docker', args, { cwd, env: { ...cleanComposeEnv(), ...(options.env ?? {}) } }).finally(() => fs.rmSync(cwd, { recursive: true, force: true }));
}

/** `docker compose config` of the harness files (docker-compose.yml + the e2e override) with the env file of the stack. */
export function composeConfig(options: { profiles?: string[]; format?: 'json' | 'yaml' } = {}): Promise<ExecResult> {
  const args = ['compose', '-p', `${PROJECT}-cfg`, '-f', COMPOSE_FILES.base, '-f', COMPOSE_FILES.e2e, '--env-file', ENV_FILE];
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

/**
 * SHA-256 of a secret (the content is read from a running container, hashed here and never logged). The files are mode
 * 600 for the user of the services, so a one-off container as root cannot read them; the API and PostgreSQL can.
 */
export async function secretFingerprint(file: 'postgres-password' | 'livekit-api-key' | 'livekit-api-secret'): Promise<string> {
  const [service, location] = file === 'postgres-password' ? (['postgres', `/run/secrets/${file}`] as const) : (['api', `/secrets/${file}`] as const);
  const result = await docker(['exec', containerName(service), 'cat', location], { check: true });
  return crypto.createHash('sha256').update(result.stdout.trim()).digest('hex');
}
