import { LogLevel } from '@microsoft/signalr';
import {
  HUB,
  applyChanges,
  applyOutputChanges,
  type OutputChangesDto,
  type ProductionChangesDto,
  type ProductionEvent,
} from '@flowstudio/scene-model';
import {
  deviceFixture,
  outputSnapshotFixture,
  sceneFixture,
  snapshotFixture,
  telemetryFixture,
} from '../../scene-model/src/testing/fixtures';
import { ProductionSync, type SyncCause, type SyncStatus } from './production-sync';
import {
  FakeSyncHub,
  RecordingLogger,
  deferred,
  flushMicrotasks,
  type Deferred,
} from './testing/fakes';

interface Harness {
  readonly hub: FakeSyncHub;
  readonly sync: ProductionSync<ProductionChangesDto>;
  readonly calls: { since: number | null; answer: Deferred<ProductionChangesDto> }[];
  readonly causes: SyncCause['kind'][];
  readonly statuses: SyncStatus[];
  readonly logger: RecordingLogger;
  /** Answers the oldest unanswered subscribe call. */
  answer(changes: ProductionChangesDto): Promise<void>;
  /** Fails the oldest unanswered subscribe call. */
  fail(error: unknown): Promise<void>;
}

function createHarness(): Harness {
  const hub = new FakeSyncHub();
  const calls: Harness['calls'] = [];
  const causes: SyncCause['kind'][] = [];
  const statuses: SyncStatus[] = [];
  const logger = new RecordingLogger();
  let answered = 0;
  const sync = new ProductionSync<ProductionChangesDto>({
    hub,
    logger,
    random: () => 0,
    now: () => 1_000,
    subscribe: (since) => {
      const answer = deferred<ProductionChangesDto>();
      calls.push({ since, answer });
      return answer.promise;
    },
    apply: applyChanges,
  });
  sync.onChange((_state, cause) => causes.push(cause.kind));
  sync.onStatus((status) => statuses.push(status));
  const next = (): Deferred<ProductionChangesDto> => {
    const call = calls[answered];
    if (!call) {
      throw new Error('no pending subscribe call');
    }
    answered += 1;
    return call.answer;
  };
  return {
    hub,
    sync,
    calls,
    causes,
    statuses,
    logger,
    answer: async (changes) => {
      next().resolve(changes);
      await flushMicrotasks();
    },
    fail: async (error) => {
      next().reject(error);
      await flushMicrotasks();
    },
  };
}

const snapshotAt = (revision: number): ProductionChangesDto => ({
  revision,
  events: null,
  snapshot: snapshotFixture({ revision }),
});

const delta = (revision: number, events: ProductionEvent[]): ProductionChangesDto => ({
  revision,
  events,
  snapshot: null,
});

const removeScene = (sceneId: string, revision: number): ProductionEvent => ({
  type: 'sceneRemoved',
  sceneId,
  revision,
});

const upsertScene = (sceneId: string, revision: number): ProductionEvent => ({
  type: 'sceneUpserted',
  scene: sceneFixture(sceneId, 5),
  revision,
});

const tick = (revision: number): ProductionEvent => ({ type: 'revisionOnly', revision });

/** Starts the sync, connects the hub and answers the first subscribe with a snapshot at revision 100. */
async function live(harness: Harness): Promise<void> {
  harness.sync.start();
  harness.hub.connect();
  await harness.answer(snapshotAt(100));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProductionSync initial sync', () => {
  it('subscribes without a revision on connect and goes live with the snapshot', async () => {
    const harness = createHarness();
    harness.sync.start();
    expect(harness.sync.status).toBe('connecting');
    expect(harness.calls).toHaveLength(0);
    harness.hub.connect();
    expect(harness.calls.map((call) => call.since)).toEqual([null]);
    expect(harness.sync.status).toBe('syncing');
    await harness.answer(snapshotAt(100));
    expect(harness.sync.state?.revision).toBe(100);
    expect(harness.sync.status).toBe('live');
    expect(harness.sync.lastSyncAt).toBe(1_000);
    expect(harness.causes).toEqual(['snapshot']);
    expect(harness.statuses).toEqual(['connecting', 'syncing', 'live']);
  });

  it('subscribes right away when the hub is already connected', () => {
    const harness = createHarness();
    harness.hub.setState('connected');
    harness.sync.start();
    expect(harness.calls).toHaveLength(1);
  });

  it('is idempotent', () => {
    const harness = createHarness();
    harness.hub.setState('connected');
    harness.sync.start();
    harness.sync.start();
    expect(harness.calls).toHaveLength(1);
  });
});

