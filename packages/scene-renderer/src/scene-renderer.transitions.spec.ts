import type { TransitionDto } from '@flowstudio/scene-model';

import {
  CAMERA,
  CAMERA_2,
  fakeAnimate,
  flushMicrotasks,
  IMAGE,
  mount,
  scene,
  sceneItem,
  SCREEN,
  withoutAnimate,
  type FakeAnimation,
  type Mounted,
} from './testing/fixtures';

const CUT: TransitionDto = { kind: 'cut', durationMs: 0 };
const fade = (durationMs: number): TransitionDto => ({ kind: 'fade', durationMs });

describe('scene renderer: transitions', () => {
  let mounted: Mounted;
  let animations: FakeAnimation[];

  beforeEach(() => {
    vi.useFakeTimers();
    animations = fakeAnimate();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const layers = (): HTMLElement[] => [
    ...mounted.container.querySelectorAll<HTMLElement>('.fs-r-layer'),
  ];
  const layerIds = (): (string | null)[] =>
    layers().map((layer) => layer.getAttribute('data-scene-id'));

  function track(promise: Promise<void>): { done: boolean } {
    const state = { done: false };
    void promise.then(() => {
      state.done = true;
    });
    return state;
  }

  it('cuts immediately and resolves', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    const result = track(
      mounted.renderer.transitionTo(scene('scn_b', [sceneItem('itm_b', SCREEN)]), CUT),
    );
    expect(layerIds()).toEqual(['scn_b']);
    await flushMicrotasks();
    expect(result.done).toBe(true);
    expect(mounted.provider.attached(CAMERA)).toEqual([]);
    expect(animations).toHaveLength(0);
  });

  it('moves the <video> of a shared source on a cut instead of recreating it', () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_x', CAMERA_2)]),
    );
    const video = mounted.part('itm_a', 'video');
    mounted.provider.live(CAMERA);
    void mounted.renderer.transitionTo(
      scene('scn_b', [sceneItem('itm_b', CAMERA, { w: 1920, h: 1080, x: 0, y: 0 })]),
      CUT,
    );
    expect(mounted.part('itm_b', 'video')).toBe(video);
    expect(mounted.provider.attachCalls.filter((call) => call.sourceId === CAMERA)).toHaveLength(1);
    expect(mounted.provider.detachCalls.map((call) => call.sourceId)).toEqual([CAMERA_2]);
    expect(mounted.container.querySelectorAll('video')).toHaveLength(1);
  });

  it('fades the new scene in over the old one and removes the old one at the end', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    const result = track(
      mounted.renderer.transitionTo(scene('scn_b', [sceneItem('itm_b', CAMERA_2)]), fade(500)),
    );

    expect(layerIds()).toEqual(['scn_a', 'scn_b']);
    const incoming = layers()[1];
    expect(incoming.style.opacity).toBe('0');
    expect(animations).toHaveLength(1);
    expect(animations[0].element).toBe(incoming);
    expect(animations[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(animations[0].duration).toBe(500);
    // Both pictures are needed during the fade.
    expect(mounted.provider.desired().has(CAMERA)).toBe(true);
    expect(mounted.provider.desired().has(CAMERA_2)).toBe(true);

    await vi.advanceTimersByTimeAsync(499);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(result.done).toBe(true);
    expect(layerIds()).toEqual(['scn_b']);
    expect(incoming.style.opacity).toBe('1');
    expect(mounted.provider.attached(CAMERA)).toEqual([]);
    expect(mounted.provider.desired().has(CAMERA)).toBe(false);
    expect(mounted.renderer.effectiveRects().has('itm_b')).toBe(true);
  });

  it('finishes a running fade instantly when a new transition starts', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', []));
    const first = track(mounted.renderer.transitionTo(scene('scn_b', []), fade(1000)));
    await vi.advanceTimersByTimeAsync(300);

    const second = track(mounted.renderer.transitionTo(scene('scn_c', []), fade(500)));
    await flushMicrotasks();
    expect(first.done).toBe(true);
    expect(animations[0].cancelled).toBe(true);
    expect(layerIds()).toEqual(['scn_b', 'scn_c']);
    expect(layers()[0].style.opacity).toBe('1');

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(second.done).toBe(true);
    expect(layerIds()).toEqual(['scn_c']);
  });

  it('survives many overlapping transitions in a row', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_0', [sceneItem('itm_0', CAMERA)]));
    const results = Array.from({ length: 20 }, (_, index) =>
      track(
        mounted.renderer.transitionTo(
          scene(`scn_${index + 1}`, [sceneItem(`itm_${index + 1}`, CAMERA)]),
          fade(300),
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();
    expect(results.every((result) => result.done)).toBe(true);
    expect(layerIds()).toEqual(['scn_20']);
    expect(mounted.provider.registrationCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns fades into cuts with reducedMotion', async () => {
    mounted = mount({ reducedMotion: true });
    mounted.renderer.show(scene('scn_a', []));
    const result = track(mounted.renderer.transitionTo(scene('scn_b', []), fade(2000)));
    expect(layerIds()).toEqual(['scn_b']);
    await flushMicrotasks();
    expect(result.done).toBe(true);
    expect(animations).toHaveLength(0);
  });

  it('cuts for fades without a usable duration and clamps very long fades', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', []));
    void mounted.renderer.transitionTo(scene('scn_b', []), fade(0));
    expect(layerIds()).toEqual(['scn_b']);
    void mounted.renderer.transitionTo(scene('scn_c', []), {
      kind: 'fade',
      durationMs: Number.NaN,
    });
    expect(layerIds()).toEqual(['scn_c']);
    void mounted.renderer.transitionTo(scene('scn_d', []), fade(99_999));
    expect(animations[0].duration).toBe(10_000);
  });

  it('shows an empty stage for transitionTo(null)', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    const result = track(mounted.renderer.transitionTo(null, fade(500)));
    expect(layers()).toHaveLength(0);
    expect(mounted.provider.registrationCount).toBe(0);
    await flushMicrotasks();
    expect(result.done).toBe(true);
  });

  it('fades in from an empty stage', async () => {
    mounted = mount();
    const result = track(mounted.renderer.transitionTo(scene('scn_a', []), fade(300)));
    expect(layerIds()).toEqual(['scn_a']);
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();
    expect(result.done).toBe(true);
  });

  it('updates in place when the target is the shown scene', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 1 })]));
    const layer = layers()[0];
    const result = track(
      mounted.renderer.transitionTo(
        scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 2 })], { version: 2 }),
        fade(500),
      ),
    );
    expect(layers()).toEqual([layer]);
    expect(mounted.item('itm_a')?.style.transform).toBe('translate(2px, 50px)');
    await flushMicrotasks();
    expect(result.done).toBe(true);
    expect(animations).toHaveLength(0);
  });

  it('show() during a fade finishes it first', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', []));
    const result = track(mounted.renderer.transitionTo(scene('scn_b', []), fade(1000)));
    mounted.renderer.show(scene('scn_c', []));
    await flushMicrotasks();
    expect(result.done).toBe(true);
    expect(layerIds()).toEqual(['scn_c']);
  });

  it('update() during a fade reaches both layers', () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 1 })]));
    void mounted.renderer.transitionTo(
      scene('scn_b', [sceneItem('itm_b', SCREEN, { x: 1 })]),
      fade(1000),
    );
    mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 7 })], { version: 2 }));
    mounted.renderer.update(scene('scn_b', [sceneItem('itm_b', SCREEN, { x: 8 })], { version: 2 }));
    expect(mounted.item('itm_a')?.style.transform).toBe('translate(7px, 50px)');
    expect(mounted.item('itm_b')?.style.transform).toBe('translate(8px, 50px)');
  });

  it('completes fades through the CSS fallback without Web Animations', async () => {
    vi.restoreAllMocks();
    const restore = withoutAnimate();
    try {
      mounted = mount();
      mounted.renderer.show(scene('scn_a', []));
      const result = track(mounted.renderer.transitionTo(scene('scn_b', []), fade(300)));
      expect(layers()[1].style.transition).toBe('opacity 300ms linear');
      // happy-dom fires no transitionend: the safety timeout must complete the fade.
      await vi.advanceTimersByTimeAsync(400);
      await flushMicrotasks();
      expect(result.done).toBe(true);
      expect(layerIds()).toEqual(['scn_b']);
    } finally {
      restore();
    }
  });

  it('resolves a running fade on destroy and never rejects', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    const promise = mounted.renderer.transitionTo(
      scene('scn_b', [sceneItem('itm_b', CAMERA_2)]),
      fade(2000),
    );
    mounted.renderer.destroy();
    await expect(promise).resolves.toBeUndefined();
    await expect(
      mounted.renderer.transitionTo(scene('scn_c', []), fade(300)),
    ).resolves.toBeUndefined();
    expect(mounted.provider.registrationCount).toBe(0);
  });

  it('resolves even when the provider throws while building the new scene', async () => {
    mounted = mount();
    vi.spyOn(mounted.provider, 'attach').mockImplementation(() => {
      throw new Error('attach failed');
    });
    await expect(
      mounted.renderer.transitionTo(scene('scn_b', [sceneItem('itm_b', CAMERA)]), CUT),
    ).resolves.toBeUndefined();
    expect(mounted.item('itm_b')).not.toBeNull();
    expect(mounted.errors).toHaveLength(1);
  });
});

