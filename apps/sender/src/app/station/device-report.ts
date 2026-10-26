import { toRtcState, type MediaSessionState, type TechCheckResult } from '@studioflow/media-client';
import type {
  CameraStateDto,
  DeviceReportDto,
  SlotState,
  SlotTelemetryDto,
  TechCheckDto,
} from '@studioflow/scene-model';

/** Everything a periodic device report is built from. */
export interface DeviceReportInput {
  readonly mediaState: MediaSessionState;
  /** `Publisher.getSlotTelemetry()` (slots in state `idle` are not included). */
  readonly telemetry: readonly SlotTelemetryDto[];
  /** Slot names of the device (`DeviceSelfDto.slots`); null while unknown (then every telemetry entry counts). */
  readonly deviceSlots: readonly string[] | null;
  /**
   * Slots without telemetry that are reported `ended`: a camera stopped on purpose, a screen share ended with
   * “Stop sharing” or lost by a reload. (`paused` comes only from the publisher: the OS or browser suspended the
   * camera, e.g. the phone app went to the background.)
   */
  readonly endedSlots: ReadonlySet<string>;
  readonly battery: { readonly pct: number; readonly charging: boolean } | null;
  readonly network: string | null;
  readonly rttMs: number | null;
  readonly techCheck: TechCheckResult | null;
  /** `Publisher.getCameraState()` of a phone (issue #11); null on a laptop or without a running camera. */
  readonly camera: CameraStateDto | null;
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

/** The check as the API knows it: the problems stay on the device (the English `note` summarizes them). */
function wireTechCheck(check: TechCheckResult | null): TechCheckDto | null {
  if (check === null) {
    return null;
  }
  const { problems: _problems, ...wire } = check;
  return wire;
}

function finiteOrNull(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : value;
}

/**
 * Builds the `Report` payload sent every 2 s over the device hub (spec 6): media state, one entry per slot of the
 * device (telemetry from the publisher, or `ended` for slots stopped on purpose, so the Regie sees “camera stopped” /
 * “sharing stopped” instead of an endless “reconnecting”), battery, network type, RTT, the last tech check and what
 * the phone camera can do and does now.
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
    techCheck: wireTechCheck(input.techCheck),
    camera: input.camera,
  };
}
