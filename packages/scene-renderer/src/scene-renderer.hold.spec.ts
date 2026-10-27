import { DEFAULT_CANVAS, autoGridSlots } from '@studioflow/scene-model';

import { snapshotBudget } from './snapshot-budget';
import {
  CAMERA,
  CAMERA_2,
  clearFrame,
  fakeAnimate,
  fakeCanvas2d,
  fakePictureProbe,
  giveFrame,
  giveMetadataOnly,
  IMAGE,
  mount,
  PAUSE_IMAGE,
  phone,
  scene,
  sceneItem,
  type Mounted,
} from './testing/fixtures';

function slotRect(count: number, index: number): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = autoGridSlots(count, DEFAULT_CANVAS)[index];
  return { x, y, w, h };
}

describe('scene renderer: hold frame', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers();
    snapshotBudget.reset();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function showCamera(overrides: Parameters<typeof sceneItem>[2] = {}): HTMLVideoElement {
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA, overrides)]));
    const video = mounted.part('itm_a', 'video') as HTMLVideoElement;
    mounted.provider.live(CAMERA);
    giveFrame(video);
    return video;
  }

  const held = (): HTMLElement | null => mounted.part('itm_a', '.sf-r-held');
  const box = (): HTMLElement | null => mounted.part('itm_a', '.sf-r-box');
  const snapshot = (): HTMLCanvasElement | null => mounted.part('itm_a', 'canvas');

  it('copies the current frame into the hold frame the moment the source is lost', () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera({ w: 1280, h: 720 });
    expect(snapshot()).toBeNull();

    mounted.provider.lose(CAMERA);
    const copy = snapshot();
    expect(copy).not.toBeNull();
    expect(copy?.width).toBe(1280);
    expect(copy?.height).toBe(720);
    expect(copy?.style.display).toBe('block');
    expect(canvas2d.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(copy?.style.objectFit).toBe('cover');
    // The video stays in place (the provider keeps its last frame as well).
    expect(mounted.part('itm_a', 'video')).toBe(video);
    // Still sharp during the hold time.
    expect(held()?.style.display).toBe('none');
    expect(box()?.style.filter).toBe('');
    // Exactly one copy, not one per render.
    mounted.renderer.refresh();
    expect(canvas2d.copies()).toHaveLength(1);
  });

  it('copies at on-screen resolution and mirrors the hold frame like the video', () => {
    fakeCanvas2d();
    mounted = mount();
    const video = showCamera({ mirror: true, fit: 'contain', x: 0, y: 0, w: 1920, h: 1080 });
    giveFrame(video, 3840, 2160);
    mounted.provider.lose(CAMERA);
    expect(snapshot()?.width).toBe(1920);
    expect(snapshot()?.height).toBe(1080);
    expect(snapshot()?.style.transform).toBe('scaleX(-1)');
    expect(snapshot()?.style.objectFit).toBe('contain');
  });

  it('copies small items at their on-screen size (stage scale × device pixel ratio, at most 1.5)', () => {
    fakeCanvas2d();
    vi.stubGlobal('devicePixelRatio', 2);
    try {
      mounted = mount({}, { width: 960, height: 540 });
      showCamera({ w: 640, h: 360 });
      mounted.provider.lose(CAMERA);
      // 640 × 0.5 × 1.5 = 480 px on screen (the ratio 2 counts as 1.5); the 1280 × 720 frame is scaled to that.
      expect([snapshot()?.width, snapshot()?.height]).toEqual([484, 272]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a rolling copy of live pictures, once per second', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(3000);
    expect(canvas2d.copies()).toHaveLength(3);
    expect(canvas2d.videoDraws().at(-1)).toEqual([video, 0, 0, 654, 368]);
    // The copy is kept hidden while the source is live.
    expect(snapshot()?.style.display).toBe('none');
  });

  it('copies less often while a copy is expensive on this computer, but always takes the first one', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    // A slow computer: the budget is in debt before the first copy, which is taken anyway (the item has none yet).
    snapshotBudget.charge(60);
    showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas2d.copies()).toHaveLength(1);
    // The next copy waits until 60 ms of copying are paid for at 4 % of the time (1.5 s after the charge).
    snapshotBudget.charge(60);
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas2d.copies()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas2d.copies()).toHaveLength(2);
  });

  it('takes the copy at the loss however much the budget is in debt', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas2d.copies()).toHaveLength(1);
    snapshotBudget.charge(10_000);
    const running = { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
    Object.defineProperty(video, 'srcObject', { value: running, configurable: true });
    mounted.provider.lose(CAMERA);
    expect(canvas2d.copies()).toHaveLength(2);
  });

  it('keeps the rolling copy when the track already ended at the loss (Chromium paints it black)', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas2d.copies()).toHaveLength(1);
    const ended = { getVideoTracks: () => [{ readyState: 'ended' }] } as unknown as MediaStream;
    Object.defineProperty(video, 'srcObject', { value: ended, configurable: true });
    mounted.provider.lose(CAMERA);
    expect(canvas2d.copies()).toHaveLength(1);
    expect(snapshot()?.style.display).toBe('block');
    // No refreshes while lost (the blur of the held state draws canvas to canvas, never from the video).
    await vi.advanceTimersByTimeAsync(5000);
    expect(canvas2d.videoDraws()).toHaveLength(1);
  });

  describe('nothing black on air (issue #50)', () => {
    const running = { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;

    it('keeps the good rolling copy when the frame at the loss is already black though the track still runs', async () => {
      const canvas2d = fakeCanvas2d();
      const probe = fakePictureProbe('picture');
      mounted = mount();
      const video = showCamera();
      await vi.advanceTimersByTimeAsync(1000);
      expect(canvas2d.copies()).toHaveLength(1);
      expect(probe.probes).toBe(1);

      // The browser paints the element black a moment before the track says that it ended.
      Object.defineProperty(video, 'srcObject', { value: running, configurable: true });
      probe.show = 'black';
      mounted.provider.lose(CAMERA);
      expect(canvas2d.videoDraws()).toHaveLength(2);
      expect(canvas2d.copies()).toHaveLength(1);
      expect(snapshot()?.style.display).toBe('block');
      expect(snapshot()?.width).toBe(654);
      expect(mounted.errors).toEqual([]);
    });

    it('copies no video that was never painted, and no hold frame is shown for it', async () => {
      const canvas2d = fakeCanvas2d();
      const probe = fakePictureProbe('transparent');
      mounted = mount();
      showCamera();
      await vi.advanceTimersByTimeAsync(3000);
      expect(canvas2d.copies()).toHaveLength(0);
      expect(snapshot()).toBeNull();

      // Lost before there was ever a picture: the item shows no empty canvas, only the scrim of the held state.
      mounted.provider.lose(CAMERA);
      expect(snapshot()).toBeNull();
      await vi.advanceTimersByTimeAsync(3000);
      expect(snapshot()).toBeNull();
      expect(held()?.style.display).toBe('flex');

      // The first real picture makes a copy as usual.
      mounted.provider.live(CAMERA);
      giveFrame(mounted.part('itm_a', 'video') as HTMLVideoElement);
      probe.show = 'picture';
      await vi.advanceTimersByTimeAsync(1000);
      expect(canvas2d.copies()).toHaveLength(1);
      expect(snapshot()).not.toBeNull();
    });

    it('does not take a video for a frame that only knows its size (metadata, no decoded frame yet)', async () => {
      const canvas2d = fakeCanvas2d();
      fakePictureProbe('picture');
      mounted = mount();
      const video = showCamera();
      giveMetadataOnly(video);
      await vi.advanceTimersByTimeAsync(3000);
      expect(canvas2d.videoDraws()).toHaveLength(0);
      expect(canvas2d.copies()).toHaveLength(0);
      mounted.provider.lose(CAMERA);
      expect(snapshot()).toBeNull();

      mounted.provider.live(CAMERA);
      const returned = mounted.part('itm_a', 'video') as HTMLVideoElement;
      giveFrame(returned);
      returned.dispatchEvent(new Event('loadeddata'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(canvas2d.copies()).toHaveLength(1);
    });

    it('keeps showing the old copy when later frames turn out to be black', async () => {
      const canvas2d = fakeCanvas2d();
      const probe = fakePictureProbe('picture');
      mounted = mount();
      showCamera();
      await vi.advanceTimersByTimeAsync(1000);
      expect(canvas2d.copies()).toHaveLength(1);
      probe.show = 'black';
      await vi.advanceTimersByTimeAsync(5000);
      expect(canvas2d.copies()).toHaveLength(1);
      mounted.provider.lose(CAMERA);
      expect(snapshot()?.style.display).toBe('block');
    });
  });

  it('takes a fresh copy at the loss while the track still runs', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    const running = { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
    Object.defineProperty(video, 'srcObject', { value: running, configurable: true });
    mounted.provider.lose(CAMERA);
    expect(canvas2d.copies()).toHaveLength(2);
  });

  it('does not refresh hold frames while the page is hidden', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    showCamera();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      await vi.advanceTimersByTimeAsync(3000);
      expect(canvas2d.drawImage).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('skips the snapshot without a frame or without a 2D context, without errors', () => {
    mounted = mount();
    const video = showCamera();
    mounted.provider.lose(CAMERA);
    expect(snapshot()).toBeNull();

    mounted.provider.live(CAMERA);
    clearFrame(video);
    fakeCanvas2d();
    mounted.provider.lose(CAMERA);
    expect(snapshot()).toBeNull();
    expect(mounted.errors).toEqual([]);
  });

  it('ignores a failing drawImage', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: () => {
            throw new DOMException('tainted', 'SecurityError');
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    mounted = mount();
    showCamera();
    mounted.provider.lose(CAMERA);
    expect(snapshot()).toBeNull();
    expect(mounted.errors).toEqual([]);
  });

  it('darkens after holdMs: blur, scrim and “Picture returns shortly”', async () => {
    const canvas2d = fakeCanvas2d({ filter: true });
    mounted = mount();
    showCamera({ w: 640, h: 360 });
    mounted.provider.lose(CAMERA);

    await vi.advanceTimersByTimeAsync(2999);
    expect(held()?.style.display).toBe('none');
    expect(canvas2d.filters).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(held()?.style.display).toBe('flex');
    expect(held()?.textContent).toBe('Picture returns shortly');
    expect(held()?.style.background).toBe('rgba(13, 17, 23, 0.72)');
    expect(mounted.part('itm_a', '.sf-r-held-text')?.style.display).toBe('inline');
    // The blur is baked into the copy (16 px on the stage, 654 px copy of a 640 px item), not a live CSS filter.
    expect(canvas2d.filters).toEqual(['blur(16.4px)', 'none']);
    expect(box()?.style.filter).toBe('');
    // The radius is exposed for tools and E2E tests (canvas pixels: 2.5 % of the 640 px item).
    expect(box()?.getAttribute('data-held-blur')).toBe('16');
    expect(snapshot()).not.toBeNull();
  });

  it('blurs the copy only once, however often the item renders, and starts sharp again with a new copy', async () => {
    const canvas2d = fakeCanvas2d({ filter: true });
    mounted = mount();
    showCamera({ w: 640, h: 360 });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(canvas2d.filters).toEqual(['blur(16.4px)', 'none']);
    for (let i = 0; i < 5; i += 1) {
      mounted.renderer.refresh();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(canvas2d.filters).toEqual(['blur(16.4px)', 'none']);

    // The source returns: the picture is shown again and the rolling copy is renewed sharp.
    mounted.provider.live(CAMERA);
    const video = mounted.part('itm_a', 'video') as HTMLVideoElement;
    giveFrame(video);
    video.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(held()?.style.display).toBe('none');
    expect(box()?.hasAttribute('data-held-blur')).toBe(false);
    expect(canvas2d.videoDraws().length).toBeGreaterThan(1);
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(canvas2d.filters).toEqual(['blur(16.4px)', 'none', 'blur(16.4px)', 'none']);
  });

  it('blurs by shrinking and enlarging where the canvas has no filter (Safari)', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    showCamera({ w: 640, h: 360 });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    // The enlarged picture replaces the sharp one in one step ("copy"): the hold frame is never cleared first (only the
    // scratch canvas is, before each frame is drawn into it).
    expect(canvas2d.clearRect).toHaveBeenCalledTimes(canvas2d.videoDraws().length);
    expect(canvas2d.compositeOperations).toEqual(['copy', 'source-over']);
    const fromCanvas = canvas2d.drawImage.mock.calls.filter(
      (call: unknown[]) =>
        call[0] instanceof HTMLCanvasElement && call[0].className !== 'sf-r-scratch',
    );
    expect(fromCanvas).toHaveLength(2);
    expect(box()?.style.filter).toBe('');
  });

  it('falls back to the CSS blur when the copy cannot be blurred, and the sharp copy is not touched', async () => {
    const canvas2d = fakeCanvas2d();
    canvas2d.drawImage.mockImplementation((source: unknown) => {
      if (source instanceof HTMLCanvasElement && source.className !== 'sf-r-scratch') {
        throw new DOMException('lost context', 'InvalidStateError');
      }
    });
    mounted = mount();
    showCamera({ w: 640, h: 360 });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(held()?.style.display).toBe('flex');
    expect(box()?.style.filter).toBe('blur(16px)');
    expect(snapshot()?.style.display).toBe('block');
    expect(canvas2d.clearRect).toHaveBeenCalledTimes(canvas2d.videoDraws().length);
    expect(mounted.errors).toEqual([]);
  });

  it('puts the sharp picture back when the blur fails after the canvas was cleared (never an empty hold frame, issue #50)', async () => {
    const canvas2d = fakeCanvas2d({ filter: true });
    let fromCanvas = 0;
    canvas2d.drawImage.mockImplementation((source: unknown) => {
      if (source instanceof HTMLCanvasElement && source.className !== 'sf-r-scratch') {
        fromCanvas += 1;
        // 1: the sharp picture into the scratch canvas, 2: the blurred picture into the hold frame (refused), 3: put back.
        if (fromCanvas === 2) {
          throw new DOMException('lost context', 'InvalidStateError');
        }
      }
    });
    mounted = mount();
    showCamera({ w: 640, h: 360 });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fromCanvas).toBe(3);
    expect(canvas2d.clearRect).toHaveBeenCalledTimes(2 + canvas2d.videoDraws().length);
    expect(canvas2d.filters.at(-1)).toBe('none');
    expect(held()?.style.display).toBe('flex');
    expect(box()?.style.filter).toBe('blur(16px)');
    expect(box()?.hasAttribute('data-held-blur')).toBe(false);
    expect(mounted.errors).toEqual([]);
  });

  it('omits the hold message on items narrower than 320 canvas pixels', async () => {
    mounted = mount();
    showCamera({ w: 319, h: 180 });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    expect(held()?.style.display).toBe('flex');
    expect(mounted.part('itm_a', '.sf-r-held-text')?.style.display).toBe('none');
    expect(box()?.style.filter).toBe('blur(8px)');
  });

  it('uses the provider lost time: a source lost 2 s ago escalates after 1 s', async () => {
    mounted = mount();
    showCamera();
    mounted.provider.lose(CAMERA, performance.now() - 2000);
    await vi.advanceTimersByTimeAsync(999);
    expect(held()?.style.display).toBe('none');
    await vi.advanceTimersByTimeAsync(1);
    expect(held()?.style.display).toBe('flex');
  });

  it('is held at once with holdMs 0', () => {
    mounted = mount();
    showCamera({ onLost: { holdMs: 0, fallbackSource: null } });
    mounted.provider.lose(CAMERA);
    expect(held()?.style.display).toBe('flex');
  });

  it('never escalates with holdMs null', async () => {
    fakeCanvas2d();
    mounted = mount();
    showCamera({ onLost: { holdMs: null, fallbackSource: null } });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(held()?.style.display).toBe('none');
    expect(snapshot()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the held state only when the returned video has a frame', async () => {
    fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);

    // The provider sets a new srcObject: no frame yet, so the darkened picture stays.
    clearFrame(video);
    mounted.provider.live(CAMERA);
    expect(held()?.style.display).toBe('flex');
    expect(snapshot()).not.toBeNull();

    giveFrame(video);
    video.dispatchEvent(new Event('loadeddata'));
    expect(held()?.style.display).toBe('none');
    expect(box()?.style.filter).toBe('');
    expect(snapshot()?.style.display).toBe('none');
    // Only the rolling copy of the live picture keeps running.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('removes the hold picture at once when the video still has frames', async () => {
    fakeCanvas2d();
    mounted = mount();
    showCamera();
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    mounted.provider.live(CAMERA);
    expect(held()?.style.display).toBe('none');
    expect(snapshot()?.style.display).toBe('none');
  });

  it('gives up waiting for the first frame after 1.5 s', async () => {
    fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    clearFrame(video);
    mounted.provider.live(CAMERA);
    await vi.advanceTimersByTimeAsync(1499);
    expect(held()?.style.display).toBe('flex');
    await vi.advanceTimersByTimeAsync(1);
    expect(held()?.style.display).toBe('none');
    expect(snapshot()?.style.display).toBe('none');
  });

  it('keeps the hold picture when the source drops again while waiting for its first frame', async () => {
    fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);
    clearFrame(video);
    mounted.provider.live(CAMERA);
    mounted.provider.lose(CAMERA);
    video.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshot()?.style.display).toBe('block');
    // A fresh hold time started with the second loss.
    expect(held()?.style.display).toBe('none');
    await vi.advanceTimersByTimeAsync(1000);
    expect(held()?.style.display).toBe('flex');
  });

  it('shows the fallback source after holdMs and removes it when the source returns', async () => {
    fakeCanvas2d();
    mounted = mount();
    const video = showCamera({
      mirror: true,
      onLost: { holdMs: 3000, fallbackSource: PAUSE_IMAGE },
    });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(3000);

    const fallback = mounted.part('itm_a', '.sf-r-fallback');
    expect(fallback?.style.display).toBe('block');
    const image = fallback?.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/media/pause.png');
    // Crop, rotation and mirror stay with the primary picture.
    expect(image?.style.transform).toBe('');
    expect(box()?.style.opacity).toBe('0');
    expect(held()?.style.display).toBe('none');
    // The primary video stays registered to notice the return.
    expect(mounted.provider.attached(CAMERA)).toEqual([video]);

    mounted.provider.live(CAMERA);
    expect(fallback?.style.display).toBe('none');
    expect(fallback?.querySelector('img')).toBeNull();
    expect(box()?.style.opacity).toBe('');
  });

  it('shows a device fallback source and releases it afterwards', async () => {
    mounted = mount();
    showCamera({ onLost: { holdMs: 1000, fallbackSource: CAMERA_2 } });
    mounted.provider.lose(CAMERA);
    await vi.advanceTimersByTimeAsync(1000);
    const fallbackVideo = mounted.part('itm_a', '.sf-r-fallback video');
    expect(fallbackVideo).not.toBeNull();
    expect(mounted.provider.attached(CAMERA_2)).toEqual([fallbackVideo]);
    expect(mounted.provider.desired().has(CAMERA_2)).toBe(true);

    mounted.provider.live(CAMERA);
    expect(mounted.provider.attached(CAMERA_2)).toEqual([]);
    expect(mounted.provider.desired().has(CAMERA_2)).toBe(false);
  });

  it('ignores a fallback that equals the source itself', async () => {
    mounted = mount();
    showCamera({ onLost: { holdMs: 0, fallbackSource: CAMERA } });
    mounted.provider.lose(CAMERA);
    expect(held()?.style.display).toBe('flex');
    expect(mounted.part('itm_a', '.sf-r-fallback')?.style.display).toBe('none');
  });

  it('shows the dark placeholder for pending sources, never a held frame', async () => {
    fakeCanvas2d();
    mounted = mount();
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_a', CAMERA)]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mounted.item('itm_a')?.style.backgroundColor).toBe('#121821');
    expect(held()?.style.display).toBe('none');
    expect(snapshot()).toBeNull();
  });

  it('runs one timer for all hold expiries', async () => {
    mounted = mount();
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_a', CAMERA, { onLost: { holdMs: 3000, fallbackSource: null } }),
        sceneItem('itm_b', CAMERA_2, { onLost: { holdMs: 10_000, fallbackSource: null } }),
      ]),
    );
    mounted.provider.live(CAMERA);
    mounted.provider.live(CAMERA_2);
    mounted.provider.lose(CAMERA);
    mounted.provider.lose(CAMERA_2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mounted.part('itm_a', '.sf-r-held')?.style.display).toBe('flex');
    expect(mounted.part('itm_b', '.sf-r-held')?.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(7000);
    expect(mounted.part('itm_b', '.sf-r-held')?.style.display).toBe('flex');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the hold state when the item moves to another layer by a cut', async () => {
    fakeCanvas2d();
    mounted = mount();
    showCamera();
    mounted.provider.lose(CAMERA);
    mounted.renderer.show(scene('scn_b', [sceneItem('itm_b', CAMERA, { w: 800 })]));
    await vi.advanceTimersByTimeAsync(3000);
    expect(mounted.part('itm_b', '.sf-r-held')?.style.display).toBe('flex');
  });

  function endTrack(video: HTMLVideoElement): void {
    const ended = { getVideoTracks: () => [{ readyState: 'ended' }] } as unknown as MediaStream;
    Object.defineProperty(video, 'srcObject', { value: ended, configurable: true });
  }

  it('gives an item that appears by a cut during a loss the hold frame of the replaced item', async () => {
    const canvas2d = fakeCanvas2d();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    endTrack(video);
    mounted.provider.lose(CAMERA);
    const donor = snapshot();
    mounted.renderer.show(scene('scn_b', [sceneItem('itm_b', CAMERA, { w: 800, h: 450 })]));
    const copy = mounted.part('itm_b', 'canvas') as HTMLCanvasElement | null;
    expect(copy).not.toBeNull();
    expect(copy).not.toBe(donor);
    expect(canvas2d.drawImage).toHaveBeenLastCalledWith(donor, 0, 0);
    expect(copy?.style.display).toBe('block');
  });

  it('gives an item that fades in during a loss the hold frame of the outgoing item', async () => {
    const canvas2d = fakeCanvas2d();
    fakeAnimate();
    mounted = mount();
    const video = showCamera();
    await vi.advanceTimersByTimeAsync(1000);
    endTrack(video);
    mounted.provider.lose(CAMERA);
    const donor = snapshot();
    void mounted.renderer.transitionTo(scene('scn_b', [sceneItem('itm_b', CAMERA)]), {
      kind: 'fade',
      durationMs: 500,
    });
    const copy = mounted.part('itm_b', 'canvas');
    expect(copy).not.toBeNull();
    expect(canvas2d.drawImage).toHaveBeenLastCalledWith(donor, 0, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(mounted.item('itm_a')).toBeNull();
    expect(copy?.style.display).toBe('block');
  });

  it('has no hold frame for an item that appears during a loss without any donor', () => {
    fakeCanvas2d();
    mounted = mount();
    mounted.provider.live(CAMERA);
    mounted.provider.lose(CAMERA);
    mounted.renderer.show(scene('scn_b', [sceneItem('itm_b', CAMERA)]));
    expect(mounted.part('itm_b', 'canvas')).toBeNull();
    expect(mounted.errors).toEqual([]);
  });
});

