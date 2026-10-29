import { compareText, formatNumber, lowerCase, t, type PlainMessageKey } from '@studioflow/i18n';
import {
  MISSING_VALUE,
  formatHm,
  formatKbpsAsMbit,
  statusWord,
  type DeviceDto,
  type SlotState,
  type SourceDto,
  type SourceStatus,
  type TechCheckLevel,
} from '@studioflow/scene-model';
import { statusLamp, statusTone, type LampTone, type StateTone } from '../docks/shared/source-view';
import { encodingView } from '../docks/shared/stream-load';
import { networkLabel, totalBitrateKbps, worstSource } from '../docks/stations/station-view';

/**
 * Pure model of the monitoring page (spec 9.1 `/monitoring`): one row per device with the live telemetry of its
 * slots, and sorting by any column. Figures carry no unit where the column heading names it. No Angular, no DOM.
 */

/** Telemetry older than this counts as stale (device reports every 2 s; a device silent for 6 s is disconnected, GAP-29). */
export const STALE_AFTER_MS = 6000;

/** Sortable columns. */
export type MonitoringColumn =
  | 'station'
  | 'state'
  | 'codes'
  | 'resolution'
  | 'fps'
  | 'bitrate'
  | 'encoding'
  | 'loss'
  | 'rtt'
  | 'battery'
  | 'network'
  | 'tech'
  | 'seen';

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** Current sort; `column` null keeps the station order of the Regie. */
export interface MonitoringSort {
  readonly column: MonitoringColumn | null;
  readonly direction: SortDirection;
}

/** One slot (camera or screen) of a station. */
export interface MonitoringSlot {
  readonly code: string;
  /** "live", "starting", "paused", "ended", "error", or "–" without telemetry. */
  readonly state: string;
  readonly resolution: string;
  readonly fps: string;
  readonly bitrate: string;
  /** How the sender encodes the slot: "H.264 · hardware", "VP9 · software encoding", or "–" when it does not tell. */
  readonly encoding: string;
  /** The sender is at its CPU limit and lowers the picture (shown as a tag, issue #12). */
  readonly cpuLimited: boolean;
  /** Packet loss in percent, one decimal, without the unit (the column heading carries it): "0.5". */
  readonly loss: string;
}

/** One row of the monitoring table. */
export interface MonitoringRow {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  /** Position in the Regie's station order (default sort). */
  readonly order: number;
  readonly status: SourceStatus;
  readonly stateWord: string;
  readonly stateTone: StateTone;
  readonly lamp: LampTone;
  readonly codes: string;
  readonly slots: readonly MonitoringSlot[];
  /** Sort keys (null = unknown, always sorted last). */
  readonly heightValue: number | null;
  readonly fpsValue: number | null;
  readonly bitrateKbps: number | null;
  /** Load of the senders: 2 = a sender is at its CPU limit, 1 = software encoding, 0 = fine; null = nothing reported. */
  readonly encodingLoad: number | null;
  readonly lossValue: number | null;
  readonly rttMs: number | null;
  readonly batteryPct: number | null;
  readonly charging: boolean;
  readonly network: string | null;
  readonly techLevel: TechCheckLevel | null;
  readonly techText: string;
  readonly techLamp: LampTone;
  /** Last telemetry or control contact (server ms), or null. */
  readonly seenAt: number | null;
  /** Telemetry is older than {@link STALE_AFTER_MS} or missing while the device is online. */
  readonly stale: boolean;
}

const SLOT_WORD_KEYS = {
  starting: 'regie.monitoring.slot.starting',
  live: 'regie.monitoring.slot.live',
  paused: 'regie.monitoring.slot.paused',
  ended: 'regie.monitoring.slot.ended',
  failed: 'regie.monitoring.slot.failed',
} as const satisfies Record<SlotState, PlainMessageKey>;

const TECH_RANK: Readonly<Record<TechCheckLevel, number>> = { ok: 3, warn: 2, bad: 1, unknown: 0 };
const TECH_TEXT_KEYS = {
  ok: 'regie.monitoring.tech.ok',
  warn: 'regie.monitoring.tech.warn',
  bad: 'regie.monitoring.tech.bad',
  unknown: 'regie.monitoring.tech.unknown',
} as const satisfies Record<TechCheckLevel, PlainMessageKey>;
const TECH_LAMP: Readonly<Record<TechCheckLevel, LampTone>> = {
  ok: '',
  warn: 'is-warn',
  bad: 'is-bad',
  unknown: 'is-idle',
};

