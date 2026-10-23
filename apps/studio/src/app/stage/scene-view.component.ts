import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import type { CanvasRect, SceneDto, TransitionDto } from '@studioflow/scene-model';
import {
  createSceneRenderer,
  type AssetMediaKind,
  type SceneRenderer,
  type SceneRendererOptions,
  type SourceMediaProvider,
} from '@studioflow/scene-renderer';
import { StudioMediaService } from '../core/media/studio-media.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ClockService } from '../core/ui/clock.service';
import { ViewportService } from '../core/ui/viewport.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { PlaceholderMediaProvider } from './placeholder-media-provider';

/** Where a scene view runs: a Regie monitor (alerts, "Source missing") or a small scene thumbnail. */
export type SceneViewMode = 'monitor' | 'thumbnail';

/**
 * A program switch to animate: when the view's scene changes to `sceneId` and `seq` was not played yet, the view
 * plays `transition` (cut or fade) instead of cutting. Built from `ProductionStoreService.programSwitch()`.
 */
export interface SceneTransitionCue {
  /** Increments with every switch (see `ProgramSwitchNotice.seq`). */
  readonly seq: number;
  /** The new program scene. */
  readonly sceneId: string | null;
  readonly transition: TransitionDto;
}

/** Creates a renderer (replaced by a fake in unit tests). */
export type SceneRendererFactory = (
  container: HTMLElement,
  options: SceneRendererOptions,
) => SceneRenderer;

/** The renderer factory of every scene view; defaults to `createSceneRenderer` of `@studioflow/scene-renderer`. */
export const SCENE_RENDERER_FACTORY = new InjectionToken<SceneRendererFactory>(
  'SCENE_RENDERER_FACTORY',
  { providedIn: 'root', factory: () => createSceneRenderer },
);

const NO_RECTS: ReadonlyMap<string, CanvasRect> = new Map();

