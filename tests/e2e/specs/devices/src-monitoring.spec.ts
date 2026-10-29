import type { Page } from '@playwright/test';
import { FakeStation } from '../../support/devices/fake-station';
import { FULL, LEFT, RIGHT, livePhone, liveLaptop, putInScene } from '../../support/devices/fleet';
import { installBatteryStub } from '../../support/devices/phone-stubs';
import { readPlaces } from '../../support/devices/places';
import { livekitCtl } from '../../support/docker-ctl';
import { requireTool } from '../../support/fixtures';
import { net } from '../../support/net';
import { pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * SRC-12: telemetry in the station line and on `/monitoring` (docs/testing.md 2.5). Three real stations (two phones, one laptop),
 * a battery stub at 15% on one phone, 5% packet loss on LiveKit (the netem sidecar of the stack) and a station without battery
 * value (a hub stand-in; Firefox, where the Battery API is missing, is covered in dev-laptop.firefox.spec.ts).
 */

interface MonitoringRow {
  name: string;
  state: string;
  slots: string;
  resolution: string;
  fps: string;
  bitrate: string;
  loss: string;
  rtt: string;
  battery: string;
  network: string;
  tech: string;
}

async function monitoringRows(page: Page): Promise<MonitoringRow[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.c-mon-table tbody tr')].map((row) => {
      const text = (element: Element | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
      // Cells by column heading, not by position: a new column (Encoding, #12) must not shift the values (#78).
      const headings = [...document.querySelectorAll('.c-mon-table thead th')].map((th) => text(th));
      const cells = [...row.querySelectorAll('td')];
      const cell = (heading: string) => {
        const index = headings.indexOf(heading);
        if (index < 1) throw new Error(`no monitoring column "${heading}" in: ${headings.join(', ')}`);
        return text(cells[index - 1]); // the first heading belongs to the device name, a th
      };
      return {
        name: text(row.querySelector('th .c-mon-table__name') ?? undefined),
        state: cell('State'),
        slots: cell('Source'),
        resolution: cell('Resolution'),
        fps: cell('Frame rate (fps)'),
        bitrate: cell('Bit rate (Mbit/s)'),
        loss: cell('Packet loss (%)'),
        rtt: cell('Round trip (ms)'),
        battery: cell('Battery'),
        network: cell('Network'),
        tech: cell('Tech check'),
      };
    }),
  );
}

