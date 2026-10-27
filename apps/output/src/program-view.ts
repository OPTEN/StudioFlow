import {
  canvasOf,
  programScene,
  type CanvasSize,
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
  'show' | 'update' | 'transitionTo' | 'showSlate' | 'setPreloadScenes' | 'refresh' | 'setCanvas'
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
 * Scenes whose sources the output keeps ready besides the program (spec 7, decision #12): the preview scene, the next
 * Take in Studio Mode, so it comes on air with its picture there and sharp. Every other scene is not prepared: its
 * sources are subscribed when it goes on air, and their pictures arrive with the next keyframe (about half a second).
 * That is what keeps the output page from decoding every source of every scene all the time.
 */
export function preloadScenesFor(state: ProductionState): SceneDto[] {
  const previewId = state.production.previewSceneId;
  if (previewId === null || previewId === state.production.programSceneId) {
    return [];
  }
  const preview = state.scenes.find((scene) => scene.id === previewId);
  return preview ? [preview] : [];
}

function sameScenes(a: readonly SceneDto[], b: readonly SceneDto[]): boolean {
  return a.length === b.length && a.every((scene, index) => scene === b[index]);
}

/** Marker for “nothing applied yet / applied state was discarded”. */
const NOTHING = Symbol('nothing');

/**
 * Maps the production state to renderer calls (spec 9.3) and makes only the calls that change something:
 * - the stage has the canvas of the production (format and resolution); a change reaches the renderer before the
 *   rescaled scenes do;
 * - the program scene is always rendered (also under a slate, so going live only fades the slate out and the
 *   picture is already there); the first state and every catch-up after a reconnect are shown without transition,
 *   a live `programSwitched` plays its transition, changes of the shown scene are diffed in place (`update`);
 * - standby → standby slate, live → no slate, ended → end slate;
 * - the preview scene is preloaded, no other scene (see {@link preloadScenesFor});
 * - a change of the sources (text content) or of the text colours re-renders the texts on stage (`refresh`).
 * While access is denied the stage is cleared (no picture of a production this link may no longer see stays in the
 * DOM) and “No access” is shown; the latest state is kept and rendered again when access returns.
 */
export class ProgramView {
  #latest: ProductionState | null = null;
  #denied = false;
  #canvas: CanvasSize | null = null;
  #scene: SceneDto | null | typeof NOTHING = NOTHING;
  #slateKey: string | null | typeof NOTHING = NOTHING;
  #preload: readonly SceneDto[] = [];
  #sources: ProductionState['sources'] | null = null;
  #textThemeKey = '';
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

  /** True while “No access” is shown. */
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

  /** Shows the “No access” slate (true) or renders the latest state again (false). */
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
    this.#renderCanvas(state);
    this.#renderScene(programScene(state), transition);
    this.#renderSlate(slateFor(state));
    const preload = preloadScenesFor(state);
    if (!sameScenes(preload, this.#preload)) {
      this.#preload = preload;
      this.renderer.setPreloadScenes(preload);
    }
    this.#renderTexts(state);
    this.#rendered = true;
  }

  #renderCanvas(state: ProductionState): void {
    const canvas = canvasOf(state.production);
    if (canvas.width !== this.#canvas?.width || canvas.height !== this.#canvas.height) {
      this.#canvas = canvas;
      this.renderer.setCanvas(canvas);
    }
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

  /** Texts read their content and colours from the state: a change asks the renderer to draw them again. */
  #renderTexts(state: ProductionState): void {
    const themeKey = JSON.stringify(state.production.textTheme ?? null);
    const changed = state.sources !== this.#sources || themeKey !== this.#textThemeKey;
    if (this.#sources !== null && changed) {
      this.renderer.refresh();
    }
    this.#sources = state.sources;
    this.#textThemeKey = themeKey;
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
