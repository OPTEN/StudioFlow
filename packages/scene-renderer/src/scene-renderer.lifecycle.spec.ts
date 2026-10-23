import type { MonitorSourceStatus } from './types';
import { createSceneRenderer } from './scene-renderer';
import { FakeProvider } from './testing/fake-provider';
import {
  CAMERA,
  CAMERA_2,
  clearFrame,
  fakeAnimate,
  fakeCanvas2d,
  giveFrame,
  mount,
  phone,
  scene,
  sceneItem,
  SCREEN,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: lifecycle and robustness', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('destroy() releases every registration, timer, listener and element', async () => {
    fakeCanvas2d();
    fakeAnimate();
    const statuses = new Map<string, MonitorSourceStatus>([[CAMERA, 'reconnecting']]);
    mounted = mount({ mode: 'monitor', statusOf: (id) => statuses.get(id) ?? 'ok' });
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA),
        sceneItem('itm_b', CAMERA_2, { onLost: { holdMs: 0, fallbackSource: SCREEN } }),
      ]),
    );
    const videoA = mounted.part('itm_a', 'video') as HTMLVideoElement;
    const videoB = mounted.part('itm_b', 'video') as HTMLVideoElement;
    giveFrame(videoA);
    giveFrame(videoB);
    mounted.provider.live(CAMERA);
    mounted.provider.live(CAMERA_2);
    mounted.provider.lose(CAMERA); // hold timer + alert ticker
    mounted.provider.lose(CAMERA_2); // fallback device attached
    clearFrame(videoB);
    mounted.provider.live(CAMERA_2); // waiting for the first frame (1.5 s timer)
    void mounted.renderer.transitionTo(scene('scn_b', [sceneItem('itm_c', phone(3))]), {
      kind: 'fade',
      durationMs: 2000,
    });
    mounted.renderer.showSlate({ title: 'Pause', subtitle: null, backgroundAssetId: null });
    mounted.renderer.stats(); // starts the fps loop
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(mounted.provider.registrationCount).toBeGreaterThan(0);

    mounted.renderer.destroy();
    expect(mounted.container.childElementCount).toBe(0);
    expect(mounted.provider.registrationCount).toBe(0);
    expect(mounted.provider.desiredCount).toBe(0);
    expect(mounted.provider.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mounted.errors).toEqual([]);

    // Idempotent, and every method is a harmless no-op afterwards.
    mounted.renderer.destroy();
    mounted.renderer.show(scene('scn_x', [sceneItem('itm_x', CAMERA)]));
    mounted.renderer.update(scene('scn_x', []));
    mounted.renderer.showSlate({ title: 'x', subtitle: null, backgroundAssetId: null });
    mounted.renderer.setPreloadScenes([scene('scn_y', [sceneItem('itm_y', CAMERA)])]);
    mounted.renderer.setSourceStatuses();
    mounted.renderer.resize();
    mounted.provider.lose(CAMERA);
    expect(mounted.renderer.stats()).toEqual({ fps: 0, items: 0, videos: 0 });
    expect(mounted.provider.registrationCount).toBe(0);
    expect(mounted.container.childElementCount).toBe(0);
  });

  it('disconnects its ResizeObserver', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(readonly callback: ResizeObserverCallback) {}
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
      },
    );
    mounted = mount();
    expect(observe).toHaveBeenCalledWith(mounted.container.firstElementChild);
    mounted.renderer.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to the window resize event without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mounted = mount({}, { width: 1920, height: 1080 });
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { w: 1920, h: 1080, x: 0, y: 0 })]),
    );
    const viewport = mounted.container.firstElementChild as HTMLElement;
    Object.defineProperty(viewport, 'clientWidth', { value: 960, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 540, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(mounted.renderer.element.style.transform).toBe('translate(0px, 0px) scale(0.5)');
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
    mounted.renderer.destroy();
    expect(remove).toHaveBeenCalledWith(
      'resize',
      add.mock.calls.find((call) => call[0] === 'resize')?.[1],
    );
  });

  it('reports items, videos and the measured frame rate', async () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA),
        sceneItem('itm_b', SCREEN, { hidden: true }),
        sceneItem('itm_c', 'ast_none0001'),
      ]),
    );
    const first = mounted.renderer.stats();
    expect(first).toEqual({ fps: 0, items: 2, videos: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    const fps = mounted.renderer.stats().fps;
    expect(fps).toBeGreaterThanOrEqual(55);
    expect(fps).toBeLessThanOrEqual(65);
  });

  it('stops measuring frames when nobody asks', async () => {
    mounted = mount();
    mounted.renderer.stats();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(mounted.renderer.stats().fps).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mounted.renderer.stats().fps).toBeGreaterThan(50);
  });

  it('keeps rendering when the provider throws everywhere', () => {
    const provider = new FakeProvider();
    for (const method of [
      'attach',
      'detach',
      'availability',
      'setDesiredSize',
      'assetUrl',
    ] as const) {
      vi.spyOn(provider, method).mockImplementation(() => {
        throw new Error(method);
      });
    }
    mounted = mount({ provider });
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', 'ast_img00001')]),
    );
    expect(mounted.item('itm_a')).not.toBeNull();
    expect(mounted.item('itm_a')?.style.backgroundColor).toBe('#121821');
    mounted.renderer.show(null);
    expect(mounted.errors.length).toBeGreaterThan(0);
    expect(mounted.errors.every((error) => error instanceof Error)).toBe(true);
  });

  it('survives a provider whose onChange throws and one that returns garbage availability', () => {
    const provider = new FakeProvider();
    vi.spyOn(provider, 'onChange').mockImplementation(() => {
      throw new Error('no events');
    });
    vi.spyOn(provider, 'availability').mockReturnValue(null as never);
    mounted = mount({ provider });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    expect(mounted.item('itm_a')?.style.backgroundColor).toBe('#121821');
    mounted.renderer.destroy();
    expect(mounted.errors.map((error) => (error as Error).message)).toContain('no events');
  });

  it('handles a provider that notifies synchronously from attach (re-entrancy)', () => {
    const provider = new FakeProvider();
    const attach = provider.attach.bind(provider);
    vi.spyOn(provider, 'attach').mockImplementation((sourceId, video) => {
      attach(sourceId, video);
      provider.live(sourceId);
    });
    mounted = mount({ provider });
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    expect(mounted.item('itm_a')?.style.backgroundColor).toBe('');
    expect(mounted.provider.desired().size).toBe(2);
    expect(mounted.errors).toEqual([]);
  });

  it('does not loop forever when the provider notifies on every desired-size call', () => {
    const provider = new FakeProvider();
    const setDesiredSize = vi.spyOn(provider, 'setDesiredSize');
    setDesiredSize.mockImplementation((sourceId) => provider.live(sourceId));
    mounted = mount({ provider });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    expect(setDesiredSize.mock.calls.length).toBeLessThan(10);
  });

  it('ignores availability changes of unrelated sources and duplicate notifications', () => {
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    const calls = mounted.provider.sizeCalls.length;
    for (let i = 0; i < 50; i += 1) {
      mounted.provider.live(CAMERA);
      mounted.provider.live('dev_other001/camera');
    }
    expect(mounted.provider.sizeCalls).toHaveLength(calls);
    expect(mounted.item('itm_a')?.style.backgroundColor).toBe('');
  });

  it('stays stable under thousands of rapid updates (no leaks, one element per item)', () => {
    mounted = mount();
    for (let version = 1; version <= 2000; version += 1) {
      const source = version % 2 === 0 ? CAMERA : CAMERA_2;
      mounted.renderer.update(
        scene('scn_a', [sceneItem('itm_a', source, { x: version % 300 })], { version }),
      );
      if (version === 1) {
        mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', source)], { version }));
      }
    }
    expect(mounted.container.querySelectorAll('.sf-r-item')).toHaveLength(1);
    expect(mounted.container.querySelectorAll('video')).toHaveLength(1);
    expect(mounted.provider.registrationCount).toBe(1);
    expect(mounted.provider.desiredCount).toBe(1);
  });

  it('creates and destroys many renderers without leftovers', () => {
    const provider = new FakeProvider();
    const container = document.createElement('div');
    document.body.append(container);
    for (let i = 0; i < 100; i += 1) {
      const renderer = createSceneRenderer(container, {
        mode: 'thumbnail',
        provider,
        onError: () => undefined,
      });
      renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', SCREEN)]));
      provider.lose(CAMERA);
      renderer.destroy();
    }
    expect(container.childElementCount).toBe(0);
    expect(provider.registrationCount).toBe(0);
    expect(provider.listenerCount).toBe(0);
    expect(provider.desiredCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    container.remove();
  });

  it('reports errors through console.warn by default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = new FakeProvider();
    vi.spyOn(provider, 'attach').mockImplementation(() => {
      throw new Error('attach failed');
    });
    const container = document.createElement('div');
    const renderer = createSceneRenderer(container, { mode: 'output', provider });
    renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    expect(warn).toHaveBeenCalledWith('[scene-renderer]', expect.any(Error));
    renderer.destroy();
  });
});
