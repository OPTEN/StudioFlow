import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@flowstudio/scene-model';
import type { SceneDto, SlateDto, TransitionDto } from '@flowstudio/scene-model';

import { DesiredSizeCollector, DesiredSizeReporter, preloadRequests } from './desired-sizes';
import { createElement, FILL, px, setStyle } from './dom';
import { fadeOpacity, type Fade } from './fade';
import { FpsMeter } from './fps-meter';
import { clampNumber } from './geometry';
import { consoleErrorSink, guarded, type ErrorSink } from './guard';
import { PALETTE } from './palette';
import { devicePixelRatioNow, watchDevicePixelRatio } from './pixel-ratio';
import { createRenderContext, type RenderContext, type RenderFrame } from './render-context';
import { MediaPool, SceneLayer } from './scene-layer';
import { SlateView } from './slate-view';
import { fitStage } from './stage-fit';
import { StatusClock } from './status-clock';
import { DeadlineTimer, now, Ticker } from './timers';
import type { CanvasRect, RendererStats, SceneRenderer, SceneRendererOptions } from './types';

/** Default accessible name of the stage. */
const DEFAULT_STAGE_LABEL = 'Szene';
/** Longest fade the renderer plays (the API allows up to 2 s; anything longer is clamped). */
const MAX_FADE_MS = 10_000;
/** Refresh of running alert timers («Standbild 00:12»). */
const ALERT_TICK_MS = 1000;
/** Refresh of the rolling hold frames: the frame shown after a loss is at most this old. */
const HOLD_FRAME_REFRESH_MS = 1000;
/** Bound for renders requested by renders (a provider that calls back synchronously must not loop forever). */
const MAX_RENDER_PASSES = 4;

let rendererCount = 0;

