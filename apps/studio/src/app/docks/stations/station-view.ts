import { t, type PlainMessageKey } from '@studioflow/i18n';
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
import { decodingText, encodingView, type DecodingInput } from '../shared/stream-load';

/**
 * Pure view model of the Stations dock (prototype "Stations": `stationLine`, `renderStations`): one station per
 * paired device, with the worst state of its slots, metrics, tally and the details. No Angular, no DOM. The texts are
 * looked up when a model is built, so build it inside a `computed` (and rebuild it when the language changes).
 */

/** Battery level below which the row warns "Battery 14%" (prototype: < 20). */
export const LOW_BATTERY_PCT = 20;

/** Line 2 of a station row. */
export type StationLine =
  /** A down or not-yet-live state: "reconnecting 00:08 freeze frame", "blocked cannot connect". */
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
  /** Back after an outage, until "Seen": "back was gone 9 s". */
  | { readonly kind: 'recovered'; readonly seconds: number }
  /** Healthy: "2.8 Mbit/s 31 ms", a low battery warning and "CPU at limit" where the sender lowers its picture. */
  | {
      readonly kind: 'metrics';
      readonly rate: string;
      readonly rtt: string;
      readonly lowBattery: number | null;
      /** "CPU at limit" (with the slot codes when the device has several), or null. */
      readonly cpuLimit: string | null;
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
  /** PGM/PVW tag (`preview` only in Studio Mode). */
  readonly tally: TallyState;
  readonly line: StationLine;
  /** Source for the small live thumbnail (camera, else the first screen), or null. */
  readonly thumbSourceId: string | null;
  /** The device has no picture, only sound (the audio station): the row shows a microphone instead of a thumbnail. */
  readonly audioOnly: boolean;
  /** Recovered incidents of the station's sources, waiting for "Seen". */
  readonly recovered: readonly IncidentDto[];
  /** Screen slots whose sharing ended ("Ask to share again"). */
  readonly endedScreens: readonly SourceDto[];
  /** "Switch camera" is offered (phone camera that is live). */
  readonly canSwitchCamera: boolean;
  /** Codes of the slots whose sender is at its CPU limit (it lowers the picture), empty when none. */
  readonly cpuLimited: readonly string[];
  /** The "Camera" panel is offered (a phone with a camera source, issue #11). */
  readonly canControlCamera: boolean;
  readonly blocked: boolean;
  /** Not connected to the server (no control connection). */
  readonly offline: boolean;
  /** Accessible name of the row (prototype): "K2 Phone stage right, on Program, reconnecting". */
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

/** Seconds an incident lasted ("was gone 9 s"), at least 1. */
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
        extra: t('regie.stations.line.freezeFrame'),
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
        word: statusWord(status),
        tone: 'bad',
        code: null,
        since: null,
        extra: t('regie.stations.line.cannotConnect'),
      };
    case 'connecting':
      return {
        kind: 'state',
        word: statusWord(status),
        tone: 'muted',
        code,
        since: null,
        extra: null,
      };
    case 'offline': {
      const seen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
      return {
        kind: 'state',
        word: statusWord(status),
        tone: 'muted',
        code: null,
        since: null,
        extra:
          seen && !Number.isNaN(seen.getTime())
            ? t('regie.stations.line.lastSeen', { time: formatHm(seen) })
            : null,
      };
    }
    case 'ok':
      return null;
  }
}

/** "CPU at limit", with the slot codes ("CPU at limit S1") when the device has several slots; null when none is limited. */
export function cpuLimitText(codes: readonly string[], several: boolean): string | null {
  if (codes.length === 0) {
    return null;
  }
  return several
    ? t('regie.load.cpuLimitCodes', { codes: codes.join(' ') })
    : t('regie.load.cpuLimit');
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
  const cpuLimited = sources
    .filter((source) =>
      (telemetry?.slots ?? []).some(
        (slot) => slot.slot === source.slot && slot.qualityLimitation === 'cpu',
      ),
    )
    .map((source) => source.code);
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
          cpuLimit: cpuLimitText(cpuLimited, sources.length > 1),
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
    cpuLimited,
    audioOnly: thumb === null && sources.some((source) => source.kind === 'audio'),
    recovered,
    endedScreens: sources.filter((source) => source.kind === 'screen' && source.status === 'ended'),
    canSwitchCamera: device.kind === 'phone' && !!camera && camera.status === 'ok',
    canControlCamera: device.kind === 'phone' && !!camera && !blocked,
    blocked,
    offline: device.connection === 'offline',
    ariaLabel:
      `${codes.join(' ')} ${device.name}`.trim() +
      (tally === 'program'
        ? `, ${t('model.status.placeProgram')}`
        : tally === 'preview'
          ? `, ${t('model.status.placePreview')}`
          : '') +
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

/** The word of a tech check level; "unknown" has no word. */
const TECH_WORD_KEYS = {
  ok: 'regie.stations.tech.ok',
  warn: 'regie.stations.tech.warn',
  bad: 'regie.stations.tech.bad',
  unknown: null,
} as const satisfies Readonly<Record<TechCheckLevel, PlainMessageKey | null>>;

const TECH_LAMPS: Readonly<Record<TechCheckLevel, LampTone>> = {
  ok: '',
  warn: 'is-warn',
  bad: 'is-bad',
  unknown: 'is-idle',
};

function techWord(level: TechCheckLevel): string {
  const wordKey = TECH_WORD_KEYS[level];
  return wordKey ? t(wordKey) : MISSING_VALUE;
}

/** Name of a network type reported by the browser; technical names (Ethernet, 5G) stay as they are. */
export function networkLabel(network: string | null | undefined): string | null {
  if (!network) {
    return null;
  }
  switch (network.toLowerCase()) {
    case 'wifi':
      return t('regie.stations.network.wifi');
    case 'cellular':
      return t('regie.stations.network.cellular');
    case 'ethernet':
      return 'Ethernet';
    case 'slow-2g':
      return '2G';
    case '5g':
    case '4g':
    case '3g':
    case '2g':
      return network.toUpperCase();
    default:
      return network;
  }
}

/** "today 10:42", or "21/10 10:42" ("21.10. 10:42" in German) for another day (local time). */
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
    ? t('regie.stations.paired.today', { time: formatHm(date) })
    : t('regie.stations.paired.otherDay', {
        day: date.getDate(),
        month: date.getMonth() + 1,
        time: formatHm(date),
      });
}