/** Severity for sorting by state (worst last in ascending order). */
const STATUS_ORDER: Readonly<Record<SourceStatus, number>> = {
  ok: 0,
  connecting: 1,
  offline: 2,
  reconnecting: 3,
  ended: 4,
  lost: 5,
  blocked: 6,
};

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTime(iso: string | null | undefined): number | null {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

/** Rows for every station, in the given (station) order. */
export function monitoringRows(
  devices: readonly DeviceDto[],
  sourcesOf: (deviceId: string) => readonly SourceDto[],
  serverNowMs: number,
): MonitoringRow[] {
  return devices.map((device, order) => {
    const sources = sourcesOf(device.id);
    const telemetry = device.telemetry;
    const slots = telemetry?.slots ?? [];
    const blocked = device.state === 'blocked';
    const worst = worstSource(sources);
    const status: SourceStatus = blocked ? 'blocked' : (worst?.status ?? 'offline');
    const telemetryAt = parseTime(telemetry?.at);
    const seenAt = telemetryAt ?? parseTime(device.lastSeenAt);
    const online = device.connection !== 'offline' && !blocked;
    const stale = online && (telemetryAt === null || serverNowMs - telemetryAt > STALE_AFTER_MS);
    const rowSlots: MonitoringSlot[] = sources.map((source) => {
      const slot = slots.find((entry) => entry.slot === source.slot);
      return {
        code: source.code,
        state: slot ? t(SLOT_WORD_KEYS[slot.state]) : MISSING_VALUE,
        resolution:
          slot && finite(slot.width) && finite(slot.height)
            ? `${slot.width} × ${slot.height}`
            : MISSING_VALUE,
        fps: slot && finite(slot.fps) ? String(Math.round(slot.fps)) : MISSING_VALUE,
        bitrate:
          slot && finite(slot.bitrateKbps) ? formatKbpsAsMbit(slot.bitrateKbps) : MISSING_VALUE,
        encoding: encodingView(slot).text,
        cpuLimited: slot?.qualityLimitation === 'cpu',
        loss:
          slot && finite(slot.packetLossPct)
            ? formatNumber(slot.packetLossPct, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })
            : MISSING_VALUE,
      };
    });
    const live = slots.filter((slot) => slot.state === 'live');
    const heights = live.map((slot) => slot.height).filter(finite);
    const fps = live.map((slot) => slot.fps).filter(finite);
    const losses = live.map((slot) => slot.packetLossPct).filter(finite);
    const encodings = live.filter((slot) => slot.codec).map((slot) => encodingView(slot));
    const tech = device.techCheck?.overall ?? null;
    const tone = statusTone(status);
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      order,
      status,
      stateWord:
        status === 'ok' ? t('regie.monitoring.stateSending') : statusWord(status, worst?.kind),
      // Healthy rows stay calm: the green lamp says enough.
      stateTone: status === 'ok' ? 'muted' : tone,
      lamp: statusLamp(status),
      codes: sources.map((source) => source.code).join(' '),
      slots: rowSlots,
      heightValue: heights.length > 0 ? Math.max(...heights) : null,
      fpsValue: fps.length > 0 ? Math.min(...fps) : null,
      bitrateKbps: totalBitrateKbps(telemetry),
      encodingLoad:
        encodings.length === 0
          ? null
          : encodings.some((view) => view.cpuLimited)
            ? 2
            : encodings.some((view) => view.software)
              ? 1
              : 0,
      lossValue: losses.length > 0 ? Math.max(...losses) : null,
      rttMs: finite(telemetry?.rttMs) ? telemetry.rttMs : null,
      batteryPct: finite(telemetry?.batteryPct) ? telemetry.batteryPct : null,
      charging: telemetry?.charging === true,
      network: networkLabel(telemetry?.network),
      techLevel: tech,
      techText: tech ? t(TECH_TEXT_KEYS[tech]) : t('regie.monitoring.tech.notRun'),
      techLamp: tech ? TECH_LAMP[tech] : 'is-idle',
      seenAt,
      stale,
    };
  });
}

/** Sort key of a row for a column; null for unknown values. */
function sortKey(row: MonitoringRow, column: MonitoringColumn): number | string | null {
  switch (column) {
    case 'station':
      return lowerCase(row.name);
    case 'state':
      return STATUS_ORDER[row.status];
    case 'codes':
      return row.codes || null;
    case 'resolution':
      return row.heightValue;
    case 'fps':
      return row.fpsValue;
    case 'bitrate':
      return row.bitrateKbps;
    case 'encoding':
      return row.encodingLoad;
    case 'loss':
      return row.lossValue;
    case 'rtt':
      return row.rttMs;
    case 'battery':
      return row.batteryPct;
    case 'network':
      return row.network;
    case 'tech':
      return row.techLevel ? TECH_RANK[row.techLevel] : null;
    case 'seen':
      return row.seenAt;
  }
}

/**
 * Sorts rows by a column. Unknown values always come last (in both directions); ties keep the Regie order. Without a
 * column the Regie order is kept.
 */
export function sortMonitoringRows(
  rows: readonly MonitoringRow[],
  sort: MonitoringSort,
): MonitoringRow[] {
  const { column } = sort;
  if (!column) {
    return [...rows].sort((a, b) => a.order - b.order);
  }
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const keyA = sortKey(a, column);
    const keyB = sortKey(b, column);
    if (keyA === null || keyB === null) {
      return keyA === keyB ? a.order - b.order : keyA === null ? 1 : -1;
    }
    const compared =
      typeof keyA === 'number' && typeof keyB === 'number'
        ? keyA - keyB
        : compareText(String(keyA), String(keyB), { numeric: true });
    return compared * factor || a.order - b.order;
  });
}

/** Next sort after clicking a column header: ascending first, then descending, then back to the Regie order. */
export function nextSort(current: MonitoringSort, column: MonitoringColumn): MonitoringSort {
  if (current.column !== column) {
    return { column, direction: 'asc' };
  }
  return current.direction === 'asc'
    ? { column, direction: 'desc' }
    : { column: null, direction: 'asc' };
}

/** "3 s ago", "5 min ago", or the local time "10:42" for anything older than an hour; "–" when unknown. */
export function seenText(seenAt: number | null, serverNowMs: number): string {
  if (seenAt === null) {
    return MISSING_VALUE;
  }
  const seconds = Math.max(0, Math.round((serverNowMs - seenAt) / 1000));
  if (seconds < 60) {
    return t('regie.monitoring.seen.seconds', { value: seconds });
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? t('regie.monitoring.seen.minutes', { value: minutes })
    : formatHm(new Date(seenAt));
}
