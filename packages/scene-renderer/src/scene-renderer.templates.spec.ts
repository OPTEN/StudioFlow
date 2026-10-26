import {
  DEFAULT_CANVAS,
  applyLayoutTemplate,
  layoutTemplate,
  type SceneItemDto,
  type SourceKind,
} from '@studioflow/scene-model';

import {
  CAMERA,
  CAMERA_2,
  mount,
  scene,
  sceneItem,
  SCREEN,
  type Mounted,
} from './testing/fixtures';

/** Kinds of the fixture sources, as the Regie's store would report them. */
const KINDS: Readonly<Record<string, SourceKind>> = {
  [CAMERA]: 'camera',
  [CAMERA_2]: 'camera',
  [SCREEN]: 'screen',
};
const kindOf = (sourceId: string): SourceKind | undefined => KINDS[sourceId];

/**
 * The renderer paints in item order (`z-index` = index, first = back) and `applyLayoutTemplate` orders the items by
 * slot, so a template with overlapping slots (Picture in picture) shows the small picture on top of the full one.
 */
describe('scene renderer: layout templates and z-order', () => {
  let mounted: Mounted;

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
  });

  function zIndex(id: string): number {
    return Number(mounted.item(id)?.style.zIndex);
  }

  function showTemplate(items: SceneItemDto[]): void {
    mounted.renderer.show(scene('scn_a', items));
    const applied = applyLayoutTemplate(items, 'pip', kindOf, DEFAULT_CANVAS);
    mounted.renderer.update(
      scene('scn_a', applied.items, { version: 2, layoutMode: applied.layoutMode }),
    );
  }

  it('Picture in picture after adding the camera first: the small camera is painted above the full screen', () => {
    mounted = mount();
    showTemplate([sceneItem('itm_k1', CAMERA), sceneItem('itm_s1', SCREEN)]);
    const [full, corner] = layoutTemplate('pip', DEFAULT_CANVAS).slots ?? [];
    expect(mounted.renderer.effectiveRects().get('itm_s1')).toEqual({
      x: full[0],
      y: full[1],
      w: full[2],
      h: full[3],
    });
    expect(mounted.renderer.effectiveRects().get('itm_k1')).toEqual({
      x: corner[0],
      y: corner[1],
      w: corner[2],
      h: corner[3],
    });
    // Same stacking context (the scene layer), the corner picture in front.
    expect(mounted.item('itm_k1')?.parentElement).toBe(mounted.item('itm_s1')?.parentElement);
    expect(zIndex('itm_k1')).toBeGreaterThan(zIndex('itm_s1'));
    expect(mounted.item('itm_k1')?.style.display).toBe('block');
    expect(mounted.item('itm_k1')?.style.transform).toBe('translate(1400px, 772px)');
    expect(mounted.item('itm_s1')?.style.width).toBe('1920px');
  });

  it('Picture in picture after adding the screen first: the order stays and the camera is still in front', () => {
    mounted = mount();
    showTemplate([sceneItem('itm_s1', SCREEN), sceneItem('itm_k1', CAMERA)]);
    expect(zIndex('itm_s1')).toBe(0);
    expect(zIndex('itm_k1')).toBe(1);
  });

  it('Picture in picture with two cameras: the front camera takes the corner', () => {
    mounted = mount();
    showTemplate([sceneItem('itm_k2', CAMERA_2), sceneItem('itm_k1', CAMERA)]);
    expect(mounted.renderer.effectiveRects().get('itm_k2')?.w).toBe(1920);
    expect(mounted.renderer.effectiveRects().get('itm_k1')?.w).toBe(480);
    expect(zIndex('itm_k1')).toBeGreaterThan(zIndex('itm_k2'));
  });

  it('Auto-Grid keeps the item order and places the items side by side (no overlap)', () => {
    mounted = mount();
    const items = [sceneItem('itm_k1', CAMERA), sceneItem('itm_s1', SCREEN)];
    const applied = applyLayoutTemplate(items, 'auto', kindOf, DEFAULT_CANVAS);
    mounted.renderer.show(scene('scn_a', applied.items, { layoutMode: applied.layoutMode }));
    mounted.provider.live(CAMERA);
    mounted.provider.live(SCREEN);
    const rects = mounted.renderer.effectiveRects();
    const camera = rects.get('itm_k1');
    const screen = rects.get('itm_s1');
    expect(zIndex('itm_k1')).toBe(0);
    expect(zIndex('itm_s1')).toBe(1);
    expect(camera && screen && camera.x + camera.w <= screen.x).toBe(true);
  });
});
