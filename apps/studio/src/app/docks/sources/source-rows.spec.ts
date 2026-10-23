import type { SourceDto } from '@studioflow/scene-model';
import {
  itemFixture,
  productionFixture,
  sceneFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import {
  addableSourceGroups,
  assetUsage,
  kindOfReference,
  sourceRows,
  usageSentence,
} from './source-rows';

const K1 = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Handy Bühne links' });
const K2 = sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', {
  label: 'Handy Bühne rechts',
  status: 'reconnecting',
  statusSince: '2026-10-22T10:00:00.000Z',
});
const K3 = sourceFixture('dev_dddddddddddddddd', 'camera', 'K10', { status: 'blocked' });
const S1 = sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', {
  label: 'Laptop Lea · Folien',
});
const M1: SourceDto = {
  id: 'ast_aaaaaaaaaaaaaaaa',
  code: 'M1',
  kind: 'image',
  label: 'Titelfolie',
  deviceId: null,
  slot: null,
  assetId: 'ast_aaaaaaaaaaaaaaaa',
  status: 'ok',
  statusSince: null,
};
const sources = new Map([K1, K2, K3, S1, M1].map((source) => [source.id, source]));

describe('source rows', () => {
  it('lists the items front to back with code, state, lamp and selection', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [
      itemFixture('itm_back', S1.id),
      itemFixture('itm_mid', K2.id, { locked: true }),
      itemFixture('itm_front', M1.id, { hidden: true }),
    ]);
    const rows = sourceRows(scene, sources, 'itm_mid');
    expect(rows.map((row) => row.itemId)).toEqual(['itm_front', 'itm_mid', 'itm_back']);
    const [front, middle, back] = rows;
    expect(front).toMatchObject({
      code: 'M1',
      icon: 'image',
      hidden: true,
      lamp: null,
      state: null,
    });
    expect(middle).toMatchObject({
      code: 'K2',
      locked: true,
      selected: true,
      lamp: 'is-warn',
      statusSince: '2026-10-22T10:00:00.000Z',
    });
    expect(middle.state).toEqual({ word: 'verbindet neu', tone: 'warn', timer: true });
    expect(back).toMatchObject({ code: 'S1', icon: 'screen', lamp: '', selected: false });
  });

  it('shows a deleted source as «Quelle fehlt» with the icon of its reference', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [
      itemFixture('itm_1', 'dev_zzzzzzzzzzzzzzzz/screen-2'),
    ]);
    const [row] = sourceRows(scene, sources, null);
    expect(row).toMatchObject({ code: '–', name: 'Quelle fehlt', icon: 'screen', missing: true });
    expect(kindOfReference('ast_zzzzzzzzzzzzzzzz', null)).toBe('image');
  });

  it('offers the sources not in the scene, without blocked ones, grouped and sorted', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [itemFixture('itm_1', K1.id)]);
    const groups = addableSourceGroups(scene, sources);
    expect(groups.map((group) => group.label)).toEqual(['Kameras', 'Screens', 'Medien']);
    expect(groups[0].sources.map((source) => source.code)).toEqual(['K2']);
    expect(groups[2].sources.map((source) => source.code)).toEqual(['M1']);
    const full = sceneFixture('scn_b', 'B', 1, [
      itemFixture('itm_1', K1.id),
      itemFixture('itm_2', K2.id),
      itemFixture('itm_3', S1.id),
      itemFixture('itm_4', M1.id),
    ]);
    expect(addableSourceGroups(full, sources)).toEqual([]);
  });

  it('finds every use of a medium and turns it into a sentence', () => {
    const scenes = [
      sceneFixture('scn_a', 'Pause', 0, [itemFixture('itm_1', M1.id)]),
      sceneFixture('scn_b', 'Intro', 1, [], {
        background: { color: '#000000', assetId: M1.id },
      }),
      sceneFixture('scn_c', 'Gespräch', 2, [
        itemFixture('itm_2', K1.id, { onLost: { holdMs: 3000, fallbackSource: M1.id } }),
      ]),
    ];
    const production = productionFixture({
      standbySlate: { title: 'Gleich', subtitle: null, backgroundAssetId: M1.id },
    });
    const usage = assetUsage(M1.id, scenes, production);
    expect(usage).toEqual([
      'in «Pause»',
      'als Hintergrund von «Intro»',
      'als Ersatzquelle in «Gespräch»',
      'auf dem Slate vor der Sendung',
    ]);
    expect(usageSentence(usage.slice(0, 2))).toBe(
      'Wird in «Pause» und als Hintergrund von «Intro» verwendet.',
    );
    expect(usageSentence(usage)).toContain('(und 1 weitere)');
    expect(usageSentence([])).toBe('Wird noch verwendet.');
    expect(assetUsage('ast_unused', scenes, production)).toEqual([]);
  });
});
