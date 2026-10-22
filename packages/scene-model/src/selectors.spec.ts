import type { DeviceDto, SourceStatus } from './contracts';
import { stateFromSnapshot, type ProductionState } from './production-state';
import {
  assetForSource,
  compareCodes,
  deviceSources,
  deviceTally,
  healthSummary,
  incidentPlace,
  isDown,
  isSourceVisibleIn,
  previewScene,
  programScene,
  sceneById,
  sceneHealth,
  sourceLabel,
  sourcesInScene,
  stationOrder,
  tallyOf,
} from './selectors';
import {
  assetFixture,
  assetSourceFixture,
  deviceFixture,
  deviceSourceFixture,
  incidentFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from './testing/fixtures';

const K1 = 'dev_k1aaaa/camera';
const K2 = 'dev_k2aaaa/camera';
const S1 = 'dev_laptop/screen-1';
const S2 = 'dev_laptop/screen-2';
const M1 = 'ast_m1aaaa';

function studioState(
  overrides: { previewSceneId?: string | null; broadcast?: 'standby' | 'live' | 'ended' } = {},
): ProductionState {
  return stateFromSnapshot(
    snapshotFixture({
      production: productionFixture({
        programSceneId: 'scn_pgm',
        previewSceneId:
          overrides.previewSceneId === undefined ? 'scn_pvw' : overrides.previewSceneId,
        broadcast: overrides.broadcast ?? 'live',
      }),
      scenes: [
        sceneFixture('scn_pgm', 0, [
          itemFixture('itm_1', S1),
          itemFixture('itm_2', K1),
          itemFixture('itm_3', K2, { hidden: true }),
        ]),
        sceneFixture('scn_pvw', 1, [itemFixture('itm_4', K2), itemFixture('itm_5', M1)]),
        sceneFixture('scn_other', 2, [itemFixture('itm_6', S2)]),
      ],
      sources: [
        deviceSourceFixture('dev_k1aaaa', 'camera', 'K1'),
        deviceSourceFixture('dev_k2aaaa', 'camera', 'K2'),
        deviceSourceFixture('dev_laptop', 'screen-1', 'S1'),
        deviceSourceFixture('dev_laptop', 'screen-2', 'S2'),
        assetSourceFixture(M1, 'M1'),
      ],
      devices: [
        deviceFixture('dev_k1aaaa', 'Handy Bühne links'),
        deviceFixture('dev_k2aaaa', 'Handy Bühne rechts'),
        deviceFixture('dev_laptop', 'Laptop Lea', { kind: 'laptop' }),
      ],
      assets: [assetFixture(M1, 'M1')],
    }),
  );
}

function withSources(
  state: ProductionState,
  statuses: Record<string, SourceStatus>,
): ProductionState {
  const sources = new Map(state.sources);
  for (const [id, status] of Object.entries(statuses)) {
    const source = sources.get(id);
    if (source) {
      sources.set(id, { ...source, status });
    }
  }
  return { ...state, sources };
}

describe('scene lookups', () => {
  it('finds program, preview and scenes by id', () => {
    const state = studioState();
    expect(programScene(state)?.id).toBe('scn_pgm');
    expect(previewScene(state)?.id).toBe('scn_pvw');
    expect(sceneById(state, 'scn_other')?.id).toBe('scn_other');
  });

  it('returns null for null, undefined and unknown ids', () => {
    const state = studioState({ previewSceneId: null });
    expect(previewScene(state)).toBeNull();
    expect(sceneById(state, undefined)).toBeNull();
    expect(sceneById(state, 'scn_gone')).toBeNull();
  });
});

describe('sourcesInScene / isSourceVisibleIn', () => {
  it('lists visible sources once in z-order', () => {
    const scene = sceneFixture('scn', 0, [
      itemFixture('a', K2),
      itemFixture('b', K1, { hidden: true }),
      itemFixture('c', S1),
      itemFixture('d', K2),
    ]);
    expect(sourcesInScene(scene)).toEqual([K2, S1]);
    expect(isSourceVisibleIn(scene, K2)).toBe(true);
    expect(isSourceVisibleIn(scene, K1)).toBe(false);
  });

  it('handles missing and empty scenes', () => {
    expect(sourcesInScene(null)).toEqual([]);
    expect(sourcesInScene(sceneFixture('scn', 0))).toEqual([]);
    expect(isSourceVisibleIn(undefined, K1)).toBe(false);
  });
});

describe('isDown', () => {
  it.each([
    ['reconnecting', true],
    ['ended', true],
    ['lost', true],
    ['blocked', true],
    ['ok', false],
    ['connecting', false],
    ['offline', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(isDown(status)).toBe(expected);
  });
});

describe('sceneHealth', () => {
  it('is null when every visible source is fine', () => {
    const state = studioState();
    expect(sceneHealth(state.scenes[0], state.sources)).toBeNull();
  });

  it('reports an amber outage as not bad', () => {
    const state = withSources(studioState(), { [K1]: 'reconnecting' });
    expect(sceneHealth(state.scenes[0], state.sources)).toEqual({ code: 'K1', bad: false });
  });

  it('prefers the first red outage over an earlier amber one', () => {
    const state = withSources(studioState(), { [S1]: 'reconnecting', [K1]: 'ended' });
    expect(sceneHealth(state.scenes[0], state.sources)).toEqual({ code: 'K1', bad: true });
  });

  it('keeps the first red outage', () => {
    const state = withSources(studioState(), { [S1]: 'lost', [K1]: 'blocked' });
    expect(sceneHealth(state.scenes[0], state.sources)).toEqual({ code: 'S1', bad: true });
  });

  it('ignores hidden items and deleted sources', () => {
    const state = withSources(studioState(), { [K2]: 'ended' });
    expect(sceneHealth(state.scenes[0], state.sources)).toBeNull();
    const orphan = sceneFixture('scn', 0, [itemFixture('x', 'dev_gone/camera')]);
    expect(sceneHealth(orphan, state.sources)).toBeNull();
  });
});

describe('tallyOf', () => {
  it('reports program before preview', () => {
    const state = studioState();
    expect(tallyOf(state, K1)).toBe('program');
    expect(tallyOf(state, K2)).toBe('preview');
    expect(tallyOf(state, S2)).toBe('off');
  });

  it('ignores the broadcast state (Regie tags)', () => {
    expect(tallyOf(studioState({ broadcast: 'standby' }), K1)).toBe('program');
  });

  it('has no preview without a preview scene', () => {
    expect(tallyOf(studioState({ previewSceneId: null }), K2)).toBe('off');
  });
});

describe('deviceTally', () => {
  it('reports per slot and the highest overall while live', () => {
    expect(deviceTally(studioState(), 'dev_laptop')).toEqual({
      overall: 'program',
      slots: { 'screen-1': 'program', 'screen-2': 'off' },
    });
    expect(deviceTally(studioState(), 'dev_k2aaaa')).toEqual({
      overall: 'preview',
      slots: { camera: 'preview' },
    });
  });

  it.each(['standby', 'ended'] as const)('is off everywhere during %s', (broadcast) => {
    expect(deviceTally(studioState({ broadcast }), 'dev_laptop')).toEqual({
      overall: 'off',
      slots: { 'screen-1': 'off', 'screen-2': 'off' },
    });
  });

  it('is off without slots for an unknown device', () => {
    expect(deviceTally(studioState(), 'dev_unknown')).toEqual({ overall: 'off', slots: {} });
  });
});

describe('incidentPlace', () => {
  it('names where the source is on air', () => {
    const state = studioState();
    expect(incidentPlace(state, K1)).toBe('im Program');
    expect(incidentPlace(state, K2)).toBe('in der Preview');
    expect(incidentPlace(state, S2)).toBe('nicht live');
    expect(incidentPlace(state, 'dev_gone/camera')).toBe('nicht live');
  });
});

describe('compareCodes', () => {
  it('orders codes naturally', () => {
    expect(['S1', 'K10', 'M1', 'K2', 'K1'].sort(compareCodes)).toEqual([
      'K1',
      'K2',
      'K10',
      'M1',
      'S1',
    ]);
  });
});

describe('deviceSources', () => {
  it('lists the sources of a device by code', () => {
    const state = studioState();
    expect(deviceSources(state, 'dev_laptop').map((source) => source.code)).toEqual(['S1', 'S2']);
    expect(deviceSources(state, 'dev_unknown')).toEqual([]);
  });
});

describe('stationOrder', () => {
  function order(
    state: ProductionState,
    devices: DeviceDto[] = [...state.devices.values()],
  ): string[] {
    return [...devices].sort(stationOrder(state)).map((device) => device.id);
  }

  it('without incidents: program before preview before the rest', () => {
    const state = studioState();
    const extra = deviceFixture('dev_idle', 'Ohne Bild');
    const sources = new Map(state.sources).set(
      'dev_idle/camera',
      deviceSourceFixture('dev_idle', 'camera', 'K3'),
    );
    const withIdle = { ...state, sources, devices: new Map(state.devices).set('dev_idle', extra) };
    expect(order(withIdle)).toEqual(['dev_k1aaaa', 'dev_laptop', 'dev_k2aaaa', 'dev_idle']);
  });

  it('puts open red incidents first, then amber, recovered and connecting', () => {
    const base = withSources(studioState(), { [K2]: 'connecting' });
    const state: ProductionState = {
      ...base,
      incidents: [
        incidentFixture('inc_1', K1, 'K1', 'reconnecting'),
        incidentFixture('inc_2', S2, 'S2', 'ended'),
      ],
    };
    expect(order(state)).toEqual(['dev_laptop', 'dev_k1aaaa', 'dev_k2aaaa']);
    const recovered: ProductionState = {
      ...base,
      incidents: [incidentFixture('inc_1', K1, 'K1', 'reconnecting', '2026-10-22T10:00:09Z')],
    };
    expect(order(recovered)).toEqual(['dev_k1aaaa', 'dev_k2aaaa', 'dev_laptop']);
  });

  it('an open incident of the same source outranks a recovered one', () => {
    const state: ProductionState = {
      ...studioState(),
      incidents: [
        incidentFixture('inc_old', S2, 'S2', 'reconnecting', '2026-10-22T10:00:09Z'),
        incidentFixture('inc_new', S2, 'S2', 'lost'),
      ],
    };
    expect(order(state)[0]).toBe('dev_laptop');
  });

  it('within a rank sorts by first slot code, devices without slots last, then by name', () => {
    const state = stateFromSnapshot(
      snapshotFixture({
        production: productionFixture({ programSceneId: null }),
        scenes: [],
        sources: [
          deviceSourceFixture('dev_b', 'camera', 'K10'),
          deviceSourceFixture('dev_a', 'camera', 'K2'),
        ],
        devices: [
          deviceFixture('dev_none2', 'Zeta'),
          deviceFixture('dev_b', 'B'),
          deviceFixture('dev_none1', 'Alpha'),
          deviceFixture('dev_a', 'A'),
        ],
      }),
    );
    expect(order(state)).toEqual(['dev_a', 'dev_b', 'dev_none1', 'dev_none2']);
  });

  it('handles an empty device list', () => {
    expect(order(studioState(), [])).toEqual([]);
  });
});

describe('assetForSource / sourceLabel', () => {
  it('finds the asset behind a media source', () => {
    const state = studioState();
    expect(assetForSource(state, M1)?.code).toBe('M1');
    expect(assetForSource(state, K1)).toBeNull();
    expect(assetForSource(state, 'ast_unknown')).toBeNull();
  });

  it('labels deleted sources «Quelle fehlt»', () => {
    const state = studioState();
    expect(sourceLabel(state, K1)).toBe('dev_k1aaaa · camera');
    expect(sourceLabel(state, 'dev_gone/camera')).toBe('Quelle fehlt');
  });
});

describe('healthSummary', () => {
  it('counts the stations that are not blocked when all is well', () => {
    const state = studioState();
    expect(healthSummary(state)).toEqual({ active: 0, bad: false, text: 'Alle 3 Stationen ok' });
    const blocked = new Map(state.devices).set(
      'dev_k2aaaa',
      deviceFixture('dev_k2aaaa', 'x', { state: 'blocked' }),
    );
    expect(healthSummary({ ...state, devices: blocked }).text).toBe('Alle 2 Stationen ok');
  });

  it('uses singular and empty wording', () => {
    const state = studioState();
    expect(
      healthSummary({ ...state, devices: new Map([['dev_a', deviceFixture('dev_a', 'A')]]) }).text,
    ).toBe('1 Station ok');
    expect(healthSummary({ ...state, devices: new Map() }).text).toBe('Keine Stationen');
  });

  it('counts open incidents; recovered ones do not count', () => {
    const state: ProductionState = {
      ...studioState(),
      incidents: [
        incidentFixture('inc_1', K1, 'K1', 'reconnecting'),
        incidentFixture('inc_2', S1, 'S1', 'reconnecting', '2026-10-22T10:00:09Z'),
      ],
    };
    expect(healthSummary(state)).toEqual({ active: 1, bad: false, text: '1 Störung' });
  });

  it('is bad when an open incident is red', () => {
    const state: ProductionState = {
      ...studioState(),
      incidents: [
        incidentFixture('inc_1', K1, 'K1', 'reconnecting'),
        incidentFixture('inc_2', S1, 'S1', 'ended'),
      ],
    };
    expect(healthSummary(state)).toEqual({ active: 2, bad: true, text: '2 Störungen' });
  });
});