test(
  'E2E-SRC-12 [ui] telemetry: “Battery 15%” in amber on the station line, /monitoring lists every station with bitrate, fps, resolution, loss, RTT, battery, network and technical check, values refresh within 3 s, problems first, 5 % packet loss shows, a missing battery value is empty',
  t.p1,
  async ({ regie, openPhone, openLaptop, pairContext, api, production, context, onCleanup }, testInfo) => {
    requireTool('netem');
    test.setTimeout(300_000);
    onCleanup(() => livekitCtl.clearNetem());
    const low = await livePhone({ openPhone }, pairContext, regie, 'Phone Battery', { profile: 'pixel7', init: (ctx) => installBatteryStub(ctx, 0.15, false) });
    const normal = await livePhone({ openPhone }, pairContext, regie, 'Phone Normal', { profile: 'pixel7', init: (ctx) => installBatteryStub(ctx, 0.8, false) });
    const laptop = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
    const bare = await pairPhone(pairContext, { name: 'Phone without battery' });
    const fake = await new FakeStation(bare.credentials).connect({ camera: 'live' });
    onCleanup(() => fake.stop());
    await putInScene(api, production, 0, low.sourceId, LEFT);
    await putInScene(api, production, 0, normal.sourceId, RIGHT);
    await putInScene(api, production, 1, laptop.sourceId, FULL);

    // The station line: “Battery 15%” in the amber state colour; the others show no battery warning.
    const lowRow = low.row;
    await expect(lowRow.locator('.c-st__l2 .c-state--warn'), 'low battery warning').toHaveText('Battery 15%', { timeout: 20_000 });
    await expect(normal.row.locator('.c-st__l2')).not.toContainText('Battery');
    await lowRow.locator('.c-st__row').click();
    await expect(lowRow.locator('.c-st__kv')).toContainText(/Battery\s*15%/);

    // /monitoring in a second page of the same Regie session.
    const monitoring = await context.newPage();
    await monitoring.goto('/monitoring');
    await expect(monitoring.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
    await expect(monitoring.locator('.c-mon-table tbody tr')).toHaveCount(4, { timeout: 20_000 });
    await expect.poll(async () => (await monitoringRows(monitoring)).filter((row) => ['Phone Battery', 'Phone Normal', 'Laptop Lea'].includes(row.name) && /\d{3,4}/.test(row.resolution) && [row.fps, row.bitrate, row.loss, row.rtt].every((cell) => /\d/.test(cell))).length, { message: 'telemetry arrived for the three live stations', timeout: 40_000 }).toBe(3);
    let rows = await monitoringRows(monitoring);
    await testInfo.attach('monitoring-rows.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    const byName = (name: string) => rows.find((row) => row.name === name)!;
    for (const name of ['Phone Battery', 'Phone Normal', 'Laptop Lea']) {
      const row = byName(name);
      expect(row.resolution, `${name}: resolution`).toMatch(/\d{3,4} × \d{3,4}|\d{3,4}p/);
      expect(row.fps, `${name}: fps`).toMatch(/\d/);
      expect(row.bitrate, `${name}: bitrate`).toMatch(/\d+\.\d/);
      expect(row.loss, `${name}: loss (the unit is in the heading)`).toMatch(/^\d+\.\d$/);
      expect(row.rtt, `${name}: RTT`).toMatch(/\d+/);
      expect(row.network, `${name}: network type`).not.toBe('');
    }
    expect(byName('Phone Battery').battery, 'battery column').toMatch(/15%/);
    expect(byName('Phone without battery').battery, 'no battery value: empty, not 0').toBe('–');
    expect(byName('Phone without battery').battery).not.toMatch(/0%/);
    await expect(monitoring.locator('.c-mon-table td.c-state--warn').filter({ hasText: '15%' }), 'low battery in the amber colour').toBeVisible();

    // Values change within 3 s (telemetry every 2 s): the RTT or the bitrate of a live station moves.
    const before = JSON.stringify((await monitoringRows(monitoring)).map((row) => [row.bitrate, row.rtt, row.fps]));
    await expect.poll(async () => JSON.stringify((await monitoringRows(monitoring)).map((row) => [row.bitrate, row.rtt, row.fps])), { message: 'values refresh', timeout: 6000, intervals: [500] }).not.toBe(before);

    // Problem stations are sorted first, in the order of the Stations dock.
    await net.cut(normal.phone.context);
    await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.name, { message: 'the problem station is first in the dock', timeout: 15_000 }).toBe('Phone Normal');
    await expect.poll(async () => (await monitoringRows(monitoring))[0]?.name, { message: 'and first on /monitoring', timeout: 15_000 }).toBe('Phone Normal');
    const dock = (await readPlaces(regie.page)).stations.map((station) => station.name);
    expect((await monitoringRows(monitoring)).map((row) => row.name), 'same order as the Stations dock').toEqual(dock);
    await net.restore(normal.phone.context);

    // 5% packet loss on LiveKit: the loss column shows it for a live station.
    await livekitCtl.netem({ lossPct: 5 });
    await expect
      .poll(async () => Math.max(...(await monitoringRows(monitoring)).filter((row) => row.name !== 'Phone without battery').map((row) => parseFloat(row.loss) || 0)), { message: 'packet loss above 0% is reported', timeout: 40_000, intervals: [1000] })
      .toBeGreaterThan(0);
    rows = await monitoringRows(monitoring);
    testInfo.annotations.push({ type: 'measurement', description: `loss column under 5% netem: ${rows.map((row) => `${row.name} ${row.loss}`).join(', ')}` });
    await livekitCtl.clearNetem();
    await sleep(500);
  },
);