describe('scene renderer: slates', () => {
  let mounted: Mounted;
  let animations: FakeAnimation[];
  const standby = { title: 'Gleich geht’s los', subtitle: 'Webinar Q4', backgroundAssetId: null };

  beforeEach(() => {
    vi.useFakeTimers();
    animations = fakeAnimate();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const slate = (): HTMLElement | null => mounted.container.querySelector('.fs-r-slate');

  it('fades a slate in above the scenes', async () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.renderer.showSlate(standby);
    const element = slate();
    expect(element?.querySelector('.fs-r-slate-title')?.textContent).toBe('Gleich geht’s los');
    expect(element?.querySelector('.fs-r-slate-subtitle')?.textContent).toBe('Webinar Q4');
    expect(element?.style.backgroundColor).toBe('#0d1117');
    expect(element?.style.color).toBe('#ffffff');
    expect(element?.querySelector<HTMLElement>('.fs-r-slate-title')?.style.fontSize).toBe('72px');
    expect(element?.querySelector<HTMLElement>('.fs-r-slate-subtitle')?.style.fontSize).toBe(
      '36px',
    );
    expect(animations[0].element).toBe(element);
    expect(animations[0].duration).toBe(300);
    // Above every scene layer.
    const scenes = mounted.container.querySelector('.fs-r-scenes');
    expect(scenes?.compareDocumentPosition(element as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await vi.advanceTimersByTimeAsync(300);
    expect(element?.style.opacity).toBe('1');
  });

  it('draws the background image from the URL or the provider', () => {
    mounted = mount();
    mounted.renderer.showSlate(standby, '/media/explicit.png');
    expect(slate()?.querySelector('img')?.getAttribute('src')).toBe('/media/explicit.png');
    mounted.renderer.showSlate({ ...standby, backgroundAssetId: IMAGE });
    expect(slate()?.querySelector('img')?.getAttribute('src')).toBe('/media/image.png');
    mounted.renderer.showSlate({ ...standby, backgroundAssetId: IMAGE }, null);
    expect(slate()?.querySelector('img')?.style.display).toBe('none');
  });

  it('updates a visible slate in place and hides an empty subtitle', () => {
    mounted = mount();
    mounted.renderer.showSlate(standby);
    const element = slate();
    mounted.renderer.showSlate({
      title: 'Danke fürs Zuschauen',
      subtitle: null,
      backgroundAssetId: null,
    });
    expect(slate()).toBe(element);
    expect(animations).toHaveLength(1);
    expect(element?.querySelector('.fs-r-slate-title')?.textContent).toBe('Danke fürs Zuschauen');
    expect(element?.querySelector<HTMLElement>('.fs-r-slate-subtitle')?.style.display).toBe('none');
  });

  it('fades out and removes the slate', async () => {
    mounted = mount();
    mounted.renderer.showSlate(standby);
    await vi.advanceTimersByTimeAsync(300);
    mounted.renderer.showSlate(null);
    expect(slate()).not.toBeNull();
    expect(animations[1].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();
    expect(slate()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reverses mid-fade from the current opacity', async () => {
    mounted = mount();
    mounted.renderer.showSlate(standby);
    await vi.advanceTimersByTimeAsync(100);
    mounted.renderer.showSlate(null);
    const out = animations[1];
    expect(out.keyframes[0]['opacity']).toBeCloseTo(1 / 3, 5);
    expect(out.duration).toBeCloseTo(100, 5);
    await vi.advanceTimersByTimeAsync(50);
    mounted.renderer.showSlate(standby);
    const back = animations[2];
    expect(back.keyframes[0]['opacity']).toBeCloseTo(1 / 6, 5);
    expect(back.duration).toBeCloseTo(250, 5);
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(slate()?.style.opacity).toBe('1');
  });

  it('switches at once with reducedMotion', async () => {
    mounted = mount({ reducedMotion: true });
    mounted.renderer.showSlate(standby);
    expect(slate()?.style.opacity).toBe('1');
    mounted.renderer.showSlate(null);
    await flushMicrotasks();
    expect(slate()).toBeNull();
    expect(animations).toHaveLength(0);
  });

  it('hiding without a slate is a no-op', () => {
    mounted = mount();
    mounted.renderer.showSlate(null);
    expect(slate()).toBeNull();
    expect(mounted.errors).toEqual([]);
  });
});
