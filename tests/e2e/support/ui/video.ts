import { expect, type Locator } from '@playwright/test';

/**
 * `<video>` checks that never sleep for state (docs/testing.md 1.5): a video "plays" when it has a picture size, enough
 * data, is not paused and delivers new frames and a moving `currentTime` within a measuring window.
 */

export interface VideoMeasurement {
  width: number;
  height: number;
  readyState: number;
  paused: boolean;
  muted: boolean;
  /** Frames presented during the window (`getVideoPlaybackQuality`), per second. */
  fps: number;
  /** `currentTime` advanced during the window. */
  advanced: boolean;
  /** Attributes the output page needs for autoplay without a gesture. */
  autoplay: boolean;
  playsInline: boolean;
}

/** Measures one `<video>` over `windowMs` (the element must be attached; the call takes about `windowMs`). */
export async function measureVideo(video: Locator, windowMs = 1000): Promise<VideoMeasurement> {
  return video.evaluate(async (element: HTMLVideoElement, ms: number) => {
    const first = element.getVideoPlaybackQuality().totalVideoFrames;
    const t0 = element.currentTime;
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, ms));
    const seconds = (performance.now() - started) / 1000;
    return {
      width: element.videoWidth,
      height: element.videoHeight,
      readyState: element.readyState,
      paused: element.paused,
      muted: element.muted,
      fps: (element.getVideoPlaybackQuality().totalVideoFrames - first) / seconds,
      advanced: element.currentTime > t0,
      autoplay: element.autoplay,
      playsInline: element.playsInline,
    };
  }, windowMs);
}

/** Waits until the video shows a moving picture: size known, data available, not paused, `minFps` new frames per second. */
export async function expectVideoPlaying(
  video: Locator,
  {
    minFps = 10,
    timeout = 20_000,
    windowMs = 1000,
  }: { minFps?: number; timeout?: number; windowMs?: number } = {},
): Promise<VideoMeasurement> {
  let last: VideoMeasurement | undefined;
  await expect
    .poll(
      async () => {
        last = await measureVideo(video, windowMs).catch(() => undefined);
        return Boolean(
          last &&
          last.width > 0 &&
          last.readyState >= 2 &&
          !last.paused &&
          last.advanced &&
          last.fps >= minFps,
        );
      },
      {
        timeout,
        intervals: [200],
        message: `the video plays at >= ${minFps} fps (last: ${JSON.stringify(last)})`,
      },
    )
    .toBe(true);
  return last!;
}

/** The video stays frozen: no new frame during `ms` while the element stays attached. */
export async function expectVideoFrozen(video: Locator, ms = 1500): Promise<void> {
  const measured = await measureVideo(video, ms);
  expect(measured.fps, 'no new frames while frozen').toBeLessThan(1);
}
