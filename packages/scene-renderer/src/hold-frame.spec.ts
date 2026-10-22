import {
  copyHoldFrame,
  copySize,
  copyVideoFrame,
  hasRunningTrack,
  hasVideoFrame,
  releaseCanvas,
  waitForVideoFrame,
} from './hold-frame';
import { clearFrame, fakeCanvas2d, giveFrame } from './testing/fixtures';

function streamWith(...states: MediaStreamTrackState[]): MediaStream {
  return {
    getVideoTracks: () => states.map((readyState) => ({ readyState })),
  } as unknown as MediaStream;
}

describe('hold frame helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
