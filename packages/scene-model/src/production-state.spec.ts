import type { OutputChangesDto, ProductionEvent } from './contracts';
import {
  applyChanges,
  applyEvent,
  applyOutputChanges,
  applyPresence,
  applyTelemetry,
  serverNow,
  stateFromOutputSnapshot,
  stateFromSnapshot,
  type ProductionState,
} from './production-state';
import {
  FIXTURE_TIME,
  assetFixture,
  deviceFixture,
  deviceSourceFixture,
  incidentFixture,
  inviteFixture,
  itemFixture,
  outputSnapshotFixture,
  outputStatusFixture,
  pairingRequestFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  telemetryFixture,
} from './testing/fixtures';

const RECEIVED_AT = Date.parse(FIXTURE_TIME) - 1500;

function baseState(): ProductionState {
  return stateFromSnapshot(
    snapshotFixture({
      scenes: [sceneFixture('scn_b', 1), sceneFixture('scn_a', 0), sceneFixture('scn_c', 2)],
      sources: [deviceSourceFixture('dev_k1aaaa', 'camera', 'K1')],
      devices: [deviceFixture('dev_k1aaaa', 'Handy Bühne links')],
      assets: [assetFixture('ast_m1aaaa', 'M1')],
      pairingRequests: [
        pairingRequestFixture('prq_b', '2026-10-22T10:05:00Z'),
        pairingRequestFixture('prq_a', '2026-10-22T10:01:00Z'),
      ],
      invites: [inviteFixture('inv_a')],
      incidents: [incidentFixture('inc_a', 'dev_k1aaaa/camera', 'K1', 'reconnecting')],
      recentLog: [{ at: FIXTURE_TIME, text: 'Szene «A» ist live' }],
    }),
    RECEIVED_AT,
  );
}

describe('stateFromSnapshot', () => {
  it('builds sorted, indexed collections and the server offset', () => {
    const state = baseState();
    expect(state.revision).toBe(100);
    expect(state.serverOffsetMs).toBe(1500);
    expect(state.scenes.map((scene) => scene.id)).toEqual(['scn_a', 'scn_b', 'scn_c']);
    expect(state.sources.get('dev_k1aaaa/camera')?.code).toBe('K1');
    expect(state.devices.get('dev_k1aaaa')?.name).toBe('Handy Bühne links');
    expect(state.assets.get('ast_m1aaaa')?.code).toBe('M1');
    expect(state.pairingRequests.map((request) => request.id)).toEqual(['prq_a', 'prq_b']);
    expect(state.invites).toHaveLength(1);
    expect(state.incidents).toHaveLength(1);
    expect(state.outputStatus?.state).toBe('none');
    expect(state.log).toHaveLength(1);
    expect(state.operatorsOnline).toBe(1);
  });

  it('breaks sortOrder ties by id and caps the log at 20 entries', () => {
    const log = Array.from({ length: 25 }, (_, index) => ({
      at: FIXTURE_TIME,
      text: `Eintrag ${index}`,
    }));
    const state = stateFromSnapshot(
      snapshotFixture({
        scenes: [sceneFixture('scn_z', 0), sceneFixture('scn_m', 0)],
        recentLog: log,
      }),
    );
    expect(state.scenes.map((scene) => scene.id)).toEqual(['scn_m', 'scn_z']);
    expect(state.log).toHaveLength(20);
    expect(state.log[0].text).toBe('Eintrag 0');
  });

  it('uses offset 0 for an unparsable server time', () => {
    expect(stateFromSnapshot(snapshotFixture({ serverTime: 'kaputt' }), 5).serverOffsetMs).toBe(0);
  });

  it('does not share arrays with the snapshot', () => {
    const snapshot = snapshotFixture();
    const state = stateFromSnapshot(snapshot);
    expect(state.scenes).not.toBe(snapshot.scenes);
  });
});

