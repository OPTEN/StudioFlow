import {
  programScene,
  type ProductionState,
  type SceneDto,
  type SlateDto,
  type TransitionDto,
} from '@studioflow/scene-model';
import type { SceneRenderer } from '@studioflow/scene-renderer';
import { noAccessSlate } from './slates';

/** The renderer calls the view makes. */
export type ProgramRenderer = Pick<
  SceneRenderer,
  'show' | 'update' | 'transitionTo' | 'showSlate' | 'setPreloadScenes'
>;

/** Slate for the broadcast state: standby slate before the start, end slate after the end, none while live. */
export function slateFor(state: ProductionState): SlateDto | null {
  switch (state.production.broadcast) {
    case 'standby':
      return state.production.standbySlate;
    case 'ended':
      return state.production.endSlate;
    default:
      return null;
  }
}

/**
 * Scenes whose sources the output keeps subscribed at a small layer (spec 7, plan 2 «Vorladen fürs Umschalten»):
 * every scene except the program, the preview scene first (Studio-Modus: the next take), then the others in order.
 */
export function preloadScenesFor(state: ProductionState): SceneDto[] {
  const programId = state.production.programSceneId;
  const previewId = state.production.previewSceneId;
  const others = state.scenes.filter((scene) => scene.id !== programId);
  const preview = others.find((scene) => scene.id === previewId);
  return preview ? [preview, ...others.filter((scene) => scene !== preview)] : others;
}

function sameScenes(a: readonly SceneDto[], b: readonly SceneDto[]): boolean {
  return a.length === b.length && a.every((scene, index) => scene === b[index]);
}

/** Marker for «nothing applied yet / applied state was discarded». */
const NOTHING = Symbol('nothing');

/**
 * Maps the production state to renderer calls (spec 9.3) and makes only the calls that change something:
 * - the program scene is always rendered (also under a slate, so going live only fades the slate out and the
 *   picture is already there); the first state and every catch-up after a reconnect are shown without transition,
 *   a live `programSwitched` plays its transition, changes of the shown scene are diffed in place (`update`);
 * - standby → standby slate, live → no slate, ended → end slate;
 * - every other scene is preloaded, the preview first.
 * While access is denied the stage is cleared (no picture of a production this link may no longer see stays in the
 * DOM) and «Kein Zugang» is shown; the latest state is kept and rendered again when access returns.
 */
export class ProgramView {
  #latest: ProductionState | null = null;
  #denied = false;
  #scene: SceneDto | null | typeof NOTHING = NOTHING;
  #slateKey: string | null | typeof NOTHING = NOTHING;
  #preload: readonly SceneDto[] = [];
  #rendered = false;

  constructor(
    private readonly renderer: ProgramRenderer,
    /** Resolves asset URLs; part of the slate comparison so a slate image that arrives later is shown. */
    private readonly assetUrl: (assetId: string) => string | null,
  ) {}

  /** True once a production state was rendered and access is not denied (`OutputReport.rendering`). */
  get rendering(): boolean {
    return this.#rendered && !this.#denied;
  }

  /** True while «Kein Zugang» is shown. */
  get denied(): boolean {
    return this.#denied;
  }

  /** The latest production state handed to {@link apply} (also while denied). */
  get latest(): ProductionState | null {
    return this.#latest;
  }

  /** The scene the audience sees (`OutputReport.programSceneId`): null while a slate covers the stage. */
  get shownSceneId(): string | null {
    if (this.#denied || this.#slateKey !== null || this.#scene === NOTHING) {
      return null;
    }
    return this.#scene?.id ?? null;
  }

  /**
   * Renders a production state. `transition` is the transition of a live `programSwitched` event; without it a
   * program change is shown immediately (first sync, catch-up after a reconnect).
   */
  apply(state: ProductionState, transition: TransitionDto | null = null): void {
    this.#latest = state;
    if (!this.#denied) {
      this.#render(state, transition);
    }
  }

  /** Shows the «No access» slate (true) or renders the latest state again (false). */
  setDenied(denied: boolean): void {
    if (denied === this.#denied) {
      return;
    }
    this.#denied = denied;
    if (denied) {
      this.renderer.showSlate(noAccessSlate(), null);
      this.renderer.show(null);
      this.renderer.setPreloadScenes([]);
      this.#scene = NOTHING;
      this.#slateKey = NOTHING;
      this.#preload = [];
      return;
    }
    if (this.#latest) {
      this.#render(this.#latest, null);
    } else {
      this.renderer.showSlate(null);
      this.#slateKey = null;
    }
  }

  #render(state: ProductionState, transition: TransitionDto | null): void {
    this.#renderScene(programScene(state), transition);
    this.#renderSlate(slateFor(state));
    const preload = preloadScenesFor(state);
    if (!sameScenes(preload, this.#preload)) {
      this.#preload = preload;
      this.renderer.setPreloadScenes(preload);
    }
    this.#rendered = true;
  }

  #renderScene(scene: SceneDto | null, transition: TransitionDto | null): void {
    const previous = this.#scene;
    this.#scene = scene;
    if (previous === NOTHING) {
      this.renderer.show(scene);
      return;
    }
    if ((scene?.id ?? null) !== (previous?.id ?? null)) {
      if (transition) {
        void this.renderer.transitionTo(scene, transition);
      } else {
        this.renderer.show(scene);
      }
      return;
    }
    if (scene && scene !== previous) {
      this.renderer.update(scene);
    }
  }

  #renderSlate(slate: SlateDto | null): void {
    const key = slate ? this.#slateKeyOf(slate) : null;
    if (key === this.#slateKey) {
      return;
    }
    this.#slateKey = key;
    // Without an explicit URL the renderer resolves the background image itself (images only).
    this.renderer.showSlate(slate);
  }

  #slateKeyOf(slate: SlateDto): string {
    const image = slate.backgroundAssetId ? this.assetUrl(slate.backgroundAssetId) : null;
    return JSON.stringify([slate.title, slate.subtitle, slate.backgroundAssetId, image]);
  }
}
