import { PublicApi } from '../../support/api';
import { openPairingTab } from '../../support/devices/pairing';
import { uniqueIp } from '../../support/fixtures';
import { net } from '../../support/net';
import { sleep } from '../../support/shell';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';
import { probeTtlSupport, useDefaultTtl, useShortTtl, type TtlSupport } from '../../support/ttl';

/**
 * PAIR through the user interface with the short-TTL profile (invite 20 s, request 20 s, credentials window 15 s, pending cap 3):
 * E2E-PAIR-05, -06, -07 (window), -16 and the expiry of the QR code. The API side of the same rules is in
 * specs/pair/pair-ttl.short-ttl.spec.ts. The profile recreates the api container (own stack, nothing else is running on it).
 */

let support: TtlSupport;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await useShortTtl();
  support = await probeTtlSupport();
  test.info().annotations.push({ type: 'ttl-support', description: JSON.stringify(support) });
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  await useDefaultTtl();
});

test.describe('PAIR short-TTL, UI', () => {
  test(
    'E2E-PAIR-05 [ui] an unanswered request expires: the laptop shows «Anfrage abgelaufen» with «Neue Anfrage», the knock card disappears without a reload, a new request gets a new code',
    t.shortTtl(),
    async ({ regie, openLaptop }) => {
      test.skip(!support.request, 'Pairing:RequestTtl is not read by the API');
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      const code = await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      await expect(regie.knockCard('Laptop Anna')).toBeVisible();
      await expect(laptop.page.locator('.c-waiting__expiry')).toContainText(/Gilt noch 00:\d\d min\./);

      // Nobody answers for 25 s.
      await expect(laptop.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 40_000 });
      await expect(laptop.page.getByRole('heading', { name: 'Anfrage abgelaufen' })).toBeVisible();
      await expect(laptop.page.getByRole('button', { name: 'Neue Anfrage' })).toBeVisible();
      await expect(regie.knockCard('Laptop Anna'), 'the card is gone without a reload').toHaveCount(0);
      expect(await regie.page.evaluate(() => performance.getEntriesByType('navigation').length), 'the Regie page was not reloaded').toBe(1);

      await laptop.page.getByRole('button', { name: 'Neue Anfrage' }).click();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      const again = await laptop.checkCode();
      expect(again, 'a new request gets a new code').not.toBe(code);
      await expect(regie.knockCard('Laptop Anna')).toBeVisible();
      await laptop.page.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(regie.knockCard('Laptop Anna'), 'cancelling removes the card').toHaveCount(0, { timeout: 10_000 });
    },
  );

  test(
    'E2E-PAIR-06 [ui] approving after expiry: a Regie that missed the removal hides the expired card by its clock; a late «Zulassen» (410) shows a German notice, creates no device and does not crash',
    t.shortTtl(),
    async ({ regie, openLaptop, api, production }) => {
      test.skip(!support.request, 'Pairing:RequestTtl is not read by the API');
      test.setTimeout(180_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Spaet', 'laptop');
      await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      await expect(regie.knockCard('Laptop Spaet')).toBeVisible();

      // The Regie loses its hub (no removal event reaches it) but keeps REST.
      const context = regie.page.context();
      await context.route('**/hubs/studio/**', (route) => route.abort());
      await net.cut(context);
      await net.restore(context);
      await expect.poll(async () => (await regie.hooks())?.hub, { message: 'the Regie hub is down', timeout: 15_000 }).not.toBe('connected');
      await expect(laptop.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 40_000 });
      // The stale card is hidden by the expiry time even though the server's removal never arrived.
      await expect(regie.knockCard('Laptop Spaet'), 'the expired card is hidden by the Regie clock').toHaveCount(0, { timeout: 10_000 });
      expect((await production.snapshot()).devices, 'no device was created').toHaveLength(0);
      await context.unroute('**/hubs/studio/**');
      await regie.waitForHub('connected', 30_000);
      await expect(regie.page.locator('.c-knock')).toHaveCount(0);
    },
  );

  test(
    'E2E-PAIR-06 [ui, late answer] a «Zulassen» that the server answers 410 or 404 removes the card and says so in German',
    t.shortTtl(),
    async ({ regie, openLaptop, api, production }) => {
      test.skip(!support.request, 'Pairing:RequestTtl is not read by the API');
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Spaet', 'laptop');
      await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      await expect(regie.knockCard('Laptop Spaet')).toBeVisible();
      // The request is answered after it expired: the server says 410 (the answer is made up here; the real 410 and 404 of the
      // API are asserted in specs/pair, this checks what the card does with them).
      await regie.page.route('**/pairing/requests/*/approve', (route) =>
        route.fulfill({ status: 410, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Gone', status: 410, code: 'pairing_expired', detail: 'Die Anfrage ist abgelaufen.' }) }),
      );
      await regie.approveKnock('Laptop Spaet');
      await expect(regie.toast()).toContainText(/abgelaufen|schon beantwortet/);
      await regie.page.unroute('**/pairing/requests/*/approve');
      expect(regie.problems.pageErrors, 'no uncaught error').toEqual([]);
      expect((await production.snapshot()).devices, 'no device').toHaveLength(0);
      await api.denyPairingRequest(production.id, (await production.snapshot()).pairingRequests[0]!.id);
    },
  );

  test(
    'E2E-PAIR-07 [ui, credentials window] a laptop that polls after the credentials window shows «Anfrage abgelaufen» and offers a new request',
    t.shortTtl(),
    async ({ regie, openLaptop, production }) => {
      test.skip(!support.request, 'Pairing:RequestTtl is not read by the API');
      test.setTimeout(120_000);
      // The laptop's connection dies right after it asked; the Regie approves; it comes back after the window (15 s).
      const late = await openLaptop();
      await late.gotoStart();
      await late.submitPairingForm('Laptop Spaet', 'laptop');
      await late.checkCode();
      await net.cut(late.context);
      await openPairingTab(regie, 'laptop');
      await regie.approveKnock('Laptop Spaet');
      await sleep(18_000);
      await net.restore(late.context);
      await expect(late.page.getByTestId('pairing-expired'), 'after the window the credentials are gone').toBeVisible({ timeout: 20_000 });
      await expect(late.page.getByRole('button', { name: 'Neue Anfrage' })).toBeVisible();
      expect(await late.storedDevice()).toBeNull();
      expect((await production.snapshot()).devices.length, 'the device exists, the laptop cannot reach it any more').toBeGreaterThanOrEqual(1);
    },
  );

  test(
    'E2E-PAIR-16 [ui] the pending cap shows a German notice on the form and works again after a slot frees up',
    t.shortTtl(),
    async ({ openLaptop, production, stack }) => {
      test.skip(!support.pendingTotal, 'Pairing:Limits:PendingTotal is not read by the API');
      test.setTimeout(120_000);
      const requests: Array<{ requestId: string; pollToken: string }> = [];
      for (let index = 0; index < 3; index++) {
        const created = await new PublicApi(stack.anonymousBase, uniqueIp()).createPairingRequest({ name: `Cap ${index}`, kind: 'laptop', platform: 'x' });
        expect(created.status, created.raw.text()).toBe(201);
        requests.push(created.body);
        production.pendingRequests.push(created.body);
      }
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      await expect(laptop.page.getByRole('alert').filter({ hasText: /Zu viele Versuche\. Bitte in \d+ (Sekunden?|Minuten?) noch einmal versuchen\./ }), 'a German rate-limit notice (GAP-27: «Zu viele Versuche. Bitte in 1 Minute noch einmal versuchen.»)').toBeVisible({ timeout: 15_000 });
      await expect(laptop.page.getByRole('button', { name: 'Weiter' }), 'the button is not stuck in the busy state').toBeEnabled();
      expect(new URL(laptop.page.url()).pathname).toBe('/join/');
      // A slot frees up: the same form works.
      await new PublicApi(stack.anonymousBase, uniqueIp()).cancelPairingRequest(requests[0]!.requestId, requests[0]!.pollToken);
      await laptop.page.getByRole('button', { name: 'Weiter' }).click();
      await expect(laptop.page.getByTestId('check-code')).toBeVisible({ timeout: 15_000 });
    },
  );

  test(
    'E2E-PAIR-12 [ui, expiry] an unused QR code expires after its TTL: the dock replaces it by itself, the old code opens the expired page',
    t.shortTtl(),
    async ({ regie, openPhone }) => {
      test.skip(!support.invite, 'Pairing:InviteTtl is not read by the API');
      test.setTimeout(120_000);
      await openPairingTab(regie, 'phone');
      const old = await regie.readPairingQr();
      await expect(regie.page.locator('.c-pair__qr-side .c-hint .u-mono')).toHaveText(/^00:(1\d|20|0\d)$/);
      await expect.poll(async () => (await regie.readPairingQr()).url, { message: 'the expired code is replaced by a new one', timeout: 45_000, intervals: [1000] }).not.toBe(old.url);
      const stale = await openPhone({ profile: 'pixel7' });
      await stale.gotoInvite(old.url);
      await expect(stale.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 20_000 });
      const fresh = await regie.readPairingQr();
      const phone = await openPhone({ profile: 'pixel7' });
      await phone.gotoInvite(fresh.url);
      await phone.waitConnected();
    },
  );
});