describe('stateFromOutputSnapshot', () => {
  it('leaves everything the output must not see empty', () => {
    const state = stateFromOutputSnapshot(
      outputSnapshotFixture({ sources: [deviceSourceFixture('dev_k1aaaa', 'camera', 'K1')] }),
      RECEIVED_AT,
    );
    expect(state.revision).toBe(100);
    expect(state.serverOffsetMs).toBe(1500);
    expect(state.sources.size).toBe(1);
    expect(state.devices.size).toBe(0);
    expect(state.pairingRequests).toEqual([]);
    expect(state.invites).toEqual([]);
    expect(state.incidents).toEqual([]);
    expect(state.log).toEqual([]);
    expect(state.outputStatus).toBeNull();
    expect(state.operatorsOnline).toBe(0);
  });
});

describe('applyEvent revision rules', () => {
  const event: ProductionEvent = { type: 'revisionOnly', revision: 101 };

  it('applies the next revision', () => {
    const state = baseState();
    const { state: next, result } = applyEvent(state, event);
    expect(result).toBe('applied');
    expect(next.revision).toBe(101);
    expect(next).not.toBe(state);
  });

  it('ignores equal and older revisions and returns the same state', () => {
    const state = baseState();
    expect(applyEvent(state, { ...event, revision: 100 })).toEqual({ state, result: 'ignored' });
    expect(applyEvent(state, { ...event, revision: 3 }).state).toBe(state);
  });

  it('reports a gap for revisions beyond the next one and returns the same state', () => {
    const state = baseState();
    const application = applyEvent(state, { ...event, revision: 102 });
    expect(application.result).toBe('gap');
    expect(application.state).toBe(state);
  });

  it('ignores a duplicate after applying it once', () => {
    const once = applyEvent(baseState(), event).state;
    expect(applyEvent(once, event).result).toBe('ignored');
  });
});

/** An event without its revision (distributes over the union, so every member keeps its own fields). */
type EventBody<E = ProductionEvent> = E extends ProductionEvent ? Omit<E, 'revision'> : never;

/** Applies an event at the next revision and asserts that it was applied. */
function apply(state: ProductionState, event: EventBody): ProductionState {
  const application = applyEvent(state, {
    ...event,
    revision: state.revision + 1,
  } as ProductionEvent);
  expect(application.result).toBe('applied');
  expect(application.state.revision).toBe(state.revision + 1);
  return application.state;
}

