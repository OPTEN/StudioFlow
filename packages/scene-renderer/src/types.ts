/**
 * Interfaces between the scene renderer and whoever supplies the pictures (LiveKit in the Regie and on the output,
 * fakes in tests). The renderer never imports livekit-client; `@flowstudio/media-client` implements
 * {@link SourceMediaProvider}.
 */
import type { SceneDto, SlateDto, TransitionDto } from '@flowstudio/scene-model';

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
 * no longer needs the element. When a source returns, the provider sets the new `srcObject` before it emits
 * {@link onChange}, so the renderer can wait for the first new frame before it removes the hold picture.
 * Chromium paints a `<video>` black as soon as its MediaStreamTrack ends; the renderer therefore keeps its own copy
 * of the last picture (refreshed about once per second) and the provider does not need to snapshot anything.
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
export type MonitorSourceStatus =
  'ok' | 'connecting' | 'offline' | 'reconnecting' | 'ended' | 'lost' | 'blocked';

/** Rectangle in canvas pixels (1920 × 1080 space). */
export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where a renderer runs. `output` is the broadcast picture (no text except slates and hold messages), `monitor` the
 * Regie preview/program monitors (alert outlines, labels, «Quelle fehlt»), `thumbnail` the small scene previews.
 */
export type RendererMode = 'output' | 'monitor' | 'thumbnail';

/** Kind of an uploaded media asset as the renderer needs it (image → `<img>`, video → looping `<video>`). */
export type AssetMediaKind = 'image' | 'video';

/** Options of {@link SceneRenderer} creation (`createSceneRenderer`). */
export interface SceneRendererOptions {
  readonly mode: RendererMode;
  readonly provider: SourceMediaProvider;
  /**
   * Letterbox and canvas background. `transparent` (output `?bg=transparent`, overlays in OBS/vMix) also skips the
   * scene background colour; a scene background image is still drawn. Default `black`.
   */
  readonly background?: 'black' | 'transparent';
  /**
   * Source health for monitor alerts (Regie). Returning undefined for a device source means the production does not
   * know it (deleted): the item renders as «Quelle fehlt». Without this option every device source counts as known.
   */
  readonly statusOf?: (sourceId: string) => MonitorSourceStatus | undefined;
  /** Slot code for monitor labels («K2 · Standbild 00:12»). */
  readonly codeOf?: (sourceId: string) => string | undefined;
  /** Turns fades into cuts (prefers-reduced-motion or an explicit setting). */
  readonly reducedMotion?: boolean;
  /** Kind of an asset; unknown assets render as images. */
  readonly assetKindOf?: (assetId: string) => AssetMediaKind | undefined;
  /** Accessible name of the stage (`role="img"`). Default «Szene». */
  readonly label?: string;
  /**
   * Receives errors thrown by the provider or the callbacks above. The renderer never lets them escape into event
   * handlers of foreign code. Default: `console.warn`.
   */
  readonly onError?: (error: unknown) => void;
}

/** Rendering statistics for the output report and debug overlay. */
export interface RendererStats {
  /** Animation frames per second of the page; 0 until measured (measuring starts with the first call). */
  readonly fps: number;
  /** Items currently shown on the stage. */
  readonly items: number;
  /** `<video>` elements currently owned by the stage. */
  readonly videos: number;
}

/** Placement of the 1920 × 1080 stage inside a container (letterbox, centred). */
export interface StageFit {
  /** Uniform scale from canvas pixels to container (CSS) pixels. */
  readonly scale: number;
  /** Left offset of the stage in container pixels. */
  readonly offsetX: number;
  /** Top offset of the stage in container pixels. */
  readonly offsetY: number;
  /** Width of the scaled stage in container pixels. */
  readonly width: number;
  /** Height of the scaled stage in container pixels. */
  readonly height: number;
}

/** Framework-free renderer of one picture (output page, Regie monitor or thumbnail). */
export interface SceneRenderer {
  /** The 1920 × 1080 stage, scaled with a CSS transform into the container (letterbox). */
  readonly element: HTMLElement;
  /** Switches to a scene immediately (same scene id: diffs in place). A running fade is finished first. */
  show(scene: SceneDto | null): void;
  /** The shown scene changed: diffs items in place without flicker. Ignores unknown or outdated scenes. */
  update(scene: SceneDto): void;
  /**
   * Plays a cut or fade to a scene. A fade always completes; a new transition finishes a running fade instantly
   * first. The promise resolves when the new scene is fully shown and never rejects.
   */
  transitionTo(scene: SceneDto | null, transition: TransitionDto): Promise<void>;
  /** Shows a standby/end slate above everything (fade 300 ms); null hides it. */
  showSlate(slate: SlateDto | null, assetUrl?: string | null): void;
  /** Output: requests a small picture for the device sources of these scenes that are not on stage. */
  setPreloadScenes(scenes: readonly SceneDto[]): void;
  /** Re-reads `statusOf` for monitor alerts. */
  setSourceStatuses(): void;
  /** Rectangles actually used per visible item id of the shown scene (after Auto-Grid), in canvas pixels. */
  effectiveRects(): ReadonlyMap<string, CanvasRect>;
  /** Rendering statistics. */
  stats(): RendererStats;
  /** Re-measures the container (called automatically by a ResizeObserver or the window `resize` event). */
  resize(): void;
  /** Removes the DOM and releases every provider registration, timer and listener. Idempotent. */
  destroy(): void;
}
