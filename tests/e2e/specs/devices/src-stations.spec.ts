import { FakeStation } from '../../support/devices/fake-station';
import { FULL, LEFT, RIGHT, putInScene } from '../../support/devices/fleet';
import { readPlaces } from '../../support/devices/places';
import { pairLaptopByLink, pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * Stations dock with many stations at once: the order (SRC-15) and the accessible names (SRC-16). Eight stations in eight
 * states would need eight browsers, so the stations are device hub stand-ins (support/devices/fake-station.ts): Hello and a
 * report per second, which is all the status rules of the API look at. The Regie is a real browser.
 */

const order = async (regie: { page: import('@playwright/test').Page }) => (await readPlaces(regie.page)).stations.map((station) => station.codes[0]);

test.describe('SRC stations', () => {
  test(
    'E2E-SRC-15 [ui] station order: red, amber, recovered, connecting, in program, in preview, the rest; ties by code; the order follows the states live',
    t.p1,
    async ({ regie, api, production, pairContext, onCleanup }) => {
      test.setTimeout(180_000);
      // Pairing order decides the codes: the laptop first (S1), then the phones K1 ... K7.
      const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Red' });
      const phones = [] as Awaited<ReturnType<typeof pairPhone>>[];
      for (let index = 1; index <= 7; index++) phones.push(await pairPhone(pairContext, { name: `Phone ${index}` }));
      expect(laptop.codes['screen-1']).toBe('S1');
      expect(phones.map((phone) => phone.codes['camera'])).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']);

      const stations = new Map<string, FakeStation>();
      const station = async (code: string, device: { credentials: ConstructorParameters<typeof FakeStation>[0] }, slots: Record<string, 'live' | 'ended'>) => {
        const fake = await new FakeStation(device.credentials).connect(slots);
        onCleanup(() => fake.stop());
        stations.set(code, fake);
        return fake;
      };
      await station('S1', laptop, { 'screen-1': 'live' });
      for (const index of [1, 2, 3, 5, 6, 7]) await station(`K${index}`, phones[index - 1]!, { camera: 'live' });
      // K4 is online but has never been live: “connecting…”.
      await station('K4', phones[3]!, {});

      // Scenes: K5 in the program scene, K6 in the preview scene (Studio Mode), K2 also in the program scene (SRC-16).
      await putInScene(api, production, 0, phones[4]!.sourceId('camera'), LEFT);
      await putInScene(api, production, 0, phones[1]!.sourceId('camera'), RIGHT);
      await putInScene(api, production, 1, phones[5]!.sourceId('camera'), FULL);
      await regie.setStudioMode(true);
      expect((await api.setPreview(production.id, { sceneId: production.sceneIds[1]! })).status).toBe(200);
      await expect.poll(async () => (await order(regie)).length, { message: 'all eight stations are listed', timeout: 20_000 }).toBe(8);
      await sleep(2000); // every stand-in has reported live at least twice

      // S1 ended (red), K2 and K3 lose their connection, K3 comes back (recovered).
      await stations.get('S1')!.set('screen-1', 'ended');
      await stations.get('K2')!.disconnect();
      await stations.get('K3')!.disconnect();
      await expect.poll(async () => (await readPlaces(regie.page)).strip.map((entry) => entry.code).sort(), { message: 'three incidents', timeout: 20_000 }).toEqual(['K2', 'K3', 'S1']);
      await stations.get('K3')!.reconnect({ camera: 'live' });
      await expect.poll(async () => (await readPlaces(regie.page)).strip.find((entry) => entry.code === 'K3')?.recovered, { message: 'K3 is back', timeout: 20_000 }).toBe(true);

      // Red, amber, recovered, connecting, program, preview, rest by code.
      await expect.poll(() => order(regie), { message: 'the station order', timeout: 20_000 }).toEqual(['S1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K1', 'K7']);
      const places = await readPlaces(regie.page);
      expect(places.stations.map((station) => station.tag)).toEqual(['', 'PGM', '', '', 'PGM', 'PVW', '', '']);

      // The order follows the states live: K1 loses its connection and moves up behind the red one, ahead of K2 (by code).
      await stations.get('K1')!.disconnect();
      await expect.poll(() => order(regie), { message: 'K1 moved to the amber group', timeout: 20_000 }).toEqual(['S1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']);
      // K4 goes live: it leaves the “connecting” rank and falls back to the rest.
      await stations.get('K4')!.set('camera', 'live');
      await expect.poll(() => order(regie), { message: 'K4 is live now', timeout: 20_000 }).toEqual(['S1', 'K1', 'K2', 'K3', 'K5', 'K6', 'K4', 'K7']);
      // “Dismiss” on K3 removes the recovered rank; K3 is not the lead incident, so it is in the issues popover.
      await regie.page.locator('sf-status-line .c-status__health').click();
      await regie.page.getByRole('dialog', { name: 'Issues' }).getByRole('button', { name: 'Dismiss' }).click();
      await regie.page.keyboard.press('Escape');
      await expect.poll(() => order(regie), { message: 'K3 after “Dismiss”', timeout: 20_000 }).toEqual(['S1', 'K1', 'K2', 'K5', 'K6', 'K3', 'K4', 'K7']);
    },
  );

  test(
    'E2E-SRC-16 [ui] accessible name of a station row: “<code> <name>, on Program, reconnecting”, aria-expanded toggles',
    t.p2,
    async ({ regie, api, production, pairContext, onCleanup }) => {
      test.setTimeout(120_000);
      const phone = await pairPhone(pairContext, { name: 'Phone stage right' });
      const fake = await new FakeStation(phone.credentials).connect({ camera: 'live' });
      onCleanup(() => fake.stop());
      await putInScene(api, production, 0, phone.sourceId('camera'), FULL);
      const row = regie.page.locator(`.c-st[data-device="${phone.id}"]`);
      await expect(row).toBeVisible();
      const toggle = row.locator('.c-st__row');
      await expect(toggle).toHaveAccessibleName('K1 Phone stage right, on Program');
      await fake.disconnect();
      await expect(toggle, 'name while reconnecting').toHaveAccessibleName('K1 Phone stage right, on Program, reconnecting', { timeout: 20_000 });
      expect(await toggle.getAttribute('aria-expanded')).toBe('false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // Keyboard: Enter on the focused row button toggles as well.
      await toggle.focus();
      await regie.page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    },
  );
});