function sameRects(
  a: ReadonlyMap<string, CanvasRect>,
  b: ReadonlyMap<string, CanvasRect>,
): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const [id, rect] of a) {
    const other = b.get(id);
    if (
      !other ||
      other.x !== rect.x ||
      other.y !== rect.y ||
      other.w !== rect.w ||
      other.h !== rect.h
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Angular wrapper around the framework-free scene renderer (`createSceneRenderer`, spec 8.3) for the Regie monitors
 * (mode `monitor`) and the scene thumbnails of the Scenes dock (mode `thumbnail`).
 *
 * ```html
 * <sf-scene-view mode="thumbnail" [scene]="scene" [label]="scene.name" />
 * ```
 *
 * - The host is the renderer's container: give it a definite size (e.g. `width: 64px; aspect-ratio: 16 / 9`, or
 *   `position: absolute; inset: 0` inside a 16:9 box). The 1920 × 1080 stage is letterboxed into it.
 * - Scene changes: the same scene id is diffed in place (`update`, no flicker; local edit drafts included), another
 *   scene is shown immediately (`show`), unless {@link cue} announces a program switch to exactly that scene: then
 *   the switch's transition is played (`transitionTo`, a fade always completes) and {@link transitionEnd} fires.
 * - Pictures come from `StudioMediaService.provider()`; until it exists (or when LiveKit is unavailable) a placeholder
 *   provider renders the layout with dark device placeholders and real images/videos. The renderer is recreated when
 *   the provider, the mode or the reduced-motion preference changes.
 * - Monitor alerts read the store (`statusOf`, `codeOf`) and refresh whenever the sources change.
 * - Renderer work happens outside Angular's templates: the renderer owns its DOM and timers and never writes signals;
 *   only {@link rects} is a signal (Auto-Grid rectangles for the edit overlay, monitor mode only).
 * - On destroy the renderer is destroyed (DOM, timers, provider registrations).
 */
@Component({
  selector: 'sf-scene-view',
  template: '',
  styles: `
    :host {
      display: block;
      overflow: hidden;
      position: relative;
    }
  `,
  host: { class: 'c-scene-view' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneViewComponent {
  /** The scene to show (null: empty stage). */
  readonly scene = input<SceneDto | null>(null);
  /** `monitor` (alerts, "Source missing", Auto-Grid rectangles) or `thumbnail`. */
  readonly mode = input<SceneViewMode>('monitor');
  /** Accessible name of the picture (`role="img"`), e.g. "Program monitor: Break, matches the output"; "Scene" by default. */
  readonly label = input<string | null>(null);
  private readonly ariaLabel = computed(() => this.label() ?? t('regie.stage.view.label'));
  /** Program switch to animate (see {@link SceneTransitionCue}); null for views that always cut. */
  readonly cue = input<SceneTransitionCue | null>(null);
  /** Fires when a cued transition has completed (also for cuts); the Program monitor flashes then. */
  readonly transitionEnd = output<TransitionDto>();

  private readonly store = inject(ProductionStoreService);
  private readonly media = inject(StudioMediaService);
  private readonly placeholder = inject(PlaceholderMediaProvider);
  private readonly viewport = inject(ViewportService);
  private readonly clock = inject(ClockService);
  private readonly factory = inject(SCENE_RENDERER_FACTORY);
  private readonly frame = inject(FRAME_SCHEDULER);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly rectsSignal = signal<ReadonlyMap<string, CanvasRect>>(NO_RECTS, {
    equal: sameRects,
  });
  private renderer: SceneRenderer | null = null;
  /** The scene the renderer shows; undefined before the first `show` of this renderer. */
  private shownScene: SceneDto | null | undefined = undefined;
  /** Sequence number of the last cue that was played or skipped. */
  private playedSeq: number | null = null;
  private unsubscribeProvider: (() => void) | null = null;
  private cancelRectsFrame: (() => void) | null = null;

  /**
   * Rectangles the renderer actually uses per visible item id (Auto-Grid places items itself), in canvas pixels.
   * Updated after every scene change, when sources come and go, and once per second for Auto-Grid scenes (hold
   * times). Always empty in thumbnail mode.
   */
  readonly rects = this.rectsSignal.asReadonly();

  private readonly provider = computed<SourceMediaProvider>(
    () => this.media.provider() ?? this.placeholder,
  );

  constructor() {
    effect((onCleanup) => {
      const provider = this.provider();
      const mode = this.mode();
      const reducedMotion = this.viewport.reducedMotion();
      untracked(() => this.create(provider, mode, reducedMotion));
      onCleanup(() => this.release());
    });
    effect(() => {
      const scene = this.scene();
      const cue = this.cue();
      untracked(() => this.present(scene, cue));
    });
    effect(() => {
      this.store.sources();
      untracked(() => this.renderer?.setSourceStatuses());
    });
    effect(() => {
      const label = this.ariaLabel();
      untracked(() => this.renderer?.element.setAttribute('aria-label', label));
    });
    effect(() => {
      // Auto-Grid reflows when hold times expire inside the renderer: re-read the rectangles once per second.
      this.clock.now();
      if (this.mode() === 'monitor' && this.scene()?.layoutMode === 'autoGrid') {
        untracked(() => this.refreshRects());
      }
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  /** The renderer's current rectangles per visible item id (fresh read; empty without renderer). */
  effectiveRects(): ReadonlyMap<string, CanvasRect> {
    return this.renderer?.effectiveRects() ?? NO_RECTS;
  }

  private create(provider: SourceMediaProvider, mode: SceneViewMode, reducedMotion: boolean): void {
    this.release();
    this.renderer = this.factory(this.host, {
      mode,
      provider,
      statusOf: (sourceId) => this.store.statusOf(sourceId),
      codeOf: (sourceId) => this.store.codeOf(sourceId),
      assetKindOf: (assetId) => this.assetKind(assetId),
      reducedMotion,
      label: this.ariaLabel(),
      onError: (error) => console.warn('[StudioFlow] scene renderer', error),
    });
    // A new renderer starts with the current scene; cues that arrived before it are not replayed.
    this.playedSeq = this.cue()?.seq ?? null;
    const scene = this.scene();
    this.renderer.show(scene);
    this.shownScene = scene;
    this.unsubscribeProvider = provider.onChange(() => this.scheduleRects());
    this.refreshRects();
  }

  private present(scene: SceneDto | null, cue: SceneTransitionCue | null): void {
    const renderer = this.renderer;
    if (!renderer || this.shownScene === undefined || scene === this.shownScene) {
      return;
    }
    const shownId = this.shownScene?.id ?? null;
    const nextId = scene?.id ?? null;
    const freshCue = cue !== null && cue.seq !== this.playedSeq && cue.sceneId === nextId;
    if (freshCue) {
      this.playedSeq = cue.seq;
    }
    this.shownScene = scene;
    if (freshCue && nextId !== shownId) {
      const transition = cue.transition;
      void renderer.transitionTo(scene, transition).then(() => {
        if (this.renderer === renderer) {
          this.refreshRects();
          this.transitionEnd.emit(transition);
        }
      });
    } else if (scene && nextId === shownId) {
      renderer.update(scene);
    } else {
      renderer.show(scene);
    }
    this.refreshRects();
  }

  private assetKind(assetId: string): AssetMediaKind | undefined {
    const kind = this.store.assetById(assetId)?.kind ?? this.store.kindOf(assetId);
    return kind === 'video' || kind === 'image' ? kind : undefined;
  }

  private refreshRects(): void {
    const rects = this.mode() === 'monitor' ? this.renderer?.effectiveRects() : undefined;
    this.rectsSignal.set(rects ?? NO_RECTS);
  }

  private scheduleRects(): void {
    if (this.cancelRectsFrame || this.mode() !== 'monitor') {
      return;
    }
    this.cancelRectsFrame = this.frame(() => {
      this.cancelRectsFrame = null;
      this.refreshRects();
    });
  }

  private release(): void {
    this.cancelRectsFrame?.();
    this.cancelRectsFrame = null;
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.shownScene = undefined;
  }
}
