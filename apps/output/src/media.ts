import type { LiveKitTokenDto } from '@studioflow/scene-model';
import type { SourceMediaProvider } from '@studioflow/scene-renderer';
import type {
  DecoderSummary,
  MediaLogger,
  MediaSessionState,
  SourceStats,
} from '@studioflow/media-client';

/** The part of `MediaSession` the page uses. */
export interface OutputMediaSession {
  readonly state: MediaSessionState;
  start(): void;
  restart(): void;
  stop(): void;
  onStateChange(listener: (state: MediaSessionState) => void): () => void;
}

/** The part of `LiveKitSourceProvider` the page uses beyond {@link SourceMediaProvider}. */
export interface OutputMediaProvider extends SourceMediaProvider {
  getStats(sourceId: string): Promise<SourceStats | null>;
  estimateLatencyMs(): Promise<number | null>;
  /** What the decoders did since the previous call (streams, software decoding, dropped frames). */
  decoderSummary(): Promise<DecoderSummary>;
  dispose(): void;
}

/** A LiveKit session (role output) with its source provider; the session is not started yet. */
export interface OutputMedia {
  readonly session: OutputMediaSession;
  readonly provider: OutputMediaProvider;
}

/** What creating the media side needs. */
export interface OutputMediaOptions {
  readonly tokenProvider: () => Promise<LiveKitTokenDto>;
  readonly assetUrl: (assetId: string) => string | null;
  readonly logger: MediaLogger;
}

/** Loads the media side lazily; the page starts it after the first frame. */
export type LoadOutputMedia = (options: OutputMediaOptions) => Promise<OutputMedia>;

/** States in which the session does not reconnect by itself (`isTerminalState`, kept local: no livekit import). */
const TERMINAL_STATES: ReadonlySet<MediaSessionState> = new Set<MediaSessionState>([
  'stopped',
  'replaced',
  'removed',
  'unauthorized',
]);

/** True for states the session never leaves by itself. */
export function isTerminalMediaState(state: MediaSessionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Default loader: imports `@studioflow/media-client` (and with it livekit-client, ~150 KB gzip, not tree-shakable)
 * as a separate chunk (livekit-media.ts), so the slate or the first scene does not wait for it.
 */
export const loadOutputMedia: LoadOutputMedia = async (options) => {
  const { MediaSession, LiveKitSourceProvider } = await import('./livekit-media');
  const session = new MediaSession({
    role: 'output',
    tokenProvider: options.tokenProvider,
    logger: options.logger,
  });
  const provider = new LiveKitSourceProvider(session, {
    assetUrl: options.assetUrl,
    logger: options.logger,
  });
  return { session, provider };
};
