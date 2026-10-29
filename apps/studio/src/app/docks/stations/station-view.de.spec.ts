import { resetLocaleForTests } from '@studioflow/i18n';
import type { DeviceTelemetryDto } from '@studioflow/scene-model';
import { deviceFixture, sourceFixture } from '../../../testing/fixtures';
import {
  decodingEntries,
  pairedText,
  stationDetails,
  stationView,
  techLamps,
} from './station-view';

const DEVICE = 'dev_aaaaaaaaaaaaaaaa';

function telemetry(): DeviceTelemetryDto {
  return {
    at: '2026-10-22T10:00:00.000Z',
    rtc: 'connected',
    batteryPct: 78,
    charging: true,
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
  };
}

describe('station view in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  const camera = sourceFixture(DEVICE, 'camera', 'K1');

  it('uses the decimal comma and the German state words', () => {
    const view = stationView(deviceFixture(DEVICE, 'Handy', { telemetry: telemetry() }), {
      sources: [camera],
      incidents: [],
      tallyOf: () => 'program',
      studioMode: false,
    });
    expect(view.line).toMatchObject({ rate: '2,8' });
    expect(view.ariaLabel).toBe('K1 Handy, im Program');
    const reconnecting = stationView(deviceFixture(DEVICE, 'Handy'), {
      sources: [{ ...camera, status: 'reconnecting' }],
      incidents: [],
      tallyOf: () => 'off',
      studioMode: false,
    });
    expect(reconnecting.line).toMatchObject({ word: 'verbindet neu', extra: 'Standbild' });
  });

  it('words the details, the tech check and other days like the German UI', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z');
    const device = deviceFixture(DEVICE, 'Handy', {
      pairedAt: new Date(now - 3600_000).toISOString(),
      telemetry: telemetry(),
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
      'Codierung',
      'Gekoppelt',
      'Paketverlust',
      'Akku',
      'Netz',
    ]);
    expect(details[2].value).toBe('H.264');
    expect(details[4].value).toBe('0,0 %');
    expect(details[5].value).toBe('78 % · lädt');
    expect(details[6].value).toBe('WLAN');
    expect(techLamps(device.techCheck)?.map((lamp) => `${lamp.label} ${lamp.word}`)).toEqual([
      'Kamera ok',
      'Netz ok',
      'Upload knapp 4,2 Mbit/s',
    ]);
    const yesterday = new Date(2026, 9, 21, 9, 5).toISOString();
    expect(pairedText(yesterday, new Date(2026, 9, 22, 12, 0).getTime())).toBe('21.10. 09:05');
  });

  it('words encoding, decoding and the CPU limit like the German UI', () => {
    const slots = telemetry().slots.map((slot) => ({
      ...slot,
      codec: 'vp9',
      hardwareEncoder: false,
      qualityLimitation: 'cpu',
    }));
    const device = deviceFixture(DEVICE, 'Handy', { telemetry: { ...telemetry(), slots } });
    const view = stationView(device, {
      sources: [camera],
      incidents: [],
      tallyOf: () => 'off',
      studioMode: false,
    });
    expect(view.line).toMatchObject({ cpuLimit: 'CPU am Limit' });
    const encoding = stationDetails(device, [camera], 'ok', Date.now())[2];
    expect(encoding).toMatchObject({
      label: 'Codierung',
      value: 'VP9 · Software-Codierung · CPU am Limit',
    });
    expect(
      decodingEntries([camera], new Map([[camera.id, { codec: 'vp9', decoder: 'software' }]])),
    ).toEqual([{ label: 'Decodierung hier', value: 'VP9 · Software-Decodierung', mono: true }]);
  });
});
