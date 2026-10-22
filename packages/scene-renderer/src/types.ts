/**
 * Interfaces between the scene renderer and whoever supplies the pictures (LiveKit in the Regie and on the output,
 * fakes in tests). The renderer never imports livekit-client; `@flowstudio/media-client` implements
 * {@link SourceMediaProvider}.
 */

/** Availability of a source picture as seen by one client. */
export type SourceAvailability =
  /** A track is attached and frames arrive. */
  | { readonly state: 'live' }
  /** The track was live and disappeared at `since` (performance.now() time base); the last frame is kept. */
  | { readonly state: 'lost'; readonly since: number }
  /** No track was ever received in this session (device offline, still connecting, unknown source). */
  | { readonly state: 'pending' };

/** Requested picture size for a source by one consumer, in device pixels of the target display. */
export interface DesiredSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Supplies media for device sources and URLs for assets.
 *
 * Contract for video elements: the renderer registers every `<video>` that shows a device source with
 * {@link attach}. The provider sets `srcObject` whenever a (new) track for that source arrives and must NOT clear it
 * when the track is lost, so the element keeps the last frame (hold frame). {@link detach} is called when the renderer
 * no longer needs the element.
 */
export interface SourceMediaProvider {
  /** Registers a video element for a device source (`{deviceId}/{slot}`); attaches the current track if any. */
  attach(sourceId: string, video: HTMLVideoElement): void;
  /** Unregisters the element; the provider stops updating it. */
  detach(sourceId: string, video: HTMLVideoElement): void;
  /** Current availability of a device source. */
  availability(sourceId: string): SourceAvailability;
  /** Notifies about availability or track changes. Returns an unsubscribe function. */
  onChange(listener: (sourceId: string) => void): () => void;
  /**
   * Declares the picture size one consumer needs for a source (null = not needed by this consumer). The provider
   * aggregates all consumers and selects the simulcast layer. `consumerId` is stable per renderer instance.
   */
  setDesiredSize(sourceId: string, consumerId: string, size: DesiredSize | null): void;
  /** Absolute or relative URL for an image or video asset, or null if unknown. */
  assetUrl(assetId: string): string | null;
}

/** Health a monitor uses to draw alert outlines and labels (Regie only). */
export type MonitorSourceStatus = 'ok' | 'connecting' | 'offline' | 'reconnecting' | 'ended' | 'lost' | 'blocked';

/** Rectangle in canvas pixels (1920 × 1080 space). */
export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
