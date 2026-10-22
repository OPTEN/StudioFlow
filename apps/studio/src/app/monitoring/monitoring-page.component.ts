import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  MISSING_VALUE,
  formatClock,
  formatKbpsAsMbit,
  formatPercent,
  pluralize,
} from '@flowstudio/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ClockService } from '../core/ui/clock.service';
import { IconComponent } from '../core/ui/icon.component';
import { toneClass, type LampTone, type StateTone } from '../docks/shared/source-view';
import {
  monitoringRows,
  nextSort,
  seenText,
  sortMonitoringRows,
  type MonitoringColumn,
  type MonitoringRow,
  type MonitoringSort,
} from './monitoring-rows';

/** A column of the table. */
interface ColumnDefinition {
  readonly id: MonitoringColumn;
  readonly label: string;
  /** Right-aligned numbers. */
  readonly numeric: boolean;
}

/** Columns in display order. */
export const MONITORING_COLUMNS: readonly ColumnDefinition[] = [
  { id: 'station', label: 'Station', numeric: false },
  { id: 'state', label: 'Zustand', numeric: false },
  { id: 'codes', label: 'Quellen', numeric: false },
  { id: 'resolution', label: 'Auflösung', numeric: false },
  { id: 'fps', label: 'fps', numeric: true },
  { id: 'bitrate', label: 'Mbit/s', numeric: true },
  { id: 'loss', label: 'Verlust', numeric: true },
  { id: 'rtt', label: 'RTT', numeric: true },
  { id: 'battery', label: 'Akku', numeric: true },
  { id: 'network', label: 'Netz', numeric: false },
  { id: 'tech', label: 'Technik-Check', numeric: false },
  { id: 'seen', label: 'Zuletzt', numeric: true },
];

/**
 * The monitoring page `/monitoring` (spec 9.1, phase 2): a full-page table of every station with its live
 * telemetry (state, slot codes, resolution, fps, bit rate, packet loss, RTT, battery and charging, network, technical
 * check, last contact). It updates with the store's telemetry stream (every 2 s per device) and the shared clock;
 * stale values are dimmed. Every column sorts (ascending, descending, back to the Regie order). Same visual language
 * as the Regie: one graphite surface, hairlines, mono figures, lamps and washes.
 */
@Component({
  selector: 'fs-monitoring-page',
  imports: [IconComponent, RouterLink],
  templateUrl: './monitoring-page.component.html',
  styleUrl: './monitoring-page.component.scss',
  host: { lang: 'de-CH' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitoringPageComponent {
  protected readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);

  protected readonly columns = MONITORING_COLUMNS;
  protected readonly sort = signal<MonitoringSort>({ column: null, direction: 'asc' });

  private readonly serverNow = computed(() => this.store.serverNow(this.clock.now()));
  protected readonly clockText = computed(() => formatClock(new Date(this.clock.now())));
  protected readonly rows = computed<readonly MonitoringRow[]>(() =>
    sortMonitoringRows(
      monitoringRows(
        this.store.stations(),
        (deviceId) => this.store.deviceSources(deviceId),
        this.serverNow(),
      ),
      this.sort(),
    ),
  );
  protected readonly summary = computed(() => {
    const rows = this.rows();
    const sending = rows.filter((row) => row.status === 'ok').length;
    const open = this.store.openIncidents().length;
    return [
      pluralize(rows.length, 'Station', 'Stationen'),
      `${sending} ${sending === 1 ? 'sendet' : 'senden'}`,
      open > 0 ? pluralize(open, 'Störung', 'Störungen') : 'keine Störung',
    ].join(' · ');
  });
  /** Connection state in the header: «Live», «Verbindet …» or «Offline» with the time of the last state. */
  protected readonly connection = computed<{ lamp: LampTone; text: string }>(() => {
    const discovery = this.store.discoveryError();
    if (discovery) {
      return { lamp: 'is-warn', text: discovery };
    }
    switch (this.store.status()) {
      case 'live':
        return { lamp: '', text: 'Live' };
      case 'offline': {
        const last = this.store.lastSyncAt();
        return {
          lamp: 'is-warn',
          text: last ? `Offline · Stand ${formatClock(new Date(last))}` : 'Offline',
        };
      }
      default:
        return { lamp: 'is-idle', text: 'Verbindet …' };
    }
  });

  constructor() {
    this.store.start();
  }

  protected sortBy(column: MonitoringColumn): void {
    this.sort.update((current) => nextSort(current, column));
  }

  protected ariaSort(column: MonitoringColumn): 'ascending' | 'descending' | null {
    const sort = this.sort();
    if (sort.column !== column) {
      return null;
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected toneClass(tone: StateTone): string {
    return toneClass(tone);
  }

  protected seen(row: MonitoringRow): string {
    return seenText(row.seenAt, this.serverNow());
  }

  protected bitrate(row: MonitoringRow): string {
    return row.bitrateKbps === null ? MISSING_VALUE : formatKbpsAsMbit(row.bitrateKbps);
  }

  protected rtt(row: MonitoringRow): string {
    return row.rttMs === null ? MISSING_VALUE : `${Math.round(row.rttMs)} ms`;
  }

  protected battery(row: MonitoringRow): string {
    if (row.batteryPct === null) {
      return MISSING_VALUE;
    }
    return `${formatPercent(row.batteryPct)}${row.charging ? ' · lädt' : ''}`;
  }

  protected lowBattery(row: MonitoringRow): boolean {
    return row.batteryPct !== null && row.batteryPct < 20 && !row.charging;
  }
}
