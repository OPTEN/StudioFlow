import type { ProductionEvent, ProductionSnapshot } from '../../../packages/scene-model/src/contracts';
import { applyChanges, applyEvent, stateFromSnapshot, type ProductionState } from '../../../packages/scene-model/src/production-state';
import type { HubOptions } from './hubs';
import { StudioHub } from './hubs';
import { sleep } from './shell';

/**
 * A Node implementation of the Regie's synchronisation rule (spec 6) on top of the product's own reducer
 * (`@flowstudio/scene-model`): apply an event when revision == local + 1, ignore <= local, on a gap or after a
 * reconnect call Subscribe(local). Events that arrive while a Subscribe is pending are buffered and applied after it.
 */
export class SyncClient {
  state: ProductionState | null = null;
  lastSync: 'delta' | 'snapshot' | null = null;
  gaps = 0;
  resubscribes = 0;
  applied = 0;
  ignored = 0;
  subscribeAnswers: Array<{ at: number; kind: 'delta' | 'snapshot'; since: number | null; events: number }> = [];
  private pending = false;
  private buffer: ProductionEvent[] = [];

  private constructor(
    readonly hub: StudioHub,
    readonly productionId: string,
  ) {
    hub.connection.on('event', (event: ProductionEvent) => this.onEvent(event));
    hub.onReconnected(() => {
      void this.resubscribe();
    });
  }

  static async connect(base: string, cookie: string, productionId: string, options: HubOptions = {}): Promise<SyncClient> {
    const hub = StudioHub.connect(base, cookie, { reconnect: true, ...options });
    const client = new SyncClient(hub, productionId);
    await hub.start();
    await client.resubscribe();
    return client;
  }

  get revision(): number {
    return this.state?.revision ?? 0;
  }

  /** Subscribe(local revision) and apply the answer: delta or snapshot. */
  async resubscribe(): Promise<void> {
    this.pending = true;
    this.resubscribes += 1;
    try {
      const since = this.state?.revision ?? null;
      const changes = await this.hub.subscribe(this.productionId, since);
      const outcome = applyChanges(this.state, changes);
      this.state = outcome.state;
      this.lastSync = outcome.result === 'snapshot' ? 'snapshot' : 'delta';
      this.subscribeAnswers.push({ at: Date.now(), kind: this.lastSync, since, events: changes.events?.length ?? 0 });
      const buffered = this.buffer;
      this.buffer = [];
      this.pending = false;
      for (const event of buffered) this.onEvent(event);
      if (outcome.result === 'gap') {
        this.gaps += 1;
        await this.resubscribe();
      }
    } finally {
      this.pending = false;
    }
  }

  private onEvent(event: ProductionEvent): void {
    if (this.pending || !this.state) {
      this.buffer.push(event);
      return;
    }
    const outcome = applyEvent(this.state, event);
    if (outcome.result === 'applied') {
      this.state = outcome.state;
      this.applied += 1;
    } else if (outcome.result === 'ignored') {
      this.ignored += 1;
    } else {
      this.gaps += 1;
      this.buffer.push(event);
      void this.resubscribe();
    }
  }

  /** Waits until the local revision is at least `revision`. */
  async waitForRevision(revision: number, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.revision < revision) {
      if (Date.now() > deadline) throw new Error(`revision ${this.revision} did not reach ${revision} within ${timeoutMs} ms`);
      await sleep(20);
    }
  }

  /** The Regie loses its connection (keeps its state). */
  async goOffline(): Promise<void> {
    await this.hub.stop();
  }

  /** The Regie is back: reconnect and Subscribe(local revision). Returns the milliseconds until the state was consistent. */
  async goOnline(): Promise<number> {
    const started = Date.now();
    await this.hub.start();
    await this.resubscribe();
    return Date.now() - started;
  }

  async stop(): Promise<void> {
    await this.hub.stop();
  }
}

/** The parts of a state that must be identical between a hub client and the REST snapshot. */
export function comparableState(state: ProductionState): unknown {
  return {
    production: state.production,
    scenes: state.scenes,
    sources: [...state.sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    devices: [...state.devices.values()].sort((a, b) => a.id.localeCompare(b.id)),
    assets: [...state.assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    pairingRequests: state.pairingRequests,
    invites: [...state.invites].sort((a, b) => a.id.localeCompare(b.id)),
    incidents: [...state.incidents].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Like comparableState, without what a connected phone changes continuously and the server does not revision
 * (telemetry and lastSeenAt: INT-SYNC-05 - relayed, not revisioned).
 */
export function comparableStateStable(state: ProductionState): unknown {
  const full = comparableState(state) as { devices: Array<Record<string, unknown>> } & Record<string, unknown>;
  return { ...full, devices: full.devices.map(({ lastSeenAt: _a, telemetry: _b, ...rest }) => rest) };
}

export function comparableSnapshot(snapshot: ProductionSnapshot): unknown {
  return comparableState(stateFromSnapshot(snapshot, Date.now()));
}
