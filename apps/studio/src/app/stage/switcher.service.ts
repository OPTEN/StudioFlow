import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import {
  FADE_DURATIONS_MS,
  formatSeconds,
  type FadeDurationMs,
  type TransitionDto,
  type TransitionKind,
} from '@studioflow/scene-model';
import { ApiError } from '../core/api/api-error';
import { StudioApiService } from '../core/api/studio-api.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { KeyboardService } from '../core/ui/keyboard.service';
import { PreferencesService } from '../core/ui/preferences.service';
import { ToastService } from '../core/ui/toast.service';

/** Toast when a command needs the server but the hub is disconnected, in the active language. */
export function offlineCommandMessage(): string {
  return t('regie.stage.switch.offline');
}

/** Longest time the fade guard blocks switching (longest fade 2 s plus a margin for clock skew). */
const MAX_GUARD_MS = 2500;

/** Message keys of the hint below the control column (prototype `renderMode`). */
export const SWITCH_HINT_KEYS = {
  studio: 'regie.stage.switch.hintStudio',
  direct: 'regie.stage.switch.hintDirect',
} as const satisfies Record<'studio' | 'direct', PlainMessageKey>;

/**
 * Switching like OBS (prototype "Transition, Take and direct switching", spec 4.2): Studio Mode (per browser), the
 * transition (Cut | Fade with duration), choosing scenes, Take, the fade guard and the program flash.
 *
 * - Studio Mode off: {@link chooseScene} switches the program directly. On: it loads the scene into the preview and
 *   {@link take} (Space) puts it on air.
 * - While a fade runs ({@link transitionRunning}, from the production's `lastSwitchAt` + duration in server time) or a
 *   switching request is in flight, new switches are ignored; a 409 `transition_running` is ignored silently.
 * - Every program switch event increments {@link programFlash} (monitor flash) and shows "‹Name› is live".
 *
 * Used by the stage (control column, monitors), the scenes dock and the keyboard (keys 1–9, Space; registered by
 * {@link registerShortcuts}, which the Regie page calls).
 */
