import { resetLocaleForTests } from '@studioflow/i18n';
import type { DeviceTelemetryDto } from '@studioflow/scene-model';
import { deviceFixture, sourceFixture } from '../../testing/fixtures';
import { monitoringRows, seenText } from './monitoring-rows';

const NOW = Date.parse('2026-10-22T10:00:10.000Z');

const TELEMETRY: DeviceTelemetryDto = {
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
      bitrateKbps: 2800,
      packetLossPct: 0.5,
      codec: 'h264',
    },
  ],
};

describe('monitoring rows in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('writes the state word, the decimal comma and the percent sign the Swiss way', () => {
    const device = deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Barn', { telemetry: TELEMETRY });
    const sources = [sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1')];
    const [row] = monitoringRows([device], () => sources, NOW);
    expect(row.stateWord).toBe('sendet');
    expect(row.techText).toBe('nicht gelaufen');
    expect(row.slots[0]).toMatchObject({ state: 'live', bitrate: '2,8', loss: '0,5' });
  });

  it('says how long ago a station was seen', () => {
    expect(seenText(NOW - 3000, NOW)).toBe('vor 3 s');
    expect(seenText(NOW - 5 * 60_000, NOW)).toBe('vor 5 min');
  });
});
