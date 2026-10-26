import {
  itemFixture,
  placeholderFixture,
  sceneFixture,
  sourceFixture,
  textSourceFixture,
} from '../../../testing/fixtures';
import {
  assignableGroups,
  placeholderName,
  placeholderOffers,
  placeholderRows,
  placeholderUsage,
} from './placeholder-view';

const K1 = placeholderFixture('K1', 'Stage phone');
const K2 = placeholderFixture('K2', null);
const S1 = placeholderFixture('S1', 'Laptop Lea');

describe('placeholderName', () => {
  it('joins code and name, and shows the code alone while the original had no name', () => {
    expect(placeholderName(K1)).toBe('K1 · Stage phone');
    expect(placeholderName(K2)).toBe('K2');
  });
});

describe('placeholderUsage', () => {
  it('counts the scenes and the items that show the placeholder, fallbacks included', () => {
    const scenes = [
      sceneFixture('scn_a', 'A', 0, [
        itemFixture('itm_1', K1.sourceId),
        itemFixture('itm_2', K1.sourceId),
      ]),
      sceneFixture('scn_b', 'B', 1, [
        itemFixture('itm_3', 'dev_other/camera', {
          onLost: { holdMs: 0, fallbackSource: K1.sourceId },
        }),
      ]),
      sceneFixture('scn_c', 'C', 2),
    ];
    expect(placeholderUsage(K1.sourceId, scenes)).toEqual({ scenes: 2, items: 2 });
    expect(placeholderUsage(S1.sourceId, scenes)).toEqual({ scenes: 0, items: 0 });
  });
});

describe('placeholderRows', () => {
  it('sorts by code and says where each is used', () => {
    const scenes = [sceneFixture('scn_a', 'A', 0, [itemFixture('itm_1', K1.sourceId)])];
    const rows = placeholderRows([S1, K2, K1], scenes);
    expect(rows.map((row) => row.code)).toEqual(['K1', 'K2', 'S1']);
    expect(rows[0]).toMatchObject({
      name: 'K1 · Stage phone',
      label: 'Stage phone',
      usedIn: 'in 1 scene',
      kind: 'camera',
    });
    expect(rows[1]).toMatchObject({ label: 'removed source', usedIn: 'in no scene' });
    expect(rows[2].kind).toBe('screen');
  });
});

describe('assignableGroups', () => {
  it('offers cameras, screens and media but no texts and no blocked sources', () => {
    const sources = new Map(
      [
        sourceFixture('dev_a', 'camera', 'K3'),
        sourceFixture('dev_b', 'screen-1', 'S2'),
        sourceFixture('dev_c', 'camera', 'K4', { status: 'blocked' }),
        sourceFixture('dev_d', 'camera', 'K1'),
        textSourceFixture('txt_a', 'T1'),
        { ...sourceFixture('ast_a', 'x', 'M1'), id: 'ast_a', kind: 'image' as const },
      ].map((source) => [source.id, source] as const),
    );
    const groups = assignableGroups(sources);
    expect(groups.map((group) => group.id)).toEqual(['camera', 'screen', 'media']);
    expect(groups[0].sources.map((source) => source.code)).toEqual(['K1', 'K3']);
    expect(groups[2].sources.map((source) => source.code)).toEqual(['M1']);
  });

  it('is empty without sources', () => {
    expect(assignableGroups(new Map())).toEqual([]);
  });
});

describe('placeholderOffers', () => {
  const camera = sourceFixture('dev_new', 'camera', 'K3', { label: 'New phone' });
  const screen = sourceFixture('dev_lap', 'screen-1', 'S2', { label: 'New laptop' });

  it('offers a new source the placeholders of its kind, sorted by code', () => {
    const offers = placeholderOffers([camera, screen], [S1, K2, K1], () => false);
    expect(offers.map((offer) => `${offer.source.code}→${offer.placeholder.code}`)).toEqual([
      'K3→K1',
      'K3→K2',
      'S2→S1',
    ]);
    expect(offers[0].name).toBe('K1 · Stage phone');
  });

  it('offers nothing for a source that a scene uses already, a blocked one or without placeholders', () => {
    expect(placeholderOffers([camera], [K1], (id) => id === camera.id)).toEqual([]);
    expect(placeholderOffers([{ ...camera, status: 'blocked' }], [K1], () => false)).toEqual([]);
    expect(placeholderOffers([camera], [], () => false)).toEqual([]);
    expect(placeholderOffers([camera], [S1], () => false)).toEqual([]);
  });

  it('never offers media or texts', () => {
    const medium = { ...sourceFixture('ast_a', 'x', 'M1'), id: 'ast_a', kind: 'image' as const };
    expect(
      placeholderOffers([medium, textSourceFixture('txt_a', 'T1')], [K1], () => false),
    ).toEqual([]);
  });
});
