import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { StackState } from '../global-setup';
import { AdminApi, type Problem, type ApiResult } from './api';
import { E2E_DIR, STATE_FILE, stackConfig, type StackConfig } from './env';
import { cleanupProduction, createProduction, probeForwardedFor, uniqueIp, type PairContext, type Production, type Stack } from './production';
import { ensureHealthy } from './stack';

export { expect };
export { uniqueIp };

export interface WorkerFixtures {
  /** Static knowledge about the stack under test. */
  stack: Stack;
  config: StackConfig;
  /** Facts recorded by global setup (fresh state of the stack, timings). */
  stackState: StackState;
  /** One admin session per worker (the cookie stays valid for 12 h and survives API restarts). */
  adminSession: AdminApi;
}

export interface TestFixtures {
  /** Admin client with the worker's session. */
  api: AdminApi;
  /** A fresh, activated production (docs/testing.md 1.2.4). */
  production: Production;
  pairContext: PairContext;
  /** Registers an async cleanup that runs after the test (in reverse order), even when it failed. */
  onCleanup: (fn: () => Promise<unknown> | unknown) => void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  config: [async ({}, use) => use(stackConfig()), { scope: 'worker' }],

  stackState: [
    async ({}, use) => {
      const state = fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as StackState) : ({} as StackState);
      await use(state);
    },
    { scope: 'worker' },
  ],

  adminSession: [
    async ({ config }, use) => {
      await ensureHealthy(60_000);
      await use(await AdminApi.login(config.baseURL, config.admin));
    },
    { scope: 'worker' },
  ],

  stack: [
    async ({ config, adminSession }, use) => {
      const forwardedForWorks = await probeForwardedFor(adminSession);
      await use({
        baseURL: config.baseURL,
        direct: config.apiDirect,
        forwardedForWorks,
        anonymousBase: forwardedForWorks ? config.apiDirect : config.baseURL,
      });
    },
    { scope: 'worker' },
  ],

  api: async ({ adminSession }, use) => {
    await use(new AdminApi(adminSession.base, adminSession.cookie));
  },

  onCleanup: async ({}, use) => {
    const tasks: Array<() => Promise<unknown> | unknown> = [];
    await use((fn) => {
      tasks.push(fn);
    });
    for (const task of tasks.reverse()) {
      try {
        await task();
      } catch {
        // cleanup is best effort
      }
    }
  },

  production: async ({ api, onCleanup }, use, testInfo) => {
    const label = /^([A-Z0-9-]+)/.exec(testInfo.title)?.[1] ?? 'test';
    const production = await createProduction(api, label);
    onCleanup(() => cleanupProduction(production));
    await use(production);
  },

  pairContext: async ({ production, stack }, use) => {
    await use({ production, stack });
  },
});

/** Asserts a ProblemDetails response: status, machine readable code and (optionally) that nothing leaks. */
export function expectProblem(result: ApiResult<Problem | unknown>, status: number, code?: string): void {
  expect(result.status, `status (body: ${result.raw.text().slice(0, 300)})`).toBe(status);
  const body = result.body as Problem | undefined;
  expect(result.headers['content-type'] ?? '', 'problem content type').toMatch(/json/);
  if (code) expect(body?.code, 'error code').toBe(code);
  const text = result.raw.text();
  expect(text, 'no stack trace in problem details').not.toMatch(/\bat [A-Z][\w.]+\(|System\.|Microsoft\.|Npgsql|\.cs:line/);
}

/** Annotates and skips a test whose precondition is not met by the product yet (never a silent pass). */
export function skipUnsupported(condition: boolean, reason: string): void {
  test.skip(condition, reason);
}

interface BugEntry {
  status: 'open' | 'fixed';
  severity: string;
  area: string;
  title: string;
  /** Open entries only: where it is tested and what was seen (read by people, not by the harness). */
  test?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  evidence?: string;
  fix?: string;
}

let bugRegistry: Record<string, BugEntry> | undefined;

function bugStatus(id: string): BugEntry | undefined {
  if (!bugRegistry) {
    const file = path.join(E2E_DIR, 'known-bugs.json');
    bugRegistry = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { bugs: Record<string, BugEntry> }).bugs : {};
  }
  return bugRegistry[id];
}

/**
 * Marks the running test as a confirmed product bug of known-bugs.json. While the bug is `open` the test keeps its
 * full assertions and is expected to fail (`test.fail`): it turns red the day the product is fixed, which is the
 * reminder to set the entry to `fixed`. A `fixed` entry only annotates the test; it then guards against regressions.
 * Steps, expected, actual and evidence are in the entry itself.
 */
export function knownBug(id: string, description: string): void {
  const entry = bugStatus(id);
  test.info().annotations.push({ type: 'bug', description: `${id} (${entry?.status ?? 'unregistered'}): ${description}` });
  // E2E_BUG_REPORT=1 runs the marked tests as plain tests: the failures are the evidence quoted in the entry.
  if (process.env['E2E_BUG_REPORT'] === '1') return;
  if (entry?.status === 'open') test.fail(true, `${id}: ${description}`);
}

/**
 * Dependent tests call this first: when the canary (E2E-NET-00) found a tool unusable, the test fails with a clear
 * message instead of passing vacuously (docs/testing.md 1.6). A missing canary file means the canary did not run yet.
 */
export function requireTool(tool: string): void {
  const file = path.join(E2E_DIR, '.output', 'canary.json');
  if (!fs.existsSync(file)) throw new Error(`tool ${tool} unavailable: E2E-NET-00 has not run (run the smoke project first)`);
  const canary = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { ok: boolean; detail: string }>;
  if (!canary[tool]?.ok) throw new Error(`tool ${tool} unavailable (E2E-NET-00): ${canary[tool]?.detail ?? 'not exercised'}`);
}
