import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatClock } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverService, PopoverTriggerDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { StationFocusService } from '../station-focus.service';
import { BroadcastControlComponent } from './broadcast-control.component';
import { LAYOUT_POPOVER, LayoutPopoverComponent } from './layout-popover.component';
import { OUTPUT_POPOVER, OutputPopoverComponent } from './output-popover.component';
import { ProductionMenuComponent } from './production-menu.component';

/**
 * The Regie header (prototype `.top`, DESIGN.md «Header»): brand, production menu, broadcast state and control,
 * output chip with its popover, station health chip (jumps to the most severe incident), «Docks und Layout»,
 * presence («2 in der Regie») and the mono clock.
 */
@Component({
  selector: 'sf-header',
  imports: [
    IconComponent,
    PopoverTriggerDirective,
    ProductionMenuComponent,
    BroadcastControlComponent,
    OutputPopoverComponent,
    LayoutPopoverComponent,
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly clock = inject(ClockService);
  private readonly toasts = inject(ToastService);
  private readonly stationFocus = inject(StationFocusService);

  protected readonly outputPopover = OUTPUT_POPOVER;
  protected readonly layoutPopover = LAYOUT_POPOVER;

  /** Header clock «HH:MM:SS» (local time). */
  protected readonly clockText = computed(() => formatClock(new Date(this.clock.now())));

  /** Lamp of the output chip: green connected, amber stale, muted none. */
  protected readonly outputLamp = computed(() => {
    switch (this.store.outputStatus()?.state) {
      case 'connected':
        return '';
      case 'stale':
        return 'is-warn';
      default:
        return 'is-idle';
    }
  });
  protected readonly outputLatency = computed(() => {
    const latency = this.store.outputStatus()?.latencyMs;
    return latency === null || latency === undefined ? '–' : `${Math.round(latency)} ms`;
  });

  protected readonly health = this.store.healthSummary;
  protected readonly healthLamp = computed(() => {
    const health = this.health();
    if (health.active === 0) {
      return this.store.state() ? '' : 'is-idle';
    }
    return health.bad ? 'is-bad' : 'is-warn';
  });

  protected readonly operators = computed(() => Math.max(1, this.store.operatorsOnline()));
  protected readonly presenceText = computed(() => {
    const count = this.operators();
    return count === 1 ? 'Eine Person in der Regie' : `${count} Personen in der Regie`;
  });

  /** Health chip: open the station of the most severe incident, or confirm that all stations send. */
  protected showHealth(): void {
    const incident = this.store.mostSevereIncident();
    if (incident && this.stationFocus.showSource(incident.sourceId)) {
      return;
    }
    if (!incident) {
      this.toasts.show(
        this.store.devices().size > 0 ? 'Alle Stationen senden' : 'Noch keine Stationen gekoppelt',
      );
    }
  }
}
