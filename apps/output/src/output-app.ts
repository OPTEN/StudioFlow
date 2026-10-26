import {
  HUB,
  applyOutputChanges,
  isDeviceSourceRef,
  programScene,
  sourcesInScene,
  type OutputChangesDto,
  type OutputReport,
  type TransitionDto,
} from '@studioflow/scene-model';
import {
  ProductionSync,
  ResilientHub,
  type HubState,
  type ResilientHubOptions,
} from '@studioflow/realtime-client';
import {
  createSceneRenderer,
  type SceneRenderer,
  type SceneRendererOptions,
} from '@studioflow/scene-renderer';
import type { DecoderSummary, MediaSessionState } from '@studioflow/media-client';
import { ACCESS_RETRY_MS, AccessGuard } from './access-guard';
import {
  createOutputApi,
  HttpError,
  REQUEST_TIMEOUT_MS,
  timeoutSignal,
  withOutputKey,
  type OutputApi,
} from './api';
import { keepVideosPlaying, resumeVideos } from './autoplay';
import { BUILD_VERSION } from './build-info';
import type { OutputConfig, OutputFlags } from './config';
import { hideIdleCursor } from './cursor';
import type { DebugInfo } from './debug-overlay';
import { DeferredSourceProvider } from './deferred-provider';
import { UI_FONT_PROBE, whenFontsReady } from './fonts';
import { createOutputLog, mediaLogger, signalRLogger, type OutputLog } from './log';
import {
  isTerminalMediaState,
  loadOutputMedia,
  type LoadOutputMedia,
  type OutputMedia,
} from './media';
import { PlaybackLoad } from './playback-load';
import { OutputAudio, type OutputMix } from './output-audio';
import { ProgramView } from './program-view';
import { noAccessSlate } from './slates';
import { mountSoundButton } from './sound-button';
import { StatusReporter } from './status-reporter';
import { VersionWatch, type MarkerStorage } from './version-watch';

/** The part of {@link ResilientHub} the page uses. */
export type OutputHub = Pick<
  ResilientHub,
  | 'state'
  | 'start'
  | 'restart'
  | 'stop'
  | 'on'
  | 'invoke'
  | 'send'
  | 'onStateChange'
  | 'onConnected'
>;

/** Seams for tests; production code uses the defaults. */
export interface OutputAppDeps {
  readonly createRenderer?: (
    container: HTMLElement,
    options: SceneRendererOptions,
  ) => SceneRenderer;
  readonly createHub?: (options: ResilientHubOptions) => OutputHub;
  readonly loadMedia?: LoadOutputMedia;
  readonly api?: OutputApi;
  readonly log?: OutputLog;
  /** Resolves when the slate font is ready (default: `document.fonts`, at most 1 s). */
  readonly waitForFonts?: () => Promise<void>;
  /** Base path of the page, default `import.meta.env.BASE_URL` (`/o/`). */
  readonly basePath?: string;
  /** Version watch seams. */
  readonly currentEntry?: string | null;
  readonly fetchIndex?: () => Promise<string>;
  readonly reload?: () => void;
  readonly storage?: MarkerStorage | null;
  /** Media starts after the first frame, at the latest after this time (default 2 s). */
  readonly mediaStartTimeoutMs?: number;
  /** The audio mix (default: a Web Audio graph that plays the program). */
  readonly createAudioMix?: () => OutputMix;
  /** Captures the sound of a video element (default `captureStream()`). */
  readonly captureVideo?: (video: HTMLVideoElement) => MediaStream | null;
}

/** A running output page (handles for tests and the debug overlay). */
export interface OutputApp {
  readonly renderer: SceneRenderer;
  readonly view: ProgramView;
  readonly hub: OutputHub;
  readonly sync: ProductionSync<OutputChangesDto>;
  readonly guard: AccessGuard;
  readonly reporter: StatusReporter;
  readonly provider: DeferredSourceProvider;
  readonly audio: OutputAudio;
  readonly versionWatch: VersionWatch;
  /** The media side once loaded. */
  media(): OutputMedia | null;
  /** Collects what the debug overlay shows. */
  debugInfo(): Promise<DebugInfo>;
  dispose(): void;
}

