import { itemFixture, sceneFixture } from '../../../testing/fixtures';
import { copyName, moveSceneOrder, nextSceneName, sceneRowView } from './scene-list';

const K1 = 'dev_aaaaaaaaaaaaaaaa/camera';
const S1 = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const codes: Record<string, string> = { [K1]: 'K1', [S1]: 'S1' };

describe('scene list helpers', () => {
  const scene = sceneFixture('scn_b', 'Lea präsentiert', 2, [
    itemFixture('itm_1', S1),
    itemFixture('itm_2', K1),
    itemFixture('itm_3', K1),
    itemFixture('itm_4', 'dev_cccccccccccccccc/camera', { hidden: true }),
  ]);

  it('builds the prototype row: keycap, PGM, codes of visible items and the aria label', () => {
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
    expect(view.ariaLabel).toBe('Lea präsentiert, live im Program');
  });

  it('marks the preview only in Studio-Modus and reports the outage', () => {
    const context = {
      programSceneId: 'scn_a',
      previewSceneId: 'scn_b',
      health: { code: 'K2', bad: false },
      codeOf: (id: string) => codes[id],
    };
    const studio = sceneRowView(scene, 0, { ...context, studioMode: true });
    expect(studio.isPreview).toBe(true);
    expect(studio.pressed).toBe(true);
    expect(studio.ariaLabel).toBe('Lea präsentiert, in der Preview, K2 gestört');
    const direct = sceneRowView(scene, 0, { ...context, studioMode: false });
    expect(direct.isPreview).toBe(false);
    expect(direct.pressed).toBe(false);
  });

  it('has no keycap after the ninth scene and says «leer» without visible items', () => {
    const empty = sceneFixture('scn_x', 'Pause', 9);
    const view = sceneRowView(empty, 9, {
      programSceneId: null,
      previewSceneId: null,
      studioMode: false,
      health: null,
      codeOf: () => undefined,
    });
    expect(view.key).toBeNull();
    expect(view.codes).toBe('leer');
  });

  it('names new scenes after their keycap and skips taken names', () => {
    expect(nextSceneName([])).toBe('Neue Szene 1');
    expect(nextSceneName([{ name: 'A' }, { name: 'B' }])).toBe('Neue Szene 3');
    expect(nextSceneName([{ name: 'A' }, { name: 'Neue Szene 2' }])).toBe('Neue Szene 3');
    expect(nextSceneName([{ name: 'Neue Szene 2' }, { name: 'Neue Szene 3' }])).toBe(
      'Neue Szene 4',
    );
  });

  it('names copies «(Kopie)», «(Kopie 2)» and keeps them within 80 characters', () => {
    expect(copyName('Intro', [{ name: 'Intro' }])).toBe('Intro (Kopie)');
    expect(copyName('Intro', [{ name: 'Intro' }, { name: 'Intro (Kopie)' }])).toBe(
      'Intro (Kopie 2)',
    );
    const long = 'x'.repeat(80);
    const copy = copyName(long, [{ name: long }]);
    expect(copy.length).toBeLessThanOrEqual(80);
    expect(copy.endsWith(' (Kopie)')).toBe(true);
  });

  it('moves a scene one place and refuses at the ends', () => {
    expect(moveSceneOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveSceneOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveSceneOrder(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveSceneOrder(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveSceneOrder(['a'], 'x', 1)).toBeNull();
  });
});
