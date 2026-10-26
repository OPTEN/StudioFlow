import { tm } from '@studioflow/i18n';
import type { SourceDto } from '@studioflow/scene-model';
import {
  itemFixture,
  placeholderFixture,
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

const K1 = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Phone stage left' });
const K2 = sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', {
  label: 'Phone stage right',
  status: 'reconnecting',
  statusSince: '2026-10-22T10:00:00.000Z',
});
const K3 = sourceFixture('dev_dddddddddddddddd', 'camera', 'K10', { status: 'blocked' });
const S1 = sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', {
  label: 'Laptop Lea · Slides',
});
const M1: SourceDto = {
  id: 'ast_aaaaaaaaaaaaaaaa',
  code: 'M1',
  kind: 'image',
  label: 'Title slide',
  deviceId: null,
  slot: null,
  assetId: 'ast_aaaaaaaaaaaaaaaa',
  status: 'ok',
  statusSince: null,
  text: null,
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
    expect(middle.state).toEqual({ word: 'reconnecting', tone: 'warn', timer: true });
    expect(back).toMatchObject({ code: 'S1', icon: 'screen', lamp: '', selected: false });
  });

  it('shows a deleted source as "Source missing" with the icon of its reference', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [
      itemFixture('itm_1', 'dev_zzzzzzzzzzzzzzzz/screen-2'),
    ]);
    const [row] = sourceRows(scene, sources, null);
    expect(row).toMatchObject({ code: '–', name: 'Source missing', icon: 'screen', missing: true });
    expect(kindOfReference('ast_zzzzzzzzzzzzzzzz', null)).toBe('image');
  });

  it('shows an item of a placeholder with the code and name of the original and "Source missing"', () => {
    const named = placeholderFixture('K7', 'Stage phone');
    const removed = placeholderFixture('S3', null);
    const scene = sceneFixture('scn_a', 'A', 0, [
      itemFixture('itm_1', named.sourceId),
      itemFixture('itm_2', removed.sourceId),
      itemFixture('itm_3', K1.id),
    ]);
    const [live, gone, camera] = sourceRows(scene, sources, 'itm_1', [named, removed]).reverse();
    expect(camera).toMatchObject({ code: 'K1', placeholderId: null });
    expect(live).toMatchObject({
      code: 'K7',
      name: 'Stage phone',
      icon: 'camera',
      missing: true,
      selected: true,
      lamp: 'is-idle',
      placeholderId: named.id,
    });
    expect(live.state).toEqual({ word: 'Source missing', tone: 'muted', timer: false });
    expect(gone).toMatchObject({ code: 'S3', name: 'removed source', icon: 'screen' });
    expect(kindOfReference(removed.sourceId, null, removed)).toBe('screen');
  });

  it('keeps a missing source without placeholder as it was', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [
      itemFixture('itm_1', 'dev_zzzzzzzzzzzzzzzz/camera'),
    ]);
    const [row] = sourceRows(scene, sources, null, [placeholderFixture('K7', 'Stage phone')]);
    expect(row).toMatchObject({ code: '–', name: 'Source missing', placeholderId: null });
    expect(row.state).toBeNull();
  });

  it('offers the sources not in the scene, without blocked ones, grouped and sorted', () => {
    const scene = sceneFixture('scn_a', 'A', 0, [itemFixture('itm_1', K1.id)]);
    const groups = addableSourceGroups(scene, sources);
    expect(groups.map((group) => group.label)).toEqual(['Cameras', 'Screens', 'Media']);
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
      sceneFixture('scn_a', 'Break', 0, [itemFixture('itm_1', M1.id)]),
      sceneFixture('scn_b', 'Intro', 1, [], {
        background: { color: '#000000', assetId: M1.id },
      }),
      sceneFixture('scn_c', 'Talk', 2, [
        itemFixture('itm_2', K1.id, { onLost: { holdMs: 3000, fallbackSource: M1.id } }),
      ]),
    ];
    const production = productionFixture({
      standbySlate: { title: 'Soon', subtitle: null, backgroundAssetId: M1.id },
    });
    const usage = assetUsage(M1.id, scenes, production);
    expect(usage.map(tm)).toEqual([
      'in “Break”',
      'as background of “Intro”',
      'as fallback in “Talk”',
      'on the slate before the broadcast',
    ]);
    expect(usageSentence(usage.slice(0, 1))).toBe('Used in “Break”.');
    expect(usageSentence(usage.slice(0, 2))).toBe('Used in “Break” and as background of “Intro”.');
    expect(usageSentence(usage.slice(0, 3))).toBe(
      'Used in “Break”, as background of “Intro” and as fallback in “Talk”.',
    );
    expect(usageSentence(usage)).toContain('(and 1 more)');
    expect(usageSentence([])).toBe('Still in use.');
    expect(assetUsage('ast_unused', scenes, production)).toEqual([]);
  });
});
