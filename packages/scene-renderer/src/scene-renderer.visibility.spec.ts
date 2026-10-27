import {
  CAMERA,
  CAMERA_2,
  mount,
  scene,
  sceneItem,
  setPageVisibility,
  stubIntersectionObserver,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: pictures only while somebody can see them', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    setPageVisibility('visible');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const stageSizes = (): Map<string, { width: number; height: number }> =>
    mounted.provider.desired((consumer) => !consumer.endsWith('/preload'));
  const preloadSizes = (): Map<string, { width: number; height: number }> =>
    mounted.provider.desired((consumer) => consumer.endsWith('/preload'));

  function showTwoCameras(): void {
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    mounted.renderer.setPreloadScenes([
      scene('scn_p', [sceneItem('itm_p', 'dev_phone003/camera', { w: 320, h: 180 })]),
    ]);
  }

  it.each(['monitor', 'thumbnail'] as const)(
    'withdraws every picture request of a %s that leaves the screen and asks again when it returns',
    (mode) => {
      const intersection = stubIntersectionObserver();
      mounted = mount({ mode });
      showTwoCameras();
      expect(intersection.observers).toHaveLength(1);
      expect(intersection.observers[0].targets.has(mounted.container.firstElementChild!)).toBe(
        true,
      );
      expect(stageSizes().size).toBe(2);
      expect(preloadSizes().size).toBe(1);

      intersection.report(false);
      expect(stageSizes().size).toBe(0);
      expect(preloadSizes().size).toBe(0);

      intersection.report(true);
      expect(stageSizes().size).toBe(2);
      expect(preloadSizes().size).toBe(1);
    },
  );

  it('withdraws the requests of a monitor in a background tab', () => {
    mounted = mount({ mode: 'monitor' });
    showTwoCameras();
    expect(stageSizes().size).toBe(2);
    setPageVisibility('hidden');
    expect(stageSizes().size).toBe(0);
    setPageVisibility('visible');
    expect(stageSizes().size).toBe(2);
  });

  it('does not report the same state twice and keeps its pictures (hold frames, elements) while hidden', () => {
    const intersection = stubIntersectionObserver();
    mounted = mount({ mode: 'monitor' });
    showTwoCameras();
    intersection.report(false);
    const calls = mounted.provider.sizeCalls.length;
    intersection.report(false);
    mounted.renderer.refresh();
    expect(mounted.provider.sizeCalls).toHaveLength(calls);
    expect(mounted.container.querySelectorAll('video')).toHaveLength(2);
    expect(mounted.provider.registrationCount).toBe(2);
  });

  it('stops its timers while hidden', () => {
    const intersection = stubIntersectionObserver();
    mounted = mount({ mode: 'monitor', statusOf: () => 'reconnecting', codeOf: () => 'K1' });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.lose(CAMERA);
    const running = vi.getTimerCount();
    expect(running).toBeGreaterThan(0);
    intersection.report(false);
    // The alert timer and the hold frame refresh stop; only the hold expiry stays.
    expect(vi.getTimerCount()).toBeLessThan(running);
    intersection.report(true);
    expect(vi.getTimerCount()).toBe(running);
  });

  it('never pauses the output: it runs where it is shown, in the background too', () => {
    const intersection = stubIntersectionObserver();
    mounted = mount({ mode: 'output' });
    showTwoCameras();
    expect(intersection.observers).toHaveLength(0);
    setPageVisibility('hidden');
    expect(stageSizes().size).toBe(2);
    expect(preloadSizes().size).toBe(1);
  });

  it('can be told to pause (or not) whatever the mode', () => {
    const intersection = stubIntersectionObserver();
    mounted = mount({ mode: 'output', pauseWhenHidden: true });
    showTwoCameras();
    intersection.report(false);
    expect(stageSizes().size).toBe(0);
    mounted.renderer.destroy();

    const other = stubIntersectionObserver();
    mounted = mount({ mode: 'monitor', pauseWhenHidden: false });
    showTwoCameras();
    expect(other.observers).toHaveLength(0);
    setPageVisibility('hidden');
    expect(stageSizes().size).toBe(2);
  });

  it('stops observing on destroy', () => {
    const intersection = stubIntersectionObserver();
    mounted = mount({ mode: 'monitor' });
    mounted.renderer.destroy();
    expect(intersection.observers[0].disconnected).toBe(true);
    setPageVisibility('hidden');
    expect(mounted.errors).toEqual([]);
  });
});
