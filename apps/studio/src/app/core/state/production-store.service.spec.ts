import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HUB } from '@flowstudio/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  deltaChanges,
  incidentFixture,
  logFixture,
  PRODUCTION_ID,
  sceneFixture,
  snapshotChanges,
  snapshotFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders } from '../../../testing/store-harness';
import { AuthService } from '../auth/auth.service';
import { ProductionStoreService, sortIncidents } from './production-store.service';

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
    expect(store.scenes().map((scene) => scene.name)).toEqual([
      'Begrüssung',
      'Präsentation',
      'Pause',
    ]);
    expect(store.programScene()?.id).toBe('scn_a');
    expect(store.previewScene()).toBeNull();
    expect(store.healthSummary().text).toBe('Alle 2 Stationen ok');
    expect(store.sourceLabel('dev_bbbbbbbbbbbbbbbb/screen-1')).toBe('Laptop Lea · Folien');
    expect(store.sourceLabel('dev_xxxxxxxxxxxxxxxx/camera')).toBe('Quelle fehlt');
    expect(store.tallyOf('dev_aaaaaaaaaaaaaaaa/camera')).toBe('program');
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
    expect(store.log()[0].text).toBe('später');
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
              "An unexpected error occurred invoking 'Subscribe' on the server. HubException: not_found: Die Produktion gibt es nicht.",
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

    expect(harness.store.discoveryError()).toBe('Keine aktive Produktion gefunden.');
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
                "An unexpected error occurred invoking 'Subscribe' on the server. HubException: service_unavailable: Die Datenbank ist gerade nicht erreichbar.",
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
      expect(store.discoveryError()).toBe('Keine aktive Produktion gefunden.');
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
