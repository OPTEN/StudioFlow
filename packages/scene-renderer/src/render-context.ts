import { guarded, type ErrorSink } from './guard';
import type { MediaHost } from './media-view';
import { resolveSource, type ResolvedSource } from './source-resolver';
import type {
  MonitorSourceStatus,
  RendererMode,
  SceneRendererOptions,
  SourceAvailability,
} from './types';

/**
 * Services the renderer hands to its layers and items. Every method that reaches foreign code (provider, host
 * callbacks) is guarded: it never throws.
 */
export interface RenderContext extends MediaHost {
  readonly mode: RendererMode;
  /** Transparent output: no scene background colour. */
  readonly transparent: boolean;
  /** Resolves a source reference (device, image, video or missing). */
  resolve(ref: string): ResolvedSource;
  /** Availability of a device source (pending when the provider fails). */
  availability(sourceId: string): SourceAvailability;
  /** Monitor status of a source; undefined when unknown or without `statusOf`. */
  statusOf(sourceId: string): MonitorSourceStatus | undefined;
  /** False when `statusOf` exists and does not know the source (deleted → “Source missing”). */
  isKnown(sourceId: string): boolean;
  /** Slot code of a source for monitor labels. */
  codeOf(sourceId: string): string | undefined;
  /** Time (performance.now() base) since which `sourceId` has `status`, as observed by this renderer. */
  statusSince(sourceId: string, status: MonitorSourceStatus, now: number): number;
  /** Asks for a render pass soon (after an asynchronous change such as a first new frame). */
  requestRender(): void;
  /** A hold frame of `sourceId` held by another item on stage (or by the layer a cut replaces), if any. */
  holdFrameDonor(sourceId: string, requester: object): HTMLCanvasElement | null;
}

/** Values shared by all items of one render pass. */
export interface RenderFrame {
  /** performance.now() at the start of the pass. */
  readonly now: number;
  /** Stage scale (canvas → CSS pixels). */
  readonly scale: number;
  /** Device pixel ratio of the display. */
  readonly devicePixelRatio: number;
}

/** Renderer services the context forwards to. */
export type RenderContextHooks = Pick<
  RenderContext,
  'statusSince' | 'requestRender' | 'holdFrameDonor'
>;

const PENDING: SourceAvailability = { state: 'pending' };

/** Builds the guarded context for one renderer. */
export function createRenderContext(
  doc: Document,
  options: SceneRendererOptions,
  sink: ErrorSink,
  hooks: RenderContextHooks,
): RenderContext {
  const { provider, statusOf, codeOf, assetKindOf } = options;
  const statusOfSource = (sourceId: string): MonitorSourceStatus | undefined =>
    guarded(sink, () => statusOf?.(sourceId), undefined);
  return {
    doc,
    provider,
    mode: options.mode,
    transparent: options.background === 'transparent',
    guard: (run) => guarded(sink, run, undefined),
    resolve: (ref) =>
      resolveSource(ref, {
        assetUrl: (assetId) => guarded(sink, () => provider.assetUrl(assetId), null),
        assetKind: (assetId) => guarded(sink, () => assetKindOf?.(assetId), undefined),
      }),
    availability: (sourceId) => {
      const availability: unknown = guarded<unknown>(
        sink,
        () => provider.availability(sourceId),
        PENDING,
      );
      // Anything that is not an object is treated as “nothing received yet”; sourceState() checks the fields.
      return availability !== null && typeof availability === 'object'
        ? (availability as SourceAvailability)
        : PENDING;
    },
    statusOf: statusOfSource,
    isKnown: (sourceId) => !statusOf || statusOfSource(sourceId) !== undefined,
    codeOf: (sourceId) => guarded(sink, () => codeOf?.(sourceId), undefined),
    statusSince: (sourceId, status, now) => hooks.statusSince(sourceId, status, now),
    requestRender: () => hooks.requestRender(),
    holdFrameDonor: (sourceId, requester) => hooks.holdFrameDonor(sourceId, requester),
  };
}
