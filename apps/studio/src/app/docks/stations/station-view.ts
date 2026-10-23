import {
  MISSING_VALUE,
  formatHm,
  formatKbpsAsMbit,
  formatPercent,
  statusWord,
  type DeviceDto,
  type DeviceTelemetryDto,
  type IncidentDto,
  type SourceDto,
  type SourceStatus,
  type TallyState,
  type TechCheckDto,
  type TechCheckLevel,
} from '@studioflow/scene-model';
import { statusLamp, statusTone, type LampTone, type StateTone } from '../shared/source-view';

/**
 * Pure view model of the Stationen dock (prototype «Stationen»: `stationLine`, `renderStations`): one station per
 * paired device, with the worst state of its slots, metrics, tally and the details. No Angular, no DOM.
 */

/** Battery level below which the row warns «Akku 14 %» (prototype: < 20). */
export const LOW_BATTERY_PCT = 20;

/** Line 2 of a station row. */
export type StationLine =
  /** A down or not-yet-live state: «verbindet neu 00:08 Standbild», «gesperrt kann sich nicht verbinden». */
  | {
      readonly kind: 'state';
      readonly word: string;
      readonly tone: StateTone;
      /** Slot code in front of the word when the device has several slots. */
      readonly code: string | null;
      /** Start of the outage for the running timer, or null (no timer). */
      readonly since: string | null;
      /** Muted text after the word/timer. */
      readonly extra: string | null;
    }
  /** Back after an outage, until «Gesehen»: «wieder da war 9 s weg». */
  | { readonly kind: 'recovered'; readonly seconds: number }
  /** Healthy: «2,8 Mbit/s 31 ms» and a low battery warning. */
  | {
      readonly kind: 'metrics';
      readonly rate: string;
      readonly rtt: string;
      readonly lowBattery: number | null;
    };

/** Everything a station row shows. */
export interface StationView {
  readonly id: string;
  readonly name: string;
  /** Slot codes, sorted (K1, S1, S2). */
  readonly codes: readonly string[];
  /** Status of the station (its worst slot; `blocked` for blocked devices). */
  readonly status: SourceStatus;
  readonly lamp: LampTone;
  /** Row wash: amber while reconnecting, red when down. */
  readonly tone: '' | 'is-warn' | 'is-bad';
  /** PGM/PVW tag (`preview` only in Studio-Modus). */
  readonly tally: TallyState;
  readonly line: StationLine;
  /** Source for the small live thumbnail (camera, else the first screen), or null. */
  readonly thumbSourceId: string | null;
  /** Recovered incidents of the station's sources, waiting for «Gesehen». */
  readonly recovered: readonly IncidentDto[];
  /** Screen slots whose sharing ended («Neu teilen lassen»). */
  readonly endedScreens: readonly SourceDto[];
  /** «Kamera wechseln» is offered (phone camera that is live). */
  readonly canSwitchCamera: boolean;
  readonly blocked: boolean;
  /** Not connected to the server (no control connection). */
  readonly offline: boolean;
  /** Accessible name of the row (prototype): «K2 Handy Bühne rechts, im Program, verbindet neu». */
  readonly ariaLabel: string;
}

/** Inputs of {@link stationView}. */
export interface StationContext {
  /** The device's sources, sorted by code. */
  readonly sources: readonly SourceDto[];
  /** Open and recovered incidents of the production. */
  readonly incidents: readonly IncidentDto[];
  /** Tally per source id in the Regie. */
  readonly tallyOf: (sourceId: string) => TallyState;
  readonly studioMode: boolean;
}

/** Severity of a slot status for the station summary (higher is worse). */
const STATUS_RANK: Readonly<Record<SourceStatus, number>> = {
  ok: 0,
  offline: 1,
  connecting: 2,
  reconnecting: 3,
  ended: 4,
  lost: 4,
  blocked: 5,
};

