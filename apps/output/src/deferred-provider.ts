import type {
  DesiredSize,
  SourceAvailability,
  SourceMediaProvider,
} from '@studioflow/scene-renderer';

const PENDING: SourceAvailability = { state: 'pending' };

/** Listener for video registrations (latency probe). */
export type VideoListener = (sourceId: string, video: HTMLVideoElement, attached: boolean) => void;

/**
 * {@link SourceMediaProvider} that the renderer can use before livekit-client is loaded (it is ~150 KB gzip and is
 * imported only after the first frame). Until {@link bind} it answers `pending` for every device source and
 * remembers the renderer's video elements and desired sizes; `bind` hands them to the LiveKit provider. Asset URLs
 * never wait for LiveKit. It also tells which `<video>` elements show which source (latency probe, autoplay).
 */
export class DeferredSourceProvider implements SourceMediaProvider {
  readonly #videos = new Map<string, Set<HTMLVideoElement>>();
  readonly #sizes = new Map<string, Map<string, DesiredSize>>();
  readonly #listeners = new Set<(sourceId: string) => void>();
  readonly #videoListeners = new Set<VideoListener>();
  readonly #assetVideos = new Map<string, Set<HTMLVideoElement>>();
  readonly #assetListeners = new Set<VideoListener>();
  #inner: SourceMediaProvider | null = null;
  #unsubscribeInner: (() => void) | null = null;

  constructor(private readonly resolveAsset: (assetId: string) => string | null) {}

  /** True once the LiveKit provider is bound. */
  get bound(): boolean {
    return this.#inner !== null;
  }

  /** Hands every registration to the real provider; later calls go straight through. Binds only once. */
  bind(inner: SourceMediaProvider): void {
    if (this.#inner) {
      return;
    }
    this.#inner = inner;
    this.#unsubscribeInner = inner.onChange((sourceId) => this.#emit(sourceId));
    for (const [sourceId, videos] of this.#videos) {
      for (const video of videos) {
        this.#call(() => inner.attach(sourceId, video));
      }
    }
    for (const [sourceId, sizes] of this.#sizes) {
      for (const [consumerId, size] of sizes) {
        this.#call(() => inner.setDesiredSize(sourceId, consumerId, size));
      }
    }
    for (const sourceId of this.#videos.keys()) {
      this.#emit(sourceId);
    }
  }

  attach(sourceId: string, video: HTMLVideoElement): void {
    let videos = this.#videos.get(sourceId);
    if (!videos) {
      videos = new Set();
      this.#videos.set(sourceId, videos);
    }
    videos.add(video);
    const inner = this.#inner;
    if (inner) {
      this.#call(() => inner.attach(sourceId, video));
    }
    this.#emitVideo(sourceId, video, true);
  }

  detach(sourceId: string, video: HTMLVideoElement): void {
    const videos = this.#videos.get(sourceId);
    if (!videos?.delete(video)) {
      return;
    }
    if (videos.size === 0) {
      this.#videos.delete(sourceId);
    }
    const inner = this.#inner;
    if (inner) {
      this.#call(() => inner.detach(sourceId, video));
    }
    this.#emitVideo(sourceId, video, false);
  }

  /** A looping video shows a video asset: the audio mix takes the sound of the asset from this element. */
  attachAsset(sourceId: string, video: HTMLVideoElement): void {
    let videos = this.#assetVideos.get(sourceId);
    if (!videos) {
      videos = new Set();
      this.#assetVideos.set(sourceId, videos);
    }
    videos.add(video);
    this.#emitAsset(sourceId, video, true);
  }

  detachAsset(sourceId: string, video: HTMLVideoElement): void {
    const videos = this.#assetVideos.get(sourceId);
    if (!videos?.delete(video)) {
      return;
    }
    if (videos.size === 0) {
      this.#assetVideos.delete(sourceId);
    }
    this.#emitAsset(sourceId, video, false);
  }

  availability(sourceId: string): SourceAvailability {
    return this.#inner ? this.#inner.availability(sourceId) : PENDING;
  }

  onChange(listener: (sourceId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setDesiredSize(sourceId: string, consumerId: string, size: DesiredSize | null): void {
    let sizes = this.#sizes.get(sourceId);
    if (size) {
      if (!sizes) {
        sizes = new Map();
        this.#sizes.set(sourceId, sizes);
      }
      sizes.set(consumerId, size);
    } else if (sizes) {
      sizes.delete(consumerId);
      if (sizes.size === 0) {
        this.#sizes.delete(sourceId);
      }
    }
    const inner = this.#inner;
    if (inner) {
      this.#call(() => inner.setDesiredSize(sourceId, consumerId, size));
    }
  }

  assetUrl(assetId: string): string | null {
    try {
      return this.resolveAsset(assetId);
    } catch {
      return null;
    }
  }

  /** Video elements currently registered, with their source. */
  videos(): [string, HTMLVideoElement][] {
    return [...this.#videos].flatMap(([sourceId, videos]) =>
      [...videos].map((video): [string, HTMLVideoElement] => [sourceId, video]),
    );
  }

  /** Notifies about video registrations; returns the unsubscribe function. */
  onVideosChange(listener: VideoListener): () => void {
    this.#videoListeners.add(listener);
    return () => this.#videoListeners.delete(listener);
  }

  /** Video elements that currently show a video asset, with the asset id. */
  assetVideos(): [string, HTMLVideoElement][] {
    return [...this.#assetVideos].flatMap(([sourceId, videos]) =>
      [...videos].map((video): [string, HTMLVideoElement] => [sourceId, video]),
    );
  }

  /** Notifies when an element starts or stops showing a video asset; returns the unsubscribe function. */
  onAssetVideosChange(listener: VideoListener): () => void {
    this.#assetListeners.add(listener);
    return () => this.#assetListeners.delete(listener);
  }

  /** Stops forwarding changes of the real provider. */
  dispose(): void {
    this.#unsubscribeInner?.();
    this.#unsubscribeInner = null;
    this.#listeners.clear();
    this.#videoListeners.clear();
    this.#assetListeners.clear();
  }

  #emit(sourceId: string): void {
    for (const listener of [...this.#listeners]) {
      this.#call(() => listener(sourceId));
    }
  }

  #emitAsset(sourceId: string, video: HTMLVideoElement, attached: boolean): void {
    for (const listener of [...this.#assetListeners]) {
      this.#call(() => listener(sourceId, video, attached));
    }
  }

  #emitVideo(sourceId: string, video: HTMLVideoElement, attached: boolean): void {
    for (const listener of [...this.#videoListeners]) {
      this.#call(() => listener(sourceId, video, attached));
    }
  }

  /** One failing registration must not stop the others (the renderer guards its own calls the same way). */
  #call(operation: () => void): void {
    try {
      operation();
    } catch {
      // Ignored: the provider logs its own failures.
    }
  }
}
