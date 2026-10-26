/**
 * The sound of video assets for the audio mix (issue #7). The renderer plays a video asset in a muted, looping `<video>`
 * (muted so every browser lets it autoplay); the mix takes the sound from that very element with
 * `HTMLMediaElement.captureStream()`, which Chromium delivers whether or not the element is muted. Picture and sound
 * therefore start, loop and stop together, with no second decoder to keep in sync.
 */
import { consoleLogger, errorContext, type MediaLogger } from '../logger';

/** Options of {@link AssetAudioTap}. */
export interface AssetAudioOptions {
  /** Called when the sound of a source appears, is replaced or goes away (`null`). */
  readonly onChange: (sourceId: string, stream: MediaStream | null) => void;
  /** Captures the sound of an element, `null` where the browser cannot. Default: `captureStream()`. */
  readonly capture?: (video: HTMLVideoElement) => MediaStream | null;
  readonly logger?: MediaLogger;
}

interface Tapped {
  readonly video: HTMLVideoElement;
  /** The audio-only stream of the element, once the element has loaded far enough. */
  stream: MediaStream | null;
  /** Removes the listeners of this element. */
  release: () => void;
}

/** Event on an element that has loaded its metadata (readyState 1 and above). */
const METADATA_READY_STATE = 1;

function defaultCapture(video: HTMLVideoElement): MediaStream | null {
  const element = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = element.captureStream ?? element.mozCaptureStream;
  if (typeof capture !== 'function') {
    return null;
  }
  const captured = capture.call(video);
  // Only the sound is wanted: a captured picture would keep the capture pipeline busy for nothing.
  for (const track of captured.getVideoTracks()) {
    track.stop();
    captured.removeTrack(track);
  }
  return captured;
}

/**
 * Follows the `<video>` elements that show video assets and gives the mix the sound of the newest one per asset. A
 * browser without `captureStream` simply gives no sound.
 */
export class AssetAudioTap {
  readonly #options: AssetAudioOptions;
  readonly #capture: (video: HTMLVideoElement) => MediaStream | null;
  readonly #logger: MediaLogger;
  readonly #tapped = new Map<string, Tapped[]>();
  #disposed = false;

  constructor(options: AssetAudioOptions) {
    this.#options = options;
    this.#capture = options.capture ?? defaultCapture;
    this.#logger = options.logger ?? consoleLogger;
  }

  /** The sound of an asset, null while the browser has none for it. */
  streamOf(sourceId: string): MediaStream | null {
    const list = this.#tapped.get(sourceId);
    return list?.[list.length - 1]?.stream ?? null;
  }

  /** The assets that have a sound right now. */
  sourceIds(): string[] {
    return [...this.#tapped].filter(([, list]) => list.at(-1)?.stream != null).map(([id]) => id);
  }

  /** An element started to show the asset: its sound replaces the one of an older element. */
  attach(sourceId: string, video: HTMLVideoElement): void {
    if (this.#disposed) {
      return;
    }
    const list = this.#tapped.get(sourceId) ?? [];
    if (list.some((entry) => entry.video === video)) {
      return;
    }
    const entry: Tapped = { video, stream: null, release: () => undefined };
    list.push(entry);
    this.#tapped.set(sourceId, list);
    const capture = (): void => {
      this.#captureNow(sourceId, entry);
    };
    if (video.readyState >= METADATA_READY_STATE) {
      if (this.#captureNow(sourceId, entry)) {
        return;
      }
    } else {
      video.addEventListener('loadedmetadata', capture, { once: true });
      entry.release = () => video.removeEventListener('loadedmetadata', capture);
    }
    // The newest element has no sound (yet): the one of an older element is no longer the one to play.
    this.#emit(sourceId);
  }

  /** The element stopped showing the asset: the sound of the next newest element, or none, takes over. */
  detach(sourceId: string, video: HTMLVideoElement): void {
    const list = this.#tapped.get(sourceId);
    const index = list?.findIndex((entry) => entry.video === video) ?? -1;
    if (list === undefined || index < 0) {
      return;
    }
    const [entry] = list.splice(index, 1);
    entry.release();
    this.#stop(entry);
    if (list.length === 0) {
      this.#tapped.delete(sourceId);
    }
    if (index === list.length) {
      this.#emit(sourceId);
    }
  }

  /** Stops every capture. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const list of this.#tapped.values()) {
      for (const entry of list) {
        entry.release();
        this.#stop(entry);
      }
    }
    this.#tapped.clear();
  }

  /** Captures the sound of an element; true when it has one (and the mix was told). */
  #captureNow(sourceId: string, entry: Tapped): boolean {
    if (this.#disposed || entry.stream !== null) {
      return false;
    }
    try {
      const captured = this.#capture(entry.video);
      if (captured === null || captured.getAudioTracks().length === 0) {
        return false;
      }
      entry.stream = captured;
      this.#emit(sourceId);
      return true;
    } catch (error) {
      this.#logger.warn('the sound of a video could not be captured', errorContext(error));
      return false;
    }
  }

  #stop(entry: Tapped): void {
    for (const track of entry.stream?.getAudioTracks() ?? []) {
      track.stop();
    }
    entry.stream = null;
  }

  #emit(sourceId: string): void {
    try {
      this.#options.onChange(sourceId, this.streamOf(sourceId));
    } catch (error) {
      this.#logger.warn('asset audio listener failed', errorContext(error));
    }
  }
}