/** Unique consumer id per renderer instance (desired sizes are aggregated per consumer by the provider). */
function nextConsumerId(): string {
  rendererCount += 1;
  return `scene-renderer-${rendererCount}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Duration of a transition in ms; 0 means cut. */
function fadeDurationOf(
  transition: TransitionDto | null | undefined,
  reducedMotion: boolean,
): number {
  if (reducedMotion || transition?.kind !== 'fade') {
    return 0;
  }
  return clampNumber(transition.durationMs, 0, MAX_FADE_MS, 0);
}

/** A fade between two scene layers that is still running. */
interface RunningFade {
  readonly fade: Fade;
  /** Removes the outgoing layer and resolves the transition promise. Idempotent. */
  readonly complete: () => void;
}

/**
 * Creates a renderer for one picture inside `container` (spec 8.3). The renderer appends a viewport that fills the
 * container (the container needs a definite size) and the 1920 × 1080 stage inside it.
 */
export function createSceneRenderer(
  container: HTMLElement,
  options: SceneRendererOptions,
): SceneRenderer {
  return new DomSceneRenderer(container, options);
}

class DomSceneRenderer implements SceneRenderer {
  readonly element: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly scenesEl: HTMLDivElement;
  private readonly slate: SlateView;
  private readonly ctx: RenderContext;
  private readonly sink: ErrorSink;
  private readonly reducedMotion: boolean;
  private readonly stageSizes: DesiredSizeReporter;
  private readonly preloadSizes: DesiredSizeReporter;
  private readonly statusClock = new StatusClock();
  private readonly fps = new FpsMeter();
  private readonly expiryTimer = new DeadlineTimer(() => this.requestRender());
  private readonly alertTicker = new Ticker(ALERT_TICK_MS, () => this.requestRender());
  private readonly holdFrameTicker = new Ticker(HOLD_FRAME_REFRESH_MS, () =>
    this.refreshHoldFrames(),
  );
  private readonly unsubscribeProvider: () => void;
  private readonly stopObservingSize: () => void;
  private current: SceneLayer | null = null;
  private outgoing: SceneLayer | null = null;
  /** The layer a cut is replacing, only while the new layer takes over (hold frame donors). */
  private retiring: SceneLayer | null = null;
  private runningFade: RunningFade | null = null;
  private preloadScenes: readonly SceneDto[] = [];
  private scale = 0;
  private busy = 0;
  private renderRequested = false;
  private destroyed = false;

  constructor(container: HTMLElement, options: SceneRendererOptions) {
    const doc = container.ownerDocument;
    const provider = options.provider;
    this.sink = options.onError ?? consoleErrorSink;
    this.reducedMotion = options.reducedMotion === true;
    this.ctx = createRenderContext(doc, options, this.sink, {
      statusSince: (sourceId, status, at) => this.statusClock.observe(sourceId, status, at),
      requestRender: () => this.requestRender(),
      holdFrameDonor: (sourceId, requester) => this.holdFrameDonor(sourceId, requester),
    });

    const background = this.ctx.transparent ? 'transparent' : PALETTE.stage;
    this.viewport = createElement(doc, 'div', 'fs-r-viewport', {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      'background-color': background,
      'pointer-events': 'none',
      'user-select': 'none',
    });
    this.element = createElement(doc, 'div', 'fs-r-stage', {
      position: 'absolute',
      left: '0',
      top: '0',
      width: px(CANVAS_WIDTH),
      height: px(CANVAS_HEIGHT),
      overflow: 'hidden',
      'transform-origin': '0 0',
      'background-color': background,
      contain: 'strict',
    });
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', options.label?.trim() || DEFAULT_STAGE_LABEL);
    // Scenes and slates are separate stacking contexts, the slate always on top.
    this.scenesEl = createElement(doc, 'div', 'fs-r-scenes', { ...FILL, 'z-index': '0' });
    const slateHost = createElement(doc, 'div', 'fs-r-slates', { ...FILL, 'z-index': '1' });
    this.element.append(this.scenesEl, slateHost);
    this.viewport.append(this.element);
    container.append(this.viewport);
    this.slate = new SlateView(doc, slateHost, this.reducedMotion);

    const consumerId = nextConsumerId();
    this.stageSizes = new DesiredSizeReporter(provider, consumerId, this.ctx.guard);
    this.preloadSizes = new DesiredSizeReporter(provider, `${consumerId}/preload`, this.ctx.guard);
    this.unsubscribeProvider = guarded(
      this.sink,
      () => provider.onChange(() => this.requestRender()),
      () => undefined,
    );
    this.stopObservingSize = this.observeSize();
    this.resize();
  }

  show(scene: SceneDto | null): void {
    this.run(() => {
      this.finishFade();
      if (scene && this.current?.sceneId === scene.id) {
        this.applyUpdate(this.current, scene);
      } else {
        this.cutTo(scene);
      }
    });
  }

  update(scene: SceneDto): void {
    this.run(() => {
      for (const layer of this.layers()) {
        if (layer.sceneId === scene.id) {
          this.applyUpdate(layer, scene);
        }
      }
    });
  }

  transitionTo(scene: SceneDto | null, transition: TransitionDto): Promise<void> {
    return this.run(() => {
      this.finishFade();
      if (scene && this.current?.sceneId === scene.id) {
        this.applyUpdate(this.current, scene);
        return Promise.resolve();
      }
      const duration = fadeDurationOf(transition, this.reducedMotion);
      if (!scene || duration === 0) {
        // An empty stage is always a cut: there is no picture to fade to.
        this.cutTo(scene);
        return Promise.resolve();
      }
      return this.fadeTo(scene, duration);
    }, Promise.resolve());
  }

  showSlate(slate: SlateDto | null, assetUrl?: string | null): void {
    this.run(() =>
      this.slate.show(slate, assetUrl === undefined ? this.slateImageUrl(slate) : assetUrl),
    );
  }

  setPreloadScenes(scenes: readonly SceneDto[]): void {
    this.run(() => {
      this.preloadScenes = Array.isArray(scenes) ? [...scenes] : [];
      this.renderRequested = true;
    });
  }

  setSourceStatuses(): void {
    this.requestRender();
  }

  effectiveRects(): ReadonlyMap<string, CanvasRect> {
    return new Map(this.current?.effectiveRects ?? []);
  }

  stats(): RendererStats {
    if (this.destroyed) {
      return { fps: 0, items: 0, videos: 0 };
    }
    const items = this.layers().reduce((sum, layer) => sum + layer.effectiveRects.size, 0);
    return { fps: this.fps.read(), items, videos: this.element.querySelectorAll('video').length };
  }

  resize(): void {
    this.run(() => {
      const fit = fitStage(this.viewport.clientWidth, this.viewport.clientHeight);
      this.scale = fit.scale;
      setStyle(
        this.element,
        'transform',
        `translate(${px(fit.offsetX)}, ${px(fit.offsetY)}) scale(${fit.scale})`,
      );
      this.renderRequested = true;
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.finishFade();
    this.ctx.guard(this.unsubscribeProvider);
    this.stopObservingSize();
    this.expiryTimer.clear();
    this.alertTicker.setActive(false);
    this.holdFrameTicker.setActive(false);
    this.fps.dispose();
    this.current?.dispose();
    this.current = null;
    this.slate.dispose();
    this.stageSizes.clear();
    this.preloadSizes.clear();
    this.viewport.remove();
  }

  /** Runs a public operation: no-op after destroy, errors go to the sink, renders requested inside run once at the end. */
  private run(operation: () => void): void;
  private run<T>(operation: () => T, fallback: T): T;
  private run<T>(operation: () => T, fallback?: T): T | undefined {
    if (this.destroyed) {
      return fallback;
    }
    this.busy += 1;
    try {
      return guarded(this.sink, operation, fallback);
    } finally {
      this.busy -= 1;
      if (this.busy === 0) {
        this.flushRender();
      }
    }
  }

  private requestRender(): void {
    if (this.destroyed) {
      return;
    }
    this.renderRequested = true;
    if (this.busy === 0) {
      this.flushRender();
    }
  }

  private flushRender(): void {
    for (
      let pass = 0;
      this.renderRequested && !this.destroyed && pass < MAX_RENDER_PASSES;
      pass += 1
    ) {
      this.renderRequested = false;
      this.busy += 1;
      try {
        guarded(this.sink, () => this.renderAll(), undefined);
      } finally {
        this.busy -= 1;
      }
    }
    this.renderRequested = false;
  }

  private frame(): RenderFrame {
    return { now: now(), scale: this.scale, devicePixelRatio: devicePixelRatioNow() };
  }

  private renderAll(): void {
    const frame = this.frame();
    const layers = this.layers();
    this.statusClock.beginPass();
    for (const layer of layers) {
      layer.render(frame);
    }
    this.statusClock.endPass();
    this.syncDesiredSizes(layers, frame);
    const expiries = layers
      .map((layer) => layer.holdExpiry)
      .filter((expiry): expiry is number => expiry !== null);
    this.expiryTimer.set(expiries.length > 0 ? Math.min(...expiries) : null);
    this.alertTicker.setActive(layers.some((layer) => layer.hasTimedAlert));
    this.holdFrameTicker.setActive(layers.some((layer) => layer.keepsHoldFrames));
  }

  /** Keeps the hold frames fresh; skipped while the page is hidden (nothing is painted then anyway). */
  private refreshHoldFrames(): void {
    if (this.destroyed || this.ctx.doc.visibilityState === 'hidden') {
      return;
    }
    const frame = this.frame();
    for (const layer of this.layers()) {
      this.ctx.guard(() => layer.refreshHoldFrames(frame));
    }
  }

  private syncDesiredSizes(layers: readonly SceneLayer[], frame: RenderFrame): void {
    const stage = new DesiredSizeCollector();
    for (const layer of layers) {
      layer.collectDesiredSizes(stage, frame);
    }
    this.stageSizes.sync(stage.result());
    this.preloadSizes.sync(preloadRequests(this.preloadScenes, stage.result()));
  }

  /** URL of a slate's background image asset from the provider (when the caller did not pass one). */
  private slateImageUrl(slate: SlateDto | null): string | null {
    const assetId = slate?.backgroundAssetId;
    if (typeof assetId !== 'string' || assetId === '') {
      return null;
    }
    const source = this.ctx.resolve(assetId);
    return source.kind === 'image' ? source.url : null;
  }

  /** Layers on stage, back to front. */
  private layers(): SceneLayer[] {
    return [this.outgoing, this.current].filter((layer): layer is SceneLayer => layer !== null);
  }

  /** Ignores outdated versions (out-of-order delivery); the same version is applied (local edits). */
  private applyUpdate(layer: SceneLayer, scene: SceneDto): void {
    if (scene.version < layer.sceneVersion) {
      return;
    }
    layer.update(scene);
    this.renderRequested = true;
  }

  private cutTo(scene: SceneDto | null): void {
    const previous = this.current;
    const pool = previous ? new MediaPool(previous.releaseMedia()) : undefined;
    this.current = scene ? new SceneLayer(scene, this.ctx, this.scenesEl, { pool }) : null;
    // A first render while the previous layer still exists, so lost sources keep their hold frames.
    this.retiring = previous;
    this.current?.render(this.frame());
    this.retiring = null;
    previous?.dispose();
    pool?.disposeRest();
    this.renderRequested = true;
  }

  private holdFrameDonor(sourceId: string, requester: object): HTMLCanvasElement | null {
    for (const layer of [this.retiring, ...this.layers()]) {
      const canvas = layer?.holdFrameOf(sourceId, requester) ?? null;
      if (canvas) {
        return canvas;
      }
    }
    return null;
  }

  private fadeTo(scene: SceneDto, durationMs: number): Promise<void> {
    const layer = new SceneLayer(scene, this.ctx, this.scenesEl, { opacity: 0 });
    this.outgoing = this.current;
    this.current = layer;
    this.renderRequested = true;
    return new Promise<void>((resolve) => {
      const fade = fadeOpacity(layer.element, 0, 1, durationMs);
      const running: RunningFade = {
        fade,
        complete: () => {
          if (this.runningFade !== running) {
            return;
          }
          this.runningFade = null;
          this.outgoing?.dispose();
          this.outgoing = null;
          this.requestRender();
          resolve();
        },
      };
      this.runningFade = running;
      void fade.done.then(() => this.ctx.guard(running.complete));
    });
  }

  /** Completes a running fade at once (a new transition or switch arrived, or teardown). */
  private finishFade(): void {
    const running = this.runningFade;
    if (running) {
      running.fade.finish();
      running.complete();
    }
  }

  /** Re-fits on container resizes and re-reports picture sizes when the device pixel ratio changes. */
  private observeSize(): () => void {
    const onResize = (): void => this.resize();
    const stopWatchingRatio = watchDevicePixelRatio(onResize);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(onResize);
      observer.observe(this.viewport);
      return () => {
        observer.disconnect();
        stopWatchingRatio();
      };
    }
    addEventListener('resize', onResize);
    return () => {
      removeEventListener('resize', onResize);
      stopWatchingRatio();
    };
  }
}
