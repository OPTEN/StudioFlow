/**
 * Test doubles for the stage specs: a scriptable scene renderer and a manual animation-frame scheduler. Test-only
 * (imported by *.spec.ts files only).
 */
import type { CanvasRect, SceneDto, TransitionDto } from '@studioflow/scene-model';
import type {
  RendererStats,
  SceneRenderer,
  SceneRendererOptions,
} from '@studioflow/scene-renderer';
import type { FrameScheduler } from '../frame-scheduler';
import type { SceneRendererFactory } from '../scene-view.component';

/** One recorded renderer call. */
export interface RendererCall {
  readonly op: 'show' | 'update' | 'transitionTo' | 'setSourceStatuses' | 'destroy';
  readonly sceneId?: string | null;
  readonly transition?: TransitionDto;
}

/** Records every call; transitions resolve only when the test says so ({@link finishTransitions}). */
export class FakeSceneRenderer implements SceneRenderer {
  readonly element: HTMLElement;
  readonly calls: RendererCall[] = [];
  destroyed = false;
  current: SceneDto | null = null;
  /** Overrides {@link effectiveRects} (e.g. an Auto-Grid placement). */
  rects: ReadonlyMap<string, CanvasRect> | null = null;
  private pending: (() => void)[] = [];

  constructor(
    readonly container: HTMLElement,
    readonly options: SceneRendererOptions,
  ) {
    this.element = container.ownerDocument.createElement('div');
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', options.label ?? 'Scene');
    container.append(this.element);
  }

  show(scene: SceneDto | null): void {
    this.calls.push({ op: 'show', sceneId: scene?.id ?? null });
    this.current = scene;
  }

  update(scene: SceneDto): void {
    this.calls.push({ op: 'update', sceneId: scene.id });
    this.current = scene;
  }

  transitionTo(scene: SceneDto | null, transition: TransitionDto): Promise<void> {
    this.calls.push({ op: 'transitionTo', sceneId: scene?.id ?? null, transition });
    this.current = scene;
    return new Promise<void>((resolve) => this.pending.push(resolve));
  }

  /** Completes every running transition. */
  finishTransitions(): void {
    const pending = this.pending;
    this.pending = [];
    for (const resolve of pending) {
      resolve();
    }
  }

  showSlate(): void {
    // Not used by the Regie monitors.
  }

  setPreloadScenes(): void {
    // Not used by the Regie monitors.
  }

  setSourceStatuses(): void {
    this.calls.push({ op: 'setSourceStatuses' });
  }

  effectiveRects(): ReadonlyMap<string, CanvasRect> {
    if (this.rects) {
      return this.rects;
    }
    return new Map(
      (this.current?.items ?? [])
        .filter((item) => !item.hidden)
        .map((item) => [item.id, { x: item.x, y: item.y, w: item.w, h: item.h }]),
    );
  }

  stats(): RendererStats {
    return { fps: 0, items: this.effectiveRects().size, videos: 0 };
  }

  resize(): void {
    // Nothing to measure.
  }

  destroy(): void {
    this.destroyed = true;
    this.calls.push({ op: 'destroy' });
    this.element.remove();
  }

  /** Recorded operations without status refreshes. */
  ops(): string[] {
    return this.calls
      .filter((call) => call.op !== 'setSourceStatuses')
      .map((call) => (call.sceneId === undefined ? call.op : `${call.op}:${call.sceneId}`));
  }
}

/** Factory that keeps every renderer it created. */
export class FakeRendererFactory {
  readonly renderers: FakeSceneRenderer[] = [];
  readonly create: SceneRendererFactory = (container, options) => {
    const renderer = new FakeSceneRenderer(container, options);
    this.renderers.push(renderer);
    return renderer;
  };

  /** The most recently created renderer. */
  get last(): FakeSceneRenderer {
    const renderer = this.renderers[this.renderers.length - 1];
    if (!renderer) {
      throw new Error('no renderer created');
    }
    return renderer;
  }
}

/** Animation frames that run only when the test calls {@link flush}. */
export class ManualFrames {
  private queue: (() => void)[] = [];
  readonly scheduler: FrameScheduler = (callback) => {
    this.queue.push(callback);
    return () => {
      this.queue = this.queue.filter((entry) => entry !== callback);
    };
  };

  /** Number of scheduled frames. */
  get pending(): number {
    return this.queue.length;
  }

  /** Runs every scheduled frame callback. */
  flush(): void {
    const queue = this.queue;
    this.queue = [];
    for (const callback of queue) {
      callback();
    }
  }
}