describe('ProductionSync live events', () => {
  it('applies the next revision and reports the event', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, removeScene('scn_b', 101));
    expect(harness.sync.state?.revision).toBe(101);
    expect(harness.sync.state?.scenes.map((scene) => scene.id)).toEqual(['scn_a']);
    expect(harness.causes).toEqual(['snapshot', 'event']);
  });

  it('ignores duplicates and already covered events', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(101));
    harness.hub.receive(HUB.event, tick(101));
    harness.hub.receive(HUB.event, tick(99));
    expect(harness.sync.state?.revision).toBe(101);
    expect(harness.causes).toEqual(['snapshot', 'event']);
    expect(harness.calls).toHaveLength(1);
  });

  it('resubscribes with the local revision on a gap and applies the delta', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(103));
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100]);
    expect(harness.sync.status).toBe('syncing');
    await harness.answer(delta(103, [tick(101), removeScene('scn_b', 102), tick(103)]));
    expect(harness.sync.state?.revision).toBe(103);
    expect(harness.sync.state?.scenes.map((scene) => scene.id)).toEqual(['scn_a']);
    expect(harness.sync.status).toBe('live');
    expect(harness.calls).toHaveLength(2);
  });

  it('buffers events during a subscribe and applies them afterwards in revision order', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    harness.hub.receive(HUB.event, upsertScene('scn_late', 103));
    harness.hub.receive(HUB.event, tick(100));
    harness.hub.receive(HUB.event, removeScene('scn_b', 102));
    harness.hub.receive(HUB.event, tick(101));
    harness.hub.receive(HUB.event, tick(101));
    expect(harness.sync.state).toBeNull();
    await harness.answer(snapshotAt(101));
    expect(harness.sync.state?.revision).toBe(103);
    expect(harness.sync.state?.scenes.map((scene) => scene.id)).toEqual(['scn_a', 'scn_late']);
    expect(harness.causes).toEqual(['snapshot', 'event', 'event']);
    expect(harness.calls).toHaveLength(1);
    expect(harness.sync.status).toBe('live');
  });

  it('handles an out-of-order burst with one resubscribe', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(103));
    harness.hub.receive(HUB.event, tick(101));
    harness.hub.receive(HUB.event, tick(102));
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100]);
    await harness.answer(delta(101, [tick(101)]));
    expect(harness.sync.state?.revision).toBe(103);
    expect(harness.calls).toHaveLength(2);
    expect(harness.sync.status).toBe('live');
  });

  it('resubscribes again when buffered events still leave a gap', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(102));
    harness.hub.receive(HUB.event, tick(105));
    await harness.answer(delta(102, [tick(101), tick(102)]));
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100, 102]);
    await harness.answer(delta(105, [tick(103), tick(104), tick(105)]));
    expect(harness.sync.state?.revision).toBe(105);
    expect(harness.sync.status).toBe('live');
  });

  it('resubscribes from the partial revision when the delta itself has a gap', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(104));
    await harness.answer(delta(104, [tick(101), tick(103)]));
    expect(harness.sync.state?.revision).toBe(101);
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100, 101]);
  });

  it('ignores malformed event payloads', async () => {
    const harness = createHarness();
    await live(harness);
    for (const payload of [
      null,
      'x',
      { type: 'revisionOnly' },
      { type: 'revisionOnly', revision: '101' },
      { revision: 101 },
      { type: 'revisionOnly', revision: 101.5 },
    ]) {
      harness.hub.receive(HUB.event, payload);
    }
    expect(harness.sync.state?.revision).toBe(100);
    expect(harness.calls).toHaveLength(1);
    expect(harness.logger.messages(LogLevel.Warning)).toHaveLength(6);
  });
});

