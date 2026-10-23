import type { DeviceTelemetryDto } from '@studioflow/scene-model';
import { deviceFixture, sourceFixture } from '../../testing/fixtures';
import {
  STALE_AFTER_MS,
  monitoringRows,
  nextSort,
  seenText,
  sortMonitoringRows,
  type MonitoringRow,
} from './monitoring-rows';
import { resetLocaleForTests } from '@studioflow/i18n';

// Not converted yet: asserts German texts, so it runs in de-CH. Remove with the conversion of this file.
beforeEach(() => resetLocaleForTests('de-CH'));

const NOW = Date.parse('2026-10-22T10:00:10.000Z');

function telemetry(kbps: number, overrides: Partial<DeviceTelemetryDto> = {}): DeviceTelemetryDto {
  return {
    at: '2026-10-22T10:00:08.000Z',
    rtc: 'connected',
    batteryPct: null,
    charging: null,
    network: 'wifi',
    rttMs: 20,
    slots: [
      {
        slot: 'camera',
        state: 'live',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: kbps,
        packetLossPct: 0.5,
        codec: 'h264',
      },
    ],
    ...overrides,
  };
}

function rows(): MonitoringRow[] {
  const devices = [
    deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Bühne', {
      telemetry: telemetry(2800, { batteryPct: 40 }),
    }),
    deviceFixture('dev_bbbbbbbbbbbbbbbb', 'Adler', { telemetry: telemetry(900) }),
    deviceFixture('dev_cccccccccccccccc', 'Zelt', { connection: 'offline', telemetry: null }),
  ];
  const sources = new Map([
    ['dev_aaaaaaaaaaaaaaaa', [sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1')]],
    [
      'dev_bbbbbbbbbbbbbbbb',
      [sourceFixture('dev_bbbbbbbbbbbbbbbb', 'camera', 'K2', { status: 'reconnecting' })],
    ],
    [
      'dev_cccccccccccccccc',
      [sourceFixture('dev_cccccccccccccccc', 'camera', 'K3', { status: 'offline' })],
    ],
  ]);
  return monitoringRows(devices, (id) => sources.get(id) ?? [], NOW);
}

describe('monitoring rows', () => {
  it('builds one row per station with per-slot values', () => {
    const [first, second, third] = rows();
    expect(first).toMatchObject({
      name: 'Bühne',
      stateWord: 'sendet',
      stateTone: 'muted',
      codes: 'K1',
      bitrateKbps: 2800,
      heightValue: 1080,
      batteryPct: 40,
      network: 'WLAN',
      stale: false,
    });
    expect(first.slots).toEqual([
      {
        code: 'K1',
        state: 'live',
        resolution: '1920 × 1080',
        fps: '30',
        bitrate: '2,8',
        loss: '0,5 %',
      },
    ]);
    expect(second).toMatchObject({
      stateWord: 'verbindet neu',
      stateTone: 'warn',
      lamp: 'is-warn',
    });
    expect(third).toMatchObject({ stateWord: 'nicht verbunden', bitrateKbps: null, stale: false });
    expect(third.slots[0].bitrate).toBe('–');
  });

  it('marks telemetry older than the server timeout as stale', () => {
    const device = deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Alt', {
      telemetry: telemetry(1000, { at: new Date(NOW - STALE_AFTER_MS - 1).toISOString() }),
    });
    const [row] = monitoringRows([device], () => [], NOW);
    expect(row.stale).toBe(true);
  });

  it('sorts by any column, unknown values last, and cycles back to the Regie order', () => {
    const list = rows();
    const byRate = sortMonitoringRows(list, { column: 'bitrate', direction: 'asc' });
    expect(byRate.map((row) => row.name)).toEqual(['Adler', 'Bühne', 'Zelt']);
    const byRateDesc = sortMonitoringRows(list, { column: 'bitrate', direction: 'desc' });
    expect(byRateDesc.map((row) => row.name)).toEqual(['Bühne', 'Adler', 'Zelt']);
    const byName = sortMonitoringRows(list, { column: 'station', direction: 'asc' });
    expect(byName.map((row) => row.name)).toEqual(['Adler', 'Bühne', 'Zelt']);
    const byState = sortMonitoringRows(list, { column: 'state', direction: 'desc' });
    expect(byState[0].name).toBe('Adler');
    const original = sortMonitoringRows(byName, { column: null, direction: 'asc' });
    expect(original.map((row) => row.name)).toEqual(['Bühne', 'Adler', 'Zelt']);

    let sort = nextSort({ column: null, direction: 'asc' }, 'fps');
    expect(sort).toEqual({ column: 'fps', direction: 'asc' });
    sort = nextSort(sort, 'fps');
    expect(sort).toEqual({ column: 'fps', direction: 'desc' });
    expect(nextSort(sort, 'fps')).toEqual({ column: null, direction: 'asc' });
    expect(nextSort(sort, 'rtt')).toEqual({ column: 'rtt', direction: 'asc' });
  });

  it('says how long ago a station was seen', () => {
    expect(seenText(null, NOW)).toBe('–');
    expect(seenText(NOW - 3000, NOW)).toBe('vor 3 s');
    expect(seenText(NOW - 5 * 60_000, NOW)).toBe('vor 5 min');
    expect(seenText(NOW - 3 * 3600_000, NOW)).toMatch(/^\d\d:\d\d$/);
  });
});
