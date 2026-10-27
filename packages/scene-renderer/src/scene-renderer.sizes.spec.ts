import {
  CAMERA,
  CAMERA_2,
  IMAGE,
  mount,
  scene,
  sceneItem,
  SCREEN,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: desired sizes and preload', () => {
  let mounted: Mounted;

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.unstubAllGlobals();
  });

  const stageSizes = (): Map<string, { width: number; height: number }> =>
    mounted.provider.desired((consumer) => !consumer.endsWith('/preload'));
  const preloadSizes = (): Map<string, { width: number; height: number }> =>
    mounted.provider.desired((consumer) => consumer.endsWith('/preload'));

  it('reports the on-screen size of device sources times the device pixel ratio, rounded up to 16 px', () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    mounted = mount({}, { width: 960, height: 540 });
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 640, h: 360 }), sceneItem('itm_i', IMAGE)]),
    );
    expect(stageSizes()).toEqual(new Map([[CAMERA, { width: 480, height: 272 }]]));
  });

  it('counts a device pixel ratio above 1.5 as 1.5 (a 4K display at 200 % asks for no more than a 1.5 display)', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    mounted = mount({}, { width: 960, height: 540 });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 640, h: 360 })]));
    expect(stageSizes().get(CAMERA)).toEqual({ width: 480, height: 272 });
    vi.stubGlobal('devicePixelRatio', 3);
    mounted.renderer.resize();
    expect(stageSizes().get(CAMERA)).toEqual({ width: 480, height: 272 });
  });

  it('never asks for more than the canvas of the production, however large the window is', () => {
    mounted = mount({}, { width: 3840, height: 2160 });
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 0, y: 0, w: 1920, h: 1080 })]),
    );
    // Scale 2 would ask for 3840 x 2160.
    expect(stageSizes().get(CAMERA)).toEqual({ width: 1920, height: 1088 });
    // A 720p production has a smaller ceiling.
    mounted.renderer.setCanvas({ width: 1280, height: 720 });
    mounted.renderer.show(
      scene('scn_b', [sceneItem('itm_b', CAMERA, { x: 0, y: 0, w: 1280, h: 720 })]),
    );
    expect(stageSizes().get(CAMERA)).toEqual({ width: 1280, height: 720 });
  });

  it('caps a zoomed crop (the uncropped picture would be far larger than the canvas)', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA, {
          x: 0,
          y: 0,
          w: 1920,
          h: 1080,
          crop: { top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 },
        }),
      ]),
    );
    expect(stageSizes().get(CAMERA)).toEqual({ width: 1920, height: 1088 });
  });

  it('accounts for crop and rotation (the source must deliver the uncropped, unrotated picture)', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA, {
          w: 400,
          h: 400,
          crop: { top: 0, right: 0.25, bottom: 0, left: 0.25 },
        }),
        sceneItem('itm_b', SCREEN, { w: 800, h: 448, rotation: 90 }),
      ]),
    );
    expect(stageSizes().get(CAMERA)).toEqual({ width: 800, height: 400 });
    expect(stageSizes().get(SCREEN)).toEqual({ width: 448, height: 800 });
  });

  it('reports the larger size when a source is shown twice', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA, { w: 320, h: 720 }),
        sceneItem('itm_b', CAMERA, { w: 640, h: 160 }),
      ]),
    );
    expect(stageSizes().get(CAMERA)).toEqual({ width: 640, height: 720 });
  });

  it('re-reports on resize and only sends changes', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 1920, h: 1080, x: 0, y: 0 })]),
    );
    expect(stageSizes().get(CAMERA)).toEqual({ width: 1920, height: 1088 });
    const calls = mounted.provider.sizeCalls.length;
    mounted.setSize(1920, 1080);
    expect(mounted.provider.sizeCalls).toHaveLength(calls);
    mounted.setSize(480, 270);
    expect(stageSizes().get(CAMERA)).toEqual({ width: 480, height: 272 });
    mounted.setSize(0, 0);
    expect(stageSizes().get(CAMERA)).toEqual({ width: 16, height: 16 });
  });

  it('withdraws sizes of sources that leave the stage or get hidden', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    mounted.renderer.update(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { hidden: true }), sceneItem('itm_b', CAMERA_2)], {
        version: 2,
      }),
    );
    expect([...stageSizes().keys()]).toEqual([CAMERA_2]);
    mounted.renderer.show(null);
    expect(stageSizes().size).toBe(0);
  });

  it('requests the stage size for device sources of preloaded scenes that are not on stage', () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.renderer.setPreloadScenes([
      scene('scn_b', [
        sceneItem('itm_b1', CAMERA),
        sceneItem('itm_b2', CAMERA_2),
        sceneItem('itm_b3', IMAGE),
        sceneItem('itm_b4', SCREEN, { hidden: true }),
      ]),
    ]);
    expect(preloadSizes()).toEqual(new Map([[CAMERA_2, { width: 640, height: 368 }]]));
    const consumers = new Set(mounted.provider.sizeCalls.map((call) => call.consumerId));
    expect(consumers.size).toBe(2);

    // The preloaded source goes on stage: its preload request is withdrawn.
    mounted.renderer.show(scene('scn_b', [sceneItem('itm_b2', CAMERA_2)]));
    expect(preloadSizes().has(CAMERA_2)).toBe(false);
    expect(preloadSizes().has(CAMERA)).toBe(true);

    mounted.renderer.setPreloadScenes([]);
    expect(preloadSizes().size).toBe(0);
  });

  it('ignores malformed preload input', () => {
    mounted = mount();
    mounted.renderer.setPreloadScenes([
      scene('scn_x', null as unknown as []),
      null as unknown as ReturnType<typeof scene>,
      scene('scn_y', [{ id: 'itm_y' } as ReturnType<typeof sceneItem>]),
    ]);
    expect(preloadSizes().size).toBe(0);
    expect(mounted.errors).toEqual([]);
  });

  it('uses a different consumer id per renderer', () => {
    mounted = mount();
    const second = mount({ provider: mounted.provider });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    second.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    const consumers = new Set(mounted.provider.sizeCalls.map((call) => call.consumerId));
    expect(consumers.size).toBe(2);
    second.renderer.destroy();
    expect(stageSizes().size).toBe(1);
  });
});