describe('ProductionSync coalescing', () => {
  it('coalesces gaps and resyncs during a running subscribe into one follow-up', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(105));
    harness.hub.receive(HUB.event, tick(107));
    harness.hub.receive(HUB.resync, 'prd_aaaaaaaaaaaaaaaa');
    harness.hub.receive(HUB.resync, 'prd_aaaaaaaaaaaaaaaa');
    expect(harness.calls).toHaveLength(2);
    await harness.answer(delta(107, [tick(101)]));
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100, null]);
    await harness.answer(snapshotAt(107));
    expect(harness.calls).toHaveLength(3);
    expect(harness.sync.status).toBe('live');
  });
});

describe('ProductionSync reconnects', () => {
  it('keeps the state while offline and resumes with a delta after reconnect', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(101));
    harness.hub.setState('reconnecting');
    expect(harness.sync.status).toBe('offline');
    expect(harness.sync.state?.revision).toBe(101);
    harness.hub.connect();
    expect(harness.calls.map((call) => call.since)).toEqual([null, 101]);
    await harness.answer(delta(102, [tick(102)]));
    expect(harness.sync.state?.revision).toBe(102);
    expect(harness.sync.status).toBe('live');
  });

  it('never reports live between a reconnect and the answer of the resubscribe', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.setState('reconnecting');
    harness.hub.connect();
    await harness.answer(delta(100, []));
    expect(harness.statuses).toEqual([
      'connecting',
      'syncing',
      'live',
      'offline',
      'syncing',
      'live',
    ]);
  });

  it('accepts a snapshot when the server no longer has the events', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.setState('reconnecting');
    harness.hub.connect();
    await harness.answer(snapshotAt(900));
    expect(harness.sync.state?.revision).toBe(900);
    expect(harness.causes).toEqual(['snapshot', 'snapshot']);
  });

  it('drops the answer of a subscribe that was overtaken by a reconnect', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(103));
    harness.hub.setState('reconnecting');
    harness.hub.connect();
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100, 100]);
    await harness.answer(delta(103, [tick(101), tick(102), tick(103)]));
    expect(harness.sync.state?.revision).toBe(100);
    await harness.answer(delta(104, [tick(101), tick(102), tick(103), tick(104)]));
    expect(harness.sync.state?.revision).toBe(104);
  });

  it('reports connecting before the first state and unauthorized from the hub', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.setState('connecting');
    expect(harness.sync.status).toBe('connecting');
    harness.hub.setState('unauthorized');
    expect(harness.sync.status).toBe('unauthorized');
  });
});

describe('ProductionSync failures', () => {
  it('retries a failed subscribe with the backoff while connected', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    await harness.fail(new Error('HubException: production not found'));
    expect(harness.sync.status).toBe('syncing');
    await vi.advanceTimersByTimeAsync(299);
    expect(harness.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.calls.map((call) => call.since)).toEqual([null, null]);
    await harness.fail(new Error('again'));
    await vi.advanceTimersByTimeAsync(600);
    expect(harness.calls).toHaveLength(3);
    await harness.answer(snapshotAt(100));
    expect(harness.sync.status).toBe('live');
  });

  it('waits for the next connect instead of retrying while disconnected', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    harness.hub.setState('reconnecting');
    await harness.fail(
      new Error('Invocation canceled due to the underlying connection being closed.'),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    harness.hub.connect();
    expect(harness.calls).toHaveLength(2);
  });

  it('asks for a snapshot when an answer cannot be applied', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    await harness.answer(delta(5, []));
    expect(harness.sync.state).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.calls.map((call) => call.since)).toEqual([null, null]);
    await harness.answer(snapshotAt(5));
    expect(harness.sync.status).toBe('live');
  });

  it('keeps working when a change listener throws', async () => {
    const harness = createHarness();
    harness.sync.onChange(() => {
      throw new Error('listener');
    });
    await live(harness);
    harness.hub.receive(HUB.event, tick(101));
    expect(harness.sync.state?.revision).toBe(101);
    expect(harness.logger.messages(LogLevel.Error)).toHaveLength(2);
  });

  it('requests a snapshot instead of buffering without bound', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    for (let revision = 1; revision <= 1500; revision += 1) {
      harness.hub.receive(HUB.event, tick(100 + revision));
    }
    await harness.answer(snapshotAt(100));
    expect(harness.calls.map((call) => call.since)).toEqual([null, null]);
    await harness.answer(snapshotAt(1600));
    expect(harness.sync.state?.revision).toBe(1600);
    expect(harness.sync.status).toBe('live');
  });
});

