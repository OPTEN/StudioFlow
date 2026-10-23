import { DeferredSourceProvider } from './deferred-provider';
import { MAX_LATENCY_SAMPLES, startLatencyProbe, type LatencySampleTarget } from './latency-probe';
import { STAMP, stampBlocks } from './latency-stamp';
import { CAMERA, SCREEN } from './testing/fixtures';

/** A 640 × 48 RGBA strip with the stamp of `timeMs`. */
function strip(timeMs: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(STAMP.width * STAMP.barHeight * 4).fill(128);
  stampBlocks(timeMs).forEach((on, block) => {
    for (let y = 0; y < STAMP.barHeight; y += 1) {
      for (let x = block * STAMP.blockWidth; x < (block + 1) * STAMP.blockWidth; x += 1) {
        const offset = (y * STAMP.width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = on ? 255 : 0;
      }
    }
  });
  return pixels;
}

/** A video element with a controllable `requestVideoFrameCallback`. */
function frameVideo() {
  const video = document.createElement('video');
  let next: VideoFrameRequestCallback | null = null;
  let handle = 0;
  const cancelled: number[] = [];
  Object.assign(video, {
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => {
      next = callback;
      handle += 1;
      return handle;
    },
    cancelVideoFrameCallback: (id: number) => cancelled.push(id),
  });
  const frame = (displayAt: number, width = 640, height = 360): void => {
    const callback = next;
    next = null;
    callback?.(displayAt, {
      expectedDisplayTime: displayAt,
      width,
      height,
      mediaTime: 0,
      presentationTime: displayAt,
      presentedFrames: 1,
    });
  };
  return { video, frame, cancelled, pending: () => next !== null };
}

describe('latency probe (?latency=1 test aid)', () => {
  const WALL_ORIGIN = 1_761_127_200_000;

  function setup(stampFor: (video: HTMLVideoElement) => number | null) {
    const registry = new DeferredSourceProvider(() => null);
    const target: LatencySampleTarget = {};
    const stop = startLatencyProbe(registry, {
      target,
      doc: document,
      readStrip: (video) => {
        const stamp = stampFor(video);
        return stamp === null ? null : strip(stamp);
      },
      wallClock: (performanceNow) => WALL_ORIGIN + performanceNow,
    });
    return { registry, target, stop };
  }

  it('samples the latency of every new frame of an attached source video', () => {
    const camera = frameVideo();
    const { registry, target, stop } = setup(() => WALL_ORIGIN + 1000 - 48);
    registry.attach(CAMERA, camera.video);
    camera.frame(1000, 320, 180);
    camera.frame(1000);
    expect(target.__studioflowLatency).toEqual([
      { sourceId: CAMERA, latencyMs: 48, at: 1000, width: 320, height: 180 },
      { sourceId: CAMERA, latencyMs: 48, at: 1000, width: 640, height: 360 },
    ]);
    stop();
  });

  it('also follows videos that were attached before the probe started', () => {
    const registry = new DeferredSourceProvider(() => null);
    const screen = frameVideo();
    registry.attach(SCREEN, screen.video);
    const target: LatencySampleTarget = {};
    startLatencyProbe(registry, {
      target,
      doc: document,
      readStrip: () => strip(WALL_ORIGIN + 500 - 33),
      wallClock: (now) => WALL_ORIGIN + now,
    });
    screen.frame(500);
    expect(target.__studioflowLatency?.map((sample) => sample.latencyMs)).toEqual([33]);
  });

  it('skips frames without a decodable stamp but keeps listening', () => {
    const camera = frameVideo();
    let stamp: number | null = null;
    const { registry, target } = setup(() => stamp);
    registry.attach(CAMERA, camera.video);
    camera.frame(100);
    expect(target.__studioflowLatency).toEqual([]);
    expect(camera.pending()).toBe(true);
    stamp = WALL_ORIGIN + 200 - 20;
    camera.frame(200);
    expect(target.__studioflowLatency).toHaveLength(1);
  });

  it('keeps at most 1000 samples', () => {
    const camera = frameVideo();
    const { registry, target } = setup(() => WALL_ORIGIN);
    registry.attach(CAMERA, camera.video);
    for (let index = 0; index < MAX_LATENCY_SAMPLES + 50; index += 1) {
      camera.frame(index);
    }
    const samples = target.__studioflowLatency ?? [];
    expect(samples).toHaveLength(MAX_LATENCY_SAMPLES);
    expect(samples[0].at).toBe(50);
    expect(samples.at(-1)?.at).toBe(MAX_LATENCY_SAMPLES + 49);
  });

  it('stops following a detached video and cancels its callback', () => {
    const camera = frameVideo();
    const { registry, target } = setup(() => WALL_ORIGIN);
    registry.attach(CAMERA, camera.video);
    registry.detach(CAMERA, camera.video);
    expect(camera.cancelled).toEqual([1]);
    camera.frame(10);
    expect(target.__studioflowLatency).toEqual([]);
  });

  it('does nothing in browsers without requestVideoFrameCallback', () => {
    const { registry, target } = setup(() => WALL_ORIGIN);
    const plain = document.createElement('video');
    expect(() => registry.attach(CAMERA, plain)).not.toThrow();
    expect(target.__studioflowLatency).toEqual([]);
  });

  it('uses the shared canvas reader when none is injected (no 2D canvas in happy-dom: no samples)', () => {
    const registry = new DeferredSourceProvider(() => null);
    const target: LatencySampleTarget = {};
    const camera = frameVideo();
    startLatencyProbe(registry, { target, doc: document });
    registry.attach(CAMERA, camera.video);
    expect(() => camera.frame(1)).not.toThrow();
    expect(target.__studioflowLatency).toEqual([]);
  });
});
