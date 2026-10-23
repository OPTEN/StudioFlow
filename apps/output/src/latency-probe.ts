import { decodeStamp, latencyMs, STAMP, stripLuma } from './latency-stamp';

/**
 * TEST AID, off by default (`?latency=1`): measures glass-to-glass latency for automated tests. For every device
 * source video on the stage it decodes the latency stamp (latency-stamp.ts) on each new video frame
 * (`requestVideoFrameCallback`; browsers without it are skipped) and appends a sample to
 * `window.__studioflowLatency` (oldest samples dropped beyond {@link MAX_LATENCY_SAMPLES}). This is the only
 * per-frame JavaScript of the page and costs one 640 × 48 canvas read per frame and video; never enable it on air.
 */

/** Cap of `window.__studioflowLatency`. */
export const MAX_LATENCY_SAMPLES = 1000;
/** Decoded values above this are treated as decode errors (no real stream is a minute late). */
const MAX_PLAUSIBLE_MS = 60_000;

/** One measurement. */
export interface LatencySample {
  /** Source reference (`{deviceId}/{slot}`). */
  readonly sourceId: string;
  /** Stamp time to the frame's expected display time, in ms. */
  readonly latencyMs: number;
  /** `performance.now()` of the frame. */
  readonly at: number;
  /** Received frame size (shows the simulcast layer). */
  readonly width: number;
  readonly height: number;
}

declare global {
  interface Window {
    /** Latency samples of the `?latency=1` test aid. */
    __studioflowLatency?: LatencySample[];
  }
}

/** Where samples go (the window). */
export interface LatencySampleTarget {
  __studioflowLatency?: LatencySample[];
}

/** The video registrations the probe follows (DeferredSourceProvider). */
export interface VideoRegistry {
  videos(): Iterable<readonly [string, HTMLVideoElement]>;
  onVideosChange(
    listener: (sourceId: string, video: HTMLVideoElement, attached: boolean) => void,
  ): () => void;
}

/** Reads the stamp bar of the current video frame as 640 × 48 RGBA pixels, or null. */
export type StripReader = (video: HTMLVideoElement) => ArrayLike<number> | null;

/** Options of {@link startLatencyProbe}. */
export interface LatencyProbeOptions {
  readonly target: LatencySampleTarget;
  readonly doc: Document;
  readonly cap?: number;
  /** Default: draws the frame's top 48/360 into a shared 640 × 48 canvas. */
  readonly readStrip?: StripReader;
  /** Wall clock in the `performance.timeOrigin` base for a `performance.now()` value. */
  readonly wallClock?: (performanceNow: number) => number;
}

/** Canvas based {@link StripReader}; null when the browser has no 2D canvas (or the frame is not decodable yet). */
export function canvasStripReader(doc: Document): StripReader {
  let context: CanvasRenderingContext2D | null | undefined;
  return (video) => {
    if (context === undefined) {
      const canvas = doc.createElement('canvas');
      canvas.width = STAMP.width;
      canvas.height = STAMP.barHeight;
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!context || !width || !height) {
      return null;
    }
    const barHeight = (height * STAMP.barHeight) / STAMP.height;
    context.drawImage(video, 0, 0, width, barHeight, 0, 0, STAMP.width, STAMP.barHeight);
    return context.getImageData(0, 0, STAMP.width, STAMP.barHeight).data;
  };
}

/** Starts the probe; returns the function that stops it. */
export function startLatencyProbe(
  registry: VideoRegistry,
  options: LatencyProbeOptions,
): () => void {
  const cap = options.cap ?? MAX_LATENCY_SAMPLES;
  const readStrip = options.readStrip ?? canvasStripReader(options.doc);
  const wallClock =
    options.wallClock ?? ((performanceNow: number) => performance.timeOrigin + performanceNow);
  const samples = (options.target.__studioflowLatency ??= []);
  const watched = new Map<HTMLVideoElement, number | null>();

  const record = (sample: LatencySample): void => {
    samples.push(sample);
    if (samples.length > cap) {
      samples.splice(0, samples.length - cap);
    }
  };

  const watch = (sourceId: string, video: HTMLVideoElement): void => {
    if (watched.has(video) || typeof video.requestVideoFrameCallback !== 'function') {
      return;
    }
    const onFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!watched.has(video)) {
        return;
      }
      try {
        const pixels = readStrip(video);
        if (pixels) {
          const stamp = decodeStamp(stripLuma(pixels));
          const displayedAt = metadata.expectedDisplayTime ?? now;
          const latency = stamp.ok ? latencyMs(stamp.ts, wallClock(displayedAt)) : Number.NaN;
          if (latency < MAX_PLAUSIBLE_MS) {
            record({
              sourceId,
              latencyMs: latency,
              at: displayedAt,
              width: metadata.width,
              height: metadata.height,
            });
          }
        }
      } catch {
        // A tainted or not yet decodable frame: try the next one.
      }
      watched.set(video, video.requestVideoFrameCallback(onFrame));
    };
    watched.set(video, video.requestVideoFrameCallback(onFrame));
  };

  const unwatch = (video: HTMLVideoElement): void => {
    const handle = watched.get(video);
    watched.delete(video);
    if (
      handle !== undefined &&
      handle !== null &&
      typeof video.cancelVideoFrameCallback === 'function'
    ) {
      video.cancelVideoFrameCallback(handle);
    }
  };

  for (const [sourceId, video] of registry.videos()) {
    watch(sourceId, video);
  }
  const unsubscribe = registry.onVideosChange((sourceId, video, attached) =>
    attached ? watch(sourceId, video) : unwatch(video),
  );
  return () => {
    unsubscribe();
    for (const video of [...watched.keys()]) {
      unwatch(video);
    }
  };
}
