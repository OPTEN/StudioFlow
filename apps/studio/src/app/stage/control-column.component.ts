import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatDb, type TransitionKind } from '@studioflow/scene-model';
import { StudioAudioService } from '../core/audio/studio-audio.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { IconComponent } from '../core/ui/icon.component';
import { SwitcherService } from './switcher.service';

let nextSwitchId = 0;

/**
 * The fixed control column right of the monitors (prototype `.ctrl`, DESIGN.md "Take", "Studio Mode switch and
 * Transition"): the Studio Mode switch, Transition (Cut | Fade), the duration stepper (violet mono value, muted
 * and disabled under Cut, disabled at the shortest and longest step), TAKE (only in Studio Mode; disabled while
 * a transition runs, while a switch is in flight, when the preview equals the program or offline; "Space" hint)
 * and the hint text. Everything is wired to {@link SwitcherService}, which also guards against rapid repeats.
 * Above Take sits the level of the program sound (issue #7), as long as the production has audio channels.
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
  protected readonly switchId = `sf-studio-switch-${++nextSwitchId}`;
  private readonly audio = inject(StudioAudioService);
  private readonly store = inject(ProductionStoreService);

  /** The production has a mixer: show the level of the program sound. */
  protected readonly hasAudio = computed(() => this.store.audioChannels().size > 0);
  /** Share of the meter's width: -60 dBFS is empty, 0 dBFS is full. */
  protected readonly programFill = computed(() =>
    Math.min(1, Math.max(0, (this.audio.programLevel() + 60) / 60)),
  );
  protected readonly programHot = computed(() => this.programFill() >= 0.9);
  protected readonly programText = computed(() => `${formatDb(this.audio.programLevel())} dB`);

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
