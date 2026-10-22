import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { TransitionKind } from '@flowstudio/scene-model';
import { IconComponent } from '../core/ui/icon.component';
import { SwitcherService } from './switcher.service';

let nextSwitchId = 0;

/**
 * The fixed control column right of the monitors (prototype `.ctrl`, DESIGN.md «Take», «Studio-Modus switch and
 * Übergang»): the Studio-Modus switch, Übergang (Schnitt | Blende), the duration stepper (violet mono value, muted
 * and disabled under Schnitt, disabled at the shortest and longest step), TAKE (only in Studio-Modus; disabled while
 * a transition runs, while a switch is in flight, when the preview equals the program or offline; «Leerschlag» hint)
 * and the hint text. Everything is wired to {@link SwitcherService}, which also guards against rapid repeats.
 */
@Component({
  selector: 'fs-control-column',
  imports: [IconComponent],
  templateUrl: './control-column.component.html',
  styleUrl: './control-column.component.scss',
  host: { class: 'c-control-column' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlColumnComponent {
  protected readonly switcher = inject(SwitcherService);
  protected readonly switchId = `fs-studio-switch-${++nextSwitchId}`;

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
