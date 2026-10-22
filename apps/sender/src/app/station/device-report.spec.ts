import type { SlotTelemetryDto } from '@flowstudio/scene-model';
import { TECH_CHECK_OK } from '../../testing/sender-fakes';
import { buildDeviceReport, type DeviceReportInput } from './device-report';

const CAMERA: SlotTelemetryDto = {
  slot: 'camera',
  state: 'live',
  width: 1280,
  height: 720,
  fps: 30,
  bitrateKbps: 2800,
  packetLossPct: 0.4,
  codec: 'h264',
};

function input(overrides: Partial<DeviceReportInput> = {}): DeviceReportInput {
  return {
    mediaState: 'connected',
    telemetry: [CAMERA],
    deviceSlots: ['camera'],
    endedSlots: new Set(),
    battery: { pct: 77.6, charging: false },
    network: 'wifi',
    rttMs: 12.4,
    techCheck: TECH_CHECK_OK,
    ...overrides,
  };
}

describe('buildDeviceReport', () => {
  it('builds the hub report from media state, telemetry and device facts', () => {
    expect(buildDeviceReport(input())).toEqual({
      rtc: 'connected',
      slots: [CAMERA],
      batteryPct: 78,
      charging: false,
      network: 'wifi',
      rttMs: 12,
      techCheck: TECH_CHECK_OK,
    });
  });

  it.each([
    ['connecting', 'reconnecting'],
    ['reconnecting', 'reconnecting'],
    ['waiting', 'reconnecting'],
    ['stopped', 'disconnected'],
    ['replaced', 'disconnected'],
    ['idle', 'disconnected'],
  ] as const)('maps media state %s to rtc %s', (mediaState, rtc) => {
    expect(buildDeviceReport(input({ mediaState })).rtc).toBe(rtc);
  });

  it('reports slots stopped on purpose as ended and sorts camera before screens', () => {
    const report = buildDeviceReport(
      input({
        telemetry: [{ ...CAMERA, slot: 'screen-2', state: 'live' }],
        deviceSlots: ['camera', 'screen-1', 'screen-2', 'screen-10'],
        endedSlots: new Set(['screen-1', 'camera', 'screen-2']),
      }),
    );

    expect(report.slots.map((slot) => [slot.slot, slot.state])).toEqual([
      ['camera', 'ended'],
      ['screen-1', 'ended'],
      ['screen-2', 'live'],
    ]);
    expect(report.slots[0]).toEqual({
      slot: 'camera',
      state: 'ended',
      width: null,
      height: null,
      fps: null,
      bitrateKbps: null,
      packetLossPct: null,
      codec: null,
    });
  });

  it('leaves out slots that do not belong to the device (a screen still being allocated)', () => {
    const report = buildDeviceReport(
      input({ telemetry: [CAMERA, { ...CAMERA, slot: 'screen-3' }], deviceSlots: ['camera'] }),
    );
    expect(report.slots.map((slot) => slot.slot)).toEqual(['camera']);
  });

  it('keeps every slot while the device slots are unknown', () => {
    const report = buildDeviceReport(
      input({ deviceSlots: null, telemetry: [CAMERA, { ...CAMERA, slot: 'screen-1' }] }),
    );
    expect(report.slots).toHaveLength(2);
  });

  it('sends null for unknown battery, network, RTT and tech check', () => {
    const report = buildDeviceReport(
      input({ battery: null, network: null, rttMs: Number.NaN, techCheck: null }),
    );
    expect(report).toMatchObject({
      batteryPct: null,
      charging: null,
      network: null,
      rttMs: null,
      techCheck: null,
    });
  });
});
