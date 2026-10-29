import { devices } from '@playwright/test';
import { PublicApi } from '../../support/api';
import { THRESHOLD } from '../../support/constants';
import { FULL, logTexts, putInScene } from '../../support/devices/fleet';
import { readPlaces } from '../../support/devices/places';
import { uniqueIp } from '../../support/fixtures';
import { net } from '../../support/net';
import { sleep } from '../../support/shell';
import { expectVideoPlaying } from '../../support/ui/video';
import { openPairingTab, pairLaptopViaKnock } from '../../support/devices/pairing';
import { pairPhoneViaQr } from '../../support/ui/pairing';
import { knownDevBug } from '../../support/devices/bugs';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * PAIR through the user interface (docs/testing.md 2.2): QR code of the Regie read with jsqr and opened in a Pixel 7 and an
 * iPhone 15 (Chromium emulation), the check code flow, deny, identical names, the double approve, invite links, a new QR code,
 * re-recognition, a lost redeem response, kind detection, the five-device fleet and the second operator. The REST side of the
 * same flows is in specs/pair/pair-rest.spec.ts (`[api]`).
 */

test.describe('PAIR phone, QR code', () => {
  for (const profile of ['pixel7', 'iphone15'] as const) {
    test(
      `E2E-PAIR-01 [ui, ${profile}] the QR code of the pairing dock pairs a phone: “Phone 1”, “Connected”, station K1 in the Regie, the code is replaced`,
      profile === 'pixel7' ? t.smoke : t.p0,
      async ({ regie, openPhone, api, production }, testInfo) => {
        test.setTimeout(120_000);
        const invite = (await api.getPhoneInvite(production.id)).body;
        await openPairingTab(regie, 'phone');
        await expect(regie.page.getByRole('tab', { name: 'Phone' })).toHaveAttribute('aria-selected', 'true');
        // The title “Phone as a camera” is hidden on short laptops (height <= 820 px, by design): the text under it is the check.
        await expect(regie.page.locator('sf-phone-tab')).toContainText('Scan this code. StudioFlow opens in the browser.');
        await expect(regie.page.locator('sf-phone-tab')).toContainText('Allow the camera. The phone then appears under Devices.');
        // The countdown: “Valid once, 29:5x left.” and it runs down.
        const countdown = regie.page.locator('.c-pair__qr-side .c-hint .u-mono');
        await expect(countdown).toHaveText(/^(30:00|29:[0-5]\d)$/);
        const first = await countdown.textContent();
        await expect.poll(async () => countdown.textContent(), { message: 'the countdown runs down', timeout: 5000 }).not.toBe(first);
        await expect(regie.page.locator('.c-pair__qr-side .c-hint')).toContainText(/Valid once, \d\d:\d\d left\./);

        const qr = await regie.readPairingQr();
        expect(qr.url, 'the QR code decodes to the invite URL of the API').toBe(invite.url);

        const phone = await openPhone({ profile });
        const redeemed = phone.page.waitForResponse((response) => /\/pairing\/invites\/[^/]+\/redeem$/.test(response.url()) && response.request().method() === 'POST');
        await phone.gotoInvite(qr.url);
        const redeemResponse = await redeemed;
        const redeemedAt = Date.now();
        expect(redeemResponse.status()).toBe(200);
        await phone.waitConnected();
        const connectedMs = Date.now() - redeemedAt;
        const stored = await phone.waitForStoredDevice();
        expect(new URL(phone.page.url()).pathname, 'the token left the address bar').toBe('/join/station');
        await expect(phone.page.getByRole('heading', { name: 'Phone 1' })).toBeVisible();
        await expect(phone.page.getByText('Paired as K1. The control room sees the picture as soon as the camera runs.')).toBeVisible();
        const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
        await expect(row).toBeVisible({ timeout: THRESHOLD.pairHardMs + 3000 });
        const stationMs = Date.now() - redeemedAt;
        testInfo.annotations.push({ type: 'measurement', description: `T-PAIR (${profile}): redeem response -> “Connected” ${connectedMs} ms, -> station row ${stationMs} ms` });
        expect(connectedMs, 'T-PAIR phone redeem -> “Connected” hard limit 3 s').toBeLessThanOrEqual(3000);
        expect(stationMs, 'T-PAIR redeem -> station in the Regie hard limit 2 s (plus the first telemetry poll of the test)').toBeLessThanOrEqual(THRESHOLD.pairHardMs + 1000);
        await expect(row.locator('.c-code')).toHaveText('K1');
        await expect(row.locator('.c-st__name')).toHaveText('Phone 1');
        // The platform text sent by the browser.
        const device = (await snapshotOf(api, production.id)).devices[0]!;
        expect(device.platform, 'platform text').toMatch(/^[\w .()-]+ · (Chrome|Edge|Firefox|Safari)$/);
        testInfo.annotations.push({ type: 'device', description: `${profile}: platform “${device.platform}”, kind ${device.kind}` });
        expect(device.kind).toBe('phone');
        // The QR code in the dock was replaced by a different one.
        await expect.poll(async () => (await regie.readPairingQr()).url, { message: 'a fresh QR code', timeout: 10_000 }).not.toBe(qr.url);
        expect(phone.problems.pageErrors).toEqual([]);
      },
    );
  }

  test(
    'E2E-PAIR-01 [ui, dock tabs] at 1280 x 720 the tabs “Laptop” and “Link” of the pairing dock can be clicked while the Phone tab shows its QR code (DEV-04)',
    t.p1,
    async ({ regie }) => {
      knownDevBug('DEV-04', 'the tab row of the pairing dock collapses to 2 px height on the Phone tab and its buttons are covered by the panel');
      expect(regie.page.viewportSize(), 'the smallest Regie size of the plan').toEqual({ width: 1280, height: 720 });
      await regie.pairButton().click();
      // A fresh browser opens “Add device” on “Phone”, the tab with the QR code (the clicks below are real pointer clicks).
      await expect(regie.pairingTab('phone')).toHaveAttribute('aria-selected', 'true');
      await regie.pairingTab('phone').click();
      await expect(regie.pairingQr()).toBeVisible();
      const geometry = await regie.page.evaluate(() => {
        const row = document.querySelector('.c-tabs') as HTMLElement;
        const reachable: Record<string, boolean> = {};
        for (const id of ['phone', 'laptop', 'link']) {
          const tab = document.getElementById(`sf-pair-tab-${id}`) as HTMLElement;
          const box = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          reachable[id] = Boolean(hit && (hit === tab || tab.contains(hit)));
        }
        return { rowHeight: Math.round(row.getBoundingClientRect().height), reachable };
      });
      expect(geometry.rowHeight, 'height of the tab row (a tab button is 32 px)').toBeGreaterThanOrEqual(30);
      expect(geometry.reachable, 'the element at the centre of each tab is the tab').toEqual({ phone: true, laptop: true, link: true });
      await regie.pairingTab('laptop').click({ timeout: 3000 });
      await expect(regie.pairingTab('laptop')).toHaveAttribute('aria-selected', 'true');
    },
  );

  test(
    'E2E-PAIR-02 [ui] the camera of a QR-paired phone goes live: green lamp, metrics, a playing picture in the Program monitor within T-VIDEO-START',
    t.p0,
    async ({ regie, openPhone, api, production }, testInfo) => {
      test.setTimeout(120_000);
      const phone = await openPhone({ profile: 'pixel7' });
      // The station line of the new row, sampled every 50 ms from before the phone opens the QR link: “not connected” /
      // “connecting…” first, the metrics once the camera is live.
      const lines: string[] = [];
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const line = (await readPlaces(regie.page).catch(() => undefined))?.stations[0]?.line;
          const normalised = line?.replace(/\d\d:\d\d/, '00:00');
          if (normalised && lines.at(-1) !== normalised) lines.push(normalised);
          await sleep(50);
        }
      })();
      const paired = await pairPhoneViaQr(regie, phone);
      await phone.waitForCamera('live', 45_000);
      await expect(paired.row.locator('.c-st__l2')).toHaveText(/\d+\.\d\s*Mbit\/s\s*\d+\s*ms/, { timeout: 20_000 });
      sampling = false;
      await sampler;
      testInfo.annotations.push({ type: 'measurement', description: `station line while the phone connects: ${lines.join(' -> ')}` });
      expect(lines[0], 'the station first shows that it is not there yet').toMatch(/not connected|connecting…|Mbit/);
      expect(lines.at(-1), 'then the metrics').toMatch(/Mbit\/s/);
      const liveAt = Date.now();
      const item = await putInScene(api, production, 0, `${paired.stored.deviceId}/camera`, FULL);
      expect(item.source).toBe(`${paired.stored.deviceId}/camera`);
      const video = regie.page.locator('.c-monitor--program video').first();
      await expectVideoPlaying(video, { minFps: 8, timeout: 30_000 });
      const videoMs = Date.now() - liveAt;
      testInfo.annotations.push({ type: 'measurement', description: `T-VIDEO-START (source already live, item added -> playing picture in the Program monitor): ${videoMs} ms` });
      await expect(paired.row.locator('.c-st__l2 .c-lamp')).not.toHaveClass(/is-(warn|bad|idle)/);
      await expect(paired.row.locator('.c-st__l2')).toHaveText(/\d+\.\d\s*Mbit\/s\s*\d+\s*ms/, { timeout: 15_000 });
      await expect(paired.row.locator('.c-tag--pgm')).toHaveText('Live');
      expect((await readPlaces(regie.page)).strip).toHaveLength(0);
      // The sender's own preview and tally agree: K1 is in the program scene, the broadcast has not started.
      expect(await phone.tally(), 'standby: nothing is on air').toBe('off');
      await expectVideoPlaying(paired.row.locator('sf-station-thumb video'), { minFps: 3, timeout: 20_000 });
    },
  );

  test(
    'E2E-PAIR-12 [ui] “Generate new code”: the toast, the old code opens the expired page, the new one pairs, the countdown restarts at 30:00',
    t.p1,
    async ({ regie, openPhone, api, production }) => {
      test.setTimeout(120_000);
      await openPairingTab(regie, 'phone');
      const old = await regie.readPairingQr();
      await regie.page.getByRole('button', { name: 'Generate new code' }).click();
      await expect(regie.toast()).toContainText('New QR code, the old one is no longer valid');
      await expect.poll(async () => (await regie.readPairingQr()).url, { message: 'the QR code changed', timeout: 10_000 }).not.toBe(old.url);
      const fresh = await regie.readPairingQr();
      await expect(regie.page.locator('.c-pair__qr-side .c-hint .u-mono'), 'countdown restarts').toHaveText(/^(30:00|29:5\d)$/);
      expect(fresh.url).toBe((await api.getPhoneInvite(production.id)).body.url);

      const stale = await openPhone({ profile: 'pixel7' });
      await stale.gotoInvite(old.url);
      await expect(stale.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 20_000 });
      await expect(stale.page.getByRole('heading', { name: 'Invite expired' })).toBeVisible();
      expect(await stale.storedDevice(), 'the old code paired nothing').toBeNull();
      const phone = await openPhone({ profile: 'pixel7' });
      await phone.gotoInvite(fresh.url);
      await phone.waitConnected();
      await expect(regie.page.locator('.c-st[data-device]')).toHaveCount(1);
    },
  );
});

