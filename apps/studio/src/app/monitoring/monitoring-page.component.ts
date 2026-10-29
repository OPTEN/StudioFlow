import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { t, tm, type PlainMessageKey } from '@studioflow/i18n';
import { MISSING_VALUE, formatClock, formatPercent } from '@studioflow/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ClipboardService } from '../core/ui/clipboard.service';
import { ClockService } from '../core/ui/clock.service';
import {
  ContextMenuDirective,
  ContextMenuService,
  type ContextMenuEntry,
} from '../core/ui/context-menu';
import { IconComponent } from '../core/ui/icon.component';
import { toneClass, type LampTone, type StateTone } from '../docks/shared/source-view';
import { SettingsPageHeadComponent } from '../settings/pages/settings-page-head.component';
import { StationFocusService } from '../shell/station-focus.service';
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
  readonly label: PlainMessageKey;
  /** The unit of the figures in the column, the same in every language (fps, Mbit/s, ms, %). */
  readonly unit?: string;
  /** Right-aligned numbers. */
  readonly numeric: boolean;
  /** One value per source (a line per source in the row) rather than one per device. */
  readonly perSource: boolean;
}

/** Columns in display order. */
export const MONITORING_COLUMNS: readonly ColumnDefinition[] = [
  { id: 'station', label: 'regie.monitoring.column.station', numeric: false, perSource: false },
  { id: 'state', label: 'regie.monitoring.column.state', numeric: false, perSource: false },
  { id: 'codes', label: 'regie.monitoring.column.codes', numeric: false, perSource: true },
  {
    id: 'resolution',
    label: 'regie.monitoring.column.resolution',
    numeric: false,
    perSource: true,
  },
  {
    id: 'fps',
    label: 'regie.monitoring.column.fps',
    unit: 'fps',
    numeric: true,
    perSource: true,
  },
  {
    id: 'bitrate',
    label: 'regie.monitoring.column.bitrate',
    unit: 'Mbit/s',
    numeric: true,
    perSource: true,
  },
  { id: 'encoding', label: 'regie.monitoring.column.encoding', numeric: false, perSource: true },
  {
    id: 'loss',
    label: 'regie.monitoring.column.loss',
    unit: '%',
    numeric: true,
    perSource: true,
  },
  { id: 'rtt', label: 'regie.monitoring.column.rtt', unit: 'ms', numeric: true, perSource: false },
  { id: 'battery', label: 'regie.monitoring.column.battery', numeric: true, perSource: false },
  { id: 'network', label: 'regie.monitoring.column.network', numeric: false, perSource: false },
  { id: 'tech', label: 'regie.monitoring.column.tech', numeric: false, perSource: false },
  { id: 'seen', label: 'regie.monitoring.column.seen', numeric: true, perSource: false },
];

/**
 * Monitoring (`/monitoring`, spec 9.1) in the settings window: a table of every device with its live telemetry (state,
 * sources, resolution, frame rate, bit rate, encoding with the "CPU at limit" tag of issue #12, packet loss, round trip,
 * battery, network, technical check and last contact). Devices with a problem come first (the order of the Devices
 * dock); a device with several sources shows one aligned line per source, so a value always sits next to its code.
 * Headings carry the units and sort on click (ascending, descending, back to the order of the devices) with a quiet
 * arrow on every column. It follows the store's telemetry stream (every 2 s per device) and the shared clock; stale
 * values are dimmed. Each row has a menu (right click, the context-menu key or its ⋯ button): show the device in the
 * control room (the Devices dock opens and flashes it) or copy its values as text.
 */
@Component({
  selector: 'sf-monitoring-page',
  imports: [ContextMenuDirective, IconComponent, RouterLink, SettingsPageHeadComponent],
  templateUrl: './monitoring-page.component.html',
  styleUrl: './monitoring-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitoringPageComponent {
  protected readonly t = t;
  protected readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);
  private readonly router = inject(Router);
  private readonly focus = inject(StationFocusService);
  private readonly menus = inject(ContextMenuService);
  private readonly clipboard = inject(ClipboardService);

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
  /** Connection state in the page head: "Live", "Connecting…" or "Offline" with the time of the last state. */
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

  protected menuLabel(row: MonitoringRow): string {
    return t('regie.monitoring.row.menu', { name: row.name });
  }

  /** The builder `[sfContextMenu]` calls when the menu of a row opens. */
  protected menuOf(row: MonitoringRow): () => readonly ContextMenuEntry[] {
    return () => this.rowMenu(row);
  }

  /** The commands of a device: show it in the control room, copy its values. */
  protected rowMenu(row: MonitoringRow): readonly ContextMenuEntry[] {
    return [
      {
        label: t('regie.monitoring.row.show'),
        icon: 'eye',
        run: () => this.showInControlRoom(row),
      },
      { label: t('regie.monitoring.row.copy'), icon: 'copy', run: () => this.copyRow(row) },
    ];
  }

  /** Opens the menu of a row under its ⋯ button. */
  protected openMenu(row: MonitoringRow, button: HTMLElement): void {
    const rect = button.getBoundingClientRect();
    this.menus.open(
      this.rowMenu(row),
      { x: rect.left, y: rect.bottom + 4 },
      { label: this.menuLabel(row), returnFocus: button },
    );
  }

  /** Goes to the control room, where the Devices dock opens the device, scrolls it into view and flashes it. */
  protected showInControlRoom(row: MonitoringRow): void {
    this.focus.showDevice(row.id);
    void this.router.navigateByUrl('/');
  }

  /** Copies the values of a device as text, one line per value and one per source. */
  protected copyRow(row: MonitoringRow): void {
    const label = (id: MonitoringColumn): string =>
      this.heading(MONITORING_COLUMNS.find((column) => column.id === id) ?? MONITORING_COLUMNS[0]);
    const lines = [
      `${row.name} · ${row.platform}`,
      `${label('state')}: ${row.stateWord}`,
      ...row.slots.map(
        (slot) =>
          `${slot.code} (${slot.state}): ${slot.resolution} · ${slot.fps} fps · ${slot.bitrate} Mbit/s · ${slot.encoding} · ${slot.loss} %`,
      ),
      `${label('rtt')}: ${this.rtt(row)}`,
      `${label('battery')}: ${this.battery(row)}`,
      `${label('network')}: ${row.network ?? MISSING_VALUE}`,
      `${label('tech')}: ${row.techText}`,
      `${label('seen')}: ${this.seen(row)}`,
    ];
    void this.clipboard.copy(lines.join('\n'), { label: row.name });
  }

  protected heading(column: ColumnDefinition): string {
    return column.unit ? `${t(column.label)} (${column.unit})` : t(column.label);
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

  /** Round trip in ms; the unit is in the heading. */
  protected rtt(row: MonitoringRow): string {
    return row.rttMs === null ? MISSING_VALUE : String(Math.round(row.rttMs));
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
