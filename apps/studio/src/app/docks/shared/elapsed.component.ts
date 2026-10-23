import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formatDuration } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';

/**
 * A running "mm:ss" timer since a server timestamp (outage timers in the Sources and Stations docks):
 * `<span class="u-mono" [sfElapsed]="source.statusSince"></span>`. Only this tiny view reads the shared clock, so the
 * once-per-second tick re-renders the digits and nothing else. The time base is the server clock
 * (`ProductionStoreService.elapsedSince`).
 */
@Component({
  selector: '[sfElapsed]',
  template: `{{ text() }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElapsedComponent {
  /** ISO server time the timer counts from; null shows 00:00. */
  readonly sfElapsed = input.required<string | null>();

  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);

  protected readonly text = computed(() =>
    formatDuration(this.store.elapsedSince(this.sfElapsed(), this.clock.now())),
  );
}
