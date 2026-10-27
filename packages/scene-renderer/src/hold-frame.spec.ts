import {
  copyHoldFrame,
  copySize,
  copyVideoFrame,
  hasRunningTrack,
  hasVideoFrame,
  releaseCanvas,
  showsPicture,
  waitForVideoFrame,
} from './hold-frame';
import {
  clearFrame,
  fakeCanvas2d,
  fakePictureProbe,
  giveFrame,
  giveMetadataOnly,
} from './testing/fixtures';

function streamWith(...states: MediaStreamTrackState[]): MediaStream {
  return {
    getVideoTracks: () => states.map((readyState) => ({ readyState })),
  } as unknown as MediaStream;
}

describe('hold frame helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sizes copies to the on-screen picture, never larger than the frame or 1920 px', () => {
    expect(copySize(1280, 720, { width: 640, height: 368 })).toEqual({ width: 654, height: 368 });
    expect(copySize(1280, 720, { width: 4000, height: 4000 })).toEqual({
      width: 1280,
      height: 720,
    });
    expect(copySize(3840, 2160, { width: 3840, height: 2160 })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(copySize(720, 1280, { width: 16, height: 16 })).toEqual({ width: 16, height: 28 });
  });

  it('knows when the frame and the track are there', () => {
    const video = document.createElement('video');
    expect(hasVideoFrame(video)).toBe(false);
    giveFrame(video);
    expect(hasVideoFrame(video)).toBe(true);
    clearFrame(video);
    expect(hasVideoFrame(video)).toBe(false);
    // The size is known from the metadata on, the frame is not there before it is decoded.
    giveMetadataOnly(video);
    expect(video.videoWidth).toBe(1280);
    expect(hasVideoFrame(video)).toBe(false);

    expect(hasRunningTrack(video)).toBe(true);
    Object.defineProperty(video, 'srcObject', { value: streamWith('ended'), configurable: true });
    expect(hasRunningTrack(video)).toBe(false);
    Object.defineProperty(video, 'srcObject', {
      value: streamWith('ended', 'live'),
      configurable: true,
    });
    expect(hasRunningTrack(video)).toBe(true);
    Object.defineProperty(video, 'srcObject', { value: streamWith(), configurable: true });
    expect(hasRunningTrack(video)).toBe(false);
  });

  it('copies only frames of running tracks and reuses the canvas size', () => {
    const { drawImage } = fakeCanvas2d();
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const limit = { width: 640, height: 368 };
    expect(copyVideoFrame(video, canvas, limit)).toBe(false);
    giveFrame(video);
    expect(copyVideoFrame(video, canvas, limit)).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([654, 368]);
    expect(copyVideoFrame(video, canvas, limit)).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(2);
    Object.defineProperty(video, 'srcObject', { value: streamWith('ended'), configurable: true });
    expect(copyVideoFrame(video, canvas, limit)).toBe(false);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('tells a picture from nothing painted and from black (issue #50)', () => {
    const video = document.createElement('video');
    const probe = fakePictureProbe('picture');
    expect(showsPicture(video)).toBe(true);
    probe.show = 'black';
    expect(showsPicture(video)).toBe(false);
    probe.show = 'transparent';
    expect(showsPicture(video)).toBe(false);
    probe.show = 'picture';
    expect(showsPicture(video)).toBe(true);
    expect(probe.probes).toBe(4);
  });

  it('counts a frame as a picture where the browser cannot tell', () => {
    const video = document.createElement('video');
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(showsPicture(video)).toBe(true);
    class Refusing {
      getContext(): unknown {
        return {
          clearRect: () => undefined,
          drawImage: () => undefined,
          getImageData: () => {
            throw new DOMException('refused', 'SecurityError');
          },
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', Refusing);
    expect(showsPicture(video)).toBe(true);
    class NoContext {
      getContext(): unknown {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', NoContext);
    expect(showsPicture(video)).toBe(true);
  });

  it('does not copy a frame that shows nothing and leaves the canvas as it was', () => {
    const { drawImage } = fakeCanvas2d();
    const probe = fakePictureProbe('picture');
    const video = document.createElement('video');
    giveFrame(video);
    const canvas = document.createElement('canvas');
    const limit = { width: 640, height: 368 };
    expect(copyVideoFrame(video, canvas, limit)).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([654, 368]);
    expect(drawImage).toHaveBeenCalledTimes(1);

    // Never painted, then black: the good copy is not overwritten and not resized (which would clear it).
    giveFrame(video, 640, 360);
    for (const show of ['transparent', 'black'] as const) {
      probe.show = show;
      expect(copyVideoFrame(video, canvas, limit)).toBe(false);
      expect([canvas.width, canvas.height]).toEqual([654, 368]);
      expect(drawImage).toHaveBeenCalledTimes(1);
    }
    probe.show = 'picture';
    expect(copyVideoFrame(video, canvas, limit)).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('does not copy a video that only knows its size', () => {
    const { drawImage } = fakeCanvas2d();
    fakePictureProbe('picture');
    const video = document.createElement('video');
    giveMetadataOnly(video);
    expect(
      copyVideoFrame(video, document.createElement('canvas'), { width: 640, height: 368 }),
    ).toBe(false);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('reports refused copies instead of throwing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('context lost');
    });
    const video = document.createElement('video');
    giveFrame(video);
    expect(
      copyVideoFrame(video, document.createElement('canvas'), { width: 100, height: 100 }),
    ).toBe(false);
  });

  it('copies another hold frame canvas, but not an empty one', () => {
    const { drawImage } = fakeCanvas2d();
    const donor = document.createElement('canvas');
    donor.width = 654;
    donor.height = 368;
    const target = document.createElement('canvas');
    expect(copyHoldFrame(donor, target)).toBe(true);
    expect([target.width, target.height]).toEqual([654, 368]);
    expect(drawImage).toHaveBeenCalledWith(donor, 0, 0);
    donor.width = 0;
    expect(copyHoldFrame(donor, document.createElement('canvas'))).toBe(false);
  });

  it('frees the canvas buffer', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    host.append(canvas);
    releaseCanvas(canvas);
    expect(canvas.width).toBe(0);
    expect(host.childElementCount).toBe(0);
  });

  it('waits for the first frame once, with a timeout, and can be cancelled', async () => {
    vi.useFakeTimers();
    const video = document.createElement('video');
    const ready = vi.fn();
    waitForVideoFrame(video, 1500, ready);
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(ready).toHaveBeenCalledTimes(1);

    const timedOut = vi.fn();
    waitForVideoFrame(video, 1500, timedOut);
    await vi.advanceTimersByTimeAsync(1500);
    expect(timedOut).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const cancel = waitForVideoFrame(video, 1500, cancelled);
    cancel();
    cancel();
    video.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(cancelled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
