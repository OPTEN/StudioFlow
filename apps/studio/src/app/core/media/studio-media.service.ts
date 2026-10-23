import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type {
  LiveKitSourceProvider,
  MediaSession,
  MediaSessionState,
} from '@studioflow/media-client';
import type { SourceMediaProvider } from '@studioflow/scene-renderer';
import { StudioApiService } from '../api/studio-api.service';
import { AuthService } from '../auth/auth.service';
import { ProductionStoreService } from '../state/production-store.service';

/** The parts of `@studioflow/media-client` the Regie loads lazily (livekit-client is ~150 KB gzip). */
export type MediaClientModule = Pick<
  typeof import('@studioflow/media-client'),
  'MediaSession' | 'LiveKitSourceProvider'
>;

/** Loads the media client; replaced in tests. The dynamic import keeps livekit-client out of the initial bundle. */
export const MEDIA_CLIENT_LOADER = new InjectionToken<() => Promise<MediaClientModule>>(
  'MEDIA_CLIENT_LOADER',
  {
    providedIn: 'root',
    factory: () => () => import('@studioflow/media-client'),
  },
);

/** State of the Regie's media connection: the `MediaSession` states plus `loading` and `failed` (chunk load). */
export type StudioMediaState = MediaSessionState | 'loading' | 'failed';

/**
 * Source provider of the Regie: the renderer interface plus receive statistics (monitoring, debug).
 * `LiveKitSourceProvider` satisfies it.
 */
export type StudioSourceProvider = SourceMediaProvider &
  Pick<LiveKitSourceProvider, 'getStats' | 'estimateLatencyMs'>;

/**
 * The Regie's LiveKit connection (spec 7, 8.4): loads `@studioflow/media-client` lazily as soon as the store is live,
 * then keeps one `MediaSession` (role studio) connected forever and exposes a `LiveKitSourceProvider` for every
 * scene renderer (monitors, thumbnails, station previews). Tokens come from `POST …/livekit-token`; a 401/403 stops
 * the session (`unauthorized`). When the active production changes the session rejoins the new room with a fresh
 * token, and the provider stays the same object.
 *
 * Renderers created before the provider exists should render placeholders and switch once {@link provider} is set.
 */
@Injectable({ providedIn: 'root' })
export class StudioMediaService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly loader = inject(MEDIA_CLIENT_LOADER);

  private session: MediaSession | null = null;
  private sourceProvider: LiveKitSourceProvider | null = null;
  private sessionProductionId: string | null = null;
  private loading: Promise<void> | null = null;
  private disposeStateListener: (() => void) | null = null;
  /** Incremented by stop(); a load that finishes afterwards is discarded. */
  private generation = 0;

  private readonly stateSignal = signal<StudioMediaState>('idle');
  private readonly providerSignal = signal<StudioSourceProvider | null>(null);

  /** Connection state; `connected` when pictures can arrive. */
  readonly state = this.stateSignal.asReadonly();
  /** The source provider for renderers, or null until the media client is loaded. */
  readonly provider = this.providerSignal.asReadonly();
  /** The connection is degraded (reconnecting or waiting between attempts). */
  readonly degraded = computed(() => {
    const state = this.stateSignal();
    return state === 'reconnecting' || state === 'waiting';
  });
  /** No pictures will arrive without operator action (unauthorized, removed, replaced, load failed). */
  readonly unavailable = computed(() => {
    const state = this.stateSignal();
    return (
      state === 'unauthorized' || state === 'removed' || state === 'replaced' || state === 'failed'
    );
  });

  constructor() {
    effect(() => {
      const live = this.store.live();
      const productionId = this.store.productionId();
      if (live && productionId) {
        untracked(() => this.ensureStarted(productionId));
      }
    });
    const unregister = inject(AuthService).onSignedOut(() => this.stop());
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.stop();
    });
  }

  /** Starts (or, for another production, rejoins) the media session. Idempotent; normally driven by the store. */
  ensureStarted(productionId: string): void {
    if (this.session) {
      if (this.sessionProductionId !== productionId) {
        this.sessionProductionId = productionId;
        this.session.restart();
      }
      return;
    }
    this.sessionProductionId = productionId;
    if (this.loading) {
      return;
    }
    const generation = this.generation;
    this.stateSignal.set('loading');
    this.loading = this.loader()
      .then((module) => {
        if (generation !== this.generation) {
          return;
        }
        this.createSession(module);
      })
      .catch((error: unknown) => {
        if (generation === this.generation) {
          console.warn('[StudioFlow] media client could not be loaded', error);
          this.stateSignal.set('failed');
        }
      })
      .finally(() => {
        this.loading = null;
      });
  }

  /** Reconnects from a terminal state (e.g. after `unauthorized` or `failed`). */
  restart(): void {
    if (this.session) {
      this.session.restart();
      return;
    }
    const productionId = this.sessionProductionId ?? this.store.productionId();
    if (productionId) {
      this.ensureStarted(productionId);
    }
  }

  /** Disconnects and releases the provider (sign-out). */
  stop(): void {
    this.generation += 1;
    this.disposeStateListener?.();
    this.disposeStateListener = null;
    this.session?.stop();
    this.session = null;
    this.sourceProvider?.dispose();
    this.sourceProvider = null;
    this.sessionProductionId = null;
    this.providerSignal.set(null);
    this.stateSignal.set('idle');
  }

  private createSession(module: MediaClientModule): void {
    const session = new module.MediaSession({
      role: 'studio',
      tokenProvider: () => {
        const productionId = this.sessionProductionId ?? this.store.productionId();
        return productionId
          ? this.api.getStudioLiveKitToken(productionId)
          : Promise.reject(new Error('No production to join.'));
      },
    });
    const provider = new module.LiveKitSourceProvider(session, {
      assetUrl: (assetId) => this.assetUrl(assetId),
    });
    this.session = session;
    this.sourceProvider = provider;
    this.disposeStateListener = session.onStateChange((state) => this.stateSignal.set(state));
    this.providerSignal.set(provider);
    this.stateSignal.set(session.state);
    session.start();
  }

  private assetUrl(assetId: string): string | null {
    const asset = this.store.assetById(assetId);
    if (asset) {
      return asset.contentUrl;
    }
    const productionId = this.sessionProductionId ?? this.store.productionId();
    return productionId ? this.api.assetContentUrl(productionId, assetId) : null;
  }
}
