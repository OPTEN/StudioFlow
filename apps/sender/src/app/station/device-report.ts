import { toRtcState, type MediaSessionState } from '@flowstudio/media-client';
import type {
  DeviceReportDto,
  SlotState,
  SlotTelemetryDto,
  TechCheckDto,
} from '@flowstudio/scene-model';

/** Everything a periodic device report is built from. */
export interface DeviceReportInput {
  readonly mediaState: MediaSessionState;
  /** `Publisher.getSlotTelemetry()` (slots in state `idle` are not included). */
  readonly telemetry: readonly SlotTelemetryDto[];
  /** Slot names of the device (`DeviceSelfDto.slots`); null while unknown (then every telemetry entry counts). */
  readonly deviceSlots: readonly string[] | null;
  /**
   * Slots without telemetry that are reported `ended`: a camera stopped on purpose, a screen share ended with
   * «Teilen beenden» or lost by a reload. (`paused` comes only from the publisher: the OS or browser suspended the
   * camera, e.g. the phone app went to the background.)
   */
  readonly endedSlots: ReadonlySet<string>;
  readonly battery: { readonly pct: number; readonly charging: boolean } | null;
  readonly network: string | null;
  readonly rttMs: number | null;
  readonly techCheck: TechCheckDto | null;
}

function emptyTelemetry(slot: string, state: SlotState): SlotTelemetryDto {
  return {
    slot,
    state,
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    packetLossPct: null,
    codec: null,
  };
}

function slotOrder(slot: string): number {
  return slot === 'camera' ? 0 : Number(slot.slice('screen-'.length)) || 99;
}

function finiteOrNull(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : value;
}

/**
 * Builds the `Report` payload sent every 2 s over the device hub (spec 6): media state, one entry per slot of the
 * device (telemetry from the publisher, or `ended` for slots stopped on purpose, so the Regie sees «Kamera beendet» /
 * «Teilen beendet» instead of an endless «verbindet neu»), battery, network type, RTT and the last tech check.
 */
export function buildDeviceReport(input: DeviceReportInput): DeviceReportDto {
  const allowed = input.deviceSlots === null ? null : new Set(input.deviceSlots);
  const slots = new Map<string, SlotTelemetryDto>();
  for (const entry of input.telemetry) {
    if (allowed === null || allowed.has(entry.slot)) {
      slots.set(entry.slot, entry);
    }
  }
  for (const slot of input.endedSlots) {
    if (!slots.has(slot) && (allowed === null || allowed.has(slot))) {
      slots.set(slot, emptyTelemetry(slot, 'ended'));
    }
  }
  const battery = input.battery;
  const rtt = finiteOrNull(input.rttMs);
  return {
    rtc: toRtcState(input.mediaState),
    slots: [...slots.values()].sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot)),
    batteryPct: battery === null ? null : Math.min(100, Math.max(0, Math.round(battery.pct))),
    charging: battery === null ? null : battery.charging,
    network: input.network,
    rttMs: rtt === null ? null : Math.max(0, Math.round(rtt)),
    techCheck: input.techCheck,
  };
}
