import { copyVideoFrame, releaseCanvas } from './hold-frame';
import { snapshotBudget } from './snapshot-budget';
import type { DesiredSize, SourceMediaProvider } from './types';

/**
 * Still pictures of device sources for the scene thumbnails (issue #12). A thumbnail does not play a video: it shows a
 * snapshot that is renewed every {@link STILL_REFRESH_MS}. Many thumbnails of one source share one hidden video and one
 * snapshot, so a Regie with six scenes that show the same camera copies its frame once per refresh instead of once per
 * thumbnail and second. The program and preview monitors are not served by the pool: they stay live.
 *
 * The snapshot is handed out as an image (a JPEG data URL), not as a canvas: a canvas on screen is a layer of its own
 * that the browser keeps compositing, and sixteen of them cost the Regie as much GPU time as the videos they replaced
 * (measured in the reference scenario with software rendering), while an image is a texture that does not change.
 */

/** Interval of the snapshots (the issue asks for 1 to 2 seconds). */
export const STILL_REFRESH_MS = 1500;
/** Largest snapshot: thumbnails are tiny, so a LOW layer is all they ever need. */
const STILL_LIMIT: DesiredSize = { width: 320, height: 180 };
/** JPEG quality of a snapshot (about 10 kB at 320 x 180). */
const STILL_QUALITY = 0.8;
/** First snapshots of a source that has no picture yet, in ms after it was acquired. */
const EARLY_TRIES_MS = [250, 700, 1200] as const;

/** A thumbnail item that wants the snapshot of a source. */
export interface StillHolder {
  /** The snapshot changed (a new picture was copied). */
  readonly onUpdate: () => void;
  /** False while the thumbnail cannot be seen: the pool then spares the copy. */
  readonly wanted: () => boolean;
}

interface Feeder {
  readonly video: HTMLVideoElement;
  /** Where frames are drawn before they are encoded; never in the document. */
  readonly canvas: HTMLCanvasElement;
  /** The latest snapshot as an image URL, null before the first one. */
  url: string | null;
  readonly holders: Set<StillHolder>;
  hasPicture: boolean;
  /** When the snapshot was taken last (the stalest one is renewed first), 0 before the first. */
  copiedAt: number;
  earlyTimers: ReturnType<typeof setTimeout>[];
}

