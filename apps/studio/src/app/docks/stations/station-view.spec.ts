import type { DeviceTelemetryDto, SourceDto, TallyState } from '@studioflow/scene-model';
import { deviceFixture, incidentFixture, sourceFixture } from '../../../testing/fixtures';
import {
  cpuLimitText,
  decodingEntries,
  incidentSeconds,
  networkLabel,
  pairedText,
  resolutionText,
  stationDetails,
  stationView,
  techLamps,
  worstSource,
  type StationContext,
} from './station-view';

const DEVICE = 'dev_aaaaaaaaaaaaaaaa';

function telemetry(overrides: Partial<DeviceTelemetryDto> = {}): DeviceTelemetryDto {
  return {
    at: '2026-10-22T10:00:00.000Z',
    rtc: 'connected',
    batteryPct: 78,
    charging: false,
    network: 'wifi',
    rttMs: 31,
    slots: [
      {
        slot: 'camera',
        state: 'live',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 2800,
        packetLossPct: 0,
        codec: 'h264',
      },
    ],
    ...overrides,
  };
}

function context(
  sources: SourceDto[],
  overrides: Partial<StationContext> = {},
  tally: TallyState = 'off',
): StationContext {
  return { sources, incidents: [], tallyOf: () => tally, studioMode: false, ...overrides };
}