describe('applyEvent per event type', () => {
  it('productionChanged replaces the production', () => {
    const production = productionFixture({ name: 'Neu', broadcast: 'live' });
    expect(apply(baseState(), { type: 'productionChanged', production }).production).toBe(
      production,
    );
  });

  it('programSwitched updates program, preview, transition and switch time', () => {
    const next = apply(baseState(), {
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: 'scn_a',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 500 },
      at: '2026-10-22T10:01:00Z',
    });
    expect(next.production.programSceneId).toBe('scn_b');
    expect(next.production.previewSceneId).toBe('scn_a');
    expect(next.production.lastTransition).toEqual({ kind: 'fade', durationMs: 500 });
    expect(next.production.lastSwitchAt).toBe('2026-10-22T10:01:00Z');
  });

  it('programSwitched for a preview-only change keeps the last program transition', () => {
    const state = baseState();
    const next = apply(state, {
      type: 'programSwitched',
      programSceneId: 'scn_a',
      previewSceneId: 'scn_c',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: '2026-10-22T10:02:00Z',
    });
    expect(next.production.previewSceneId).toBe('scn_c');
    expect(next.production.lastTransition).toBe(state.production.lastTransition);
    expect(next.production.lastSwitchAt).toBe(state.production.lastSwitchAt);
  });

  it('sceneUpserted inserts a new scene in sort order', () => {
    const next = apply(baseState(), { type: 'sceneUpserted', scene: sceneFixture('scn_new', 1) });
    expect(next.scenes.map((scene) => scene.id)).toEqual(['scn_a', 'scn_b', 'scn_new', 'scn_c']);
  });

  it('sceneUpserted replaces an existing scene and resorts it', () => {
    const updated = sceneFixture('scn_a', 5, [itemFixture('itm_1', 'dev_k1aaaa/camera')], {
      version: 2,
    });
    const next = apply(baseState(), { type: 'sceneUpserted', scene: updated });
    expect(next.scenes.map((scene) => scene.id)).toEqual(['scn_b', 'scn_c', 'scn_a']);
    expect(next.scenes[2]).toBe(updated);
  });

  it('sceneRemoved removes the scene; an unknown id keeps the list', () => {
    const state = baseState();
    expect(
      apply(state, { type: 'sceneRemoved', sceneId: 'scn_b' }).scenes.map((scene) => scene.id),
    ).toEqual(['scn_a', 'scn_c']);
    expect(apply(state, { type: 'sceneRemoved', sceneId: 'scn_x' }).scenes).toBe(state.scenes);
  });

  it('scenesReordered applies the new order and renumbers sortOrder', () => {
    const next = apply(baseState(), {
      type: 'scenesReordered',
      sceneIds: ['scn_c', 'scn_a', 'scn_b'],
    });
    expect(next.scenes.map((scene) => [scene.id, scene.sortOrder])).toEqual([
      ['scn_c', 0],
      ['scn_a', 1],
      ['scn_b', 2],
    ]);
  });

  it('scenesReordered ignores unknown and duplicate ids and appends unlisted scenes in their order', () => {
    const state = baseState();
    const next = apply(state, { type: 'scenesReordered', sceneIds: ['scn_x', 'scn_c', 'scn_c'] });
    expect(next.scenes.map((scene) => [scene.id, scene.sortOrder])).toEqual([
      ['scn_c', 0],
      ['scn_a', 1],
      ['scn_b', 2],
    ]);
  });

  it('scenesReordered keeps unchanged scene objects', () => {
    const state = baseState();
    const next = apply(state, { type: 'scenesReordered', sceneIds: ['scn_a', 'scn_c', 'scn_b'] });
    expect(next.scenes[0]).toBe(state.scenes[0]);
    expect(next.scenes[1]).not.toBe(state.scenes[2]);
  });

  it('sourceUpserted and sourceRemoved maintain the source map', () => {
    const state = baseState();
    const updated = deviceSourceFixture('dev_k1aaaa', 'camera', 'K1', 'reconnecting');
    const withUpdate = apply(state, { type: 'sourceUpserted', source: updated });
    expect(withUpdate.sources.get(updated.id)).toBe(updated);
    expect(state.sources.get(updated.id)?.status).toBe('ok');
    const removed = apply(withUpdate, { type: 'sourceRemoved', sourceId: updated.id });
    expect(removed.sources.has(updated.id)).toBe(false);
    expect(apply(removed, { type: 'sourceRemoved', sourceId: 'dev_x/camera' }).sources).toBe(
      removed.sources,
    );
  });

  it('deviceUpserted replaces the whole device and deviceRemoved removes it', () => {
    const state = applyTelemetry(baseState(), {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture(FIXTURE_TIME),
    });
    const replacement = deviceFixture('dev_k1aaaa', 'Umbenannt');
    const next = apply(state, { type: 'deviceUpserted', device: replacement });
    expect(next.devices.get('dev_k1aaaa')).toBe(replacement);
    expect(next.devices.get('dev_k1aaaa')?.telemetry).toBeNull();
    expect(apply(next, { type: 'deviceRemoved', deviceId: 'dev_k1aaaa' }).devices.size).toBe(0);
  });

  it('assetUpserted and assetRemoved maintain the asset map', () => {
    const asset = assetFixture('ast_m2aaaa', 'M2');
    const next = apply(baseState(), { type: 'assetUpserted', asset });
    expect(next.assets.get('ast_m2aaaa')).toBe(asset);
    expect(
      apply(next, { type: 'assetRemoved', assetId: 'ast_m1aaaa' }).assets.has('ast_m1aaaa'),
    ).toBe(false);
  });

  it('pairingRequestUpserted keeps oldest first and pairingRequestRemoved removes the request', () => {
    const next = apply(baseState(), {
      type: 'pairingRequestUpserted',
      request: pairingRequestFixture('prq_0', '2026-10-22T09:59:00Z'),
    });
    expect(next.pairingRequests.map((request) => request.id)).toEqual(['prq_0', 'prq_a', 'prq_b']);
    const removed = apply(next, {
      type: 'pairingRequestRemoved',
      requestId: 'prq_a',
      outcome: 'approved',
    });
    expect(removed.pairingRequests.map((request) => request.id)).toEqual(['prq_0', 'prq_b']);
  });

  it('inviteUpserted replaces in place or appends; inviteRemoved removes', () => {
    const state = baseState();
    const renewed = { ...inviteFixture('inv_a'), url: 'https://studioflow.test/join/i/neu' };
    const replaced = apply(state, { type: 'inviteUpserted', invite: renewed });
    expect(replaced.invites).toEqual([renewed]);
    const appended = apply(replaced, { type: 'inviteUpserted', invite: inviteFixture('inv_b') });
    expect(appended.invites.map((invite) => invite.id)).toEqual(['inv_a', 'inv_b']);
    expect(
      apply(appended, { type: 'inviteRemoved', inviteId: 'inv_a' }).invites.map(
        (invite) => invite.id,
      ),
    ).toEqual(['inv_b']);
  });

  it('incidentUpserted keeps insertion order and incidentRemoved removes', () => {
    const state = baseState();
    const recovered = incidentFixture(
      'inc_a',
      'dev_k1aaaa/camera',
      'K1',
      'reconnecting',
      '2026-10-22T10:00:09Z',
    );
    const updated = apply(state, { type: 'incidentUpserted', incident: recovered });
    expect(updated.incidents).toEqual([recovered]);
    const second = apply(updated, {
      type: 'incidentUpserted',
      incident: incidentFixture('inc_b', 'x', 'S1', 'ended'),
    });
    expect(second.incidents.map((incident) => incident.id)).toEqual(['inc_a', 'inc_b']);
    expect(
      apply(second, { type: 'incidentRemoved', incidentId: 'inc_a' }).incidents.map(
        (incident) => incident.id,
      ),
    ).toEqual(['inc_b']);
  });

  it('outputStatusChanged replaces the output status', () => {
    const status = outputStatusFixture({ state: 'connected', consumers: 1, latencyMs: 180 });
    expect(apply(baseState(), { type: 'outputStatusChanged', status }).outputStatus).toBe(status);
  });

  it('logAppended prepends and keeps at most 20 entries', () => {
    let state = baseState();
    for (let index = 0; index < 25; index += 1) {
      state = apply(state, {
        type: 'logAppended',
        entry: { at: FIXTURE_TIME, text: `Eintrag ${index}` },
      });
    }
    expect(state.log).toHaveLength(20);
    expect(state.log[0].text).toBe('Eintrag 24');
    expect(state.log[19].text).toBe('Eintrag 5');
  });

  it('revisionOnly only advances the revision', () => {
    const state = baseState();
    const next = apply(state, { type: 'revisionOnly' });
    expect({ ...next, revision: state.revision }).toEqual(state);
    expect(next.scenes).toBe(state.scenes);
  });

  it('an unknown event type from a newer server only advances the revision', () => {
    const state = baseState();
    const unknown = { type: 'somethingNew', revision: 101 } as unknown as ProductionEvent;
    const application = applyEvent(state, unknown);
    expect(application.result).toBe('applied');
    expect(application.state.revision).toBe(101);
    expect(application.state.scenes).toBe(state.scenes);
  });

  it('never mutates the input state', () => {
    const state = baseState();
    const frozen = JSON.stringify({
      ...state,
      sources: [...state.sources],
      devices: [...state.devices],
      assets: [...state.assets],
    });
    apply(state, { type: 'sceneRemoved', sceneId: 'scn_a' });
    apply(state, { type: 'sourceRemoved', sourceId: 'dev_k1aaaa/camera' });
    apply(state, { type: 'logAppended', entry: { at: FIXTURE_TIME, text: 'x' } });
    expect(
      JSON.stringify({
        ...state,
        sources: [...state.sources],
        devices: [...state.devices],
        assets: [...state.assets],
      }),
    ).toBe(frozen);
  });
});

