import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import type { DeviceDto } from '@studioflow/scene-model';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { brightnessText, cameraPanelView, distanceText, zoomText } from './camera-panel-view';
import { CameraControlService } from './camera-control.service';

/** A slider keeps the value the user drags to this long after the last move; then it shows what the phone reports. */
export const DRAFT_HOLD_MS = 1500;
/** A report that arrives sooner than this after the last move does not pull the slider back (the drag goes on). */
const DRAG_QUIET_MS = 400;

type Slider = 'zoom' | 'distance' | 'brightness';

/**
 * Camera panel of a phone station (issue #11): lens picker, zoom, focus (automatic or locked, with distance),
 * brightness, light and "Reset to auto". Only the controls the phone reported are shown, and every slider shows the
 * value the phone reports back; while the user drags, the dragged value is shown and sent (throttled by
 * {@link CameraControlService}). A lens switch of a source that is in the program asks first (dashed red box). A refusal
 * by the phone or the server appears as an inline message. Sliders are native range inputs: arrow keys, Page Up/Down,
 * Home and End work.
 */
@Component({
  selector: 'sf-camera-panel',
  imports: [ConfirmBoxComponent],
  templateUrl: './camera-panel.component.html',
  styleUrl: './camera-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraPanelComponent {
  /** The phone. */
  readonly device = input.required<DeviceDto>();
  /** The camera is in the program scene: switching the lens needs a confirmation. */
  readonly inProgram = input(false);
  /** Codes of the station for the confirmation ("K1"). */
  readonly label = input('');

  private readonly control = inject(CameraControlService);
  protected readonly t = t;

  protected readonly view = computed(() => cameraPanelView(this.device()));
  /** The lens waiting for the confirmation. */
  protected readonly lensToConfirm = signal<{ id: string; label: string } | null>(null);
  private readonly drafts = signal<Readonly<Partial<Record<Slider, number>>>>({});
  private lastMoveAt = 0;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly failure = computed(() => {
    const view = this.view();
    return (
      this.control.failureOf(this.device().id) ?? (view.kind === 'controls' ? view.problem : null)
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearDraftTimer());
    effect(() => {
      this.view();
      untracked(() => {
        if (Date.now() - this.lastMoveAt > DRAG_QUIET_MS) {
          this.drafts.set({});
        }
      });
    });
  }

  /** The value a slider shows: the one being dragged, else what the phone reports. */
  protected shown(slider: Slider, actual: number): number {
    return this.drafts()[slider] ?? actual;
  }

  protected shownText(slider: Slider, actual: number): string {
    const value = this.shown(slider, actual);
    return slider === 'zoom'
      ? zoomText(value)
      : slider === 'brightness'
        ? brightnessText(value)
        : distanceText(value);
  }

  protected move(slider: Slider, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.lastMoveAt = Date.now();
    this.drafts.update((drafts) => ({ ...drafts, [slider]: value }));
    this.clearDraftTimer();
    this.draftTimer = setTimeout(() => this.drafts.set({}), DRAFT_HOLD_MS);
    this.control.send(
      this.device(),
      slider === 'zoom'
        ? { zoom: value }
        : slider === 'brightness'
          ? { exposureCompensation: value }
          : { focusDistance: value },
    );
  }

  protected setBrightnessAuto(): void {
    this.drafts.update(({ brightness: _brightness, ...rest }) => rest);
    this.control.send(this.device(), { exposureCompensation: 0 });
  }

  protected setFocus(mode: 'auto' | 'manual'): void {
    this.control.send(this.device(), { focusMode: mode });
  }

  protected setTorch(on: boolean): void {
    this.control.send(this.device(), { torch: on });
  }

  protected reset(): void {
    this.drafts.set({});
    this.control.send(this.device(), { reset: true });
  }

  protected chooseLens(id: string, label: string): void {
    if (this.inProgram()) {
      this.lensToConfirm.set({ id, label });
      return;
    }
    this.control.send(this.device(), { lensId: id });
  }

  protected confirmLens(): void {
    const lens = this.lensToConfirm();
    if (lens !== null) {
      this.control.send(this.device(), { lensId: lens.id });
    }
    this.lensToConfirm.set(null);
  }

  private clearDraftTimer(): void {
    if (this.draftTimer !== null) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
  }
}