/** After access returns, the page waits this long at most for a fresh state before it renders the last one. */
export const ALLOW_RENDER_TIMEOUT_MS = 5000;
/** Rejoin delay after LiveKit removed this page. */
export const REMOVAL_RESTART_MS = 3000;
/** A second removal within this window waits {@link ACCESS_RETRY_MS} instead. */
const REPEATED_REMOVAL_WINDOW_MS = 60_000;
/** Retry of a failed livekit-client chunk load. */
const MEDIA_LOAD_RETRY_MS = 30_000;
const DEFAULT_MEDIA_START_TIMEOUT_MS = 2000;

/** `?bg=transparent`: html, body and the stage become transparent. */
export function applyDocumentMode(doc: Document, flags: OutputFlags): void {
  doc.documentElement.classList.toggle('is-transparent', flags.background === 'transparent');
}

/** Runs `callback` once after the next paint (rAF + task), at the latest after 250 ms (hidden pages have no rAF). */
function afterNextPaint(win: Window | null, callback: () => void): () => void {
  let done = false;
  const run = (): void => {
    if (!done) {
      done = true;
      clearTimeout(fallback);
      callback();
    }
  };
  const fallback = setTimeout(run, 250);
  win?.requestAnimationFrame?.(() => setTimeout(run, 0));
  return () => {
    done = true;
    clearTimeout(fallback);
  };
}

