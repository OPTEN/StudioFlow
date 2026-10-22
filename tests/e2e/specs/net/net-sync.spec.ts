import { stateFromSnapshot } from '../../../../packages/scene-model/src/production-state';
import { THRESHOLD } from '../../support/constants';
import { expect, test } from '../../support/fixtures';
import { SyncClient, comparableState } from '../../support/sync-client';
import { t } from '../../support/tags';

/**
 * NET - reconnect with delta and with snapshot (E2E-NET-14 a/b at hub level): a Regie that was away for a short
 * time receives the missed events, one that was away for more than the ring buffer (500 events) a snapshot.
 */

test.describe('NET reconnect', () => {
  test('E2E-NET-14 [api] (a) a Regie offline for a few seconds resubscribes with its revision and receives a delta', t.smoke, async ({ config, api, production, onCleanup }) => {
    const a = await SyncClient.connect(config.baseURL, api.cookie, production.id);
    onCleanup(() => a.stop());
    await a.goOffline();
    const lastKnown = a.revision;
    // Regie B makes 10 changes while A is away.
    for (let index = 0; index < 10; index++) expect((await api.updateScene(production.id, production.sceneIds[index % 3]!, { name: `Delta ${index}` })).status).toBe(200);
    const took = await a.goOnline();
    const answer = a.subscribeAnswers.at(-1)!;
    expect(answer.since, 'Subscribe is called with the last revision').toBe(lastKnown);
    expect(answer.kind, 'a short gap is answered with events, not a snapshot').toBe('delta');
    expect(answer.events).toBe(10);
    expect(a.lastSync).toBe('delta');
    expect(took, 'T-SYNC-DELTA').toBeLessThanOrEqual(THRESHOLD.syncDeltaHardMs);
    const rest = (await api.getSnapshot(production.id)).body;
    expect(a.revision).toBe(rest.revision);
    expect(comparableState(a.state!)).toEqual(comparableState(stateFromSnapshot(rest)));
  });

  test('E2E-NET-14 [api] (b) a Regie that missed more than 500 events gets a snapshot and converges within T-SYNC-DELTA (snapshot)', t.p0, async ({ config, api, production, onCleanup }) => {
    test.setTimeout(120_000);
    const a = await SyncClient.connect(config.baseURL, api.cookie, production.id);
    onCleanup(() => a.stop());
    await a.goOffline();
    for (let index = 0; index < 520; index += 10) {
      await Promise.all(Array.from({ length: 10 }, (_, k) => api.updateScene(production.id, production.sceneIds[(index + k) % 3]!, { name: `Snapshot ${index + k}` })));
    }
    const took = await a.goOnline();
    const answer = a.subscribeAnswers.at(-1)!;
    expect(answer.kind, '501+ events behind: snapshot').toBe('snapshot');
    expect(a.lastSync).toBe('snapshot');
    expect(took, 'T-SYNC-DELTA snapshot').toBeLessThanOrEqual(THRESHOLD.syncSnapshotHardMs);
    const rest = (await api.getSnapshot(production.id)).body;
    expect(a.revision).toBe(rest.revision);
    expect(comparableState(a.state!)).toEqual(comparableState(stateFromSnapshot(rest)));
  });

  test('E2E-NET-14 [api] a client that reconnects with a revision from the future (API restarted) is given a snapshot', t.p1, async ({ config, api, production, onCleanup }) => {
    const a = await SyncClient.connect(config.baseURL, api.cookie, production.id);
    onCleanup(() => a.stop());
    const future = a.revision + 5_000_000_000;
    const changes = await a.hub.subscribe(production.id, future);
    expect(changes.snapshot, 'an unknown future revision is answered with a snapshot').not.toBeNull();
    expect(changes.events).toBeNull();
  });
});