@Injectable({ providedIn: 'root' })
export class SwitcherService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly preferences = inject(PreferencesService);
  private readonly toasts = inject(ToastService);
  private readonly keyboard = inject(KeyboardService);

  private readonly studioModeSignal = signal(this.preferences.readStudioMode());
  private readonly transitionKindSignal = signal<TransitionKind>(
    this.preferences.readTransition().kind,
  );
  private readonly fadeDurationSignal = signal<FadeDurationMs>(
    this.preferences.readTransition().durationMs,
  );
  private readonly transitionRunningSignal = signal(false);
  private readonly commandInFlightSignal = signal(false);
  private readonly programFlashSignal = signal(0);
  /** Guards the automatic preview assignment against repeating a failed request. */
  private previewFixKey: string | null = null;

  /** Studio Mode (persisted per browser as `studioflow.studio`). */
  readonly studioMode = this.studioModeSignal.asReadonly();
  /** Cut or Fade. */
  readonly transitionKind = this.transitionKindSignal.asReadonly();
  /** Fade duration; kept while Cut is chosen (persisted as `studioflow.transition`). */
  readonly fadeDurationMs = this.fadeDurationSignal.asReadonly();
  /** Transition sent with switches: `{ cut, 0 }` or `{ fade, duration }`. */
  readonly transition = computed<TransitionDto>(() =>
    this.transitionKindSignal() === 'cut'
      ? { kind: 'cut', durationMs: 0 }
      : { kind: 'fade', durationMs: this.fadeDurationSignal() },
  );
  /** "0.3 s" for the duration stepper. */
  readonly durationLabel = computed(() => formatSeconds(this.fadeDurationSignal()));
  /** The allowed fade durations (0,2 … 2 s). */
  readonly durationSteps = FADE_DURATIONS_MS;
  /** A fade of the last program switch is still running (server time). */
  readonly transitionRunning = this.transitionRunningSignal.asReadonly();
  /** A switching request (program, preview, take) is in flight. */
  readonly commandInFlight = this.commandInFlightSignal.asReadonly();
  /** Switching is blocked: a fade runs or a request is in flight. */
  readonly busy = computed(() => this.transitionRunningSignal() || this.commandInFlightSignal());
  /** Take is possible right now (Studio Mode, a preview different from the program, idle, connected). */
  readonly canTake = computed(() => {
    const preview = this.store.previewSceneId();
    return (
      this.studioModeSignal() &&
      !this.busy() &&
      preview !== null &&
      preview !== this.store.programSceneId() &&
      this.store.canCommand()
    );
  });
  /** Increments with every program switch event; the Program monitor plays its flash when it changes. */
  readonly programFlash = this.programFlashSignal.asReadonly();
  /** The last program switch event (scene ids and transition) for renderers. */
  readonly programSwitch = this.store.programSwitch;
  /** Hint text of the control column. */
  readonly hint = computed(() =>
    t(this.studioModeSignal() ? SWITCH_HINT_KEYS.studio : SWITCH_HINT_KEYS.direct),
  );

  constructor() {
    this.watchTransitionGuard();
    this.watchProgramSwitches();
    this.watchPreviewInStudioMode();
  }

  /** Registers keys 1–9 and Space; returns the unregister function. Called by the Regie page. */
  registerShortcuts(): () => void {
    const offScene = this.keyboard.register('scene', (index) => {
      const scene = this.store.scenes()[index];
      if (!scene) {
        return false;
      }
      void this.chooseScene(scene.id);
      return true;
    });
    const offTake = this.keyboard.register('take', () => {
      if (!this.studioModeSignal()) {
        return false;
      }
      void this.take();
      return true;
    });
    return () => {
      offScene();
      offTake();
    };
  }

  /**
   * Turns Studio Mode on or off (prototype `setStudio`). On: the preview gets the scene after the program when it
   * has none (or shows the program). Off: the preview is cleared unless another operator is online (spec 4.2).
   */
  async setStudioMode(on: boolean): Promise<void> {
    if (on === this.studioModeSignal()) {
      return;
    }
    this.studioModeSignal.set(on);
    this.preferences.writeStudioMode(on);
    this.toasts.show(on ? t('regie.stage.switch.studioOn') : t('regie.stage.switch.studioOff'));
    const productionId = this.store.productionId();
    if (!productionId || !this.store.canCommand()) {
      // The preview is fixed by watchPreviewInStudioMode once the Regie is connected again.
      return;
    }
    const preview = this.store.previewSceneId();
    const program = this.store.programSceneId();
    try {
      if (on && (preview === null || preview === program)) {
        const next = this.sceneAfter(program);
        if (next && next !== preview) {
          // The automatic assignment must not send the same request again.
          this.previewFixKey = `${productionId}:${program}`;
          await this.api.setPreview(productionId, { sceneId: next });
        }
      } else if (!on && preview !== null && this.store.operatorsOnline() <= 1) {
        await this.api.setPreview(productionId, { sceneId: null });
      }
    } catch (error) {
      this.toasts.error(error);
    }
  }

  /** Cut or Fade (persisted). */
  setTransitionKind(kind: TransitionKind): void {
    this.transitionKindSignal.set(kind);
    this.persistTransition();
  }

  /** True when the duration can move one step in `direction` (false under Cut and at the ends). */
  canStepDuration(direction: -1 | 1): boolean {
    if (this.transitionKindSignal() === 'cut') {
      return false;
    }
    const index = FADE_DURATIONS_MS.indexOf(this.fadeDurationSignal()) + direction;
    return index >= 0 && index < FADE_DURATIONS_MS.length;
  }

  /** Moves the fade duration one step (0,2 0,3 0,5 0,8 1 1,5 2 s). */
  stepDuration(direction: -1 | 1): void {
    const current = FADE_DURATIONS_MS.indexOf(this.fadeDurationSignal());
    const index = Math.min(FADE_DURATIONS_MS.length - 1, Math.max(0, current + direction));
    this.fadeDurationSignal.set(FADE_DURATIONS_MS[index]);
    this.persistTransition();
  }

  /**
   * A click on a scene or keys 1–9 (prototype `chooseScene`): in Studio Mode the scene goes into the preview,
   * otherwise it goes on air with the current transition. Ignored while switching is {@link busy}.
   */
  async chooseScene(sceneId: string): Promise<void> {
    if (this.busy()) {
      return;
    }
    const productionId = this.store.productionId();
    if (!productionId || !this.store.canCommand()) {
      this.toasts.show(offlineCommandMessage());
      return;
    }
    if (this.studioModeSignal()) {
      if (this.store.previewSceneId() !== sceneId) {
        await this.command(() => this.api.setPreview(productionId, { sceneId }));
      }
      return;
    }
    if (sceneId === this.store.programSceneId()) {
      return;
    }
    const transition = this.transition();
    await this.command(() => this.api.switchProgram(productionId, { sceneId, transition }));
  }

  /** Take (Space): preview ↔ program with the current transition. Resolves false when nothing was sent. */
  async take(): Promise<boolean> {
    if (!this.studioModeSignal() || this.busy()) {
      return false;
    }
    const preview = this.store.previewSceneId();
    if (preview === null || preview === this.store.programSceneId()) {
      return false;
    }
    const productionId = this.store.productionId();
    if (!productionId || !this.store.canCommand()) {
      this.toasts.show(offlineCommandMessage());
      return false;
    }
    const transition = this.transition();
    await this.command(() => this.api.take(productionId, { transition }));
    return true;
  }

  private async command(request: () => Promise<unknown>): Promise<void> {
    this.commandInFlightSignal.set(true);
    try {
      await request();
    } catch (error) {
      if (!ApiError.from(error).is('transition_running')) {
        this.toasts.error(error);
      }
    } finally {
      this.commandInFlightSignal.set(false);
    }
  }

  /** The scene after `sceneId` in list order (wrapping), like the prototype; null without scenes. */
  private sceneAfter(sceneId: string | null): string | null {
    const scenes = this.store.scenes();
    if (scenes.length === 0) {
      return null;
    }
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    return scenes[(index + 1) % scenes.length].id;
  }

  private persistTransition(): void {
    this.preferences.writeTransition({
      kind: this.transitionKindSignal(),
      durationMs: this.fadeDurationSignal(),
    });
  }

  /** transitionRunning: true from the program switch until lastSwitchAt + duration (server time). */
  private watchTransitionGuard(): void {
    const lastSwitch = computed(
      () => {
        const production = this.store.production();
        return {
          at: production?.lastSwitchAt ?? null,
          durationMs:
            production?.lastTransition?.kind === 'fade' ? production.lastTransition.durationMs : 0,
        };
      },
      { equal: (a, b) => a.at === b.at && a.durationMs === b.durationMs },
    );
    effect((onCleanup) => {
      const { at, durationMs } = lastSwitch();
      const start = at ? Date.parse(at) : Number.NaN;
      const remaining = Number.isNaN(start)
        ? 0
        : start + durationMs - untracked(() => this.store.serverNow());
      if (remaining <= 0 || durationMs <= 0) {
        this.transitionRunningSignal.set(false);
        return;
      }
      this.transitionRunningSignal.set(true);
      // Capped at the longest fade plus a margin, so a skewed clock can never block switching for long.
      const timer = setTimeout(
        () => this.transitionRunningSignal.set(false),
        Math.min(remaining, MAX_GUARD_MS),
      );
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** Flash and "‹Name› is live" for every program switch event. */
  private watchProgramSwitches(): void {
    effect(() => {
      const notice = this.store.programSwitch();
      if (!notice) {
        return;
      }
      untracked(() => {
        this.programFlashSignal.update((value) => value + 1);
        const scene = this.store.sceneById(notice.programSceneId);
        if (scene) {
          this.toasts.show(t('regie.stage.switch.live', { name: scene.name }));
        }
      });
    });
  }

  /** In Studio Mode a preview must exist: assign the scene after the program when the server has none. */
  private watchPreviewInStudioMode(): void {
    effect(() => {
      const needed =
        this.studioModeSignal() &&
        this.store.live() &&
        this.store.previewSceneId() === null &&
        this.store.scenes().length > 0;
      if (!needed) {
        if (this.store.previewSceneId() !== null) {
          this.previewFixKey = null;
        }
        return;
      }
      const productionId = this.store.productionId();
      const program = this.store.programSceneId();
      const key = `${productionId}:${program}`;
      if (!productionId || this.previewFixKey === key) {
        return;
      }
      this.previewFixKey = key;
      const next = untracked(() => this.sceneAfter(program));
      if (next) {
        this.api
          .setPreview(productionId, { sceneId: next })
          .catch((error: unknown) => this.toasts.error(error));
      }
    });
  }
}
