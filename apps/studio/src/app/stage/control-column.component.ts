import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatDb, type TransitionKind } from '@studioflow/scene-model';
import { StudioAudioService } from '../core/audio/studio-audio.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { IconComponent } from '../core/ui/icon.component';
import { SwitcherService } from './switcher.service';

/** The program meter spans −60 … 0 dBFS. */
const METER_FLOOR_DB = -60;
/** The meter turns red from −3 dBFS (DESIGN.md "Audio"). */
const METER_HOT_DB = -3;

let nextColumnId = 0;

/**
 * The fixed control column right of the monitors (DESIGN.md "Stage"): one calm stack from the mode to the action.
 *
 * - Studio Mode: a switch with a one-line explanation under it (what a click on a scene does now). The explanation
 *   keeps two lines of room, so nothing below it moves when the mode toggles.
 * - Transition: the segmented control Cut | Fade, then the duration of the fade as a stepper row. Under Cut the row
 *   stays in place but is clearly inactive (dimmed, both buttons disabled, the reason as its tooltip); the duration is
 *   kept for the next fade.
 * - Program audio: the peak level of what the output plays, a thin bar with the value in dB (red from −3 dBFS), or
 *   "No sound sources yet" while the production has no mixer channels.
 * - Take (Studio Mode only): the one filled action of the stage with its "Space" key hint. While it cannot take, the
 *   line under it names the reason (no connection, fading, switching, no scene in Preview, Preview already on air).
 *
 * Everything is wired to {@link SwitcherService}, which also guards against rapid repeats.
 */
@Component({
  selector: 'sf-control-column',
  imports: [IconComponent],
  templateUrl: './control-column.component.html',
  styleUrl: './control-column.component.scss',
  host: { class: 'c-control-column' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlColumnComponent {
  protected readonly t = t;
  protected readonly switcher = inject(SwitcherService);
  private readonly audio = inject(StudioAudioService);
  private readonly store = inject(ProductionStoreService);

  private readonly id = ++nextColumnId;
  protected readonly switchId = `sf-studio-switch-${this.id}`;
  protected readonly hintId = `sf-studio-hint-${this.id}`;
  protected readonly levelId = `sf-program-level-${this.id}`;
  protected readonly reasonId = `sf-take-reason-${this.id}`;

  /** Cut is chosen: the duration row is inactive. */
  protected readonly cut = computed(() => this.switcher.transitionKind() === 'cut');
  /** The production has a mixer: show the level of the program sound. */
  protected readonly hasAudio = computed(() => this.store.audioChannels().size > 0);
  /** The program level clamped to the meter's range (its `aria-valuenow`). */
  protected readonly programDb = computed(() =>
    Math.min(0, Math.max(METER_FLOOR_DB, this.audio.programLevel())),
  );
  /** Share of the meter's width: −60 dBFS is empty, 0 dBFS is full. */
  protected readonly programFill = computed(
    () => (this.programDb() - METER_FLOOR_DB) / -METER_FLOOR_DB,
  );
  protected readonly programHot = computed(() => this.audio.programLevel() >= METER_HOT_DB);
  protected readonly programText = computed(() => `${formatDb(this.audio.programLevel())} dB`);
  /** What a screen reader hears for the meter: "Silent" below the floor, else the value. */
  protected readonly programValueText = computed(() =>
    this.audio.programLevel() <= METER_FLOOR_DB
      ? t('regie.stage.control.silent')
      : this.programText(),
  );

  /** Why Take cannot take right now, or '' when it can. */
  protected readonly takeReason = computed(() => {
    if (!this.store.canCommand()) {
      return t('regie.stage.control.takeOffline');
    }
    if (this.switcher.transitionRunning()) {
      return t('regie.stage.control.takeFading');
    }
    if (this.switcher.commandInFlight()) {
      return t('regie.stage.control.takeSwitching');
    }
    const preview = this.store.previewSceneId();
    if (preview === null) {
      return t('regie.stage.control.takeNoPreview');
    }
    return preview === this.store.programSceneId() ? t('regie.stage.control.takeSame') : '';
  });

  protected onStudioModeChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.switcher.setStudioMode(checked);
  }

  protected setKind(kind: TransitionKind): void {
    this.switcher.setTransitionKind(kind);
  }

  protected step(direction: -1 | 1): void {
    if (this.switcher.canStepDuration(direction)) {
      this.switcher.stepDuration(direction);
    }
  }

  protected take(): void {
    void this.switcher.take();
  }
}