describe('applyChanges', () => {
  it('builds the state from a snapshot, ignoring the previous state', () => {
    const snapshot = snapshotFixture({ revision: 500 });
    const { state, result } = applyChanges(
      baseState(),
      { revision: 500, events: null, snapshot },
      RECEIVED_AT,
    );
    expect(result).toBe('snapshot');
    expect(state.revision).toBe(500);
    expect(state.serverOffsetMs).toBe(1500);
  });

  it('a snapshot wins over events in the same answer', () => {
    const snapshot = snapshotFixture({ revision: 200 });
    const { state, result } = applyChanges(null, {
      revision: 200,
      events: [{ type: 'sceneRemoved', sceneId: 'scn_a', revision: 201 }],
      snapshot,
    });
    expect(result).toBe('snapshot');
    expect(state.revision).toBe(200);
    expect(state.scenes).toHaveLength(2);
  });

  it('applies a delta in revision order, skipping covered events', () => {
    const { state, result } = applyChanges(baseState(), {
      revision: 102,
      events: [
        { type: 'sceneRemoved', sceneId: 'scn_c', revision: 102 },
        { type: 'revisionOnly', revision: 100 },
        { type: 'sceneRemoved', sceneId: 'scn_b', revision: 101 },
      ],
      snapshot: null,
    });
    expect(result).toBe('applied');
    expect(state.revision).toBe(102);
    expect(state.scenes.map((scene) => scene.id)).toEqual(['scn_a']);
  });

  it('stops at a gap inside the delta with the state up to the gap', () => {
    const { state, result } = applyChanges(baseState(), {
      revision: 104,
      events: [
        { type: 'sceneRemoved', sceneId: 'scn_b', revision: 101 },
        { type: 'sceneRemoved', sceneId: 'scn_c', revision: 103 },
      ],
      snapshot: null,
    });
    expect(result).toBe('gap');
    expect(state.revision).toBe(101);
    expect(state.scenes.map((scene) => scene.id)).toEqual(['scn_a', 'scn_c']);
  });

  it('reports a gap when the delta ends below the announced revision', () => {
    const { result, state } = applyChanges(baseState(), {
      revision: 103,
      events: [{ type: 'revisionOnly', revision: 101 }],
      snapshot: null,
    });
    expect(result).toBe('gap');
    expect(state.revision).toBe(101);
  });

  it('an empty delta at the current revision is applied without changes', () => {
    const state = baseState();
    const application = applyChanges(state, { revision: 100, events: [], snapshot: null });
    expect(application).toEqual({ state, result: 'applied' });
    expect(applyChanges(state, { revision: 100, events: null, snapshot: null }).state).toBe(state);
  });

  it('throws for a delta without a state (the client must have asked for a snapshot)', () => {
    expect(() => applyChanges(null, { revision: 1, events: [], snapshot: null })).toThrow(
      /snapshot/,
    );
  });
});