describe('station view', () => {
  const camera = sourceFixture(DEVICE, 'camera', 'K1');

  it('shows metrics for a healthy station: "2.8 Mbit/s", "31 ms", PGM', () => {
    const view = stationView(
      deviceFixture(DEVICE, 'Phone stage left', { telemetry: telemetry() }),
      context([camera], {}, 'program'),
    );
    expect(view.line).toEqual({
      kind: 'metrics',
      rate: '2.8',
      rtt: '31',
      lowBattery: null,
      cpuLimit: null,
    });
    expect(view.cpuLimited).toEqual([]);
    expect(view.tally).toBe('program');
    expect(view.lamp).toBe('');
    expect(view.tone).toBe('');
    expect(view.thumbSourceId).toBe(camera.id);
    expect(view.canSwitchCamera).toBe(true);
    expect(view.ariaLabel).toBe('K1 Phone stage left, on Program');
  });

  it('shows a microphone instead of a picture for the audio station, which is on Program with its mode', () => {
    const mic = sourceFixture(DEVICE, 'mic', 'A1', { label: 'Mixing desk' });
    const view = stationView(
      deviceFixture(DEVICE, 'Mixing desk', { kind: 'audioStation', telemetry: telemetry() }),
      context([mic], {}, 'program'),
    );
    expect(view.audioOnly).toBe(true);
    expect(view.thumbSourceId).toBeNull();
    expect(view.codes).toEqual(['A1']);
    expect(view.tally).toBe('program');
    expect(view.canSwitchCamera).toBe(false);
    expect(view.canControlCamera).toBe(false);
    // A phone whose microphone is on has a picture too: its thumbnail stays.
    const phone = stationView(deviceFixture(DEVICE, 'Phone'), context([camera, mic]));
    expect(phone.audioOnly).toBe(false);
    expect(phone.thumbSourceId).toBe(camera.id);
  });

  it('warns about a low battery unless the phone is charging', () => {
    const low = stationView(
      deviceFixture(DEVICE, 'Phone', { telemetry: telemetry({ batteryPct: 14 }) }),
      context([camera]),
    );
    expect(low.line).toMatchObject({ kind: 'metrics', lowBattery: 14 });
    const charging = stationView(
      deviceFixture(DEVICE, 'Phone', { telemetry: telemetry({ batteryPct: 14, charging: true }) }),
      context([camera]),
    );
    expect(charging.line).toMatchObject({ lowBattery: null });
  });

  it('flags a sender at its CPU limit in the state line, with the slot codes of a laptop', () => {
    const limited = telemetry({
      slots: [{ ...telemetry().slots[0], qualityLimitation: 'cpu' }],
    });
    const phone = stationView(
      deviceFixture(DEVICE, 'Phone', { telemetry: limited }),
      context([camera]),
    );
    expect(phone.line).toMatchObject({ kind: 'metrics', cpuLimit: 'CPU at limit' });
    expect(phone.cpuLimited).toEqual(['K1']);

    const laptop = 'dev_bbbbbbbbbbbbbbbb';
    const s1 = sourceFixture(laptop, 'screen-1', 'S1');
    const s2 = sourceFixture(laptop, 'screen-2', 'S2');
    const base = telemetry().slots[0];
    const view = stationView(
      deviceFixture(laptop, 'Laptop Lea', {
        kind: 'laptop',
        telemetry: telemetry({
          slots: [
            { ...base, slot: 'screen-1' },
            { ...base, slot: 'screen-2', qualityLimitation: 'cpu' },
          ],
        }),
      }),
      context([s1, s2]),
    );
    expect(view.line).toMatchObject({ cpuLimit: 'CPU at limit S2' });
    expect(cpuLimitText([], true)).toBeNull();
    expect(cpuLimitText(['S1', 'S2'], true)).toBe('CPU at limit S1 S2');
    const bandwidth = stationView(
      deviceFixture(DEVICE, 'Phone', {
        telemetry: telemetry({ slots: [{ ...base, qualityLimitation: 'bandwidth' }] }),
      }),
      context([camera]),
    );
    expect(bandwidth.line).toMatchObject({ cpuLimit: null });
  });

  it('names a camera stopped on purpose "camera stopped" and offers no reshare for it', () => {
    const ended = { ...camera, status: 'ended' as const, statusSince: '2026-10-22T10:00:00Z' };
    const view = stationView(deviceFixture(DEVICE, 'Phone'), context([ended]));
    expect(view.line).toMatchObject({ kind: 'state', word: 'camera stopped', tone: 'bad' });
    expect(view.endedScreens).toEqual([]);
    expect(view.ariaLabel).toBe('K1 Phone, camera stopped');
  });

  it('shows "reconnecting" with timer and "freeze frame" while reconnecting', () => {
    const reconnecting = {
      ...camera,
      status: 'reconnecting' as const,
      statusSince: '2026-10-22T10:00:00Z',
    };
    const view = stationView(deviceFixture(DEVICE, 'Phone'), context([reconnecting]));
    expect(view.line).toEqual({
      kind: 'state',
      word: 'reconnecting',
      tone: 'warn',
      code: null,
      since: '2026-10-22T10:00:00Z',
      extra: 'freeze frame',
    });
    expect(view.tone).toBe('is-warn');
    expect(view.lamp).toBe('is-warn');
    expect(view.canSwitchCamera).toBe(false);
    expect(view.ariaLabel).toBe('K1 Phone, reconnecting');
  });

  it('takes the worst slot of a laptop and names its code', () => {
    const laptop = 'dev_bbbbbbbbbbbbbbbb';
    const s1 = sourceFixture(laptop, 'screen-1', 'S1');
    const s2 = sourceFixture(laptop, 'screen-2', 'S2', { status: 'ended' });
    const view = stationView(
      deviceFixture(laptop, 'Laptop Lea', { kind: 'laptop' }),
      context([s1, s2]),
    );
    expect(view.status).toBe('ended');
    expect(view.line).toMatchObject({
      kind: 'state',
      word: 'sharing stopped',
      code: 'S2',
      tone: 'bad',
    });
    expect(view.endedScreens.map((source) => source.code)).toEqual(['S2']);
    expect(view.codes).toEqual(['S1', 'S2']);
    expect(worstSource([s1, s2])).toBe(s2);
  });

  it('shows a blocked device as "blocked cannot connect"', () => {
    const view = stationView(
      deviceFixture(DEVICE, 'Phone', { state: 'blocked' }),
      context([{ ...camera, status: 'blocked' }]),
    );
    expect(view.blocked).toBe(true);
    expect(view.line).toMatchObject({ word: 'blocked', extra: 'cannot connect' });
  });

  it('keeps a recovered station marked until "Seen"', () => {
    const incident = incidentFixture('inc_1', camera.id, 'K1', {
      startedAt: '2026-10-22T10:00:00.000Z',
      endedAt: '2026-10-22T10:00:09.000Z',
    });
    const view = stationView(
      deviceFixture(DEVICE, 'Phone'),
      context([camera], { incidents: [incident] }),
    );
    expect(view.line).toEqual({ kind: 'recovered', seconds: 9 });
    expect(view.recovered).toEqual([incident]);
    expect(incidentSeconds({ ...incident, endedAt: incident.startedAt })).toBe(1);
  });

  it('shows PVW only in Studio Mode', () => {
    const device = deviceFixture(DEVICE, 'Phone');
    expect(stationView(device, context([camera], {}, 'preview')).tally).toBe('off');
    expect(stationView(device, context([camera], { studioMode: true }, 'preview')).tally).toBe(
      'preview',
    );
  });

  it('lists the details and the technical check', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z');
    const device = deviceFixture(DEVICE, 'Phone', {
      platform: 'iPhone 13 · Safari',
      pairedAt: new Date(now - 3600_000).toISOString(),
      telemetry: telemetry({ charging: true }),
      techCheck: {
        overall: 'warn',
        camera: 'ok',
        network: 'ok',
        bandwidth: 'warn',
        uploadKbps: 4200,
        rttMs: 20,
        at: '2026-10-22T09:00:00.000Z',
        note: null,
      },
    });
    const details = stationDetails(device, [camera], 'ok', now);
    expect(details.map((entry) => entry.label)).toEqual([
      'Device',
      'Resolution',
      'Encoding',
      'Paired',
      'Packet loss',
      'Battery',
      'Network',
    ]);
    expect(details[1].value).toBe('1080p');
    expect(details[2].value).toBe('H.264');
    expect(details[3].value).toMatch(/^today \d\d:\d\d$/);
    expect(details[4].value).toBe('0.0%');
    expect(details[5].value).toBe('78% · charging');
    expect(details[6].value).toBe('Wi-Fi');
    expect(techLamps(device.techCheck)?.map((lamp) => `${lamp.label} ${lamp.word}`)).toEqual([
      'Camera ok',
      'Network ok',
      'Upload borderline 4.2 Mbit/s',
    ]);
    expect(techLamps(null)).toBeNull();
    expect(stationDetails(device, [camera], 'reconnecting', now)[4].value).toBe('–');
  });

  it('says how a slot is encoded, per slot for a laptop, and marks software encoding and the CPU limit', () => {
    const slot = telemetry().slots[0];
    const hardware = deviceFixture(DEVICE, 'Phone', {
      telemetry: telemetry({ slots: [{ ...slot, hardwareEncoder: true }] }),
    });
    expect(stationDetails(hardware, [camera], 'ok', 0)[2]).toMatchObject({
      label: 'Encoding',
      value: 'H.264 · hardware',
    });

    const laptop = 'dev_bbbbbbbbbbbbbbbb';
    const sources = [
      sourceFixture(laptop, 'screen-1', 'S1'),
      sourceFixture(laptop, 'screen-2', 'S2'),
    ];
    const device = deviceFixture(laptop, 'Laptop Lea', {
      kind: 'laptop',
      telemetry: telemetry({
        slots: [
          { ...slot, slot: 'screen-1', codec: 'h264', hardwareEncoder: true },
          {
            ...slot,
            slot: 'screen-2',
            codec: 'vp9',
            hardwareEncoder: false,
            qualityLimitation: 'cpu',
          },
        ],
      }),
    });
    const entries = stationDetails(device, sources, 'ok', 0).filter((entry) =>
      entry.label.startsWith('Encoding'),
    );
    expect(entries.map((entry) => [entry.label, entry.value])).toEqual([
      ['Encoding S1', 'H.264 · hardware'],
      ['Encoding S2', 'VP9 · software encoding · CPU at limit'],
    ]);
    const silent = deviceFixture(DEVICE, 'Phone', {
      telemetry: telemetry({ slots: [{ ...slot, codec: null }] }),
    });
    expect(stationDetails(silent, [camera], 'ok', 0).map((entry) => entry.label)).not.toContain(
      'Encoding',
    );
  });

  it('says how this Regie decodes the pictures of a station, where the browser tells', () => {
    const laptop = 'dev_bbbbbbbbbbbbbbbb';
    const s1 = sourceFixture(laptop, 'screen-1', 'S1');
    const s2 = sourceFixture(laptop, 'screen-2', 'S2');
    expect(
      decodingEntries([camera], new Map([[camera.id, { codec: 'h264', decoder: 'hardware' }]])),
    ).toEqual([{ label: 'Decoding here', value: 'H.264 · hardware decoding', mono: true }]);
    expect(
      decodingEntries(
        [s1, s2],
        new Map([
          [s1.id, { codec: 'vp9', decoder: 'software' as const }],
          [s2.id, null],
        ]),
      ),
    ).toEqual([{ label: 'Decoding S1 here', value: 'VP9 · software decoding', mono: true }]);
    expect(decodingEntries([camera], new Map([[camera.id, { codec: 'h264' }]]))).toEqual([]);
    expect(decodingEntries([camera], new Map())).toEqual([]);
  });

  it('formats network types, resolutions of several slots and other days', () => {
    expect(networkLabel('ethernet')).toBe('Ethernet');
    expect(networkLabel('4g')).toBe('4G');
    expect(networkLabel(null)).toBeNull();
    const laptop = 'dev_bbbbbbbbbbbbbbbb';
    const sources = [
      sourceFixture(laptop, 'screen-1', 'S1'),
      sourceFixture(laptop, 'screen-2', 'S2'),
    ];
    const slots = telemetry().slots;
    expect(
      resolutionText(
        telemetry({
          slots: [
            { ...slots[0], slot: 'screen-1', height: 1440 },
            { ...slots[0], slot: 'screen-2', height: 720 },
          ],
        }),
        sources,
      ),
    ).toBe('S1 1440p · S2 720p');
    expect(resolutionText(null, sources)).toBe('–');
    const yesterday = new Date(2026, 9, 21, 9, 5).toISOString();
    expect(pairedText(yesterday, new Date(2026, 9, 22, 12, 0).getTime())).toBe('21/10 09:05');
  });
});
