/**
 * End-to-end specs: ResilientHub and ProductionSync with the real @microsoft/signalr client (createHubConnection)
 * against an in-process SignalR server, with real timers and real sockets.
 */
import {
  HUB,
  applyChanges,
  type ProductionChangesDto,
  type ProductionEvent,
} from '@flowstudio/scene-model';
import { snapshotFixture } from '../../scene-model/src/testing/fixtures';
import { ProductionSync } from './production-sync';
import { ResilientHub, type HubState } from './resilient-hub';
import { RecordingLogger } from './testing/fakes';
import { TestSignalRServer, type TestHubClient } from './testing/signalr-test-server';

/** Server-side production: a revision counter, an event log and the subscribed clients. */
class ProductionModel {
  revision = 100;
  readonly subscribeCalls: (number | null)[] = [];
  private readonly events: ProductionEvent[] = [];
  private readonly subscribers = new Set<TestHubClient>();

  constructor(private readonly server: TestSignalRServer) {}

  subscribe(client: TestHubClient, since: number | null): ProductionChangesDto {
    this.subscribeCalls.push(since);
    this.subscribers.add(client);
    if (since !== null && since <= this.revision && since >= 100) {
      return {
        revision: this.revision,
        events: this.events.filter((event) => event.revision > since),
        snapshot: null,
      };
    }
    return {
      revision: this.revision,
      events: null,
      snapshot: snapshotFixture({ revision: this.revision }),
    };
  }

  publish(): void {
    this.revision += 1;
    const event: ProductionEvent = { type: 'revisionOnly', revision: this.revision };
    this.events.push(event);
    for (const client of this.subscribers) {
      if (this.server.clients.has(client)) {
        client.send(HUB.event, event);
      }
    }
  }
}

const WAIT = { timeout: 10_000, interval: 20 };

let server: TestSignalRServer;
let model: ProductionModel;
let hub: ResilientHub;
let sync: ProductionSync<ProductionChangesDto>;
let hubStates: HubState[];

beforeEach(async () => {
  server = new TestSignalRServer();
  await server.start();
  model = new ProductionModel(server);
  server.onInvoke = (target, args, client) => {
    if (target !== HUB.subscribe) {
      throw new Error(`unknown method ${target}`);
    }
    const since = args[1];
    return model.subscribe(client, typeof since === 'number' ? since : null);
  };
  const logger = new RecordingLogger();
  hub = new ResilientHub({
    url: `${server.url}/hubs/studio`,
    accessTokenFactory: () => 'admin-session',
    logger,
    wakeSignals: () => () => undefined,
  });
  hubStates = [];
  hub.onStateChange((state) => hubStates.push(state));
  sync = new ProductionSync<ProductionChangesDto>({
    hub,
    logger,
    subscribe: (since) =>
      hub.invoke<ProductionChangesDto>(HUB.subscribe, 'prd_aaaaaaaaaaaaaaaa', since),
    apply: applyChanges,
  });
  sync.start();
  hub.start();
  await vi.waitFor(() => expect(sync.status).toBe('live'), WAIT);
});

afterEach(async () => {
  sync.stop();
  await hub.stop();
  await server.close();
});

describe('realtime client against a SignalR server', () => {
  it('syncs the snapshot, applies live events and sends the token', async () => {
    expect(sync.state?.revision).toBe(100);
    expect(model.subscribeCalls).toEqual([null]);
    expect(server.lastAuthorization).toBe('Bearer admin-session');
    model.publish();
    model.publish();
    await vi.waitFor(() => expect(sync.state?.revision).toBe(102), WAIT);
  });

  it('resumes with a delta after a network drop, including events missed while away', async () => {
    model.publish();
    await vi.waitFor(() => expect(sync.state?.revision).toBe(101), WAIT);
    server.dropAll();
    model.publish();
    await vi.waitFor(() => expect(sync.state?.revision).toBe(102), WAIT);
    expect(model.subscribeCalls).toEqual([null, 101]);
    expect(hubStates).toContain('reconnecting');
    expect(sync.status).toBe('live');
  });

  it('keeps the state through a server outage and reconnects without a tight loop', async () => {
    server.accepting = false;
    server.dropAll();
    await vi.waitFor(() => expect(hub.state).toBe('reconnecting'), WAIT);
    const requestsBefore = server.requests;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sync.status).toBe('offline');
    expect(sync.state?.revision).toBe(100);
    // 0, 300, 600 ms (+ jitter) → at most a handful of attempts in 1.5 s.
    expect(server.requests - requestsBefore).toBeLessThanOrEqual(5);
    model.publish();
    server.accepting = true;
    await vi.waitFor(() => expect(sync.state?.revision).toBe(101), WAIT);
    expect(sync.status).toBe('live');
    expect(model.subscribeCalls.at(-1)).toBe(100);
  });

  it('stops for good on 403 during a reconnect and recovers after restart()', async () => {
    server.negotiateStatus = 403;
    server.dropAll();
    await vi.waitFor(() => expect(hub.state).toBe('unauthorized'), WAIT);
    expect(sync.status).toBe('unauthorized');
    const requests = server.requests;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(server.requests).toBe(requests);
    server.negotiateStatus = 200;
    hub.restart();
    await vi.waitFor(() => expect(sync.status).toBe('live'), WAIT);
    expect(model.subscribeCalls).toEqual([null, 100]);
  });

  it(
    'detects a silent server with the 6 s server timeout and reconnects',
    { timeout: 20_000 },
    async () => {
      server.sendPings = false;
      const startedAt = Date.now();
      await vi.waitFor(() => expect(hubStates).toContain('reconnecting'), {
        timeout: 12_000,
        interval: 20,
      });
      const detectedAfter = Date.now() - startedAt;
      server.sendPings = true;
      expect(detectedAfter).toBeGreaterThanOrEqual(5000);
      expect(detectedAfter).toBeLessThan(9000);
      await vi.waitFor(() => expect(sync.status).toBe('live'), WAIT);
      expect(model.subscribeCalls).toEqual([null, 100]);
    },
  );

  it('applies events that overtake a slow subscribe answer', async () => {
    server.onInvoke = (_target, args, client) => {
      const since = args[1];
      const answer = model.subscribe(client, typeof since === 'number' ? since : null);
      return new Promise((resolve) => setTimeout(() => resolve(answer), 300));
    };
    server.broadcast(HUB.resync, 'prd_aaaaaaaaaaaaaaaa');
    await vi.waitFor(() => expect(model.subscribeCalls).toHaveLength(2), WAIT);
    model.publish();
    model.publish();
    model.publish();
    await vi.waitFor(() => expect(sync.state?.revision).toBe(103), WAIT);
    expect(sync.status).toBe('live');
    expect(model.subscribeCalls).toEqual([null, null]);
  });

  it('stays consistent through a flapping connection while events keep coming', async () => {
    for (let round = 0; round < 6; round += 1) {
      model.publish();
      server.dropAll();
      await new Promise((resolve) => setTimeout(resolve, 40 + round * 40));
      model.publish();
    }
    await vi.waitFor(() => {
      expect(sync.status).toBe('live');
      expect(sync.state?.revision).toBe(model.revision);
    }, WAIT);
    expect(model.revision).toBe(112);
  });

  it('stop() closes the connection and never reconnects', async () => {
    await hub.stop();
    expect(hub.state).toBe('stopped');
    await vi.waitFor(() => expect(server.clients.size).toBe(0), WAIT);
    const requests = server.requests;
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(server.requests).toBe(requests);
    expect(sync.status).toBe('offline');
    expect(sync.state?.revision).toBe(100);
  });
});