describe('applyOutputChanges', () => {
  it('builds the output state from an output snapshot', () => {
    const changes = {
      revision: 100,
      events: null,
      snapshot: outputSnapshotFixture(),
    } as unknown as OutputChangesDto;
    const { state, result } = applyOutputChanges(null, changes, RECEIVED_AT);
    expect(result).toBe('snapshot');
    expect(state.devices.size).toBe(0);
    expect(state.outputStatus).toBeNull();
  });

  it('applies revisionOnly and scene events of an output delta', () => {
    const start = stateFromOutputSnapshot(outputSnapshotFixture());
    const changes = {
      revision: 102,
      events: [
        { type: 'revisionOnly', revision: 101 },
        { type: 'sceneRemoved', sceneId: 'scn_b', revision: 102 },
      ],
      snapshot: null,
    } as unknown as OutputChangesDto;
    const { state, result } = applyOutputChanges(start, changes);
    expect(result).toBe('applied');
    expect(state.revision).toBe(102);
    expect(state.scenes.map((scene) => scene.id)).toEqual(['scn_a']);
  });
});

describe('applyTelemetry', () => {
  it('replaces the telemetry of a known device', () => {
    const telemetry = telemetryFixture('2026-10-22T10:00:02Z', { batteryPct: 42 });
    const next = applyTelemetry(baseState(), { deviceId: 'dev_k1aaaa', telemetry });
    expect(next.devices.get('dev_k1aaaa')?.telemetry).toBe(telemetry);
  });

  it('returns the same state for an unknown device', () => {
    const state = baseState();
    expect(
      applyTelemetry(state, { deviceId: 'dev_unknown', telemetry: telemetryFixture(FIXTURE_TIME) }),
    ).toBe(state);
  });

  it('ignores telemetry older than the one held', () => {
    const newer = applyTelemetry(baseState(), {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture('2026-10-22T10:00:04Z'),
    });
    expect(
      applyTelemetry(newer, {
        deviceId: 'dev_k1aaaa',
        telemetry: telemetryFixture('2026-10-22T10:00:02Z'),
      }),
    ).toBe(newer);
  });

  it('accepts telemetry with an unparsable time instead of blocking updates forever', () => {
    const broken = applyTelemetry(baseState(), {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture('kaputt'),
    });
    const next = applyTelemetry(broken, {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture('2026-10-22T10:00:04Z'),
    });
    expect(next.devices.get('dev_k1aaaa')?.telemetry?.at).toBe('2026-10-22T10:00:04Z');
  });

  it('does not change the revision', () => {
    const next = applyTelemetry(baseState(), {
      deviceId: 'dev_k1aaaa',
      telemetry: telemetryFixture(FIXTURE_TIME),
    });
    expect(next.revision).toBe(100);
  });
});