/** Seconds an incident lasted («war 9 s weg»), at least 1. */
export function incidentSeconds(incident: IncidentDto): number {
  const started = Date.parse(incident.startedAt);
  const ended = Date.parse(incident.endedAt ?? '');
  const seconds = Math.round((ended - started) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : 1;
}

/** Sum of the bit rates of the live slots in kbit/s, or null without telemetry. */
export function totalBitrateKbps(telemetry: DeviceTelemetryDto | null): number | null {
  const rates = (telemetry?.slots ?? [])
    .filter((slot) => slot.state === 'live')
    .map((slot) => slot.bitrateKbps)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return rates.length > 0 ? rates.reduce((sum, value) => sum + value, 0) : null;
}

/** The worst slot of a device (first of equal rank by code), or null without slots. */
export function worstSource(sources: readonly SourceDto[]): SourceDto | null {
  let worst: SourceDto | null = null;
  for (const source of sources) {
    if (!worst || STATUS_RANK[source.status] > STATUS_RANK[worst.status]) {
      worst = source;
    }
  }
  return worst;
}

function stateLine(
  device: DeviceDto,
  worst: SourceDto | null,
  status: SourceStatus,
  multi: boolean,
): StationLine | null {
  const code = multi && worst ? worst.code : null;
  switch (status) {
    case 'reconnecting':
      return {
        kind: 'state',
        word: statusWord(status, worst?.kind),
        tone: 'warn',
        code,
        since: worst?.statusSince ?? null,
        extra: 'Standbild',
      };
    case 'ended':
    case 'lost':
      return {
        kind: 'state',
        word: statusWord(status, worst?.kind),
        tone: 'bad',
        code,
        since: worst?.statusSince ?? null,
        extra: null,
      };
    case 'blocked':
      return {
        kind: 'state',
        word: 'gesperrt',
        tone: 'bad',
        code: null,
        since: null,
        extra: 'kann sich nicht verbinden',
      };
    case 'connecting':
      return { kind: 'state', word: 'verbindet …', tone: 'muted', code, since: null, extra: null };
    case 'offline': {
      const seen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
      return {
        kind: 'state',
        word: 'nicht verbunden',
        tone: 'muted',
        code: null,
        since: null,
        extra: seen && !Number.isNaN(seen.getTime()) ? `zuletzt ${formatHm(seen)}` : null,
      };
    }
    case 'ok':
      return null;
  }
}

/** Row model of one station (prototype `renderStations` + `stationLine`). */
export function stationView(device: DeviceDto, context: StationContext): StationView {
  const { sources } = context;
  const blocked = device.state === 'blocked';
  const worst = worstSource(sources);
  const status: SourceStatus = blocked ? 'blocked' : (worst?.status ?? 'offline');
  const sourceIds = new Set(sources.map((source) => source.id));
  const incidents = context.incidents.filter((incident) => sourceIds.has(incident.sourceId));
  const recovered = incidents.filter(
    (incident) =>
      incident.endedAt !== null &&
      !incidents.some((open) => open.sourceId === incident.sourceId && open.endedAt === null),
  );
  const telemetry = device.telemetry;
  const battery = telemetry?.batteryPct ?? null;
  const lowBattery =
    battery !== null && battery < LOW_BATTERY_PCT && telemetry?.charging !== true ? battery : null;
  const rate = totalBitrateKbps(telemetry);
  const line: StationLine =
    stateLine(device, worst, status, sources.length > 1) ??
    (recovered.length > 0
      ? { kind: 'recovered', seconds: incidentSeconds(recovered[recovered.length - 1]) }
      : {
          kind: 'metrics',
          rate: rate === null ? MISSING_VALUE : formatKbpsAsMbit(rate),
          rtt:
            typeof telemetry?.rttMs === 'number'
              ? String(Math.round(telemetry.rttMs))
              : MISSING_VALUE,
          lowBattery,
        });
  const tallies = sources.map((source) => context.tallyOf(source.id));
  const tally: TallyState = tallies.includes('program')
    ? 'program'
    : context.studioMode && tallies.includes('preview')
      ? 'preview'
      : 'off';
  const codes = sources.map((source) => source.code);
  const camera = sources.find((source) => source.kind === 'camera');
  const thumb = camera ?? sources.find((source) => source.kind === 'screen') ?? null;
  const tone = statusTone(status);
  return {
    id: device.id,
    name: device.name,
    codes,
    status,
    lamp: statusLamp(status),
    tone: tone === 'warn' ? 'is-warn' : tone === 'bad' ? 'is-bad' : '',
    tally,
    line,
    thumbSourceId: thumb?.id ?? null,
    recovered,
    endedScreens: sources.filter((source) => source.kind === 'screen' && source.status === 'ended'),
    canSwitchCamera: device.kind === 'phone' && !!camera && camera.status === 'ok',
    blocked,
    offline: device.connection === 'offline',
    ariaLabel:
      `${codes.join(' ')} ${device.name}`.trim() +
      (tally === 'program' ? ', im Program' : tally === 'preview' ? ', in der Preview' : '') +
      (status !== 'ok' ? `, ${statusWord(status, worst?.kind)}` : ''),
  };
}

/** One entry of the details list. */
export interface DetailEntry {
  readonly label: string;
  readonly value: string;
  /** Value in mono (measurements, times). */
  readonly mono: boolean;
}

/** One lamp of the technical check. */
export interface TechLamp {
  readonly label: string;
  readonly lamp: LampTone;
  readonly word: string;
}

const TECH_WORDS: Readonly<Record<TechCheckLevel, string>> = {
  ok: 'ok',
  warn: 'knapp',
  bad: 'schlecht',
  unknown: MISSING_VALUE,
};

const TECH_LAMPS: Readonly<Record<TechCheckLevel, LampTone>> = {
  ok: '',
  warn: 'is-warn',
  bad: 'is-bad',
  unknown: 'is-idle',
};

/** German name of a network type reported by the browser. */
export function networkLabel(network: string | null | undefined): string | null {
  if (!network) {
    return null;
  }
  const labels: Readonly<Record<string, string>> = {
    wifi: 'WLAN',
    ethernet: 'Ethernet',
    cellular: 'Mobilfunk',
    '5g': '5G',
    '4g': '4G',
    '3g': '3G',
    '2g': '2G',
    'slow-2g': '2G',
  };
  return labels[network.toLowerCase()] ?? network;
}

/** «heute 10:42», or «21.10. 10:42» for another day (local time). */
export function pairedText(iso: string, nowMs: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return MISSING_VALUE;
  }
  const now = new Date(nowMs);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? `heute ${formatHm(date)}`
    : `${date.getDate()}.${date.getMonth() + 1}. ${formatHm(date)}`;
}

