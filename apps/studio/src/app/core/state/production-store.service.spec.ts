import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { tm } from '@studioflow/i18n';
import { HUB, canvasDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  deltaChanges,
  incidentFixture,
  itemFixture,
  logFixture,
  placeholderFixture,
  PRODUCTION_ID,
  productionFixture,
  sceneFixture,
  snapshotChanges,
  snapshotFixture,
  textSourceFixture,
} from '../../../testing/fixtures';
import { MemoryStorage, startStore, studioTestProviders } from '../../../testing/store-harness';
import { AuthService } from '../auth/auth.service';
import {
  ProductionStoreService,
  sortIncidents,
  type StudioTestHook,
} from './production-store.service';
import { TEST_HOOKS_FLAG } from './test-hooks';
describe('ProductionStoreService', () => {
  let hub: FakeStudioHub;

  beforeEach(() => {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
  });

  it('discovers the active production, subscribes for a snapshot and goes live', async () => {
    const { store } = await startStore(hub);
    expect(store.productionId()).toBe(PRODUCTION_ID);
    expect(hub.subscribeCalls).toEqual([{ productionId: PRODUCTION_ID, since: null }]);
    expect(store.status()).toBe('live');
    expect(store.online()).toBe(true);
    expect(store.canCommand()).toBe(true);
    expect(store.scenes().map((scene) => scene.name)).toEqual(['Welcome', 'Presentation', 'Break']);
    expect(store.programScene()?.id).toBe('scn_a');
    expect(store.previewScene()).toBeNull();
    expect(store.healthSummary().text).toBe('All 2 stations ok');
    expect(store.sourceLabel('dev_bbbbbbbbbbbbbbbb/screen-1')).toBe('Laptop Lea · Slides');
    expect(store.sourceLabel('dev_xxxxxxxxxxxxxxxx/camera')).toBe('Source missing');
    expect(store.tallyOf('dev_aaaaaaaaaaaaaaaa/camera')).toBe('program');
  });

  it('serves the content of texts and the text colours, and follows their events', async () => {
    const harness = await startStore(hub);
    const { store } = harness;
    expect(store.textOf('dev_aaaaaaaaaaaaaaaa/camera')).toBeUndefined();
    expect(store.textTheme()).toEqual({
      accent: '#1f6feb',
      background: '#0d1117',
      foreground: '#ffffff',
    });

    harness.emitEvent({
      type: 'sourceUpserted',
      source: textSourceFixture('txt_aaaaaaaaaaaaaaaa', 'T1'),
    });
    harness.emitEvent({
      type: 'sourceUpserted',
      source: textSourceFixture('txt_aaaaaaaaaaaaaaaa', 'T1', { line1: 'Leo Lang' }),
    });
    harness.emitEvent({
      type: 'productionChanged',
      production: productionFixture({
        textTheme: { accent: '#ff8800', background: '#001122', foreground: '#eeeeee' },
      }),
    });

    expect(store.textOf('txt_aaaaaaaaaaaaaaaa')?.line1).toBe('Leo Lang');
    expect(store.sourceLabel('txt_aaaaaaaaaaaaaaaa')).toBe('Leo Lang');
    expect(store.kindOf('txt_aaaaaaaaaaaaaaaa')).toBe('text');
    expect(store.textTheme().accent).toBe('#ff8800');
    harness.emitEvent({ type: 'sourceRemoved', sourceId: 'txt_aaaaaaaaaaaaaaaa' });
    expect(store.textOf('txt_aaaaaaaaaaaaaaaa')).toBeUndefined();
  });

  it('serves the canvas of the production and follows a change of the format', async () => {
    const harness = await startStore(hub);
    const store = harness.store;
    const initial = store.canvas();
    expect(initial).toEqual({ width: 1920, height: 1080 });
    expect(store.canvasAspect()).toBe('1920 / 1080');

    harness.emitEvent({
      type: 'productionChanged',
      production: productionFixture({ name: 'Renamed' }),
    });
    await harness.settle();
    expect(store.canvas()).toBe(initial);

    harness.emitEvent({
      type: 'productionCanvasChanged',
      production: productionFixture({ canvas: canvasDto('portrait', 'p720') }),
      scenes: [sceneFixture('scn_a', 'Welcome', 0)],
    });
    await harness.settle();

    expect(store.canvas()).toEqual({ width: 720, height: 1280 });
    expect(store.canvasAspect()).toBe('720 / 1280');
    expect(store.production()?.canvas.format).toBe('portrait');
    expect(store.sceneById('scn_a')?.items).toEqual([]);
  });

  it('serves the placeholders of a copied production and names the items that point to them', async () => {
    const k1 = placeholderFixture('K1', 'Stage phone');
    const harness = await startStore(
      hub,
      snapshotFixture({
        placeholders: [k1],
        scenes: [sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_1', k1.sourceId)])],
      }),
    );
    const store = harness.store;
    expect(store.placeholders()).toEqual([k1]);
    expect(store.placeholderOf(k1.sourceId)).toEqual(k1);
    expect(store.placeholderOf('dev_other/camera')).toBeNull();
    expect(store.placeholderOf(null)).toBeNull();
    expect(store.codeOf(k1.sourceId)).toBe('K1');
    expect(store.sourceLabel(k1.sourceId)).toBe('Stage phone');
    expect(store.sourceLabel('dev_other/camera')).toBe('Source missing');
    expect(store.sourceById(k1.sourceId)).toBeNull();
    expect(store.statusOf(k1.sourceId)).toBeUndefined();

    harness.emitEvent({ type: 'placeholderRemoved', placeholderId: k1.id });
    await harness.settle();
    expect(store.placeholders()).toEqual([]);
    expect(store.codeOf(k1.sourceId)).toBeUndefined();
    expect(store.sourceLabel(k1.sourceId)).toBe('Source missing');
  });

  it('knows whether a scene shows a source, as an item or as a fallback', async () => {
    const harness = await startStore(
      hub,
      snapshotFixture({
        scenes: [
          sceneFixture('scn_a', 'Welcome', 0, [
            itemFixture('itm_1', 'dev_aaaaaaaaaaaaaaaa/camera', {
              onLost: { holdMs: 0, fallbackSource: 'ast_fallback' },
            }),
          ]),
          sceneFixture('scn_b', 'Break', 1),
        ],
      }),
    );
    const store = harness.store;
    expect(store.isSourceUsed('dev_aaaaaaaaaaaaaaaa/camera')).toBe(true);
    expect(store.isSourceUsed('ast_fallback')).toBe(true);
    expect(store.isSourceUsed('dev_bbbbbbbbbbbbbbbb/screen-1')).toBe(false);
  });

  it('knows 1920 × 1080 before the first snapshot', () => {
    expect(TestBed.inject(ProductionStoreService).canvas()).toEqual({ width: 1920, height: 1080 });
  });

  it('applies live events and reports program switches', async () => {
    const harness = await startStore(hub);
    const { store } = harness;
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 500 },
      at: new Date().toISOString(),
    });
    expect(store.state()?.revision).toBe(101);
    expect(store.programSceneId()).toBe('scn_b');
    expect(store.programSwitch()).toMatchObject({
      seq: 1,
      programSceneId: 'scn_b',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 500 },
    });
    expect(store.tallyOf('dev_bbbbbbbbbbbbbbbb/screen-1')).toBe('program');

    // A preview-only change is not a program switch.
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: 'scn_c',
      previousProgramSceneId: 'scn_b',
      transition: { kind: 'cut', durationMs: 0 },
      at: new Date().toISOString(),
    });
    expect(store.previewSceneId()).toBe('scn_c');
    expect(store.programSwitch()?.seq).toBe(1);
  });

  it('ignores duplicates and resubscribes from the local revision on a gap', async () => {
    const harness = await startStore(hub);
    const { store } = harness;
    const renamed = sceneFixture('scn_c', 'Kurze Pause', 2, [], { version: 2 });
    hub.subscribe = () =>
      Promise.resolve(
        deltaChanges(102, [
          { type: 'sceneUpserted', scene: renamed, revision: 101 },
          { type: 'logAppended', entry: logFixture('später'), revision: 102 },
        ]),
      );
    harness.emitEvent({ type: 'logAppended', entry: logFixture('alt'), revision: 100 });
    expect(store.state()?.revision).toBe(100);
    harness.emitEvent({ type: 'logAppended', entry: logFixture('später'), revision: 102 });
    await flushMicrotasks();
    expect(hub.subscribeCalls).toHaveLength(2);
    expect(hub.subscribeCalls[1]).toEqual({ productionId: PRODUCTION_ID, since: 100 });
    expect(store.state()?.revision).toBe(102);
    expect(store.sceneById('scn_c')?.name).toBe('Kurze Pause');
    expect(store.log()[0].params).toEqual({ scene: 'später' });
  });

  it('follows the active production on resync', async () => {
    const harness = await startStore(hub);
    const other = snapshotFixture({
      revision: 5,
      production: { ...snapshotFixture().production, id: 'prd_bbbbbbbbbbbbbbbb', name: 'Workshop' },
    });
    hub.subscribe = (productionId) =>
      productionId === 'prd_bbbbbbbbbbbbbbbb'
        ? Promise.resolve(snapshotChanges(other))
        : Promise.reject(new Error('wrong production'));
    hub.emit(HUB.resync, 'prd_bbbbbbbbbbbbbbbb');
    await flushMicrotasks();
    expect(hub.subscribeCalls.at(-1)).toEqual({
      productionId: 'prd_bbbbbbbbbbbbbbbb',
      since: null,
    });
    expect(harness.store.productionId()).toBe('prd_bbbbbbbbbbbbbbbb');
    expect(harness.store.production()?.name).toBe('Workshop');
  });

  it('asks for the active production again when Subscribe answers not_found', async () => {
    const harness = await startStore(hub);
    const other = snapshotFixture({
      revision: 5,
      production: { ...snapshotFixture().production, id: 'prd_bbbbbbbbbbbbbbbb', name: 'Workshop' },
    });
    hub.subscribe = (productionId) =>
      productionId === 'prd_bbbbbbbbbbbbbbbb'
        ? Promise.resolve(snapshotChanges(other))
        : Promise.reject(
            new Error(
              "An unexpected error occurred invoking 'Subscribe' on the server. HubException: not_found: The production does not exist.",
            ),
          );

    hub.drop();
    hub.connect();
    await flushMicrotasks();
    harness.http.expectOne('/api/productions/active').flush({
      id: 'prd_bbbbbbbbbbbbbbbb',
      name: 'Workshop',
      slug: 'workshop',
      isActive: true,
      createdAt: '2026-10-22T08:00:00.000Z',
    });
    await flushMicrotasks();

    expect(hub.subscribeCalls.at(-1)).toEqual({
      productionId: 'prd_bbbbbbbbbbbbbbbb',
      since: null,
    });
    expect(harness.store.productionId()).toBe('prd_bbbbbbbbbbbbbbbb');
    expect(harness.store.production()?.name).toBe('Workshop');
    expect(harness.store.status()).toBe('live');
  });

  it('says so when no production is active after a not_found', async () => {
    const harness = await startStore(hub);
    hub.subscribe = () => Promise.reject(new Error('HubException: not_found: weg'));

    hub.drop();
    hub.connect();
    await flushMicrotasks();
    harness.http
      .expectOne('/api/productions/active')
      .flush({ code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await flushMicrotasks();

    expect(tm(harness.store.discoveryError())).toBe('No active production found.');
    harness.store.stop();
  });

  it('retries a Subscribe refused with service_unavailable calmly, without asking for the production', async () => {
    const harness = await startStore(hub);
    vi.useFakeTimers();
    try {
      let refusals = 2;
      hub.subscribe = () =>
        refusals-- > 0
          ? Promise.reject(
              new Error(
                "An unexpected error occurred invoking 'Subscribe' on the server. HubException: service_unavailable: The database is not reachable right now.",
              ),
            )
          : Promise.resolve(snapshotChanges(snapshotFixture()));

      hub.drop();
      hub.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.store.status()).toBe('syncing');
      await vi.advanceTimersByTimeAsync(5000);

      expect(hub.subscribeCalls).toHaveLength(4);
      harness.http.expectNone('/api/productions/active');
      expect(harness.store.status()).toBe('live');
      expect(harness.store.discoveryError()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies presence and telemetry without a revision', async () => {
    const { store } = await startStore(hub);
    hub.emit(HUB.presence, 2);
    expect(store.operatorsOnline()).toBe(2);
    hub.emit(HUB.telemetry, {
      deviceId: 'dev_aaaaaaaaaaaaaaaa',
      telemetry: {
        at: new Date().toISOString(),
        rtc: 'connected',
        batteryPct: 14,
        charging: false,
        network: 'wifi',
        rttMs: 31,
        slots: [],
      },
    });
    expect(store.deviceById('dev_aaaaaaaaaaaaaaaa')?.telemetry?.batteryPct).toBe(14);
    expect(store.state()?.revision).toBe(100);
  });

  it('keeps the state while offline and blocks commands', async () => {
    const { store } = await startStore(hub);
    hub.drop();
    await flushMicrotasks();
    expect(store.status()).toBe('offline');
    expect(store.canCommand()).toBe(false);
    expect(store.scenes().length).toBe(3);
  });

  it('sends the operator to the login when the hub refuses the session', async () => {
    const auth = TestBed.inject(AuthService);
    const handle = vi.spyOn(auth, 'handleUnauthorized').mockImplementation(() => undefined);
    await startStore(hub);
    hub.setState('unauthorized');
    expect(handle).toHaveBeenCalled();
  });

  it('stops on sign-out and forgets the state', async () => {
    const { store } = await startStore(hub);
    store.stop();
    expect(hub.stopCalls).toBe(1);
    expect(store.state()).toBeNull();
    expect(store.productionId()).toBeNull();
  });

  it('retries discovery and reports a missing production', async () => {
    vi.useFakeTimers();
    try {
      const store = TestBed.inject(ProductionStoreService);
      const controller = TestBed.inject(HttpTestingController);
      store.start();
      controller
        .expectOne('/api/productions/active')
        .flush({ code: 'not_found' }, { status: 404, statusText: 'Not Found' });
      await vi.advanceTimersByTimeAsync(0);
      expect(tm(store.discoveryError())).toBe('No active production found.');
      await vi.advanceTimersByTimeAsync(1100);
      controller.expectOne('/api/productions/active');
      store.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sorts incidents like the prototype', () => {
    const sorted = sortIncidents([
      incidentFixture('inc_1', 's1', 'K1', {
        kind: 'reconnecting',
        startedAt: '2026-10-22T10:00:00Z',
      }),
      incidentFixture('inc_2', 's2', 'S1', { kind: 'ended', startedAt: '2026-10-22T10:00:05Z' }),
      incidentFixture('inc_3', 's3', 'K2', {
        kind: 'lost',
        startedAt: '2026-10-22T09:00:00Z',
        endedAt: '2026-10-22T09:00:09Z',
      }),
      incidentFixture('inc_4', 's4', 'K3', { kind: 'lost', startedAt: '2026-10-22T09:59:00Z' }),
    ]);
    expect(sorted.map((incident) => incident.id)).toEqual(['inc_4', 'inc_2', 'inc_1', 'inc_3']);
  });
});

describe('ProductionStoreService test hook (spec 12)', () => {
  const view = window as unknown as { __sfStudio?: StudioTestHook };

  afterEach(() => TestBed.resetTestingModule());

  function configure(flag: string | null): FakeStudioHub {
    const hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (flag !== null) {
      storage.setItem(TEST_HOOKS_FLAG, flag);
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    return hub;
  }

  it('exposes a read-only window.__sfStudio with the opt-in flag', async () => {
    const hub = configure('1');
    const harness = await startStore(hub);
    const hook = view.__sfStudio!;

    expect(hook.revision).toBe(100);
    expect(hook.lastSync).toBe('snapshot');
    expect(hook.hub).toBe('connected');

    hub.subscribe = () =>
      Promise.resolve(
        deltaChanges(102, [
          { type: 'logAppended', entry: logFixture('eins'), revision: 101 },
          { type: 'logAppended', entry: logFixture('zwei'), revision: 102 },
        ]),
      );
    harness.emitEvent({ type: 'logAppended', entry: logFixture('zwei'), revision: 102 });
    await flushMicrotasks();
    expect(hook.lastSync).toBe('delta');
    expect(hook.revision).toBe(102);

    hub.setState('reconnecting');
    expect(hook.hub).toBe('reconnecting');
    expect(Object.isFrozen(hook)).toBe(true);
    expect(Object.keys(window)).not.toContain('__sfStudio');
    expect(() => {
      (view as { __sfStudio: unknown }).__sfStudio = {};
    }).toThrow(TypeError);
    expect(() => {
      (hook as { revision: number | null }).revision = 1;
    }).toThrow(TypeError);
    expect(view.__sfStudio).toBe(hook);

    TestBed.resetTestingModule();
    expect('__sfStudio' in window).toBe(false);
  });

  it.each([null, '0', 'true', ' 1'])(
    'has no window.__sfStudio without the opt-in flag (%s)',
    async (flag) => {
      const hub = configure(flag);
      await startStore(hub);

      expect('__sfStudio' in window).toBe(false);
    },
  );
});