describe('scene renderer: Auto-Grid', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.useRealTimers();
  });

  function showGrid(count: number, holdMs: number | null = 3000): void {
    mounted.renderer.show(
      scene(
        'scn_grid',
        Array.from({ length: count }, (_, index) =>
          sceneItem(`itm_${index}`, phone(index + 1), { onLost: { holdMs, fallbackSource: null } }),
        ),
        { layoutMode: 'autoGrid' },
      ),
    );
  }

  it.each([1, 2, 3, 4, 5, 9, 10])('places %i live sources on the Auto-Grid slots', (count) => {
    mounted = mount();
    showGrid(count);
    for (let index = 0; index < count; index += 1) {
      mounted.provider.live(phone(index + 1));
    }
    const rects = mounted.renderer.effectiveRects();
    expect(rects.size).toBe(Math.min(count, 9));
    for (let index = 0; index < Math.min(count, 9); index += 1) {
      expect(rects.get(`itm_${index}`)).toEqual(slotRect(count, index));
      expect(mounted.item(`itm_${index}`)?.style.display).toBe('block');
    }
    if (count === 10) {
      expect(mounted.item('itm_9')?.style.display).toBe('none');
    }
  });

  it('does not place pending sources and reflows when they arrive', () => {
    mounted = mount();
    showGrid(3);
    mounted.provider.live(phone(1));
    expect(mounted.renderer.effectiveRects().size).toBe(1);
    expect(mounted.renderer.effectiveRects().get('itm_0')).toEqual(slotRect(1, 0));
    expect(mounted.item('itm_1')?.style.display).toBe('none');
    mounted.provider.live(phone(3));
    expect(mounted.renderer.effectiveRects().get('itm_2')).toEqual(slotRect(2, 1));
  });

  it('keeps a lost source in its slot during the hold time, then reflows; reflows back on return', async () => {
    mounted = mount();
    showGrid(4);
    for (let index = 1; index <= 4; index += 1) {
      mounted.provider.live(phone(index));
    }
    mounted.provider.lose(phone(2));
    expect(mounted.renderer.effectiveRects().size).toBe(4);
    await vi.advanceTimersByTimeAsync(2999);
    expect(mounted.renderer.effectiveRects().size).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    const rects = mounted.renderer.effectiveRects();
    expect(rects.size).toBe(3);
    expect(rects.has('itm_1')).toBe(false);
    expect(rects.get('itm_2')).toEqual(slotRect(3, 1));
    expect(mounted.item('itm_1')?.style.display).toBe('none');

    mounted.provider.live(phone(2));
    expect(mounted.renderer.effectiveRects().get('itm_1')).toEqual(slotRect(4, 1));
  });

  it('keeps a lost source placed forever with holdMs null', async () => {
    mounted = mount();
    showGrid(2, null);
    mounted.provider.live(phone(1));
    mounted.provider.live(phone(2));
    mounted.provider.lose(phone(1));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mounted.renderer.effectiveRects().size).toBe(2);
  });

  it('always places media and never hidden items', () => {
    mounted = mount();
    mounted.renderer.show(
      scene(
        'scn_grid',
        [
          sceneItem('itm_img', IMAGE),
          sceneItem('itm_hidden', CAMERA, { hidden: true }),
          sceneItem('itm_cam', CAMERA_2),
        ],
        { layoutMode: 'autoGrid' },
      ),
    );
    mounted.provider.live(CAMERA);
    expect([...mounted.renderer.effectiveRects().keys()]).toEqual(['itm_img']);
    mounted.provider.live(CAMERA_2);
    expect([...mounted.renderer.effectiveRects().keys()]).toEqual(['itm_img', 'itm_cam']);
  });

  it('keeps sources that wait for a slot subscribed with a small picture', () => {
    mounted = mount();
    showGrid(2);
    mounted.provider.live(phone(1));
    expect(mounted.provider.desired().get(phone(2))).toEqual({ width: 320, height: 180 });
  });

  it('switches between free and Auto-Grid on update', () => {
    mounted = mount();
    const items = [sceneItem('itm_a', CAMERA, { x: 5, y: 6, w: 100, h: 60 })];
    mounted.renderer.show(scene('scn_a', items));
    mounted.provider.live(CAMERA);
    expect(mounted.renderer.effectiveRects().get('itm_a')).toEqual({ x: 5, y: 6, w: 100, h: 60 });
    mounted.renderer.update(scene('scn_a', items, { version: 2, layoutMode: 'autoGrid' }));
    expect(mounted.renderer.effectiveRects().get('itm_a')).toEqual(slotRect(1, 0));
  });
});
