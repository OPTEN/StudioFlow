import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatClock } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverService, PopoverTriggerDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { StationFocusService } from '../station-focus.service';
import { BroadcastControlComponent } from './broadcast-control.component';
import { LAYOUT_POPOVER, LayoutPopoverComponent } from './layout-popover.component';
import { OUTPUT_POPOVER, OutputPopoverComponent, linkStateText } from './output-popover.component';
import { ProductionMenuComponent } from './production-menu.component';
import { SETTINGS_POPOVER, SettingsPopoverComponent } from './settings-popover.component';

/**
 * The Regie header (prototype `.top`, DESIGN.md "Header"): brand, production menu, broadcast state and control,
 * output chip with its popover, station health chip (jumps to the most severe incident), "Docks and layout",
 * settings, presence ("2 in the control room") and the mono clock.
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
    SettingsPopoverComponent,
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
  protected readonly settingsPopover = SETTINGS_POPOVER;
  protected readonly t = t;

  /** Header clock "HH:MM:SS" (local time). */
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
  /** The chip names the connected links ("Proxy + Teams camera"); empty while none is connected. */
  protected readonly connectedLinks = computed(() =>
    (this.store.outputStatus()?.links ?? [])
      .filter((link) => link.state === 'connected')
      .map((link) => link.name)
      .join(' + '),
  );
  /** Tooltip of the chip: every link with its state ("Proxy · connected"). */
  protected readonly outputTitle = computed(() => {
    const links = this.store.outputStatus()?.links ?? [];
    return links.length > 0
      ? links
          .map((link) =>
            t('regie.output.link.line', { name: link.name, state: linkStateText(link.state) }),
          )
          .join('\n')
      : null;
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
  protected readonly presenceText = computed(() =>
    t('regie.header.presence.long', { count: this.operators() }),
  );

  /** Health chip: open the station of the most severe incident, or confirm that all stations send. */
  protected showHealth(): void {
    const incident = this.store.mostSevereIncident();
    if (incident && this.stationFocus.showSource(incident.sourceId)) {
      return;
    }
    if (!incident) {
      this.toasts.show(
        this.store.devices().size > 0
          ? t('regie.header.health.allSending')
          : t('regie.header.health.noStations'),
      );
    }
  }
}