describe('ProductionSync resync', () => {
  it('resubscribes from scratch on a resync message', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.resync, 'prd_other');
    expect(harness.calls.map((call) => call.since)).toEqual([null, null]);
    await harness.answer(snapshotAt(7));
    expect(harness.sync.state?.revision).toBe(7);
  });

  it('keeps the snapshot request of a resync when a reconnect overtakes it', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.resync, 'prd_other');
    harness.hub.setState('reconnecting');
    harness.hub.connect();
    expect(harness.calls.map((call) => call.since)).toEqual([null, null, null]);
  });

  it('resync() resolves once a newly requested snapshot is applied', async () => {
    const harness = createHarness();
    await live(harness);
    let resolved = false;
    const done = harness.sync.resync().then(() => {
      resolved = true;
    });
    await flushMicrotasks();
    expect(resolved).toBe(false);
    await harness.answer(snapshotAt(120));
    await done;
    expect(resolved).toBe(true);
  });

  it('resync() during a running delta subscribe waits for the follow-up snapshot', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(102));
    let resolved = false;
    const done = harness.sync.resync().then(() => {
      resolved = true;
    });
    await harness.answer(delta(102, [tick(101), tick(102)]));
    expect(resolved).toBe(false);
    expect(harness.calls.at(-1)?.since).toBeNull();
    await harness.answer(snapshotAt(102));
    await done;
    expect(resolved).toBe(true);
  });

  it('resync() waits for the connection and survives a failed attempt', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.setState('reconnecting');
    const done = harness.sync.resync();
    expect(harness.calls).toHaveLength(1);
    harness.hub.connect();
    expect(harness.calls.at(-1)?.since).toBeNull();
    await harness.fail(new Error('boom'));
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.calls.at(-1)?.since).toBeNull();
    await harness.answer(snapshotAt(130));
    await expect(done).resolves.toBeUndefined();
  });

  it('coalesces many concurrent resync() calls into one follow-up snapshot subscribe', async () => {
    const harness = createHarness();
    await live(harness);
    const first = harness.sync.resync();
    const later = Array.from({ length: 19 }, () => harness.sync.resync());
    expect(harness.calls).toHaveLength(2);
    await harness.answer(snapshotAt(150));
    await expect(first).resolves.toBeUndefined();
    // The later calls were made while the first snapshot was already requested: they share one more.
    expect(harness.calls.map((call) => call.since)).toEqual([null, null, null]);
    await harness.answer(snapshotAt(151));
    await expect(Promise.all(later)).resolves.toHaveLength(19);
    expect(harness.calls).toHaveLength(3);
    expect(harness.sync.status).toBe('live');
  });

  it('turns a synchronous throw of subscribe into a retried failure', async () => {
    const hub = new FakeSyncHub();
    let calls = 0;
    const sync = new ProductionSync<ProductionChangesDto>({
      hub,
      logger: new RecordingLogger(),
      random: () => 0,
      subscribe: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('sync throw');
        }
        return Promise.resolve(snapshotAt(100));
      },
      apply: applyChanges,
    });
    sync.start();
    hub.connect();
    await flushMicrotasks();
    expect(sync.status).toBe('syncing');
    await vi.advanceTimersByTimeAsync(300);
    expect(sync.status).toBe('live');
    sync.stop();
  });

  it('resync() rejects when the sync stops first or is not running', async () => {
    const harness = createHarness();
    await expect(harness.sync.resync()).rejects.toThrow(/not running/);
    await live(harness);
    const pending = harness.sync.resync();
    harness.sync.stop();
    await expect(pending).rejects.toThrow(/stopped/);
  });
});