/** The picture on a canvas as a JPEG data URL, or null where the browser cannot encode it. */
function encodeStill(canvas: HTMLCanvasElement): string | null {
  try {
    const url = canvas.toDataURL('image/jpeg', STILL_QUALITY);
    return url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

/** Creates the hidden `<video>` that plays a source for its snapshot. */
function createFeederVideo(doc: Document): HTMLVideoElement {
  const video = doc.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  return video;
}

/**
 * Snapshots of device sources, shared by all thumbnails of a provider. A source gets a hidden video (registered with the
 * provider like any other element) while a holder wants it; the snapshots are taken together by one timer.
 */
export class StillPool {
  private readonly feeders = new Map<string, Feeder>();
  private readonly host: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly doc: Document,
    private readonly provider: SourceMediaProvider,
    private readonly guard: (run: () => void) => void,
    private readonly onEmpty: () => void,
  ) {
    // In the document (invisible, one pixel), not detached: some engines pause a playing video that is not in a tree.
    this.host = doc.createElement('div');
    this.host.className = 'sf-r-stills';
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    doc.body.append(this.host);
  }

  /** Registers a holder for a source and starts playing it when it is the first. */
  acquire(sourceId: string, holder: StillHolder): void {
    let feeder = this.feeders.get(sourceId);
    if (!feeder) {
      feeder = this.createFeeder(sourceId);
      this.feeders.set(sourceId, feeder);
    }
    feeder.holders.add(holder);
    this.timer ??= setInterval(() => this.refreshAll(), STILL_REFRESH_MS);
  }

  /** Unregisters a holder; the last one of a source stops playing it, the last of all removes the pool. */
  release(sourceId: string, holder: StillHolder): void {
    const feeder = this.feeders.get(sourceId);
    if (!feeder) {
      return;
    }
    feeder.holders.delete(holder);
    if (feeder.holders.size === 0) {
      this.destroyFeeder(sourceId, feeder);
      this.feeders.delete(sourceId);
    }
    if (this.feeders.size === 0) {
      this.dispose();
      this.onEmpty();
    }
  }

  /** The latest snapshot of a source as an image URL, or null while it has no picture. */
  urlOf(sourceId: string): string | null {
    return this.feeders.get(sourceId)?.url ?? null;
  }

  /** Number of sources that are being played (tests). */
  get size(): number {
    return this.feeders.size;
  }

  /** Stops the timer and removes everything. Idempotent. */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const [sourceId, feeder] of this.feeders) {
      this.destroyFeeder(sourceId, feeder);
    }
    this.feeders.clear();
    this.host.remove();
  }

  private createFeeder(sourceId: string): Feeder {
    const video = createFeederVideo(this.doc);
    const canvas = this.doc.createElement('canvas');
    try {
      // Drawn on the CPU and read back for the JPEG: no GPU surface for a canvas nobody sees.
      canvas.getContext('2d', { willReadFrequently: true });
    } catch {
      // A browser without the option draws as it always does.
    }
    const feeder: Feeder = {
      video,
      canvas,
      url: null,
      holders: new Set(),
      hasPicture: false,
      copiedAt: 0,
      earlyTimers: [],
    };
    this.host.append(video);
    this.guard(() => this.provider.attach(sourceId, video));
    // The first snapshot as soon as there is a picture, then the regular rhythm.
    video.addEventListener('loadeddata', () => this.refresh(feeder, true));
    feeder.earlyTimers = EARLY_TRIES_MS.map((delay) =>
      setTimeout(() => {
        if (!feeder.hasPicture) {
          this.refresh(feeder, true);
        }
      }, delay),
    );
    return feeder;
  }

  private destroyFeeder(sourceId: string, feeder: Feeder): void {
    for (const timer of feeder.earlyTimers) {
      clearTimeout(timer);
    }
    feeder.earlyTimers = [];
    this.guard(() => this.provider.detach(sourceId, feeder.video));
    feeder.video.remove();
    releaseCanvas(feeder.canvas);
  }

  private refreshAll(): void {
    if (this.doc.visibilityState === 'hidden') {
      return;
    }
    // The stalest first; a copy that is expensive on this computer makes the others wait (see {@link snapshotBudget}).
    const stalest = [...this.feeders.values()].sort((a, b) => a.copiedAt - b.copiedAt);
    for (const feeder of stalest) {
      if (!snapshotBudget.allows()) {
        return;
      }
      this.refresh(feeder, false);
    }
  }

  /** Copies the frame when a holder can see it (or `force`, for the first picture) and tells the holders. */
  private refresh(feeder: Feeder, force: boolean): void {
    const holders = [...feeder.holders];
    if (holders.length === 0 || (!force && !holders.some((holder) => holder.wanted()))) {
      return;
    }
    const url = snapshotBudget.measure(() =>
      copyVideoFrame(feeder.video, feeder.canvas, STILL_LIMIT) ? encodeStill(feeder.canvas) : null,
    );
    if (url === null) {
      return;
    }
    feeder.url = url;
    feeder.hasPicture = true;
    feeder.copiedAt = performance.now();
    for (const holder of holders) {
      this.guard(holder.onUpdate);
    }
  }
}

/** The pool of a provider, shared by all thumbnail renderers that use it; removed again with its last holder. */
const pools = new WeakMap<SourceMediaProvider, StillPool>();

/** The shared pool of `provider` in `doc` (created with the first call). */
export function stillPoolFor(
  doc: Document,
  provider: SourceMediaProvider,
  guard: (run: () => void) => void,
): StillPool {
  let pool = pools.get(provider);
  if (!pool) {
    const created = new StillPool(doc, provider, guard, () => {
      if (pools.get(provider) === created) {
        pools.delete(provider);
      }
    });
    pools.set(provider, created);
    pool = created;
  }
  return pool;
}
