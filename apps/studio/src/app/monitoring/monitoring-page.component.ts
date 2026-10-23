import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { t, tm, type PlainMessageKey } from '@studioflow/i18n';
import {
  MISSING_VALUE,
  formatClock,
  formatKbpsAsMbit,
  formatPercent,
} from '@studioflow/scene-model';
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
  /** Message key of the heading, or null for a unit that is never translated ({@link ColumnDefinition.unit}). */
  readonly label: PlainMessageKey | null;
  /** Heading that is the same in every language (fps, Mbit/s, RTT). */
  readonly unit?: string;
  /** Right-aligned numbers. */
  readonly numeric: boolean;
}

/** Columns in display order. */
export const MONITORING_COLUMNS: readonly ColumnDefinition[] = [
  { id: 'station', label: 'regie.monitoring.column.station', numeric: false },
  { id: 'state', label: 'regie.monitoring.column.state', numeric: false },
  { id: 'codes', label: 'regie.monitoring.column.codes', numeric: false },
  { id: 'resolution', label: 'regie.monitoring.column.resolution', numeric: false },
  { id: 'fps', label: null, unit: 'fps', numeric: true },
  { id: 'bitrate', label: null, unit: 'Mbit/s', numeric: true },
  { id: 'loss', label: 'regie.monitoring.column.loss', numeric: true },
  { id: 'rtt', label: null, unit: 'RTT', numeric: true },
  { id: 'battery', label: 'regie.monitoring.column.battery', numeric: true },
  { id: 'network', label: 'regie.monitoring.column.network', numeric: false },
  { id: 'tech', label: 'regie.monitoring.column.tech', numeric: false },
  { id: 'seen', label: 'regie.monitoring.column.seen', numeric: true },
];

/**
 * The monitoring page `/monitoring` (spec 9.1, phase 2): a full-page table of every station with its live
 * telemetry (state, slot codes, resolution, fps, bit rate, packet loss, RTT, battery and charging, network, technical
 * check, last contact). It updates with the store's telemetry stream (every 2 s per device) and the shared clock;
 * stale values are dimmed. Every column sorts (ascending, descending, back to the Regie order). Same visual language
 * as the Regie: one graphite surface, hairlines, mono figures, lamps and washes.
 */
@Component({
  selector: 'sf-monitoring-page',
  imports: [IconComponent, RouterLink],
  templateUrl: './monitoring-page.component.html',
  styleUrl: './monitoring-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitoringPageComponent {
  protected readonly t = t;
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
      t('regie.monitoring.summary.stations', { count: rows.length }),
      t('regie.monitoring.summary.sending', { count: sending }),
      t('regie.monitoring.summary.incidents', { count: open }),
    ].join(' · ');
  });
  /** Connection state in the header: "Live", "Connecting…" or "Offline" with the time of the last state. */
  protected readonly connection = computed<{ lamp: LampTone; text: string }>(() => {
    const discovery = this.store.discoveryError();
    if (discovery) {
      return { lamp: 'is-warn', text: tm(discovery) };
    }
    switch (this.store.status()) {
      case 'live':
        return { lamp: '', text: t('regie.monitoring.connection.live') };
      case 'offline': {
        const last = this.store.lastSyncAt();
        return {
          lamp: 'is-warn',
          text: last
            ? t('regie.monitoring.connection.offlineSince', {
                time: formatClock(new Date(last)),
              })
            : t('regie.monitoring.connection.offline'),
        };
      }
      default:
        return { lamp: 'is-idle', text: t('regie.monitoring.connection.connecting') };
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
    const percent = formatPercent(row.batteryPct);
    return row.charging ? t('regie.monitoring.batteryCharging', { percent }) : percent;
  }

  protected lowBattery(row: MonitoringRow): boolean {
    return row.batteryPct !== null && row.batteryPct < 20 && !row.charging;
  }
}