describe('ProductionSync telemetry and presence', () => {
  async function liveWithDevice(harness: Harness): Promise<void> {
    harness.sync.start();
    harness.hub.connect();
    await harness.answer({
      revision: 100,
      events: null,
      snapshot: snapshotFixture({ devices: [deviceFixture('dev_k1aaaa', 'Handy')] }),
    });
  }

  it('applies telemetry without touching the revision', async () => {
    const harness = createHarness();
    await liveWithDevice(harness);
    const telemetry = telemetryFixture('2026-10-22T10:00:02Z', { batteryPct: 17 });
    harness.hub.receive(HUB.telemetry, { deviceId: 'dev_k1aaaa', telemetry });
    expect(harness.sync.state?.devices.get('dev_k1aaaa')?.telemetry).toEqual(telemetry);
    expect(harness.sync.state?.revision).toBe(100);
    expect(harness.causes).toEqual(['snapshot', 'telemetry']);
  });

  it('ignores telemetry for unknown devices, malformed messages and before the first snapshot', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    harness.hub.receive(HUB.telemetry, {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture('2026-10-22T10:00:02Z'),
    });
    await harness.answer({
      revision: 100,
      events: null,
      snapshot: snapshotFixture({ devices: [deviceFixture('dev_k1aaaa', 'Handy')] }),
    });
    expect(harness.sync.state?.devices.get('dev_k1aaaa')?.telemetry).toBeNull();
    harness.hub.receive(HUB.telemetry, {
      deviceId: 'dev_unknown',
      telemetry: telemetryFixture('2026-10-22T10:00:02Z'),
    });
    harness.hub.receive(HUB.telemetry, { deviceId: 'dev_k1aaaa' });
    harness.hub.receive(HUB.telemetry, 'garbage');
    expect(harness.causes).toEqual(['snapshot']);
  });

  it('applies presence counts and ignores invalid ones', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.presence, 2);
    harness.hub.receive(HUB.presence, 2);
    harness.hub.receive(HUB.presence, '3');
    harness.hub.receive(HUB.presence, -1);
    expect(harness.sync.state?.operatorsOnline).toBe(2);
    expect(harness.causes).toEqual(['snapshot', 'presence']);
  });
});

describe('ProductionSync stop', () => {
  it('unregisters everything, ignores pending answers and leaves no timers', async () => {
    const harness = createHarness();
    harness.sync.start();
    harness.hub.connect();
    await harness.fail(new Error('boom'));
    expect(vi.getTimerCount()).toBe(1);
    harness.sync.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.hub.listenerCount()).toBe(0);
    expect(harness.sync.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.calls).toHaveLength(1);
  });

  it('keeps the last state after stop and ignores an answer that arrives later', async () => {
    const harness = createHarness();
    await live(harness);
    harness.hub.receive(HUB.event, tick(105));
    harness.sync.stop();
    await harness.answer(snapshotAt(999));
    expect(harness.sync.state?.revision).toBe(100);
    harness.hub.receive(HUB.event, tick(101));
    expect(harness.sync.state?.revision).toBe(100);
  });

  it('a listener may stop the sync while a snapshot is applied', async () => {
    const harness = createHarness();
    harness.sync.onChange(() => harness.sync.stop());
    harness.sync.start();
    harness.hub.connect();
    harness.hub.receive(HUB.event, tick(101));
    await harness.answer(snapshotAt(100));
    expect(harness.sync.state?.revision).toBe(100);
    expect(harness.sync.status).toBe('offline');
  });

  it('can start again after stop', async () => {
    const harness = createHarness();
    await live(harness);
    harness.sync.stop();
    harness.sync.start();
    expect(harness.calls.map((call) => call.since)).toEqual([null, 100]);
  });
});

describe('ProductionSync for the output page', () => {
  it('works with OutputChangesDto and revisionOnly events', async () => {
    const hub = new FakeSyncHub();
    const answers: Deferred<OutputChangesDto>[] = [];
    const sync = new ProductionSync<OutputChangesDto>({
      hub,
      logger: new RecordingLogger(),
      subscribe: () => {
        const answer = deferred<OutputChangesDto>();
        answers.push(answer);
        return answer.promise;
      },
      apply: applyOutputChanges,
    });
    sync.start();
    hub.connect();
    answers[0].resolve({
      revision: 100,
      events: null,
      snapshot: outputSnapshotFixture(),
    } as unknown as OutputChangesDto);
    await flushMicrotasks();
    hub.receive(HUB.event, tick(101));
    hub.receive(HUB.event, removeScene('scn_b', 102));
    expect(sync.state?.revision).toBe(102);
    expect(sync.state?.scenes.map((scene) => scene.id)).toEqual(['scn_a']);
    expect(sync.state?.devices.size).toBe(0);
    expect(sync.status).toBe('live');
  });
});
