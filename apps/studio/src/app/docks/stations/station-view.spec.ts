import type { DeviceTelemetryDto, SourceDto, TallyState } from '@flowstudio/scene-model';
import { deviceFixture, incidentFixture, sourceFixture } from '../../../testing/fixtures';
import {
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

  it('shows metrics for a healthy station: «2,8 Mbit/s», «31 ms», PGM', () => {
    const view = stationView(
      deviceFixture(DEVICE, 'Handy Bühne links', { telemetry: telemetry() }),
      context([camera], {}, 'program'),
    );
    expect(view.line).toEqual({ kind: 'metrics', rate: '2,8', rtt: '31', lowBattery: null });
    expect(view.tally).toBe('program');
    expect(view.lamp).toBe('');
    expect(view.tone).toBe('');
    expect(view.thumbSourceId).toBe(camera.id);
    expect(view.canSwitchCamera).toBe(true);
    expect(view.ariaLabel).toBe('K1 Handy Bühne links, im Program');
  });

  it('warns about a low battery unless the phone is charging', () => {
    const low = stationView(
      deviceFixture(DEVICE, 'Handy', { telemetry: telemetry({ batteryPct: 14 }) }),
      context([camera]),
    );
    expect(low.line).toMatchObject({ kind: 'metrics', lowBattery: 14 });
    const charging = stationView(
      deviceFixture(DEVICE, 'Handy', { telemetry: telemetry({ batteryPct: 14, charging: true }) }),
      context([camera]),
    );
    expect(charging.line).toMatchObject({ lowBattery: null });
  });

  it('names a camera stopped on purpose «Kamera beendet» and offers no reshare for it', () => {
    const ended = { ...camera, status: 'ended' as const, statusSince: '2026-10-22T10:00:00Z' };
    const view = stationView(deviceFixture(DEVICE, 'Handy'), context([ended]));
    expect(view.line).toMatchObject({ kind: 'state', word: 'Kamera beendet', tone: 'bad' });
    expect(view.endedScreens).toEqual([]);
    expect(view.ariaLabel).toBe('K1 Handy, Kamera beendet');
  });

  it('shows «verbindet neu» with timer and «Standbild» while reconnecting', () => {
    const reconnecting = {
      ...camera,
      status: 'reconnecting' as const,
      statusSince: '2026-10-22T10:00:00Z',
    };
    const view = stationView(deviceFixture(DEVICE, 'Handy'), context([reconnecting]));
    expect(view.line).toEqual({
      kind: 'state',
      word: 'verbindet neu',
      tone: 'warn',
      code: null,
      since: '2026-10-22T10:00:00Z',
      extra: 'Standbild',
    });
    expect(view.tone).toBe('is-warn');
    expect(view.lamp).toBe('is-warn');
    expect(view.canSwitchCamera).toBe(false);
    expect(view.ariaLabel).toBe('K1 Handy, verbindet neu');
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
      word: 'Teilen beendet',
      code: 'S2',
      tone: 'bad',
    });
    expect(view.endedScreens.map((source) => source.code)).toEqual(['S2']);
    expect(view.codes).toEqual(['S1', 'S2']);
    expect(worstSource([s1, s2])).toBe(s2);
  });

  it('shows a blocked device as «gesperrt kann sich nicht verbinden»', () => {
    const view = stationView(
      deviceFixture(DEVICE, 'Handy', { state: 'blocked' }),
      context([{ ...camera, status: 'blocked' }]),
    );
    expect(view.blocked).toBe(true);
    expect(view.line).toMatchObject({ word: 'gesperrt', extra: 'kann sich nicht verbinden' });
  });

  it('keeps a recovered station marked until «Gesehen»', () => {
    const incident = incidentFixture('inc_1', camera.id, 'K1', {
      startedAt: '2026-10-22T10:00:00.000Z',
      endedAt: '2026-10-22T10:00:09.000Z',
    });
    const view = stationView(
      deviceFixture(DEVICE, 'Handy'),
      context([camera], { incidents: [incident] }),
    );
    expect(view.line).toEqual({ kind: 'recovered', seconds: 9 });
    expect(view.recovered).toEqual([incident]);
    expect(incidentSeconds({ ...incident, endedAt: incident.startedAt })).toBe(1);
  });

  it('shows PVW only in Studio-Modus', () => {
    const device = deviceFixture(DEVICE, 'Handy');
    expect(stationView(device, context([camera], {}, 'preview')).tally).toBe('off');
    expect(stationView(device, context([camera], { studioMode: true }, 'preview')).tally).toBe(
      'preview',
    );
  });

  it('lists the details and the technical check', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z');
    const device = deviceFixture(DEVICE, 'Handy', {
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
      'Gerät',
      'Auflösung',
      'Gekoppelt',
      'Verlust',
      'Akku',
      'Netz',
    ]);
    expect(details[1].value).toBe('1080p');
    expect(details[2].value).toMatch(/^heute \d\d:\d\d$/);
    expect(details[3].value).toBe('0,0 %');
    expect(details[4].value).toBe('78 % · lädt');
    expect(details[5].value).toBe('WLAN');
    expect(techLamps(device.techCheck)?.map((lamp) => `${lamp.label} ${lamp.word}`)).toEqual([
      'Kamera ok',
      'Netz ok',
      'Upload knapp 4,2 Mbit/s',
    ]);
    expect(techLamps(null)).toBeNull();
    expect(stationDetails(device, [camera], 'reconnecting', now)[3].value).toBe('–');
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
    expect(pairedText(yesterday, new Date(2026, 9, 22, 12, 0).getTime())).toBe('21.10. 09:05');
  });
});