/** Resolution of the live slots, "1080p" or "S1 1080p · S2 720p" for several slots. */
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
 * The details of an expanded station (prototype `.st-detail` key-value list): Device, Resolution, Paired, Packet loss,
 * then Battery and Network where the device reports them, and "Last seen" for disconnected devices.
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
    {
      label: t('regie.stations.detail.device'),
      value: device.platform || MISSING_VALUE,
      mono: false,
    },
    {
      label: t('regie.stations.detail.resolution'),
      value: resolutionText(telemetry, sources),
      mono: true,
    },
    ...encodingEntries(telemetry, sources),
    {
      label: t('regie.stations.detail.paired'),
      value: pairedText(device.pairedAt, nowMs),
      mono: false,
    },
    {
      label: t('regie.stations.detail.loss'),
      value: status === 'ok' && loss !== null ? formatPercent(loss, 1) : MISSING_VALUE,
      mono: true,
    },
  ];
  if (typeof telemetry?.batteryPct === 'number') {
    const battery = formatPercent(telemetry.batteryPct);
    entries.push({
      label: t('regie.stations.detail.battery'),
      value: telemetry.charging ? t('regie.stations.detail.charging', { battery }) : battery,
      mono: true,
    });
  }
  const network = networkLabel(telemetry?.network);
  if (network) {
    entries.push({ label: t('regie.stations.detail.network'), value: network, mono: false });
  }
  if (device.connection === 'offline' && device.lastSeenAt) {
    entries.push({
      label: t('regie.stations.detail.lastSeen'),
      value: pairedText(device.lastSeenAt, nowMs),
      mono: false,
    });
  }
  return entries;
}

/**
 * How each live slot is encoded on the sender ("H.264 · hardware", "VP9 · software encoding"), one entry per slot; a
 * sender at its CPU limit says so. Nothing for a device that reports no codec yet.
 */
function encodingEntries(
  telemetry: DeviceTelemetryDto | null,
  sources: readonly SourceDto[],
): DetailEntry[] {
  const slots = (telemetry?.slots ?? []).filter((slot) => slot.codec);
  return slots.map((slot) => {
    const code = sources.find((source) => source.slot === slot.slot)?.code ?? slot.slot;
    const view = encodingView(slot);
    return {
      label:
        slots.length > 1
          ? t('regie.load.detail.encodingCode', { code })
          : t('regie.load.detail.encoding'),
      value: view.cpuLimited ? `${view.text} · ${t('regie.load.cpuLimit')}` : view.text,
      mono: true,
    };
  });
}

/**
 * How this Regie decodes the pictures of the station's sources (“H.264 · hardware decoding”), one entry per source for
 * which the browser tells; `stats` are the receive statistics of the media provider, by source id.
 */
export function decodingEntries(
  sources: readonly SourceDto[],
  stats: ReadonlyMap<string, DecodingInput | null>,
): DetailEntry[] {
  const known = sources.flatMap((source) => {
    const text = decodingText(stats.get(source.id) ?? null);
    return text === null ? [] : [{ source, text }];
  });
  return known.map(({ source, text }) => ({
    label:
      sources.length > 1
        ? t('regie.load.detail.decodingCode', { code: source.code })
        : t('regie.load.detail.decoding'),
    value: text,
    mono: true,
  }));
}

/** The lamps of the tech check (Camera, Network, Upload), or null when it has not run yet. */
export function techLamps(check: TechCheckDto | null): TechLamp[] | null {
  if (!check) {
    return null;
  }
  const upload =
    typeof check.uploadKbps === 'number' ? ` ${formatKbpsAsMbit(check.uploadKbps)} Mbit/s` : '';
  return [
    {
      label: t('regie.stations.tech.camera'),
      lamp: TECH_LAMPS[check.camera],
      word: techWord(check.camera),
    },
    {
      label: t('regie.stations.tech.network'),
      lamp: TECH_LAMPS[check.network],
      word: techWord(check.network),
    },
    {
      label: t('regie.stations.tech.upload'),
      lamp: TECH_LAMPS[check.bandwidth],
      word: `${techWord(check.bandwidth)}${upload}`,
    },
  ];
}
