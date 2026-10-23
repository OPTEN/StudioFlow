import type { Locator, Page } from '@playwright/test';
import { TEXT } from '../../support/text';
import { uniqueIp } from '../../support/fixtures';
import { DeviceHub } from '../../support/hubs';
import { livekitAdmin } from '../../support/livekit';
import {
  pairLaptopByLink,
  pairPhone,
  type PairedDevice,
  type PairContext,
} from '../../support/production';
import { t } from '../../support/tags';
import { OutputPage } from '../../support/ui/output';
import { expect, test } from '../../support/ui/fixtures';
import { newUiContext } from '../../support/ui';
import { toastOf, SCENES } from '../../support/regie/kit';
import { parseOutputUrl } from '../../support/api';

/**
 * The header of the Regie: the output chip and its popover (state, consumers, link, copy, IP restriction editor,
 * regenerate the key) and the monitoring page (docs/testing.md E2E-OUT-15, E2E-AUTH-23, E2E-AUTH-24, E2E-SRC-12). The API
 * level of these features is covered by specs/auth; here the operator's controls are driven.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const chip = (page: Page): Locator => page.getByRole('button', { name: /^Output/ });
const popover = (page: Page): Locator => page.getByRole('dialog', { name: 'Output' });
const kv = (pop: Locator, term: string): Locator => pop.locator(`dt:text-is("${term}") + dd`);
const ipInput = (pop: Locator): Locator => pop.getByLabel('IP-Adresse oder Netz (CIDR)');
const IP_ERROR = 'Bitte eine IP-Adresse wie 10.0.0.42 oder ein Netz wie 10.0.0.0/24 eingeben.';

async function openPopover(page: Page): Promise<Locator> {
  const pop = popover(page);
  if (!(await pop.isVisible())) await chip(page).click();
  await expect(pop).toBeVisible();
  return pop;
}

test.describe('REGIE output popover', () => {
  test(
    'E2E-OUT-15 [regie popover] state, consumers and addresses follow the output pages; format and latency lines; the link is masked and «Kopieren» puts the real link on the clipboard',
    t.p1,
    async ({ regie, openOutput, api, production }) => {
      await production.seed([...SCENES]);
      const page = regie.page;
      const pop = await openPopover(page);
      await expect(kv(pop, 'Zustand')).toHaveText('nicht verbunden');
      await expect(kv(pop, 'Abnehmer')).toHaveText('–');
      await expect(kv(pop, 'Format')).toHaveText('1920 × 1080 · 16:9 · 30 fps');
      await expect(kv(pop, 'Latenz')).toContainText('noch nicht gemessen');
      await expect(chip(page).locator('.c-lamp')).toHaveClass(/is-idle/);

      // The link is masked; «Kopieren» copies the full URL with the real key.
      const settings = (await api.getOutputSettings(production.id)).body;
      const masked = new URL(settings.url).host + `/o/${production.slug}?k=••••••`;
      await expect(pop.locator('.c-linkbox__text')).toHaveText(masked);
      await expect(pop.locator('.c-linkbox__text')).not.toContainText(production.outputKey);
      await pop.getByRole('button', { name: 'Kopieren' }).click();
      await expect(toastOf(page)).toContainText(`Kopiert: ${masked}`);
      expect(
        await page.evaluate(() => navigator.clipboard.readText()),
        'the clipboard holds the full link',
      ).toBe(settings.url);
      expect(await page.locator('body').innerText(), 'the key is never shown').not.toContain(
        production.outputKey,
      );

      // One output page: verbunden, 1 Abnehmer, with its address; then a second one.
      const first = await openOutput(production);
      await first.stage();
      await expect(kv(pop, 'Zustand'), 'connected within a few seconds').toHaveText(
        'verbunden, 1 Abnehmer',
        { timeout: 12_000 },
      );
      await expect(kv(pop, 'Abnehmer')).not.toHaveText('–');
      await expect(chip(page).locator('.c-lamp')).not.toHaveClass(/is-idle|is-warn/);
      const second = await openOutput(production);
      await second.stage();
      await expect(kv(pop, 'Zustand')).toHaveText('verbunden, 2 Abnehmer', { timeout: 12_000 });
      // Closing one page and then both brings the state back.
      await first.page.context().close();
      await expect(kv(pop, 'Zustand'), 'one page closed').toHaveText('verbunden, 1 Abnehmer', {
        timeout: 12_000,
      });
      await second.page.context().close();
      await expect(kv(pop, 'Zustand'), 'none left within 8 s').toHaveText('nicht verbunden', {
        timeout: 12_000,
      });
      await expect(kv(pop, 'Abnehmer')).toHaveText('–');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-23 [regie popover, editor] the IP restriction editor validates addresses and CIDR ranges, adds and removes entries, saves or discards, and reports what it did',
    t.p1,
    async ({ regie, api, production }) => {
      const page = regie.page;
      const pop = await openPopover(page);
      await expect(pop).toContainText('Jede Adresse darf den Output öffnen.');
      const add = async (text: string) => {
        await ipInput(pop).fill(text);
        await pop.getByRole('button', { name: 'Hinzufügen' }).click();
      };
      const entries = () => pop.locator('.c-output-link__ip .u-mono').allTextContents();

      // Invalid input: the message, nothing is added, nothing to save.
      for (const bad of [
        '10.0.0.256',
        'abc',
        '10.0.0.0/33',
        '1.2.3',
        '10.0.0.1/',
        '300.1.1.1',
        '::g',
        '10.0.0.0/24/8',
      ]) {
        await add(bad);
        await expect(pop.getByText(IP_ERROR), `«${bad}» is refused`).toBeVisible();
        await expect.poll(entries).toEqual([]);
        await expect(pop.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
        await ipInput(pop).fill('');
      }
      // Valid input: IPv4, a range, IPv6 (lower case), a duplicate is ignored.
      for (const good of ['10.0.0.42', '10.0.0.0/24', '2001:DB8::1', 'fd00::/64', '10.0.0.42']) {
        await add(good);
        await expect(pop.getByText(IP_ERROR)).toHaveCount(0);
      }
      await expect.poll(entries).toEqual(['10.0.0.42', '10.0.0.0/24', '2001:db8::1', 'fd00::/64']);
      await expect(pop).toContainText('Nur diese Adressen dürfen den Output öffnen.');
      await expect(ipInput(pop), 'the field is empty after adding').toHaveValue('');
      await pop.getByRole('button', { name: '10.0.0.0/24 entfernen' }).click();
      await expect.poll(entries).toEqual(['10.0.0.42', '2001:db8::1', 'fd00::/64']);

      // «Verwerfen» goes back to what the server has (nothing); the API was not touched.
      await pop.getByRole('button', { name: 'Verwerfen' }).click();
      await expect.poll(entries).toEqual([]);
      await expect(pop.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
      expect((await api.getOutputSettings(production.id)).body.allowedIps).toEqual([]);

      // «Speichern»: toast, API.
      await add('10.0.0.42');
      await add('10.0.0.0/24');
      await pop.getByRole('button', { name: 'Speichern' }).click();
      await expect(toastOf(page)).toContainText('Zugriff gespeichert');
      await expect(pop.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
      expect((await api.getOutputSettings(production.id)).body.allowedIps).toEqual([
        '10.0.0.42',
        '10.0.0.0/24',
      ]);
      // The list survives closing and opening the popover (it is read from the server).
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      const again = await openPopover(page);
      await expect
        .poll(() => again.locator('.c-output-link__ip .u-mono').allTextContents())
        .toEqual(['10.0.0.42', '10.0.0.0/24']);
      // Removing everything and saving opens the output for every address again.
      await again.getByRole('button', { name: '10.0.0.42 entfernen' }).click();
      await again.getByRole('button', { name: '10.0.0.0/24 entfernen' }).click();
      await again.getByRole('button', { name: 'Speichern' }).click();
      await expect(toastOf(page)).toContainText(
        'Zugriff gespeichert: jede Adresse darf den Output öffnen',
      );
      expect((await api.getOutputSettings(production.id)).body.allowedIps).toEqual([]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-23 [regie popover, behaviour] a restriction that excludes the proxy kicks the connected page within 2 s («Kein Zugang», «nicht verbunden»); the observed address lets it back in',
    t.p0,
    async ({ regie, openOutput, api, production }) => {
      test.setTimeout(120_000);
      await production.seed([...SCENES]);
      const page = regie.page;
      const output = await openOutput(production);
      await output.stage();
      const pop = await openPopover(page);
      await expect(kv(pop, 'Zustand')).toHaveText('verbunden, 1 Abnehmer', { timeout: 12_000 });
      const address = (await kv(pop, 'Abnehmer').innerText()).split(',')[0]!.trim();
      expect(address).toMatch(/^[0-9a-f.:]+$/i);
      expect(await output.slateText(), 'the output is not denied').not.toContain(TEXT.slate.denied);

      const save = async (list: string[]) => {
        for (const entry of await pop.locator('.c-output-link__ip .u-mono').allTextContents())
          await pop.getByRole('button', { name: `${entry} entfernen` }).click();
        for (const entry of list) {
          await ipInput(pop).fill(entry);
          await pop.getByRole('button', { name: 'Hinzufügen' }).click();
        }
        await pop.getByRole('button', { name: 'Speichern' }).click();
      };

      // A foreign address only: the connected page is kicked within 2 s of saving.
      const saved = Date.now();
      await save(['203.0.113.9']);
      await expect
        .poll(() => output.slateText(), {
          message: 'the connected page shows «Kein Zugang»',
          timeout: 8000,
          intervals: [100],
        })
        .toContain(TEXT.slate.denied);
      const kickedAfter = Date.now() - saved;
      test.info().annotations.push({
        type: 'measurement',
        description: `connected output refused ${kickedAfter} ms after clicking «Speichern»`,
      });
      expect(kickedAfter, 'T-KEY / GAP-06: within 2 s of saving').toBeLessThanOrEqual(2500);
      await expect(kv(pop, 'Zustand'), 'the chip says nicht verbunden').toHaveText(
        'nicht verbunden',
        { timeout: 10_000 },
      );
      await output.page.reload();
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(TEXT.slate.denied);
      expect((await api.getOutputSettings(production.id)).body.allowedIps).toEqual(['203.0.113.9']);

      // The address the proxy was seen with: the page works again after a reload.
      await save([address]);
      await expect(toastOf(page)).toContainText('Zugriff gespeichert');
      await output.page.reload();
      await expect
        .poll(() => output.slateText(), {
          message: 'the observed address is let in',
          timeout: 15_000,
        })
        .not.toContain(TEXT.slate.denied);
      await expect(kv(pop, 'Zustand')).toHaveText('verbunden, 1 Abnehmer', { timeout: 15_000 });
      expect((await api.getOutputSettings(production.id)).body.allowedIps).toEqual([address]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-24 [regie popover] «Link neu erzeugen»: «Abbrechen» changes nothing; confirming kicks the old page within T-KEY, removes it from LiveKit, the old link stays dead, the new one works',
    t.p0,
    async ({ regie, openOutput, browser, api, production, onCleanup }) => {
      test.setTimeout(120_000);
      await production.seed([...SCENES]);
      const page = regie.page;
      const oldKey = production.outputKey;
      const output = await openOutput(production);
      await output.stage();
      const pop = await openPopover(page);
      await expect(kv(pop, 'Zustand')).toHaveText('verbunden, 1 Abnehmer', { timeout: 12_000 });
      await expect
        .poll(
          async () =>
            (await livekitAdmin.listParticipants(production.id)).some((participant) =>
              participant.identity.startsWith(`output_${production.slug}`),
            ),
          { message: 'the output page is in the LiveKit room', timeout: 15_000 },
        )
        .toBe(true);

      // «Abbrechen» in the confirm box: nothing changes.
      await pop.getByRole('button', { name: 'Link neu erzeugen' }).click();
      const confirm = pop.getByRole('group', { name: 'Link neu erzeugen' });
      await expect(confirm).toContainText(
        'Der alte Link von «Proxy» hört sofort auf. Was ihn nutzt, braucht danach den neuen.',
      );
      await confirm.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(confirm).toBeHidden();
      expect((await api.getOutputSettings(production.id)).body.url).toContain(`k=${oldKey}`);
      expect(await output.slateText()).not.toContain(TEXT.slate.denied);

      // Confirm.
      await pop.getByRole('button', { name: 'Link neu erzeugen' }).click();
      const clicked = Date.now();
      await pop
        .getByRole('group', { name: 'Link neu erzeugen' })
        .getByRole('button', { name: 'Neu erzeugen' })
        .click();
      await expect(toastOf(page)).toContainText(
        'Neuer Link für «Proxy» erzeugt. Der alte ist ungültig.',
      );
      await expect
        .poll(() => output.slateText(), {
          message: 'the old page shows «Kein Zugang»',
          timeout: 8000,
          intervals: [100],
        })
        .toContain(TEXT.slate.denied);
      const refusedAfter = Date.now() - clicked;
      test.info().annotations.push({
        type: 'measurement',
        description: `old output refused ${refusedAfter} ms after confirming (T-KEY hard limit 2000 ms)`,
      });
      expect(refusedAfter, 'T-KEY hard limit').toBeLessThanOrEqual(2000);
      await expect
        .poll(
          async () =>
            (await livekitAdmin.listParticipants(production.id)).some((participant) =>
              participant.identity.startsWith(`output_${production.slug}`),
            ),
          { message: 'no output participant of the old key is left in LiveKit', timeout: 8000 },
        )
        .toBe(false);
      await expect(regie.statusLine()).toContainText('Output-Link «Proxy» neu erzeugt');

      // The old link stays dead after a reload; the new one plays (standby slate, connected).
      await output.page.reload();
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(TEXT.slate.denied);
      expect(
        (await production.output(oldKey).getOutputSnapshot()).status,
        'REST with the old key',
      ).toBe(403);
      await production.refreshOutput();
      expect(production.outputKey).not.toBe(oldKey);
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const fresh = await OutputPage.open(context, production);
      await expect
        .poll(() => fresh.slateText(), {
          message: 'the new link shows the standby slate',
          timeout: 15_000,
        })
        .toContain(TEXT.slate.standby);
      await expect(kv(pop, 'Zustand')).toHaveText('verbunden, 1 Abnehmer', { timeout: 15_000 });
      // «Kopieren» now copies the new link.
      await pop.getByRole('button', { name: 'Kopieren' }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(parseOutputUrl(copied).key).toBe(production.outputKey);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE monitoring page', () => {
  const report = (
    hub: DeviceHub,
    slots: Array<{
      slot: string;
      state?: string;
      width?: number;
      height?: number;
      fps?: number;
      bitrateKbps?: number;
      packetLossPct?: number;
    }>,
    extra: Record<string, unknown> = {},
  ) =>
    hub.report({
      rtc: 'connected',
      slots: slots.map((slot) => ({
        state: 'live',
        width: 1280,
        height: 720,
        fps: 30,
        bitrateKbps: 2500,
        packetLossPct: 0,
        codec: 'h264',
        ...slot,
      })) as never,
      ...extra,
    });

  async function hubFor(pairContext: PairContext, device: PairedDevice): Promise<DeviceHub> {
    const hub = DeviceHub.connect(pairContext.stack.anonymousBase, device.credentials, {
      headers: pairContext.stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {},
    });
    await hub.open();
    return hub;
  }

  test(
    'E2E-SRC-12 [regie monitoring] /monitoring lists every station with live values, sorts by any column and keeps the order of the Stationen dock',
    t.p1,
    async ({ regie, context, production, pairContext, onCleanup }) => {
      test.setTimeout(120_000);
      const phoneOne = await pairPhone(pairContext, { name: 'Handy Eins' });
      const phoneTwo = await pairPhone(pairContext, { name: 'Handy Zwei' });
      const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
      const hubOne = await hubFor(pairContext, phoneOne);
      const hubTwo = await hubFor(pairContext, phoneTwo);
      const hubLaptop = await hubFor(pairContext, laptop);
      for (const hub of [hubOne, hubTwo, hubLaptop]) onCleanup(() => hub.stop());

      await report(
        hubOne,
        [
          {
            slot: 'camera',
            width: 1280,
            height: 720,
            fps: 30,
            bitrateKbps: 2500,
            packetLossPct: 0.5,
          },
        ],
        { batteryPct: 15, charging: false, network: 'wifi', rttMs: 42 },
      );
      await report(
        hubLaptop,
        [
          {
            slot: 'screen-1',
            width: 1920,
            height: 1080,
            fps: 25,
            bitrateKbps: 4000,
            packetLossPct: 0,
          },
        ],
        { network: 'ethernet', rttMs: 8 },
      );
      // Handy Zwei: the OS paused the camera -> reconnecting (a problem station), battery full and charging.
      await report(hubTwo, [{ slot: 'camera' }], {
        batteryPct: 80,
        charging: true,
        network: '4g',
        rttMs: 120,
      });
      await expect
        .poll(
          async () =>
            (await production.snapshot()).sources.find(
              (source) => source.id === phoneTwo.sourceId(),
            )?.status,
          { message: 'Handy Zwei is live first' },
        )
        .toBe('ok');
      await hubTwo.report({
        rtc: 'connected',
        slots: [
          {
            slot: 'camera',
            state: 'paused',
            width: 1280,
            height: 720,
            fps: 30,
            bitrateKbps: 2500,
            packetLossPct: 0,
            codec: 'h264',
          },
        ],
        batteryPct: 80,
        charging: true,
        network: '4g',
        rttMs: 120,
      });
      await expect
        .poll(
          async () =>
            (await production.snapshot()).sources.find(
              (source) => source.id === phoneTwo.sourceId(),
            )?.status,
          { message: 'the paused camera is reconnecting' },
        )
        .toBe('reconnecting');
      await regie.waitForConvergence(production.id);

      const mon = await context.newPage();
      await mon.goto('/monitoring');
      await expect(mon.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
      await expect(mon.locator('.c-mon__conn')).toContainText('Live');
      const rows = mon.locator('tbody tr');
      await expect(rows).toHaveCount(3);
      const cell = (row: Locator, index: number) => row.locator('td').nth(index);
      const rowOf = (name: string) => mon.locator('tbody tr').filter({ hasText: name });
      await expect(mon.locator('.c-mon__summary')).toContainText('3 Stationen');

      // Columns after the station name: Zustand, Quellen, Auflösung, fps, Mbit/s, Verlust, RTT, Akku, Netz, Technik-Check, Zuletzt.
      const one = rowOf('Handy Eins');
      await expect(cell(one, 0)).toContainText('sendet');
      await expect(cell(one, 1)).toContainText('K1');
      await expect(cell(one, 2)).toHaveText('1280 × 720');
      await expect(cell(one, 3)).toHaveText('30');
      await expect(cell(one, 4)).toHaveText('2,5');
      await expect(cell(one, 5)).toHaveText('0,5 %');
      await expect(cell(one, 6)).toHaveText('42 ms');
      await expect(cell(one, 7)).toHaveText('15 %');
      await expect(cell(one, 7), 'a low battery is amber').toHaveClass(/c-state--warn/);
      await expect(cell(one, 8)).toHaveText('WLAN');
      await expect(cell(one, 10)).toContainText(/vor \d+ s/);
      const lap = rowOf('Laptop Lea');
      await expect(cell(lap, 1)).toContainText('S1');
      await expect(cell(lap, 2)).toHaveText('1920 × 1080');
      await expect(cell(lap, 4)).toHaveText('4,0');
      await expect(cell(lap, 7), 'no battery value: a dash, not 0').toHaveText('–');
      await expect(cell(lap, 8)).toHaveText('Ethernet');
      const two = rowOf('Handy Zwei');
      await expect(cell(two, 0), 'the paused camera is a problem').toContainText('verbindet neu');
      await expect(cell(two, 7)).toHaveText('80 % · lädt');
      await expect(cell(two, 7)).not.toHaveClass(/c-state--warn/);
      await expect(cell(two, 8)).toHaveText('4G');

      // The default order is the order of the Stationen dock (problems first).
      const names = (locator: Locator) =>
        locator.evaluateAll((elements) => elements.map((element) => element.textContent ?? ''));
      const monitoringOrder = async () => await names(mon.locator('tbody th .c-mon-table__name'));
      const dockOrder = async () => {
        const text = await names(regie.page.locator('.c-st[data-device]'));
        return ['Handy Eins', 'Handy Zwei', 'Laptop Lea'].sort(
          (a, b) =>
            text.findIndex((entry) => entry.includes(a)) -
            text.findIndex((entry) => entry.includes(b)),
        );
      };
      expect(await monitoringOrder(), 'same order as the Stationen dock').toEqual(
        await dockOrder(),
      );
      expect((await monitoringOrder())[0], 'the problem station comes first').toBe('Handy Zwei');

      // Sorting: fps ascending (25, 30, then the station without a live slot last), descending, then back to the default.
      const header = (label: string) => mon.getByRole('columnheader', { name: label });
      await mon.getByRole('button', { name: 'fps', exact: true }).click();
      await expect(header('fps')).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(monitoringOrder).toEqual(['Laptop Lea', 'Handy Eins', 'Handy Zwei']);
      await mon.getByRole('button', { name: 'fps', exact: true }).click();
      await expect(header('fps')).toHaveAttribute('aria-sort', 'descending');
      await expect.poll(monitoringOrder).toEqual(['Handy Eins', 'Laptop Lea', 'Handy Zwei']);
      await mon.getByRole('button', { name: 'Mbit/s', exact: true }).click();
      await expect
        .poll(monitoringOrder, { message: 'Mbit/s ascending: 2,5 then 4, unknown last' })
        .toEqual(['Handy Eins', 'Laptop Lea', 'Handy Zwei']);
      await mon.getByRole('button', { name: 'Mbit/s', exact: true }).click();
      await expect.poll(monitoringOrder).toEqual(['Laptop Lea', 'Handy Eins', 'Handy Zwei']);
      await mon.getByRole('button', { name: 'Station', exact: true }).click();
      await expect
        .poll(monitoringOrder, { message: 'by name' })
        .toEqual(['Handy Eins', 'Handy Zwei', 'Laptop Lea']);
      await mon.getByRole('button', { name: 'Station', exact: true }).click();
      await mon.getByRole('button', { name: 'Station', exact: true }).click();
      await expect(header('Station')).not.toHaveAttribute('aria-sort', /.+/);
      expect(await monitoringOrder(), 'back to the Regie order').toEqual(await dockOrder());

      // Live values: a new report reaches the table within a few seconds (telemetry is relayed once per 2 s).
      await report(
        hubOne,
        [
          {
            slot: 'camera',
            width: 1920,
            height: 1080,
            fps: 24,
            bitrateKbps: 3500,
            packetLossPct: 2.5,
          },
        ],
        { batteryPct: 14, charging: false, network: 'wifi', rttMs: 77 },
      );
      await expect(cell(rowOf('Handy Eins'), 2)).toHaveText('1920 × 1080', { timeout: 6000 });
      await expect(cell(rowOf('Handy Eins'), 3)).toHaveText('24');
      await expect(cell(rowOf('Handy Eins'), 4)).toHaveText('3,5');
      await expect(cell(rowOf('Handy Eins'), 5)).toHaveText('2,5 %');
      await expect(cell(rowOf('Handy Eins'), 6)).toHaveText('77 ms');
      await expect(cell(rowOf('Handy Eins'), 7)).toHaveText('14 %');
      // Handy Zwei comes back: the state word changes.
      await report(hubTwo, [{ slot: 'camera' }], {
        batteryPct: 80,
        charging: true,
        network: '4g',
        rttMs: 120,
      });
      await expect(cell(rowOf('Handy Zwei'), 0)).toContainText('sendet', { timeout: 6000 });
      await mon.getByRole('link', { name: 'Zurück zur Regie' }).click();
      await expect(mon).toHaveURL(/\/$/);
      await expect(regie.page).toHaveURL(/\/$/);
    },
  );
});
