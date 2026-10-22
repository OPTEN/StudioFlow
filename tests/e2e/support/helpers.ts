import { expect } from '@playwright/test';
import type { ProductionEvent } from '../../../packages/scene-model/src/contracts';
import type { AdminApi } from './api';
import { StudioHub, type HubSession } from './hubs';
import type { Production } from './production';
import { sleep } from './shell';

/** Connects and subscribes a studio hub client (through Caddy by default) and registers its cleanup. */
export async function openStudio(
  base: string,
  api: AdminApi,
  production: Production,
  onCleanup: (fn: () => Promise<unknown> | unknown) => void,
  options: { sinceRevision?: number | null; reconnect?: boolean } = {},
): Promise<{ hub: StudioHub; revision: number }> {
  const hub = StudioHub.connect(base, api.cookie, { reconnect: options.reconnect });
  onCleanup(() => hub.stop());
  const changes = await hub.open(production.id, options.sinceRevision ?? null);
  return { hub, revision: changes.revision };
}

/** The revisions of consecutive events must increase by exactly one (the client rule of spec 6). */
export function expectConsecutive(events: ProductionEvent[], after?: number): void {
  const revisions = events.map((event) => event.revision);
  for (let index = 0; index < revisions.length; index++) {
    const expected = index === 0 ? (after === undefined ? revisions[0]! : after + 1) : revisions[index - 1]! + 1;
    expect(revisions[index], `revision #${index} of ${revisions.join(', ')}`).toBe(expected);
  }
}

/** Compact event list for failure messages: `type` or `type:detail`. */
export function describeEvents(hub: HubSession): string {
  return hub
    .events()
    .map((event) => {
      const any = event as unknown as Record<string, unknown>;
      const detail = (any['source'] as { status?: string; code?: string } | undefined) ?? (any['device'] as { state?: string; connection?: string } | undefined) ?? (any['incident'] as { kind?: string } | undefined);
      return detail ? `${event.type}(${Object.values(detail).filter((value) => typeof value === 'string').slice(0, 2).join('/')})` : event.type;
    })
    .join(', ');
}

/** Polls `read` until `predicate` is true; returns the elapsed milliseconds. */
export async function pollUntil<T>(
  what: string,
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ value: T; elapsedMs: number }> {
  const started = Date.now();
  let value: T;
  for (;;) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}; last value: ${JSON.stringify(value)?.slice(0, 500)}`);
    await sleep(intervalMs);
  }
}

/** Percentile of a numeric sample (nearest rank). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