test.describe('PAIR laptop, check code', () => {
  test(
    'E2E-PAIR-03 [ui] a laptop pairs with a check code: form, the same code on both screens, “Allow”, station S1 “Laptop Anna”',
    t.smoke,
    async ({ regie, openLaptop, api, production }, testInfo) => {
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      // The entry points: /join, /join/ and the deep link /join/waiting (no pending request: back to the form).
      for (const entry of ['/join', '/join/', '/join/waiting']) {
        const response = await laptop.page.goto(entry);
        expect(response?.status(), entry).toBeLessThan(400);
        await expect(laptop.page.getByRole('heading', { name: 'Pair device' }), entry).toBeVisible();
      }
      expect(await laptop.defaultKind(), 'a desktop browser defaults to a laptop').toBe('laptop');
      await expect(laptop.page.getByLabel('Device name'), 'a name is suggested from the platform').toHaveValue(/^Laptop /);

      const posted = laptop.page.waitForResponse((response) => /\/api\/pairing\/requests$/.test(response.url()) && response.request().method() === 'POST');
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      expect((await posted).status()).toBe(201);
      const requestedAt = Date.now();
      const code = await laptop.checkCode();
      expect(code, 'check code “47 12”').toMatch(/^\d{2} \d{2}$/);
      await expect(laptop.page.getByText('Check code for the control room')).toBeVisible();
      expect(new URL(laptop.page.url()).pathname).toBe('/join/waiting');

      await openPairingTab(regie, 'laptop');
      await expect(regie.knockCard('Laptop Anna')).toBeVisible({ timeout: 5000 });
      const cardMs = Date.now() - requestedAt;
      expect(await regie.knockCheckCode('Laptop Anna'), 'the same code on the knock card').toBe(code);
      await expect(regie.knockCard('Laptop Anna')).toContainText('Laptop Anna wants to join');
      await expect(regie.knockCard('Laptop Anna')).toContainText('Same code on the device?');
      await expect(regie.knockCard('Laptop Anna'), 'the card names the kind and the platform').toContainText(/Laptop · .+ · expires in/);
      const approvedAt = Date.now();
      await regie.approveKnock('Laptop Anna');
      await laptop.waitConnected();
      const connectedMs = Date.now() - approvedAt;
      testInfo.annotations.push({ type: 'measurement', description: `T-PAIR: request -> knock card ${cardMs} ms; “Allow” -> laptop connected ${connectedMs} ms` });
      expect(cardMs, 'T-PAIR request -> knock card hard limit 1.5 s (+ the first poll of the test)').toBeLessThanOrEqual(2500);
      expect(connectedMs, 'T-PAIR “Allow” -> laptop connected hard limit 3.5 s').toBeLessThanOrEqual(5000);
      expect(new URL(laptop.page.url()).pathname).toBe('/join/station');
      const stored = await laptop.waitForStoredDevice();
      const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('.c-code')).toHaveText('S1');
      await expect(row.locator('.c-st__name')).toHaveText('Laptop Anna');
      const sources = (await snapshotOf(api, production.id)).sources;
      expect(sources.find((source) => source.deviceId === stored.deviceId)!.label, 'source label').toBe('Laptop Anna · Screen 1');
      await expect(regie.page.locator('.c-knock')).toHaveCount(0);
      expect((await logTexts(api, production)).some((text) => /^S1 Laptop Anna paired$/.test(text))).toBe(true);
    },
  );

  test(
    'E2E-PAIR-04 [ui] “Deny”: the card is gone, the log says so, the laptop shows the denial with “New request”, no device is created',
    t.p1,
    async ({ regie, openLaptop, api, production }) => {
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      const code = await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      expect(await regie.knockCheckCode('Laptop Anna')).toBe(code);
      await regie.denyKnock('Laptop Anna');
      await expect(regie.knockCard('Laptop Anna')).toHaveCount(0);
      await expect(laptop.page.getByTestId('pairing-denied')).toBeVisible({ timeout: 10_000 });
      await expect(laptop.page.getByTestId('pairing-denied')).toContainText('The control room denied the request from “Laptop Anna”.');
      await expect(laptop.page.getByRole('button', { name: 'New request' })).toBeVisible();
      expect(await logTexts(api, production)).toContain('Request from Laptop Anna denied');
      expect((await snapshotOf(api, production.id)).devices, 'no device was created').toHaveLength(0);
      expect(await laptop.storedDevice()).toBeNull();
      await laptop.page.getByRole('button', { name: 'New request' }).click();
      await expect(laptop.page.getByRole('heading', { name: 'Pair device' })).toBeVisible();
    },
  );

  test(
    'E2E-PAIR-07 [ui, reload and offline] polling survives: a reload on the waiting screen keeps the request and its code; a laptop that was offline when the Regie approved still gets in',
    t.p1,
    async ({ regie, openLaptop, api, production }) => {
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      const code = await laptop.checkCode();
      const pending = (await snapshotOf(api, production.id)).pairingRequests;
      expect(pending).toHaveLength(1);
      await laptop.page.reload();
      expect(await laptop.checkCode(), 'same request, same check code after a reload').toBe(code);
      expect((await snapshotOf(api, production.id)).pairingRequests, 'no second request was made').toHaveLength(1);
      expect(await laptop.page.evaluate(() => JSON.parse(sessionStorage.getItem('studioflow.pairing') ?? '{}').checkCode)).toBeTruthy();

      // The laptop goes offline, the Regie approves, the laptop comes back 5 s later and polls.
      await net.cut(laptop.context);
      await openPairingTab(regie, 'laptop');
      expect(await regie.knockCheckCode('Laptop Anna')).toBe(code);
      await regie.approveKnock('Laptop Anna');
      await sleep(5000);
      await net.restore(laptop.context);
      await laptop.waitConnected(30_000);
      await laptop.waitForStoredDevice();
      expect(new URL(laptop.page.url()).pathname).toBe('/join/station');
    },
  );

  test(
    'E2E-PAIR-08 [ui] nine requests with the same name: nine cards with nine distinct codes; the card with the code of the real laptop pairs exactly that laptop',
    t.p1,
    async ({ regie, openLaptop, api, production, stack }) => {
      test.setTimeout(120_000);
      for (let index = 0; index < 8; index++) {
        const created = await new PublicApi(stack.anonymousBase, uniqueIp()).createPairingRequest({ name: 'Laptop', kind: 'laptop', platform: 'Windows · Chrome' });
        expect(created.status).toBe(201);
        production.pendingRequests.push({ requestId: created.body.requestId, pollToken: created.body.pollToken });
      }
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop', 'laptop');
      const code = await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      const cards = regie.page.getByRole('group', { name: 'Pairing request' });
      // The pairing dock holds every card once (the Stations dock shows them only while the dock is closed).
      await expect.poll(() => cards.count(), { message: 'nine cards', timeout: 15_000 }).toBe(9);
      const codes = await regie.page.locator('.c-knock__code').allTextContents();
      expect(new Set(codes.map((text) => text.trim())).size, 'nine distinct codes').toBe(9);
      expect(codes.map((text) => text.trim())).toContain(code);

      const own = cards.filter({ has: regie.page.locator('.c-knock__code', { hasText: code }) });
      await expect(own).toHaveCount(1);
      await own.getByRole('button', { name: 'Allow' }).click();
      await laptop.waitConnected();
      const stored = await laptop.waitForStoredDevice();
      expect((await snapshotOf(api, production.id)).devices.map((device) => device.id)).toEqual([stored.deviceId]);
      await expect(cards, 'the other eight stay pending').toHaveCount(8);
    },
  );

  test(
    'E2E-PAIR-09 [ui] double approve: two operators click “Allow” at once, exactly one device, no error toast, the card is gone for both within 1 s',
    t.p0,
    async ({ regie, openRegie, openLaptop, api, production }) => {
      test.setTimeout(120_000);
      const other = await openRegie();
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      await openPairingTab(other, 'laptop');
      await expect(regie.knockCard('Laptop Anna')).toBeVisible();
      await expect(other.knockCard('Laptop Anna')).toBeVisible();
      const statuses: number[] = [];
      for (const page of [regie.page, other.page]) page.on('response', (response) => {
        if (/\/pairing\/requests\/[^/]+\/approve$/.test(response.url())) statuses.push(response.status());
      });
      // Both buttons are resolved first and clicked in the same instant: a click that waits for its actionability checks
      // can find the card already removed by the other operator's approval and never land.
      const allow = [regie, other].map((operator) => operator.knockCard('Laptop Anna').getByRole('button', { name: 'Allow' }));
      for (const button of allow) await expect(button).toBeEnabled();
      await Promise.all(allow.map((button) => button.dispatchEvent('click')));
      await expect(regie.knockCard('Laptop Anna')).toHaveCount(0, { timeout: 1500 });
      await expect(other.knockCard('Laptop Anna')).toHaveCount(0, { timeout: 1500 });
      await expect.poll(() => statuses.length, { message: 'both operators answered', timeout: 5000 }).toBe(2);
      expect(statuses.sort(), 'one wins (200), the loser is told the card is gone (404)').toEqual([200, 404]);
      for (const operator of [regie, other]) await expect(operator.toast().filter({ hasText: /error|did not work|unknown/i }), 'no error toast').toHaveCount(0);
      await laptop.waitConnected();
      expect((await snapshotOf(api, production.id)).devices, 'exactly one device').toHaveLength(1);
      await expect(regie.page.locator('.c-st[data-device]')).toHaveCount(1);
    },
  );

  test(
    'E2E-PAIR-18 [ui] a second operator sees the knock card and the new station live within a second',
    t.p2,
    async ({ regie, openRegie, openLaptop }) => {
      test.setTimeout(120_000);
      const other = await openRegie();
      await openPairingTab(regie, 'laptop');
      await openPairingTab(other, 'laptop');
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      await laptop.checkCode();
      await expect(regie.knockCard('Laptop Anna')).toBeVisible();
      await expect(other.knockCard('Laptop Anna'), 'the card appears in B within 1 s of A seeing it').toBeVisible({ timeout: 1500 });
      await regie.approveKnock('Laptop Anna');
      await expect(other.knockCard('Laptop Anna'), 'it disappears in B within 1 s').toHaveCount(0, { timeout: 1500 });
      await laptop.waitConnected();
      await expect(regie.station('Laptop Anna')).toBeVisible();
      await expect(other.station('Laptop Anna'), 'the new station appears in both').toBeVisible({ timeout: 5000 });
    },
  );

  test(
    'E2E-PAIR-19 [ui] pairing while the Regie reconnects: the card is shown once after the resubscription',
    t.p2,
    async ({ regie, openLaptop }) => {
      test.setTimeout(120_000);
      await openPairingTab(regie, 'laptop');
      await net.cut(regie.page.context());
      await regie.waitForHub('reconnecting', 15_000).catch(() => undefined);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Anna', 'laptop');
      await laptop.checkCode();
      await sleep(1500);
      await net.restore(regie.page.context());
      await regie.waitForHub('connected', 30_000);
      await expect(regie.knockCard('Laptop Anna')).toBeVisible({ timeout: 10_000 });
      await expect(regie.page.getByRole('group', { name: 'Pairing request' }), 'no duplicate card').toHaveCount(1);
    },
  );
});

