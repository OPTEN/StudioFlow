import { snapshotBudget } from './snapshot-budget';
import { STILL_REFRESH_MS } from './still-pool';
import {
  CAMERA,
  CAMERA_2,
  fakeCanvas2d,
  giveFrame,
  IMAGE,
  mount,
  scene,
  sceneItem,
  setPageVisibility,
  stubIntersectionObserver,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: thumbnails show still pictures', () => {
  let mounted: Mounted;
  const mounts: Mounted[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    snapshotBudget.reset();
  });

  afterEach(() => {
    for (const each of mounts.splice(0)) {
      each.renderer.destroy();
      each.container.remove();
    }
    setPageVisibility('visible');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function thumbnail(provider?: Mounted['provider']): Mounted {
    const each = mount(
      { mode: 'thumbnail', ...(provider ? { provider } : {}) },
      { width: 160, height: 90 },
    );
    mounts.push(each);
    return each;
  }

  /** The hidden video that plays a source for the snapshots, with a picture. */
  function feederOf(source: string, width = 480, height = 270): HTMLVideoElement {
    const video = mounted.provider.attached(source)[0];
    giveFrame(video, width, height);
    return video;
  }

  const stillOf = (id: string): HTMLImageElement | null => mounted.part(id, 'img');

  it('has no video of its own for a device source: a hidden video per source feeds a snapshot', () => {
    fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', IMAGE)]));
    expect(mounted.container.querySelectorAll('video.sf-r-media--device')).toHaveLength(0);
    expect(mounted.renderer.stats().videos).toBe(0);
    const feeders = document.querySelectorAll('.sf-r-stills video');
    expect(feeders).toHaveLength(1);
    expect(mounted.provider.attached(CAMERA)).toEqual([feeders[0]]);
    expect(stillOf('itm_a')).toBeNull();
  });

  it('shows the first picture as soon as the source has one and renews it every 1.5 seconds', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    const feeder = feederOf(CAMERA);
    feeder.dispatchEvent(new Event('loadeddata'));

    const still = stillOf('itm_a');
    expect(still).not.toBeNull();
    expect(still?.style.display).toBe('block');
    // The snapshot is an image of at most 320 x 180: a canvas on screen would be a layer of its own that the browser
    // keeps compositing (see StillPool).
    expect(still?.tagName).toBe('IMG');
    expect(still?.getAttribute('src')).toBe('data:image/jpeg;base64,still-320x180-1');
    expect(mounted.container.querySelector('canvas')).toBeNull();
    expect(canvas2d.videoDraws()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS * 4);
    expect(canvas2d.videoDraws()).toHaveLength(5);
    expect(stillOf('itm_a')?.getAttribute('src')).toBe('data:image/jpeg;base64,still-320x180-5');
  });

  it('copies one frame per source and refresh, however many thumbnails show the source', async () => {
    const canvas2d = fakeCanvas2d();
    const provider = thumbnail().provider;
    mounted = mounts[0];
    const second = thumbnail(provider);
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    second.renderer.show(scene('scn_b', [sceneItem('itm_c', CAMERA)]));
    // One hidden video per source, shared by both renderers.
    expect(document.querySelectorAll('.sf-r-stills video')).toHaveLength(2);
    expect(provider.attached(CAMERA)).toHaveLength(1);
    provider.live(CAMERA);
    provider.live(CAMERA_2);
    feederOf(CAMERA).dispatchEvent(new Event('loadeddata'));
    giveFrame(provider.attached(CAMERA_2)[0], 480, 270);
    provider.attached(CAMERA_2)[0].dispatchEvent(new Event('loadeddata'));
    // The first pictures: one copy per source, not per thumbnail.
    expect(canvas2d.videoDraws()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws()).toHaveLength(4);
    expect(stillOf('itm_a')).not.toBeNull();
    expect(second.part('itm_c', 'img')).not.toBeNull();
    // One snapshot per source, one image for every thumbnail that shows it.
    expect(stillOf('itm_a')?.getAttribute('src')).toBe(
      second.part('itm_c', 'img')?.getAttribute('src'),
    );
    expect(stillOf('itm_a')?.getAttribute('src')).not.toBe(stillOf('itm_b')?.getAttribute('src'));
  });

  it('waits with the next snapshots while copies are expensive on this computer', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    mounted.provider.live(CAMERA);
    mounted.provider.live(CAMERA_2);
    feederOf(CAMERA).dispatchEvent(new Event('loadeddata'));
    giveFrame(mounted.provider.attached(CAMERA_2)[0], 480, 270);
    mounted.provider.attached(CAMERA_2)[0].dispatchEvent(new Event('loadeddata'));
    expect(canvas2d.videoDraws()).toHaveLength(2);
    // 80 ms of copying are paid for after 2 s at 4 % of the time: the tick after 1.5 s finds the budget in debt.
    snapshotBudget.charge(80);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws()).toHaveLength(4);
  });

  it('renews the stalest snapshot first when the budget allows only one copy', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    mounted.provider.live(CAMERA);
    mounted.provider.live(CAMERA_2);
    const first = feederOf(CAMERA);
    first.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(100);
    const second = mounted.provider.attached(CAMERA_2)[0];
    giveFrame(second, 480, 270);
    second.dispatchEvent(new Event('loadeddata'));
    canvas2d.drawImage.mockClear();
    // One copy per round: the first source is older, so it goes first, then the other one.
    vi.spyOn(snapshotBudget, 'allows').mockReturnValueOnce(true).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws().map((call) => call[0])).toEqual([first]);
    vi.spyOn(snapshotBudget, 'allows').mockReturnValueOnce(true).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws().map((call) => call[0])).toEqual([first, second]);
  });

  it('keeps the last picture when the source is lost and does not copy any more', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    const feeder = feederOf(CAMERA);
    feeder.dispatchEvent(new Event('loadeddata'));
    const ended = { getVideoTracks: () => [{ readyState: 'ended' }] } as unknown as MediaStream;
    Object.defineProperty(feeder, 'srcObject', { value: ended, configurable: true });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS * 3);
    expect(canvas2d.videoDraws()).toHaveLength(1);
    expect(stillOf('itm_a')?.style.display).toBe('block');
  });

  it('spares the copies while nobody can see the thumbnails', async () => {
    const intersection = stubIntersectionObserver();
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    feederOf(CAMERA).dispatchEvent(new Event('loadeddata'));
    expect(canvas2d.videoDraws()).toHaveLength(1);
    intersection.report(false);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS * 3);
    expect(canvas2d.videoDraws()).toHaveLength(1);
    // The video is no longer asked for either.
    expect(mounted.provider.desired().size).toBe(0);
    intersection.report(true);
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS);
    expect(canvas2d.videoDraws()).toHaveLength(2);
  });

  it('spares the copies in a background tab', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    feederOf(CAMERA).dispatchEvent(new Event('loadeddata'));
    setPageVisibility('hidden');
    await vi.advanceTimersByTimeAsync(STILL_REFRESH_MS * 3);
    expect(canvas2d.videoDraws()).toHaveLength(1);
  });

  it('keeps the feeder and the picture when the item is kept by a cut to a scene with the same source', async () => {
    fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.provider.live(CAMERA);
    const feeder = feederOf(CAMERA);
    feeder.dispatchEvent(new Event('loadeddata'));
    mounted.renderer.show(scene('scn_b', [sceneItem('itm_b', CAMERA, { w: 320, h: 180 })]));
    expect(mounted.provider.attached(CAMERA)).toEqual([feeder]);
    expect(document.querySelectorAll('.sf-r-stills video')).toHaveLength(1);
    expect(mounted.provider.detachCalls).toHaveLength(0);
    expect(stillOf('itm_b')).not.toBeNull();
  });

  it('releases the feeder when the last thumbnail leaves and removes the pool when it is empty', () => {
    fakeCanvas2d();
    mounted = thumbnail();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA), sceneItem('itm_b', CAMERA_2)]),
    );
    expect(mounted.provider.registrationCount).toBe(2);
    mounted.renderer.update(scene('scn_a', [sceneItem('itm_a', CAMERA)], { version: 2 }));
    expect(mounted.provider.registrationCount).toBe(1);
    mounted.renderer.destroy();
    expect(mounted.provider.registrationCount).toBe(0);
    expect(document.querySelectorAll('.sf-r-stills')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives a provider that throws on attach and detach', () => {
    mounted = thumbnail();
    vi.spyOn(mounted.provider, 'attach').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(mounted.provider, 'detach').mockImplementation(() => {
      throw new Error('boom');
    });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    mounted.renderer.destroy();
    expect(mounted.errors.length).toBeGreaterThan(0);
  });

  it('asks the provider for the small picture the thumbnail needs', () => {
    mounted = thumbnail();
    mounted.renderer.show(
      scene('scn_a', [sceneItem('itm_a', CAMERA, { x: 0, y: 0, w: 640, h: 360 })]),
    );
    // 160 px wide container, scale 160 / 1920: 640 x 360 canvas pixels are 54 x 30 screen pixels.
    expect(mounted.provider.desired().get(CAMERA)).toEqual({ width: 64, height: 32 });
  });
});
