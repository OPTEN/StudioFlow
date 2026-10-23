import {
  CAMERA,
  CAMERA_2,
  CLIP,
  IMAGE,
  mount,
  scene,
  sceneItem,
  SCREEN,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: stage and items', () => {
  let mounted: Mounted;

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
  });

  describe('stage', () => {
    it('is a 1920 × 1080 image element scaled into the container', () => {
      mounted = mount({}, { width: 960, height: 540 });
      const stage = mounted.renderer.element;
      expect(stage.style.width).toBe('1920px');
      expect(stage.style.height).toBe('1080px');
      expect(stage.style.transform).toBe('translate(0px, 0px) scale(0.5)');
      expect(stage.getAttribute('role')).toBe('img');
      expect(stage.getAttribute('aria-label')).toBe('Scene');
    });

    it('letterboxes a 4:3 container and re-fits on resize', () => {
      mounted = mount({}, { width: 1024, height: 768 });
      expect(mounted.renderer.element.style.transform).toBe(
        `translate(0px, 96px) scale(${1024 / 1920})`,
      );
      mounted.setSize(2560, 1080);
      expect(mounted.renderer.element.style.transform).toBe('translate(320px, 0px) scale(1)');
    });

    it('uses the label option and the background option', () => {
      mounted = mount({ label: 'Program', background: 'transparent' });
      expect(mounted.renderer.element.getAttribute('aria-label')).toBe('Program');
      expect(mounted.renderer.element.style.backgroundColor).toBe('transparent');
      const viewport = mounted.container.firstElementChild as HTMLElement;
      expect(viewport.style.backgroundColor).toBe('transparent');
    });

    it('keeps every scene layer in its own stacking context below the slates', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
      const layer = mounted.container.querySelector<HTMLElement>('.sf-r-layer');
      expect(layer?.style.isolation).toBe('isolate');
      expect(mounted.container.querySelector<HTMLElement>('.sf-r-scenes')?.style.zIndex).toBe('0');
      expect(mounted.container.querySelector<HTMLElement>('.sf-r-slates')?.style.zIndex).toBe('1');
    });

    it('is black by default', () => {
      mounted = mount();
      expect(mounted.renderer.element.style.backgroundColor).toBe('#000000');
    });
  });

  describe('items', () => {
    it('positions items in canvas pixels', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 40, y: -20, w: 800, h: 450 })]),
      );
      const root = mounted.item('itm_a');
      expect(root?.style.transform).toBe('translate(40px, -20px)');
      expect(root?.style.width).toBe('800px');
      expect(root?.style.height).toBe('450px');
      expect(mounted.renderer.effectiveRects().get('itm_a')).toEqual({
        x: 40,
        y: -20,
        w: 800,
        h: 450,
      });
    });

    it('paints in array order through z-index and does not move nodes when reordered', () => {
      mounted = mount();
      const a = sceneItem('itm_a', CAMERA);
      const b = sceneItem('itm_b', SCREEN);
      mounted.renderer.show(scene('scn_a', [a, b]));
      const rootA = mounted.item('itm_a');
      const rootB = mounted.item('itm_b');
      const videoA = mounted.part('itm_a', 'video');
      expect(rootA?.style.zIndex).toBe('0');
      expect(rootB?.style.zIndex).toBe('1');

      mounted.renderer.update(scene('scn_a', [b, a], { version: 2 }));
      expect(mounted.item('itm_a')).toBe(rootA);
      expect(rootA?.style.zIndex).toBe('1');
      expect(rootB?.style.zIndex).toBe('0');
      expect(mounted.part('itm_a', 'video')).toBe(videoA);
      // DOM order is untouched: no <video> was re-parented.
      expect(rootA?.nextElementSibling).toBe(rootB);
    });

    it('applies fit through object-fit and paints contain bars', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_a', CAMERA, { fit: 'contain' }),
          sceneItem('itm_b', CAMERA_2, { fit: 'cover' }),
        ]),
      );
      expect(mounted.part('itm_a', 'video')?.style.objectFit).toBe('contain');
      expect(mounted.part('itm_b', 'video')?.style.objectFit).toBe('cover');
      mounted.provider.live(CAMERA);
      mounted.provider.live(CAMERA_2);
      expect(mounted.item('itm_a')?.style.backgroundColor).toBe('#0a0d12');
      expect(mounted.item('itm_b')?.style.backgroundColor).toBe('');
    });

    it('crops with an inner box so the cropped part fills the item', () => {
      mounted = mount();
      const crop = { top: 0.1, right: 0.2, bottom: 0.3, left: 0.05 };
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 600, h: 300, crop })]));
      const cropEl = mounted.part('itm_a', '.sf-r-crop');
      expect(cropEl?.style.width).toBe(`${600 / 0.75}px`);
      expect(cropEl?.style.height).toBe(`${300 / 0.6}px`);
      expect(cropEl?.style.left).toBe(`${-0.05 * (600 / 0.75)}px`);
      expect(cropEl?.style.top).toBe(`${-0.1 * (300 / 0.6)}px`);
      expect(mounted.item('itm_a')?.style.overflow).toBe('hidden');
    });

    it('rotates the inner box and swaps its size for 90° and 270°', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 800, h: 450, rotation: 90 })]),
      );
      const box = mounted.part('itm_a', '.sf-r-box');
      expect(box?.style.transform).toBe('rotate(90deg)');
      expect(box?.style.width).toBe('450px');
      expect(box?.style.height).toBe('800px');
      expect(box?.style.left).toBe('175px');
      expect(box?.style.top).toBe('-175px');

      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 800, h: 450, rotation: 180 })]),
      );
      expect(box?.style.transform).toBe('rotate(180deg)');
      expect(box?.style.width).toBe('800px');
      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 800, h: 450, rotation: 0 })]),
      );
      expect(box?.style.transform).toBe('');
    });

    it('mirrors the media horizontally', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { mirror: true })]));
      expect(mounted.part('itm_a', 'video')?.style.transform).toBe('scaleX(-1)');
      mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', CAMERA, { mirror: false })]));
      expect(mounted.part('itm_a', 'video')?.style.transform).toBe('');
    });

    it('rounds corners with clipping and draws the border as inset shadow', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_a', CAMERA, { radius: 12, border: { width: 4, color: '#1f6feb' } }),
        ]),
      );
      expect(mounted.item('itm_a')?.style.borderRadius).toBe('12px');
      const border = mounted.part('itm_a', '.sf-r-border');
      expect(border?.style.boxShadow).toBe('inset 0 0 0 4px #1f6feb');
      expect(border?.style.display).toBe('block');

      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { radius: 0, border: null })]),
      );
      expect(mounted.item('itm_a')?.style.borderRadius).toBe('');
      expect(border?.style.display).toBe('none');
    });
  });

  describe('media elements', () => {
    it('registers a muted inline autoplay video for device sources', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
      const video = mounted.part('itm_a', 'video');
      expect(video).not.toBeNull();
      for (const attribute of [
        'muted',
        'playsinline',
        'autoplay',
        'disablepictureinpicture',
        'aria-hidden',
      ]) {
        expect(video?.hasAttribute(attribute)).toBe(true);
      }
      expect(video?.hasAttribute('loop')).toBe(false);
      expect(mounted.provider.attached(CAMERA)).toEqual([video]);
    });

    it('renders video assets as looping videos and images as img', () => {
      mounted = mount({ assetKindOf: (id) => (id === CLIP ? 'video' : undefined) });
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP), sceneItem('itm_i', IMAGE)]));
      const video = mounted.part('itm_v', 'video');
      expect(video?.getAttribute('src')).toBe('/media/clip.mp4');
      expect(video?.hasAttribute('loop')).toBe(true);
      expect(video?.hasAttribute('muted')).toBe(true);
      const image = mounted.part('itm_i', 'img');
      expect(image?.getAttribute('src')).toBe('/media/image.png');
      expect(image?.getAttribute('decoding')).toBe('async');
      expect(image?.getAttribute('draggable')).toBe('false');
      expect(image?.getAttribute('alt')).toBe('');
      expect(mounted.provider.attachCalls).toHaveLength(0);
    });

    it('treats assets of unknown kind as images', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP)]));
      expect(mounted.part('itm_v', 'img')?.getAttribute('src')).toBe('/media/clip.mp4');
    });

    it('keeps the same <video> when an update does not change the source', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
      const video = mounted.part('itm_a', 'video');
      for (let version = 2; version < 20; version += 1) {
        mounted.renderer.update(
          scene(
            'scn_a',
            [sceneItem('itm_a', CAMERA, { x: version * 10, w: 300 + version, fit: 'contain' })],
            { version },
          ),
        );
      }
      expect(mounted.part('itm_a', 'video')).toBe(video);
      expect(mounted.provider.attachCalls).toHaveLength(1);
      expect(mounted.provider.detachCalls).toHaveLength(0);
      expect(mounted.item('itm_a')?.style.transform).toBe('translate(190px, 50px)');
    });

    it('replaces the element and detaches the old one when the source changes', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
      const old = mounted.part('itm_a', 'video');
      mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', CAMERA_2)], { version: 2 }));
      const replacement = mounted.part('itm_a', 'video');
      expect(replacement).not.toBe(old);
      expect(old?.isConnected).toBe(false);
      expect(mounted.provider.attached(CAMERA)).toEqual([]);
      expect(mounted.provider.attached(CAMERA_2)).toEqual([replacement]);
      expect(mounted.item('itm_a')?.querySelectorAll('video')).toHaveLength(1);

      mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', IMAGE)], { version: 3 }));
      expect(mounted.item('itm_a')?.querySelector('video')).toBeNull();
      expect(mounted.part('itm_a', 'img')).not.toBeNull();
      expect(mounted.provider.registrationCount).toBe(0);
    });

    it('removes items that disappear and releases their video', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
      );
      mounted.renderer.update(scene('scn_a', [sceneItem('itm_b', CAMERA_2)], { version: 2 }));
      expect(mounted.item('itm_a')).toBeNull();
      expect(mounted.provider.attached(CAMERA)).toEqual([]);
      expect(mounted.renderer.stats()).toMatchObject({ items: 1, videos: 1 });
    });
  });

  describe('hidden and missing', () => {
    it('hides hidden items but keeps their video for a flicker-free unhide', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { hidden: true })]));
      const root = mounted.item('itm_a');
      expect(root?.style.display).toBe('none');
      expect(mounted.renderer.effectiveRects().size).toBe(0);
      const video = mounted.part('itm_a', 'video');

      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { hidden: false })], { version: 2 }),
      );
      expect(root?.style.display).toBe('block');
      expect(mounted.part('itm_a', 'video')).toBe(video);
      expect(mounted.renderer.effectiveRects().has('itm_a')).toBe(true);
    });

    it('shows the dark placeholder for pending and missing sources, without text on the output', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_p', CAMERA),
          sceneItem('itm_m', 'ast_gone0001'),
          sceneItem('itm_x', 'garbage'),
        ]),
      );
      for (const id of ['itm_p', 'itm_m', 'itm_x']) {
        expect(mounted.item(id)?.style.backgroundColor).toBe('#121821');
        expect(mounted.part(id, '.sf-r-missing')?.style.display).toBe('none');
      }
      expect(mounted.part('itm_m', 'img')).toBeNull();
    });

    it('labels missing sources “Source missing” on monitors, including device sources the production does not know', () => {
      mounted = mount({ mode: 'monitor', statusOf: (id) => (id === CAMERA ? 'ok' : undefined) });
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_ok', CAMERA),
          sceneItem('itm_del', CAMERA_2),
          sceneItem('itm_m', 'ast_gone0001'),
        ]),
      );
      expect(mounted.part('itm_ok', '.sf-r-missing')?.style.display).toBe('none');
      for (const id of ['itm_del', 'itm_m']) {
        const label = mounted.part(id, '.sf-r-missing');
        expect(label?.style.display).toBe('flex');
        expect(label?.textContent).toBe('Source missing');
        expect(mounted.item(id)?.style.backgroundColor).toBe('#121821');
      }
    });

    it('re-resolves assets on update (asset list arrived later)', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', 'ast_late0001')]));
      expect(mounted.part('itm_a', 'img')).toBeNull();
      mounted.provider.urls.set('ast_late0001', '/media/late.png');
      mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', 'ast_late0001')]));
      expect(mounted.part('itm_a', 'img')?.getAttribute('src')).toBe('/media/late.png');
    });
  });

  describe('scene background and robustness', () => {
    it('paints the background colour and image', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [], { background: { color: '#123456', assetId: IMAGE } }),
      );
      const layer = mounted.container.querySelector<HTMLElement>('[data-scene-id="scn_a"]');
      expect(layer?.style.backgroundColor).toBe('#123456');
      const image = layer?.querySelector<HTMLImageElement>('.sf-r-background');
      expect(image?.getAttribute('src')).toBe('/media/image.png');
      expect(image?.style.display).toBe('block');

      mounted.renderer.update(
        scene('scn_a', [], { version: 2, background: { color: 'nonsense', assetId: null } }),
      );
      expect(layer?.style.backgroundColor).toBe('');
      expect(image?.style.display).toBe('none');
    });

    it('skips the scene colour on a transparent output', () => {
      mounted = mount({ background: 'transparent' });
      mounted.renderer.show(
        scene('scn_a', [], { background: { color: '#123456', assetId: null } }),
      );
      expect(
        mounted.container.querySelector<HTMLElement>('[data-scene-id="scn_a"]')?.style
          .backgroundColor,
      ).toBe('');
    });

    it('ignores outdated versions and updates of scenes that are not shown', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 10 })], { version: 5 }),
      );
      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 99 })], { version: 4 }),
      );
      expect(mounted.item('itm_a')?.style.transform).toBe('translate(10px, 50px)');
      mounted.renderer.update(scene('scn_other', [sceneItem('itm_z', CAMERA_2)]));
      expect(mounted.item('itm_z')).toBeNull();
      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 20 })], { version: 5 }),
      );
      expect(mounted.item('itm_a')?.style.transform).toBe('translate(20px, 50px)');
    });

    it('renders malformed scenes without throwing (duplicate ids, null items, missing arrays)', () => {
      mounted = mount();
      const duplicate = sceneItem('itm_a', CAMERA_2, { x: 999 });
      const items = [
        sceneItem('itm_a', CAMERA),
        duplicate,
        null,
        { id: 7 },
      ] as unknown as ReturnType<typeof sceneItem>[];
      mounted.renderer.show(scene('scn_a', items));
      expect(mounted.container.querySelectorAll('.sf-r-item')).toHaveLength(1);
      expect(mounted.item('itm_a')?.style.transform).toBe('translate(100px, 50px)');
      mounted.renderer.update(scene('scn_a', undefined as unknown as []));
      expect(mounted.container.querySelectorAll('.sf-r-item')).toHaveLength(0);
      expect(mounted.errors).toEqual([]);
    });

    it('clamps absurd geometry instead of producing invalid styles', () => {
      mounted = mount();
      mounted.renderer.show(
        scene('scn_a', [
          sceneItem('itm_a', CAMERA, {
            x: Number.NaN,
            w: 1e9,
            crop: { top: 0.9, right: 0.9, bottom: -2, left: 0.9 },
            radius: 1e6,
          }),
        ]),
      );
      const root = mounted.item('itm_a');
      expect(root?.style.transform).toBe('translate(0px, 50px)');
      expect(root?.style.width).toBe('3840px');
      expect(root?.style.borderRadius).toBe('200px');
      const cropEl = mounted.part('itm_a', '.sf-r-crop');
      expect(Number.parseFloat(cropEl?.style.width ?? '')).toBeCloseTo(38400, 3);
    });

    it('shows nothing for show(null)', () => {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
      mounted.renderer.show(null);
      expect(mounted.container.querySelectorAll('.sf-r-layer')).toHaveLength(0);
      expect(mounted.provider.registrationCount).toBe(0);
      expect(mounted.renderer.effectiveRects().size).toBe(0);
    });
  });
});