test.describe('PAIR invite links, re-recognition, redeem', () => {
  test(
    'E2E-PAIR-10 [ui] invite link for laptops: create, copy, open: redirect, direct pairing without approval, the second context gets the expired page',
    t.smoke,
    async ({ regie, openLaptop, api, production, config }) => {
      test.setTimeout(120_000);
      await openPairingTab(regie, 'link');
      await regie.page.getByRole('button', { name: 'Create link' }).click();
      await expect(regie.toast()).toContainText('Invite link created');
      const shown = regie.page.locator('.c-pair__url--wrap');
      // The secret part is hidden until “Show link”.
      await expect(shown).toHaveText(/\/j\/•+$/);
      await regie.page.getByRole('button', { name: 'Show link' }).click();
      await expect(regie.page.getByRole('button', { name: 'Show link' })).toHaveAttribute('aria-pressed', 'true');
      await expect(shown).toHaveText(/\/j\/[A-Za-z0-9_-]{20,}$/);
      const text = (await shown.textContent())!.trim();
      await expect(regie.page.locator('.c-hint').filter({ hasText: 'Valid once and' })).toHaveText(/Valid once and expires in (30|29) minutes\. Whoever opens it is paired straight away\./);
      await regie.page.getByRole('button', { name: 'Copy' }).click();
      await expect(regie.toast()).toContainText(`Copied: ${text}`);
      const clipboard = await regie.page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard, 'the clipboard holds the full link').toBe(`${config.baseURL}/j/${text.split('/j/')[1]}`);
      const invites = (await snapshotOf(api, production.id)).invites.filter((invite) => invite.kind === 'laptopLink');
      expect(invites).toHaveLength(1);
      expect(invites[0]!.url).toBe(clipboard);

      const first = await openLaptop();
      const second = await openLaptop();
      await first.gotoInvite(clipboard);
      await first.waitConnected();
      const stored = await first.waitForStoredDevice();
      expect(new URL(first.page.url()).pathname, 'the token is gone from the address bar').toBe('/join/station');
      expect(first.page.url()).not.toContain(clipboard.split('/j/')[1]!);
      await expect(regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`), 'paired without an approval').toBeVisible();
      await expect(regie.page.locator('.c-knock')).toHaveCount(0);

      await second.gotoInvite(clipboard);
      await expect(second.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 20_000 });
      await expect(second.page.getByRole('link', { name: 'Pair with a check code' })).toHaveAttribute('href', /\/join\/?$/);
      expect(await second.storedDevice()).toBeNull();
      // The used link left the Regie.
      await expect(regie.page.locator('.c-pair__big-url'), 'a used link is gone from the Regie').toHaveCount(0);
    },
  );

  test(
    'E2E-PAIR-11 [ui] “Revoke link”: toast, the link opens the expired page, no invite is listed, the creation is in the log',
    t.p1,
    async ({ regie, openLaptop, api, production }) => {
      test.setTimeout(120_000);
      await openPairingTab(regie, 'link');
      await regie.page.getByRole('button', { name: 'Create link' }).click();
      const invite = (await snapshotOf(api, production.id)).invites.find((candidate) => candidate.kind === 'laptopLink')!;
      await regie.page.getByRole('button', { name: 'Revoke link' }).click();
      await expect(regie.toast()).toContainText('Invite link revoked');
      await expect(regie.page.locator('.c-pair__big-url')).toHaveCount(0);
      await expect(regie.page.locator('.c-pair__invites')).toHaveCount(0);
      expect((await snapshotOf(api, production.id)).invites.filter((candidate) => candidate.kind === 'laptopLink')).toHaveLength(0);
      const laptop = await openLaptop();
      await laptop.gotoInvite(invite.url);
      await expect(laptop.page.getByTestId('pairing-expired')).toBeVisible({ timeout: 20_000 });
      expect(await logTexts(api, production)).toContain('Invite link created');
      // Another link in the list can be revoked from the list as well.
      await regie.page.getByRole('button', { name: 'Create link' }).click();
      await regie.page.getByRole('button', { name: 'Create another link' }).click();
      await expect(regie.page.locator('.c-pair__invites li')).toHaveCount(1);
      await regie.page.locator('.c-pair__invites').getByRole('button', { name: /Revoke invite/ }).click();
      await expect(regie.page.locator('.c-pair__invites li')).toHaveCount(0);
    },
  );

  test(
    'E2E-PAIR-13 [ui] re-recognition: a reload goes straight to the station (same device, no duplicate); cleared storage shows the form and leaves the old station listed',
    t.smoke,
    async ({ regie, openPhone, api, production }) => {
      test.setTimeout(120_000);
      const phone = await openPhone({ profile: 'pixel7' });
      const paired = await pairPhoneViaQr(regie, phone);
      await phone.waitForCamera('live', 45_000);
      const before = paired.stored;
      await phone.page.goto('/join/');
      await phone.waitConnected();
      expect(new URL(phone.page.url()).pathname, 'straight to the station').toBe('/join/station');
      expect((await phone.waitForStoredDevice()).deviceId).toBe(before.deviceId);
      await phone.waitForCamera('live', 45_000);
      await expect(regie.page.locator('.c-st[data-device]'), 'no duplicate station').toHaveCount(1);
      expect((await snapshotOf(api, production.id)).devices).toHaveLength(1);
      await expect(paired.row.locator('.c-code')).toHaveText('K1');

      // Storage cleared: the pairing form again; the old station stays (it was live, so it is expected back).
      await phone.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await phone.page.goto('/join/');
      await expect(phone.page.getByRole('heading', { name: 'Pair device' })).toBeVisible();
      await expect(phone.page.getByLabel('Device name')).toBeVisible();
      await expect.poll(async () => (await readPlaces(regie.page)).stations.length, { message: 'the old station stays listed', timeout: 10_000 }).toBe(1);
      expect((await snapshotOf(api, production.id)).devices, 'the old station is not removed').toHaveLength(1);
    },
  );

  test(
    'E2E-PAIR-14 [ui] a lost redeem response: the sender retries with the same client id and ends up paired exactly once',
    t.p1,
    async ({ regie, openPhone, api, production }) => {
      test.setTimeout(120_000);
      const invite = (await api.getPhoneInvite(production.id)).body;
      // Service workers blocked: once the sender's service worker controls the page, page.route no longer sees its requests.
      const phone = await openPhone({ profile: 'pixel7', context: { serviceWorkers: 'block' } });
      let attempts = 0;
      const clientIds: string[] = [];
      await phone.page.route('**/api/pairing/invites/*/redeem', async (route) => {
        attempts += 1;
        clientIds.push(JSON.parse(route.request().postData() ?? '{}').clientId);
        if (attempts === 1) {
          // The request reaches the server, the answer is lost.
          await route.fetch();
          await route.abort('connectionreset');
          return;
        }
        await route.fallback();
      });
      await phone.gotoInvite(invite.url);
      await phone.waitConnected(60_000);
      const stored = await phone.waitForStoredDevice();
      expect(attempts, 'the sender asked again').toBeGreaterThanOrEqual(2);
      expect(new Set(clientIds).size, 'the same client id on every attempt').toBe(1);
      expect((await snapshotOf(api, production.id)).devices.map((device) => device.id), 'exactly one device').toEqual([stored.deviceId]);
      await expect(regie.page.locator('.c-st[data-device]')).toHaveCount(1);
    },
  );
});

test.describe('PAIR kind detection', () => {
  const cases = [
    { name: 'Desktop Chrome', options: devices['Desktop Chrome'], kind: 'laptop', os: /^Laptop / },
    { name: 'Pixel 7', options: devices['Pixel 7'], kind: 'phone', os: /^Phone / },
    { name: 'iPhone 15', options: devices['iPhone 15'], kind: 'phone', os: /^iPhone/ },
    { name: 'iPad (gen 7)', options: devices['iPad (gen 7)'], kind: 'phone', os: /^(iPad|Phone)/, noDisplayMedia: true },
  ] as const;
  for (const entry of cases) {
    test(
      `E2E-PAIR-15 [ui, ${entry.name}] kind detection: the default is a ${entry.kind}, the toggle changes it, the platform text is “<system> · <browser>”`,
      t.p1,
      async ({ browser, api, production, onCleanup }, testInfo) => {
        const { defaultBrowserType: _ignored, ...options } = entry.options;
        void _ignored;
        const { newUiContext } = await import('../../support/ui/init');
        const context = await newUiContext(browser, { context: { ...options } });
        onCleanup(() => context.close());
        // Safari on an iPad has no getDisplayMedia; the Chromium emulation has, so it is taken away to be like the device.
        if ('noDisplayMedia' in entry) await context.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }));
        const page = await context.newPage();
        await page.goto('/join/');
        const phoneRadio = page.getByRole('radio', { name: 'Phone camera' });
        const laptopRadio = page.getByRole('radio', { name: 'Laptop screen' });
        await expect(phoneRadio).toBeVisible();
        expect(await phoneRadio.isChecked(), `${entry.name} defaults to ${entry.kind}`).toBe(entry.kind === 'phone');
        await expect(page.getByLabel('Device name')).toHaveValue(entry.os);
        // The toggle switches the kind.
        const other = entry.kind === 'phone' ? laptopRadio : phoneRadio;
        await other.check();
        await expect(other).toBeChecked();
        await (entry.kind === 'phone' ? phoneRadio : laptopRadio).check();
        await page.getByLabel('Device name').fill(`Test ${entry.name}`.slice(0, 40));
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('check-code')).toBeVisible();
        const request = (await snapshotOf(api, production.id)).pairingRequests.at(-1)!;
        testInfo.annotations.push({ type: 'device', description: `${entry.name}: platform “${request.platform}”, kind ${request.kind}` });
        expect(request.platform, 'platform text').toMatch(/^[\w .()-]+ · (Chrome|Edge|Firefox|Safari)$/);
        expect(request.kind).toBe(entry.kind);
        const pending = (await snapshotOf(api, production.id)).pairingRequests;
        for (const candidate of pending) {
          const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('studioflow.pairing') ?? '{}').pollToken as string | undefined);
          if (token) production.pendingRequests.push({ requestId: candidate.id, pollToken: token });
        }
        await page.getByRole('button', { name: 'Cancel' }).click();
      },
    );
  }
});

test.describe('PAIR fleet', () => {
  test(
    'E2E-PAIR-17 [ui] rehearsal webinar fleet: three phones by QR, two laptops (code and link), all five live in one scene on the output, one chip “All 5 stations ok”',
    t.p0,
    async ({ regie, openPhone, openLaptop, openOutput, api, production }, testInfo) => {
      test.setTimeout(300_000);
      const phones = [];
      for (let index = 0; index < 3; index++) {
        const phone = await openPhone({ profile: 'pixel7' });
        phones.push(await pairPhoneViaQr(regie, phone));
      }
      const byCode = await openLaptop();
      const viaCode = await pairLaptopViaKnock(regie, byCode, 'Laptop Code');
      // Laptop 2 by invite link.
      await openPairingTab(regie, 'link');
      await regie.page.getByRole('button', { name: 'Create link' }).click();
      const inviteUrl = (await snapshotOf(api, production.id)).invites.find((invite) => invite.kind === 'laptopLink')!.url;
      const byLink = await openLaptop();
      await byLink.gotoInvite(inviteUrl);
      await byLink.waitConnected();
      const linkStored = await byLink.waitForStoredDevice();
      for (const phone of phones) await phone.sender.waitForCamera('live', 60_000);
      await byCode.shareScreen();
      await byCode.waitForSlot('screen-1', 'live', 30_000);
      await byLink.shareScreen();
      await byLink.waitForSlot('screen-1', 'live', 30_000);

      const snapshot = await snapshotOf(api, production.id);
      const codes = snapshot.sources.map((source) => source.code).sort();
      expect(codes).toEqual(['K1', 'K2', 'K3', 'S1', 'S2']);
      // Scene “Rehearsal” with all five sources.
      const sceneId = production.sceneIds[0]!;
      await api.updateScene(production.id, sceneId, { name: 'Rehearsal' });
      const rects = [
        { x: 0, y: 0, w: 640, h: 360 },
        { x: 640, y: 0, w: 640, h: 360 },
        { x: 1280, y: 0, w: 640, h: 360 },
        { x: 0, y: 360, w: 960, h: 540 },
        { x: 960, y: 360, w: 960, h: 540 },
      ];
      const sourceIds = [...phones.map((phone) => phone.stored.deviceId + '/camera'), `${viaCode.stored.deviceId}/screen-1`, `${linkStored.deviceId}/screen-1`];
      for (const [index, sourceId] of sourceIds.entries()) await putInScene(api, production, 0, sourceId, { ...rects[index]!, fit: 'cover' });
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      const startedAt = Date.now();
      await output.waitForPlayingVideos(5, { timeout: 60_000, minFps: 5 });
      testInfo.annotations.push({ type: 'measurement', description: `five playing videos on the output after ${Date.now() - startedAt} ms (output opened with all five live)` });
      await expect.poll(async () => (await readPlaces(regie.page)).header.text, { message: 'health chip', timeout: 20_000 }).toBe('All 5 devices OK');
      expect((await readPlaces(regie.page)).strip, 'no incident').toHaveLength(0);
    },
  );
});

test.describe('PAIR entry points', () => {
  test(
    'E2E-PAIR-20 [ui] the short URLs serve the sender: /join, /join/, /join/waiting, /join/station and a deep link show the pairing form or the expired page, /j/{token} redirects to /join/i/{token}',
    t.p1,
    async ({ openPhone, config }) => {
      const phone = await openPhone({ profile: 'pixel7' });
      const page = phone.page;
      for (const entry of ['/join', '/join/', '/join/waiting', '/join/station', '/join/anything/unknown']) {
        const response = await page.goto(entry);
        expect(response?.status(), `${entry} is served`).toBeLessThan(400);
        expect(await page.title(), `${entry}: the sender shell`).toBe('StudioFlow Sender');
        await expect(page.getByRole('heading', { name: 'Pair device' }), `${entry}: an unpaired browser sees the pairing form, not a server error`).toBeVisible();
      }
      const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
      const invite = await page.goto(`/join/i/${token}`);
      expect(invite?.status()).toBeLessThan(400);
      await expect(page.getByTestId('pairing-expired'), 'an unknown invite opens the expired page').toBeVisible({ timeout: 20_000 });
      const redirect = await page.request.get(`${config.baseURL}/j/${token}`, { maxRedirects: 0 });
      expect(redirect.status(), '/j/{token} redirects').toBeGreaterThanOrEqual(300);
      expect(redirect.status()).toBeLessThan(400);
      expect(new URL(redirect.headers()['location']!, config.baseURL).pathname).toBe(`/join/i/${token}`);
      // The link in a browser ends on the redeem page.
      await page.goto(`${config.baseURL}/j/${token}`);
      await expect(page).toHaveURL(new RegExp(`/join/i/${token}$`));
    },
  );
});

/** The production snapshot from the API (the Regie's own state is read through the DOM). */
async function snapshotOf(api: { getSnapshot(id: string): Promise<{ body: import('../../support/api').ProductionSnapshot }> }, id: string) {
  return (await api.getSnapshot(id)).body;
}
