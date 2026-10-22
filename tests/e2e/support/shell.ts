import { spawn, type SpawnOptions } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr in arrival order (what a terminal would show). */
  output: string;
  durationMs: number;
}

export interface ExecOptions extends SpawnOptions {
  /** Text written to stdin (then closed). */
  input?: string;
  /** Kill the process after this many ms (default 10 min). */
  timeoutMs?: number;
  /** Throw when the exit code is not 0. */
  check?: boolean;
  /** Stream output to the test log while running (long builds). */
  echo?: boolean;
}

/** Runs a command without a shell and collects its output. Never prints secrets itself. */
export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const { input, timeoutMs = 600_000, check = false, echo = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { windowsHide: true, ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      output += text;
      if (echo) process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      output += text;
      if (echo) process.stderr.write(text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result: ExecResult = { code, stdout, stderr, output, durationMs: Date.now() - started };
      if (check && code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${output.slice(-4000)}`));
        return;
      }
      resolve(result);
    });
    if (input !== undefined) child.stdin?.write(input);
    child.stdin?.end();
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it returns a truthy value (returned) or the timeout passes (throws with `what`). */
export async function waitUntil<T>(
  what: string,
  probe: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  { timeoutMs = 30_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${what}${lastError ? ` (last error: ${String(lastError)})` : ''}`);
    }
    await sleep(intervalMs);
  }
}