function sessionStorageOrNull(win: Window | null): MarkerStorage | null {
  try {
    return win?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

function roundOrNull(value: number | null | undefined, digits = 0): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Composition of the output page (spec 9.3): output hub + `ProductionSync` → {@link ProgramView} → scene renderer;
 * LiveKit (lazy, after the first frame) → source provider; “No access” with slow retries; status reports; the
 * optional debug overlay and latency probe.
 */
export function startOutputApp(
  config: OutputConfig,
  root: HTMLElement,
  deps: OutputAppDeps = {},
): OutputApp {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const log = deps.log ?? createOutputLog();
  const api = deps.api ?? createOutputApi({ slug: config.slug, key: config.key });
  const basePath = deps.basePath ?? import.meta.env.BASE_URL;
  const disposers: (() => void)[] = [];
  let disposed = false;
  /** Lazy work (LiveKit, overlays) has started. */
  let lazyStarted = false;
  /** The slate font is loaded (or the wait timed out). */
  let fontsSettled = false;

  applyDocumentMode(doc, config.flags);

  let sync: ProductionSync<OutputChangesDto> | null = null;
  const assetUrl = (assetId: string): string | null => {
    const asset = sync?.state?.assets.get(assetId);
    return asset ? withOutputKey(asset.contentUrl, config.key) : null;
  };
  const provider = new DeferredSourceProvider(assetUrl);
  // The sound: a Web Audio mix of the program (microphones and screens from LiveKit, videos from the stage).
  const audio = new OutputAudio({
    enabled: config.flags.audio,
    ...(deps.createAudioMix ? { createMix: deps.createAudioMix } : {}),
    ...(deps.captureVideo ? { captureVideo: deps.captureVideo } : {}),
  });
  disposers.push(
    provider.onAssetVideosChange((sourceId, video, attached) =>
      audio.assetVideo(sourceId, video, attached),
    ),
  );
  if (config.flags.audio) {
    disposers.push(mountSoundButton(doc, audio));
  }
  const renderer = (deps.createRenderer ?? createSceneRenderer)(root, {
    mode: 'output',
    provider,
    background: config.flags.background,
    // The Regie chose cut or fade for the audience; the proxy machine's motion setting does not change that.
    reducedMotion: false,
    assetKindOf: (assetId) => sync?.state?.assets.get(assetId)?.kind,
    textOf: (sourceId) => sync?.state?.sources.get(sourceId)?.text ?? undefined,
    textTheme: () => sync?.state?.production.textTheme,
    label: 'Program',
    onError: (error) => log.warn(`renderer: ${describe(error)}`),
  });
  const view = new ProgramView(renderer, assetUrl);

  const hub = (deps.createHub ?? ((options) => new ResilientHub(options)))({
    url: HUB.outputPath,
    accessTokenFactory: () => config.key,
    logger: signalRLogger(log),
  });
  const productionSync = new ProductionSync<OutputChangesDto>({
    hub,
    subscribe: (since) => hub.invoke<OutputChangesDto>(HUB.subscribeOutput, since),
    apply: applyOutputChanges,
    logger: signalRLogger(log),
  });
  sync = productionSync;

  // Media (livekit-client) is loaded after the first frame.
  let media: OutputMedia | null = null;
  let mediaLoading: Promise<OutputMedia | null> | null = null;
  let mediaRetry: ReturnType<typeof setTimeout> | null = null;
  const loadMedia = deps.loadMedia ?? loadOutputMedia;

  // LiveKit removed the participant (key regenerated, spec 4.8) or deleted the room: rejoin soon instead of showing
  // “No access” – a refused link then fails at the token endpoint (unauthorized), a spurious removal heals itself
  // with the hold frames on screen. A removal that repeats within a minute waits the full access retry interval.
  let removalRestart: ReturnType<typeof setTimeout> | null = null;
  let lastRemovalAt = Number.NEGATIVE_INFINITY;
  const restartAfterRemoval = (): void => {
    if (removalRestart !== null) {
      return;
    }
    const now = Date.now();
    const delay =
      now - lastRemovalAt < REPEATED_REMOVAL_WINDOW_MS ? ACCESS_RETRY_MS : REMOVAL_RESTART_MS;
    lastRemovalAt = now;
    removalRestart = setTimeout(() => {
      removalRestart = null;
      const current: OutputMedia | null = media;
      if (!disposed && !guard.denied && current && isTerminalMediaState(current.session.state)) {
        current.session.restart();
      }
    }, delay);
  };

  const onMediaState = (state: MediaSessionState): void => {
    if (state === 'connected') {
      guard.allow('media');
    } else if (state === 'unauthorized') {
      guard.deny('media');
    } else if ((state === 'removed' || state === 'replaced') && !guard.denied) {
      restartAfterRemoval();
    }
  };

  const startMedia = (): Promise<OutputMedia | null> => {
    if (mediaLoading) {
      return mediaLoading;
    }
    mediaLoading = loadMedia({
      tokenProvider: () => api.liveKitToken(),
      assetUrl,
      logger: mediaLogger(log),
    }).then(
      (loaded) => {
        if (disposed) {
          loaded.provider.dispose();
          return null;
        }
        media = loaded;
        provider.bind(loaded.provider);
        audio.bindInputs(loaded.provider);
        disposers.push(loaded.session.onStateChange(onMediaState));
        if (!guard.denied) {
          loaded.session.start();
        }
        return loaded;
      },
      (error: unknown) => {
        log.warn(`media: livekit-client could not be loaded (${describe(error)})`);
        mediaRetry = setTimeout(() => {
          mediaRetry = null;
          mediaLoading = null;
          if (!disposed) {
            void startMedia();
          }
        }, MEDIA_LOAD_RETRY_MS);
        return null;
      },
    );
    return mediaLoading;
  };

  // “No access” after access returns: render once the state is fresh again (no flash of an outdated program).
  let pendingAllow = false;
  let allowTimer: ReturnType<typeof setTimeout> | null = null;
  const finishAllow = (): void => {
    pendingAllow = false;
    if (allowTimer !== null) {
      clearTimeout(allowTimer);
      allowTimer = null;
    }
    if (!guard.denied) {
      view.setDenied(false);
      audio.setAllowed(true);
    }
  };
  const allowWhenSynced = (): void => {
    if (productionSync.status === 'live' || !productionSync.state) {
      finishAllow();
      return;
    }
    pendingAllow = true;
    allowTimer ??= setTimeout(finishAllow, ALLOW_RENDER_TIMEOUT_MS);
  };

  const guard = new AccessGuard({
    onDenied: () => {
      pendingAllow = false;
      view.setDenied(true);
      audio.setAllowed(false);
      // A page that may no longer see the production must not keep receiving its pictures either.
      if (media && !isTerminalMediaState(media.session.state)) {
        media.session.stop();
      }
    },
    onAllowed: () => {
      allowWhenSynced();
      if (media && isTerminalMediaState(media.session.state)) {
        media.session.restart();
      } else if (lazyStarted) {
        void startMedia();
      }
    },
    retry: (side) => {
      if (side === 'hub') {
        hub.restart();
      } else {
        media?.session.restart();
      }
    },
  });

  disposers.push(
    hub.onStateChange((state: HubState) => {
      if (state === 'unauthorized') {
        guard.deny('hub');
      } else if (state === 'connected') {
        guard.allow('hub');
      }
    }),
  );

  // Reload once after an update, never on air (see version-watch.ts).
  const versionWatch = new VersionWatch({
    currentEntry:
      deps.currentEntry === undefined
        ? (doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null)
        : deps.currentEntry,
    fetchIndex:
      deps.fetchIndex ??
      (async () => {
        const response = await fetch(basePath, {
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: 'text/html' },
          signal: timeoutSignal(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new HttpError(response.status);
        }
        return response.text();
      }),
    storage: deps.storage === undefined ? sessionStorageOrNull(win) : deps.storage,
    canReload: () =>
      productionSync.status === 'live' && view.latest?.production.broadcast !== 'live',
    reload: deps.reload ?? (() => win?.location.reload()),
  });
  let connectedBefore = false;
  disposers.push(
    hub.onConnected(() => {
      if (connectedBefore) {
        void versionWatch.check();
      }
      connectedBefore = true;
    }),
  );

  // Lazy work after the first frame: LiveKit, debug overlay, latency probe.
  const startLazyWork = (): void => {
    if (lazyStarted || disposed) {
      return;
    }
    lazyStarted = true;
    clearTimeout(lazyFallback);
    if (!guard.denied) {
      void startMedia();
    }
    if (config.flags.debug) {
      void import('./debug-overlay').then(({ mountDebugOverlay }) => {
        if (!disposed) {
          disposers.push(mountDebugOverlay(doc, debugInfo));
        }
      });
    }
    if (config.flags.latency && win) {
      void import('./latency-probe').then(({ startLatencyProbe }) => {
        if (!disposed) {
          disposers.push(startLatencyProbe(provider, { target: win, doc }));
        }
      });
    }
  };
  const lazyFallback = setTimeout(
    startLazyWork,
    deps.mediaStartTimeoutMs ?? DEFAULT_MEDIA_START_TIMEOUT_MS,
  );
  let cancelPaintWait: (() => void) | null = null;

  // State → picture. The first state waits for the slate font (at most 1 s), so the first slate never reflows.
  const renderState = (transition: TransitionDto | null): void => {
    const state = productionSync.state;
    if (!state || !fontsSettled) {
      return;
    }
    view.apply(state, transition);
    if (pendingAllow) {
      finishAllow();
    }
    if (view.rendering && !lazyStarted && cancelPaintWait === null) {
      cancelPaintWait = afterNextPaint(win, startLazyWork);
    }
    versionWatch.maybeReload();
  };
  void (deps.waitForFonts ?? (() => whenFontsReady(doc, [UI_FONT_PROBE])))().then(() => {
    fontsSettled = true;
    if (!disposed) {
      renderState(null);
    }
  });
  disposers.push(
    productionSync.onChange((state, cause) => {
      audio.update(state, cause);
      const transition =
        cause.kind === 'event' && cause.event.type === 'programSwitched'
          ? cause.event.transition
          : null;
      renderState(transition);
    }),
    productionSync.onStatus((status) => {
      if (status === 'live') {
        if (pendingAllow) {
          finishAllow();
        }
        versionWatch.maybeReload();
      }
    }),
  );

  // Status reports every 2 s (REST every 10 s while the hub is down); the tick also resumes paused videos. They carry
  // what this machine manages: the frame rate, the share of dropped frames and the streams it decodes (in software).
  const playbackLoad = new PlaybackLoad();
  const reporter = new StatusReporter({
    collect: async (): Promise<OutputReport> => {
      const stats = renderer.stats();
      return {
        rendering: view.rendering,
        latencyMs: roundOrNull(await estimateLatency()),
        fps: roundOrNull(stats.fps || null, 1),
        programSceneId: view.shownSceneId,
        ...playbackLoad.measure(stats, await decoderSummary()),
        audio: audio.report(),
      };
    },
    transport: {
      hubConnected: () => hub.state === 'connected',
      sendViaHub: (report) => hub.send(HUB.report, report),
      sendViaRest: (report) => api.report(report),
    },
    enabled: () => !guard.denied,
    onTick: () => {
      resumeVideos(root);
      audio.tryResume();
    },
  });

  const estimateLatency = async (): Promise<number | null> => {
    const current: OutputMedia | null = media;
    if (!current) {
      return null;
    }
    try {
      return await current.provider.estimateLatencyMs();
    } catch {
      return null;
    }
  };

  const decoderSummary = async (): Promise<DecoderSummary | null> => {
    const current: OutputMedia | null = media;
    if (!current) {
      return null;
    }
    try {
      return await current.provider.decoderSummary();
    } catch {
      return null;
    }
  };

  const debugInfo = async (): Promise<DebugInfo> => {
    const state = productionSync.state;
    const scene = state ? programScene(state) : null;
    const sourceIds = sourcesInScene(scene).filter(isDeviceSourceRef);
    const current: OutputMedia | null = media;
    const stats = await Promise.all(
      sourceIds.map((sourceId) =>
        current ? current.provider.getStats(sourceId).catch(() => null) : Promise.resolve(null),
      ),
    );
    const mix = audio.debug();
    const audioChannels = await Promise.all(
      mix.channels.map(async (channel) => ({
        code: state?.sources.get(channel.sourceId)?.code ?? null,
        label: state?.sources.get(channel.sourceId)?.label ?? null,
        audible: channel.audible,
        hasSound: channel.hasSound,
        levelDb: channel.levelDb,
        stats: current
          ? await current.provider.getAudioStats(channel.sourceId).catch(() => null)
          : null,
      })),
    );
    return {
      productionName: state?.production.name ?? null,
      sceneName: scene?.name ?? null,
      broadcast: state?.production.broadcast ?? null,
      revision: state?.revision ?? null,
      canvas: state?.production.canvas ?? null,
      hubState: hub.state,
      syncStatus: productionSync.status,
      mediaState: current?.session.state ?? null,
      latencyMs: await estimateLatency(),
      rendererFps: renderer.stats().fps,
      version: BUILD_VERSION,
      sources: sourceIds.map((sourceId, index) => ({
        code: state?.sources.get(sourceId)?.code ?? null,
        label: state?.sources.get(sourceId)?.label ?? null,
        availability: provider.availability(sourceId).state,
        stats: stats[index] ?? null,
      })),
      audio: { state: audio.state, programDb: mix.programDb, channels: audioChannels },
    };
  };

  disposers.push(keepVideosPlaying(root, doc), hideIdleCursor(doc));
  productionSync.start();
  hub.start();
  reporter.start();

  return {
    renderer,
    view,
    hub,
    sync: productionSync,
    guard,
    reporter,
    provider,
    audio,
    versionWatch,
    media: () => media,
    debugInfo,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      clearTimeout(lazyFallback);
      cancelPaintWait?.();
      if (allowTimer !== null) {
        clearTimeout(allowTimer);
      }
      if (mediaRetry !== null) {
        clearTimeout(mediaRetry);
      }
      if (removalRestart !== null) {
        clearTimeout(removalRestart);
      }
      reporter.stop();
      guard.dispose();
      productionSync.stop();
      void hub.stop();
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
      const current: OutputMedia | null = media;
      if (current) {
        current.session.stop();
        current.provider.dispose();
      }
      provider.dispose();
      audio.dispose();
      renderer.destroy();
    },
  };
}

/**
 * A link that cannot work (malformed slug, missing or malformed key): “No access”, no network access at all.
 * Nothing can change without a new link, so there is nothing to retry.
 */
export function startInvalidLinkPage(
  root: HTMLElement,
  flags: OutputFlags,
  deps: Pick<OutputAppDeps, 'createRenderer' | 'waitForFonts'> = {},
): () => void {
  const doc = root.ownerDocument;
  applyDocumentMode(doc, flags);
  const renderer = (deps.createRenderer ?? createSceneRenderer)(root, {
    mode: 'output',
    provider: new DeferredSourceProvider(() => null),
    background: flags.background,
    label: 'Program',
  });
  let disposed = false;
  void (deps.waitForFonts ?? (() => whenFontsReady(doc, [UI_FONT_PROBE])))().then(() => {
    if (!disposed) {
      renderer.showSlate(noAccessSlate(), null);
    }
  });
  const stopCursor = hideIdleCursor(doc);
  return () => {
    disposed = true;
    stopCursor();
    renderer.destroy();
  };
}