/** Resolution of the live slots, «1080p» or «S1 1080p · S2 720p» for several slots. */
export function resolutionText(
  telemetry: DeviceTelemetryDto | null,
  sources: readonly SourceDto[],
): string {
  const slots = (telemetry?.slots ?? []).filter(
    (slot) => typeof slot.height === 'number' && slot.height > 0,
  );
  if (slots.length === 0) {
    return MISSING_VALUE;
  }
  if (slots.length === 1) {
    return `${slots[0].height}p`;
  }
  return slots
    .map((slot) => {
      const code = sources.find((source) => source.slot === slot.slot)?.code ?? slot.slot;
      return `${code} ${slot.height}p`;
    })
    .join(' · ');
}

/** Largest packet loss of the live slots in percent, or null. */
export function packetLoss(telemetry: DeviceTelemetryDto | null): number | null {
  const losses = (telemetry?.slots ?? [])
    .filter((slot) => slot.state === 'live')
    .map((slot) => slot.packetLossPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return losses.length > 0 ? Math.max(...losses) : null;
}

/**
 * The details of an expanded station (prototype `.st-detail` key-value list): Gerät, Auflösung, Gekoppelt, Verlust,
 * then Akku and Netz where the device reports them, and «Zuletzt» for disconnected devices.
 */
export function stationDetails(
  device: DeviceDto,
  sources: readonly SourceDto[],
  status: SourceStatus,
  nowMs: number,
): DetailEntry[] {
  const telemetry = device.telemetry;
  const loss = packetLoss(telemetry);
  const entries: DetailEntry[] = [
    { label: 'Gerät', value: device.platform || MISSING_VALUE, mono: false },
    { label: 'Auflösung', value: resolutionText(telemetry, sources), mono: true },
    { label: 'Gekoppelt', value: pairedText(device.pairedAt, nowMs), mono: false },
    {
      label: 'Verlust',
      value: status === 'ok' && loss !== null ? formatPercent(loss, 1) : MISSING_VALUE,
      mono: true,
    },
  ];
  if (typeof telemetry?.batteryPct === 'number') {
    entries.push({
      label: 'Akku',
      value: `${formatPercent(telemetry.batteryPct)}${telemetry.charging ? ' · lädt' : ''}`,
      mono: true,
    });
  }
  const network = networkLabel(telemetry?.network);
  if (network) {
    entries.push({ label: 'Netz', value: network, mono: false });
  }
  if (device.connection === 'offline' && device.lastSeenAt) {
    entries.push({ label: 'Zuletzt', value: pairedText(device.lastSeenAt, nowMs), mono: false });
  }
  return entries;
}

/** The lamps of the technical check (Kamera, Netz, Upload), or null when it has not run yet. */
export function techLamps(check: TechCheckDto | null): TechLamp[] | null {
  if (!check) {
    return null;
  }
  const upload =
    typeof check.uploadKbps === 'number' ? ` ${formatKbpsAsMbit(check.uploadKbps)} Mbit/s` : '';
  return [
    { label: 'Kamera', lamp: TECH_LAMPS[check.camera], word: TECH_WORDS[check.camera] },
    { label: 'Netz', lamp: TECH_LAMPS[check.network], word: TECH_WORDS[check.network] },
    {
      label: 'Upload',
      lamp: TECH_LAMPS[check.bandwidth],
      word: `${TECH_WORDS[check.bandwidth]}${upload}`,
    },
  ];
}
