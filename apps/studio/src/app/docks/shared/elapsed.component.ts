import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formatDuration } from '@flowstudio/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';

/**
 * A running «mm:ss» timer since a server timestamp (outage timers in the Quellen and Stationen docks):
 * `<span class="u-mono" [fsElapsed]="source.statusSince"></span>`. Only this tiny view reads the shared clock, so the
 * once-per-second tick re-renders the digits and nothing else. The time base is the server clock
 * (`ProductionStoreService.elapsedSince`).
 */
@Component({
  selector: '[fsElapsed]',
  template: `{{ text() }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElapsedComponent {
  /** ISO server time the timer counts from; null shows 00:00. */
  readonly fsElapsed = input.required<string | null>();

  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);

  protected readonly text = computed(() =>
    formatDuration(this.store.elapsedSince(this.fsElapsed(), this.clock.now())),
  );
}
