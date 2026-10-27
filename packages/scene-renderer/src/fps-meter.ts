/** What the videos of a stage presented, as of one reading. */
export interface FrameRate {
  /** Frames per second of the busiest video over the last seconds (0 without video or when frames do not run). */
  readonly fps: number;
  /** Frames presented by all videos since the meter saw them, cumulative. */
  readonly presented: number;
  /** Frames the browser dropped before it could present them, cumulative. */
  readonly dropped: number;
}

/** The rate is taken over at least this long (readings are 1 to 2 seconds apart). */
const SPAN_MS = 1500;
/** A rate needs at least this much time between its first and last sample. */
const MIN_SPAN_MS = 500;

interface Sample {
  readonly at: number;
  readonly total: number;
}

interface Watched {
  samples: Sample[];
  dropped: number;
}

/**
 * Measures the frame rate the page really shows: the frames its videos present (`getVideoPlaybackQuality()`), read when
 * someone asks (the output reports it every 2 s, the debug panel every second). Between two readings nothing runs: no
 * `requestAnimationFrame` loop that wakes the page 60 times a second for a number nobody looks at. The rate is that of the
 * busiest video (a page of 15 fps screens presents 15 frames a second, whatever the display refresh is); the dropped
 * frames are those the machine did not manage to show. Presented and dropped frames are cumulative, so several readers
 * can take their own differences.
 */
export class FpsMeter {
  private readonly videos = new WeakMap<HTMLVideoElement, Watched>();
  private presented = 0;
  private dropped = 0;

  /** Reads the videos and returns the rate and the cumulative frame counts. */
  read(videos: Iterable<HTMLVideoElement>): FrameRate {
    const at = performance.now();
    let fps = 0;
    for (const video of videos) {
      const quality = qualityOf(video);
      if (quality === null) {
        continue;
      }
      let watched = this.videos.get(video);
      const last = watched?.samples[watched.samples.length - 1];
      if (watched === undefined || last === undefined) {
        watched = { samples: [], dropped: quality.dropped };
        this.videos.set(video, watched);
      } else if (quality.total < last.total) {
        // The counters went back: the element started over.
        watched.samples = [];
        watched.dropped = quality.dropped;
      } else {
        this.presented += quality.total - last.total;
        this.dropped += Math.max(0, quality.dropped - watched.dropped);
        watched.dropped = quality.dropped;
      }
      watched.samples.push({ at, total: quality.total });
      while (watched.samples.length > 1 && at - watched.samples[1].at >= SPAN_MS) {
        watched.samples.shift();
      }
      const first = watched.samples[0];
      if (at - first.at >= MIN_SPAN_MS) {
        fps = Math.max(fps, ((quality.total - first.total) * 1000) / (at - first.at));
      }
    }
    return { fps, presented: this.presented, dropped: this.dropped };
  }
}

function qualityOf(video: HTMLVideoElement): { total: number; dropped: number } | null {
  if (typeof video.getVideoPlaybackQuality !== 'function') {
    return null;
  }
  try {
    const quality = video.getVideoPlaybackQuality();
    return { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
  } catch {
    return null;
  }
}
