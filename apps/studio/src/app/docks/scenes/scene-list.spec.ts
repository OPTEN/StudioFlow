import { itemFixture, sceneFixture } from '../../../testing/fixtures';
import { copyName, moveSceneOrder, nextSceneName, sceneRowView } from './scene-list';

const K1 = 'dev_aaaaaaaaaaaaaaaa/camera';
const S1 = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const codes: Record<string, string> = { [K1]: 'K1', [S1]: 'S1' };

describe('scene list helpers', () => {
  const scene = sceneFixture('scn_b', 'Lea presents', 2, [
    itemFixture('itm_1', S1),
    itemFixture('itm_2', K1),
    itemFixture('itm_3', K1),
    itemFixture('itm_4', 'dev_cccccccccccccccc/camera', { hidden: true }),
  ]);

  it('builds the row: keycap, Live, codes of visible items, the aria label and no click hint', () => {
    const view = sceneRowView(scene, 2, {
      programSceneId: 'scn_b',
      previewSceneId: null,
      studioMode: false,
      health: null,
      codeOf: (id) => codes[id],
    });
    expect(view.key).toBe('3');
    expect(view.isProgram).toBe(true);
    expect(view.pressed).toBe(true);
    expect(view.codes).toBe('S1 · K1');
    expect(view.ariaLabel).toBe('Lea presents, live on Program');
    expect(view.hint).toBeNull();
  });

  it('marks the preview only in Studio Mode and reports the outage', () => {
    const context = {
      programSceneId: 'scn_a',
      previewSceneId: 'scn_b',
      health: { code: 'K2', bad: false },
      codeOf: (id: string) => codes[id],
    };
    const studio = sceneRowView(scene, 0, { ...context, studioMode: true });
    expect(studio.isPreview).toBe(true);
    expect(studio.pressed).toBe(true);
    expect(studio.ariaLabel).toBe('Lea presents, in Preview, K2 disrupted');
    const direct = sceneRowView(scene, 0, { ...context, studioMode: false });
    expect(direct.isPreview).toBe(false);
    expect(direct.pressed).toBe(false);
    expect(direct.hint).toBe('Click or press 1 to go live');
    expect(
      sceneRowView(scene, 4, { ...context, previewSceneId: 'scn_a', studioMode: true }).hint,
    ).toBe('Click or press 5 to show in Preview');
  });

  it('has no keycap after the ninth scene and says "No sources" without visible items', () => {
    const empty = sceneFixture('scn_x', 'Break', 9);
    const view = sceneRowView(empty, 9, {
      programSceneId: null,
      previewSceneId: null,
      studioMode: false,
      health: null,
      codeOf: () => undefined,
    });
    expect(view.key).toBeNull();
    expect(view.codes).toBe('No sources');
    expect(view.hint).toBe('Click to go live');
  });

  it('names new scenes after their keycap and skips taken names', () => {
    expect(nextSceneName([])).toBe('New scene 1');
    expect(nextSceneName([{ name: 'A' }, { name: 'B' }])).toBe('New scene 3');
    expect(nextSceneName([{ name: 'A' }, { name: 'New scene 2' }])).toBe('New scene 3');
    expect(nextSceneName([{ name: 'New scene 2' }, { name: 'New scene 3' }])).toBe('New scene 4');
  });

  it('names copies "(copy)", "(copy 2)" and keeps them within 80 characters', () => {
    expect(copyName('Intro', [{ name: 'Intro' }])).toBe('Intro (copy)');
    expect(copyName('Intro', [{ name: 'Intro' }, { name: 'Intro (copy)' }])).toBe('Intro (copy 2)');
    const long = 'x'.repeat(80);
    const copy = copyName(long, [{ name: long }]);
    expect(copy.length).toBeLessThanOrEqual(80);
    expect(copy.endsWith(' (copy)')).toBe(true);
  });

  it('moves a scene one place and refuses at the ends', () => {
    expect(moveSceneOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveSceneOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveSceneOrder(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveSceneOrder(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveSceneOrder(['a'], 'x', 1)).toBeNull();
  });
});