describe('applyPresence', () => {
  it('sets the operator count', () => {
    expect(applyPresence(baseState(), 2).operatorsOnline).toBe(2);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores the invalid count %s',
    (count) => {
      const state = baseState();
      expect(applyPresence(state, count)).toBe(state);
    },
  );

  it('returns the same state for an unchanged count', () => {
    const state = baseState();
    expect(applyPresence(state, 1)).toBe(state);
  });
});

describe('reducer performance', () => {
  it('applies 5000 events to a full production (99 scenes × 32 items) quickly', () => {
    const items = Array.from({ length: 32 }, (_, index) =>
      itemFixture(`itm_${index}`, `dev_${index}/camera`),
    );
    const scenes = Array.from({ length: 99 }, (_, index) =>
      sceneFixture(`scn_${index}`, index, items),
    );
    let state = stateFromSnapshot(snapshotFixture({ scenes }));
    const started = performance.now();
    for (let index = 0; index < 5000; index += 1) {
      const scene = sceneFixture(`scn_${index % 99}`, (index * 7) % 99, items, { version: index });
      state = applyEvent(state, {
        type: 'sceneUpserted',
        scene,
        revision: state.revision + 1,
      }).state;
    }
    expect(state.revision).toBe(5100);
    expect(state.scenes).toHaveLength(99);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('serverNow', () => {
  it('corrects the local clock by the measured offset', () => {
    expect(serverNow(baseState(), 10_000)).toBe(11_500);
  });

  it('defaults to the current time', () => {
    const before = Date.now();
    const value = serverNow(baseState());
    expect(value).toBeGreaterThanOrEqual(before + 1500);
  });
});
