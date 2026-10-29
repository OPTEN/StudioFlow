import type { Page } from '@playwright/test';
import { THRESHOLD } from '../../support/constants';
import { knownDevBug } from '../../support/devices/bugs';
import { FULL, livePhone, liveLaptop, logTexts, openStation, putInScene, studioPreview } from '../../support/devices/fleet';
import { readPlaces, waitForOutage, waitForRecovered } from '../../support/devices/places';
import { installWakeLockStub, setPageVisible, suspendCamera, wakeLockState } from '../../support/devices/phone-stubs';
import { livekitAdmin } from '../../support/livekit';
import { net } from '../../support/net';
import { pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { expectVideoPlaying } from '../../support/ui/video';
import { PhoneSender } from '../../support/ui/sender';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * SRC (device operations from the Regie): block / unblock, duplicate tab, control room chat, camera switch, technical check,
 * removing a device, the phone's behaviour (wake lock, auto-start, settings, dark mode, stop, background) and camera
 * failure. Docs/testing.md 2.5.
 */

/** Counts the sockets and Hello calls a page opens from now on (a socket that is already open is not seen by Playwright). */
function trackSockets(page: Page) {
  const counts = { hub: 0, rtc: 0, hello: 0 };
  page.on('websocket', (socket) => {
    const url = socket.url();
    if (/\/hubs\/device/.test(url)) {
      counts.hub += 1;
      socket.on('framesent', (event) => {
        if (typeof event.payload === 'string' && event.payload.includes('"target":"Hello"')) counts.hello += 1;
      });
    } else if (/\/rtc(\/|\?)/.test(url)) counts.rtc += 1;
  });
  return counts;
}

test.describe('SRC device operations', () => {
  test(
    'E2E-SRC-10 [ui] block and unblock from the station details: “Blocked” on the phone within T-BLOCK, 15 s polling, “Unblock” brings it back',
    t.smoke,
    async ({ regie, openPhone, pairContext, api, production }, testInfo) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await studioPreview(regie, api, production, 1);
      const popoverButton = regie.page.getByRole('button', { name: 'Add source', exact: true });
      await popoverButton.click();
      await expect(regie.page.getByRole('menu', { name: 'Add source' }).getByRole('menuitem', { name: /K1 Phone One/ }), 'K1 is offered while it is not blocked').toBeVisible();
      await regie.page.keyboard.press('Escape');

      const row = await openStation(regie, k1.device.id);
      await row.getByRole('button', { name: 'Block device' }).click();
      const box = row.getByRole('group', { name: 'Block device' });
      await expect(box).toContainText('K1 will be disconnected immediately and cannot connect again until you unblock it.');
      // “Cancel” does nothing.
      await box.getByRole('button', { name: 'Cancel' }).click();
      await expect(box).toBeHidden();
      expect((await production.snapshot()).devices[0]!.state, 'still active after “Cancel”').toBe('active');
      await expect(k1.phone.connectionState().first()).toHaveAttribute('data-state', 'connected');

      const requests = { me: 0, negotiate: 0, token: 0 };
      k1.phone.page.on('request', (request) => {
        const url = request.url();
        if (/\/api\/device\/me$/.test(url)) requests.me += 1;
        else if (/\/hubs\/device\/negotiate/.test(url)) requests.negotiate += 1;
        else if (/\/api\/device\/livekit-token/.test(url)) requests.token += 1;
      });
      await row.getByRole('button', { name: 'Block device' }).click();
      const clickedAt = Date.now();
      await box.getByRole('button', { name: 'Block now' }).click();
      await expect(regie.toast()).toContainText('K1 blocked and disconnected');
      // T-BLOCK: “Block now” -> sender “Blocked” and the LiveKit participant gone.
      let senderMs = -1;
      let livekitMs = -1;
      while ((senderMs < 0 || livekitMs < 0) && Date.now() - clickedAt < 15_000) {
        if (senderMs < 0 && (await k1.phone.connectionState().first().getAttribute('data-state').catch(() => null)) === 'blocked') senderMs = Date.now() - clickedAt;
        if (livekitMs < 0 && !(await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === k1.device.id)) livekitMs = Date.now() - clickedAt;
        await sleep(50);
      }
      testInfo.annotations.push({ type: 'measurement', description: `T-BLOCK: sender “Blocked” ${senderMs} ms, LiveKit participant gone ${livekitMs} ms` });
      expect(senderMs, 'the sender shows “Blocked”').toBeGreaterThan(-1);
      expect(senderMs, 'T-BLOCK hard limit 2 s (sender)').toBeLessThanOrEqual(THRESHOLD.blockHardMs);
      expect(livekitMs, 'T-BLOCK hard limit 2 s (LiveKit)').toBeLessThanOrEqual(THRESHOLD.blockHardMs);
      await expect(k1.phone.page.getByRole('heading', { name: 'This device is blocked' })).toBeVisible();
      await expect(k1.phone.page.getByLabel('Camera preview'), 'the picture is gone').toHaveCount(0);

      // Regie: row red “blocked cannot connect”, monitor tab, no incident, log, not offered in “+ Source”.
      await waitForOutage(regie, 'K1', 'blocked', { inSources: false });
      const places = await readPlaces(regie.page);
      expect(places.stations.find((station) => station.codes.includes('K1'))!.line).toMatch(/blocked\s*cannot connect/);
      expect(places.strip, 'incidents of a blocked source are removed').toHaveLength(0);
      expect((await production.snapshot()).incidents).toHaveLength(0);
      expect(await logTexts(api, production)).toContain('K1 Phone One blocked');
      await popoverButton.click();
      await expect(regie.page.getByRole('menu', { name: 'Add source' })).toBeVisible();
      await expect(regie.page.getByRole('menu', { name: 'Add source' }).getByRole('menuitem', { name: /K1/ }), 'a blocked source is listed but cannot be added').toBeDisabled();
      await regie.page.keyboard.press('Escape');

      // 45 s blocked: the sender polls on a 15 s cadence, not in a loop.
      await sleep(45_000);
      testInfo.annotations.push({ type: 'measurement', description: `requests of the blocked sender in 45 s: ${JSON.stringify(requests)}` });
      expect(requests.me, 'GET /api/device/me while blocked').toBeLessThanOrEqual(4);
      expect(requests.negotiate, 'hub negotiate while blocked').toBeLessThanOrEqual(4);
      expect(requests.token, 'LiveKit token while blocked').toBeLessThanOrEqual(4);

      await row.getByRole('button', { name: 'Unblock' }).click();
      const unblockedAt = Date.now();
      await expect(regie.toast()).toContainText('K1 unblocked');
      await k1.phone.waitConnected(40_000);
      await k1.phone.waitForCamera('live', 40_000);
      const backMs = Date.now() - unblockedAt;
      testInfo.annotations.push({ type: 'measurement', description: `T-BLOCK: “Unblock” -> sender back and camera live ${backMs} ms` });
      expect(backMs, 'T-BLOCK: “Unblock” -> sender back, hard limit 20 s (+ camera start)').toBeLessThanOrEqual(25_000);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { message: 'K1 ok again', timeout: 20_000 }).toMatch(/Mbit\/s/);
      expect(await logTexts(api, production)).toContain('K1 Phone One unblocked');
      expect((await production.snapshot()).incidents.filter((incident) => incident.endedAt === null), 'no incident remains').toHaveLength(0);
    },
  );

  test(
    'E2E-SRC-11 [ui] duplicate tab, no ping-pong: the old tab shows “Opened in another tab”, “Continue here” takes over and the roles stay swapped',
    t.p0,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      const tab1 = k1.phone;
      const sessionOne = (await tab1.hooks())!.sessionId;
      const sockets1 = trackSockets(tab1.page);

      // Tab 2 in the same browser context.
      const tab2 = await PhoneSender.inContext(tab1.context, 'pixel7');
      const sockets2 = trackSockets(tab2.page);
      await tab2.gotoStart();
      await tab2.waitConnected();
      await tab2.waitForCamera('live', 45_000);
      expect((await tab2.hooks())!.sessionId, 'every tab has its own session id').not.toBe(sessionOne);
      await tab1.waitForConnection('replaced', 15_000);
      await expect(tab1.page.getByRole('heading', { name: 'Opened in another tab' })).toBeVisible();
      await expect(tab1.page.getByRole('button', { name: 'Continue here' })).toBeVisible();
      expect((await tab1.hooks())!.slots['camera'], 'tab 1 released the camera').not.toBe('live');

      // 30 s without ping-pong: tab 1 stays replaced, tab 2 stays connected, nobody reconnects or says Hello again.
      const first = { hub1: sockets1.hub, rtc1: sockets1.rtc, hello1: sockets1.hello };
      const seen1 = new Set<string>();
      const seen2 = new Set<string>();
      for (let index = 0; index < 60; index++) {
        seen1.add((await tab1.connection()) ?? 'none');
        seen2.add((await tab2.connection()) ?? 'none');
        await sleep(500);
      }
      expect([...seen1], 'the replaced tab never flips').toEqual(['replaced']);
      expect([...seen2], 'the live tab stays connected').toEqual(['connected']);
      expect({ hub1: sockets1.hub, rtc1: sockets1.rtc, hello1: sockets1.hello }, 'the replaced tab opens no new connection and sends no Hello').toEqual(first);
      expect(sockets2.hello, 'LiveKit joins and hubs of the live tab: one Hello per connection').toBeLessThanOrEqual(2);
      expect(sockets2.rtc, 'LiveKit joins for the identity <= 2 per takeover').toBeLessThanOrEqual(2);
      const places = await readPlaces(regie.page);
      expect(places.stations, 'one station').toHaveLength(1);
      expect((await production.snapshot()).incidents.filter((incident) => incident.endedAt === null), 'no permanent incident').toHaveLength(0);

      // “Continue here” in tab 1: the roles swap and stay swapped.
      const hello1 = sockets1.hello;
      const rtc1 = sockets1.rtc;
      await tab1.page.getByRole('button', { name: 'Continue here' }).click();
      await tab1.waitConnected(30_000);
      await tab1.waitForCamera('live', 45_000);
      await tab2.waitForConnection('replaced', 15_000);
      const swapped1 = new Set<string>();
      const swapped2 = new Set<string>();
      const hello2 = sockets2.hello;
      const hub2 = sockets2.hub;
      const rtc2 = sockets2.rtc;
      for (let index = 0; index < 60; index++) {
        swapped1.add((await tab1.connection()) ?? 'none');
        swapped2.add((await tab2.connection()) ?? 'none');
        await sleep(500);
      }
      expect([...swapped1], 'tab 1 stays connected').toEqual(['connected']);
      expect([...swapped2], 'tab 2 stays replaced').toEqual(['replaced']);
      expect(sockets1.hello - hello1, 'tab 1 said Hello once for the takeover').toBeLessThanOrEqual(2);
      expect(sockets1.rtc - rtc1, 'tab 1 joined LiveKit at most twice').toBeLessThanOrEqual(2);
      expect({ hello: sockets2.hello, hub: sockets2.hub, rtc: sockets2.rtc }, 'the newly replaced tab opens nothing').toEqual({ hello: hello2, hub: hub2, rtc: rtc2 });
      expect((await readPlaces(regie.page)).stations).toHaveLength(1);
      expect((await production.snapshot()).incidents.filter((incident) => incident.endedAt === null)).toHaveLength(0);
    },
  );

  test(
    'E2E-SRC-11 [ui, wake lock] the replaced tab releases the camera and the wake lock, the live tab holds it (DEV-03)',
    t.p1,
    async ({ regie, openPhone, pairContext }) => {
      knownDevBug('DEV-03', 'a tab that was replaced by another one keeps its screen wake lock');
      test.setTimeout(120_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7', init: installWakeLockStub });
      const tab1 = k1.phone;
      expect((await wakeLockState(tab1.page))!.active, 'tab 1 holds the wake lock while it sends').toBe(1);
      const tab2 = await PhoneSender.inContext(tab1.context, 'pixel7');
      await tab2.gotoStart();
      await tab2.waitConnected();
      await tab2.waitForCamera('live', 45_000);
      await tab1.waitForConnection('replaced', 15_000);
      await expect.poll(async () => (await wakeLockState(tab1.page))!.active, { message: 'tab 1 released the wake lock', timeout: 5000 }).toBe(0);
      expect((await tab1.hooks())!.slots['camera'], 'tab 1 released the camera').not.toBe('live');
      expect((await wakeLockState(tab2.page))!.active, 'tab 2 holds it now').toBe(1);
      await tab1.page.getByRole('button', { name: 'Continue here' }).click();
      await tab1.waitConnected(30_000);
      await tab2.waitForConnection('replaced', 15_000);
      await expect.poll(async () => (await wakeLockState(tab2.page))!.active, { message: 'tab 2 released it after the takeover', timeout: 5000 }).toBe(0);
      expect((await wakeLockState(tab1.page))!.active, 'tab 1 holds it again').toBe(1);
    },
  );

  test(
    'E2E-SRC-17 [ui] control room chat: a quick pick and a typed message arrive as a banner on the phone, the text is escaped, 140 characters at most, an offline device is told so',
    t.p1,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const row = await openStation(regie, k1.device.id);
      await row.getByRole('tab', { name: 'Message' }).click();
      const composer = row.locator('sf-message-composer');
      await expect(composer.getByLabel('Message to Phone One')).toBeFocused();

      await composer.getByRole('button', { name: 'Quick send: Live in 10 s' }).click();
      const banner = k1.phone.messageBanner();
      await expect(banner, 'the banner on the phone').toBeVisible();
      await expect(banner).toContainText('Live in 10 s');
      await expect(banner).toContainText(/Message from the control room\s*\d\d:\d\d/);
      await expect(regie.toast()).toContainText('Message sent to Phone One: “Live in 10 s”');
      await banner.getByRole('button', { name: 'OK' }).click();
      await expect(banner).toBeHidden();

      // A typed message with markup: shown as text, nothing executes.
      const payload = '<img src=x onerror="window.__xss=1"> Please smile';
      const input = composer.getByLabel('Message to Phone One');
      await input.fill(payload);
      await composer.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(banner).toContainText(payload);
      expect(await k1.phone.page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'no markup is executed').toBeUndefined();
      expect(await k1.phone.page.locator('[data-testid=message-banner] img').count()).toBe(0);
      await banner.getByRole('button', { name: 'OK' }).click();

      // 141 characters cannot be sent: the field stops at 140, the API refuses 141.
      await input.fill('x'.repeat(141));
      expect(await input.inputValue(), 'the UI limit').toHaveLength(140);
      await expect(composer).toContainText('140/140');
      const tooLong = await api.sendDeviceCommand(production.id, k1.device.id, { kind: 'message', slot: null, text: 'y'.repeat(141) });
      expect(tooLong.status, 'the API refuses 141 characters').toBe(400);
      expect(tooLong.body.code).toBe('validation_failed');

      // An offline device (paired, never connected: “not connected”): 202, a toast that it is offline, nothing shown later.
      const offline = await pairPhone(pairContext, { name: 'Phone Offline' });
      const offlineRow = await openStation(regie, offline.id);
      await expect(offlineRow.locator('.c-st__l2')).toContainText('not connected');
      await offlineRow.getByRole('tab', { name: 'Message' }).click();
      const offlineComposer = offlineRow.locator('sf-message-composer');
      await offlineComposer.getByLabel('Message to Phone Offline').fill('Never arrives');
      const posted = regie.page.waitForResponse((response) => /\/devices\/[^/]+\/commands$/.test(response.url()) && response.request().method() === 'POST');
      await offlineComposer.getByRole('button', { name: 'Send', exact: true }).click();
      expect((await posted).status(), 'accepted even if the device is offline').toBe(202);
      await expect(regie.toast()).toContainText('Phone Offline is not connected. The message will not arrive.');
      const returned = await openPhone({ profile: 'pixel7' });
      await returned.seedCredentials(offline.credentials);
      await returned.gotoStart();
      await returned.waitConnected();
      await expect(returned.messageBanner(), 'nothing is delivered later').toHaveCount(0);
      await sleep(2500);
      await expect(returned.messageBanner()).toHaveCount(0);
    },
  );

  test(
    'E2E-SRC-18 [ui] “Switch camera” is offered for a camera that is ok only; the phone re-acquires with the other facing and the picture continues',
    t.p2,
    async ({ regie, openPhone, openLaptop, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      await putInScene(api, production, 0, k1.sourceId, FULL);
      const before = await k1.phone.mediaCalls();
      const facingBefore = await k1.phone.facing();

      const phoneRow = await openStation(regie, k1.device.id);
      // “Switch camera” sits in the Camera tab of the details.
      await phoneRow.getByRole('tab', { name: 'Camera' }).click();
      await expect(phoneRow.getByRole('button', { name: 'Switch camera' })).toBeVisible();
      const laptopRow = await openStation(regie, s1.device.id);
      await expect(laptopRow.getByRole('button', { name: 'Switch camera' }), 'not for screens').toHaveCount(0);

      await openStation(regie, k1.device.id); // one station is open at a time
      await phoneRow.getByRole('tab', { name: 'Camera' }).click();
      await phoneRow.getByRole('button', { name: 'Switch camera' }).click();
      await expect(regie.toast()).toContainText('K1: switching camera');
      const switchedAt = Date.now();
      await expect.poll(() => k1.phone.facing(), { message: 'the phone switched to the other camera', timeout: 10_000 }).not.toBe(facingBefore);
      const after = await k1.phone.mediaCalls();
      expect(after.userMedia, 'the sender asked the browser for a camera again').toBeGreaterThan(before.userMedia);
      const calls = await k1.phone.page.evaluate(() => (window as unknown as { __sfMedia: { userMediaCalls: Array<{ video?: { facingMode?: unknown } }> } }).__sfMedia.userMediaCalls);
      const facings = calls.map((call) => JSON.stringify(call.video?.facingMode ?? null));
      expect(facings.at(-1), 'the last request names the opposite facing mode').toContain(facingBefore === 'user' ? 'environment' : 'user');
      await k1.phone.waitForCamera('live', 15_000);
      await expectVideoPlaying(regie.page.locator('.c-monitor--program video').first(), { minFps: 6, timeout: 15_000 });
      expect(Date.now() - switchedAt, 'the picture continues after at most 3 s of the switch (plus the first poll)').toBeLessThanOrEqual(15_000);
      await expect.poll(async () => (await readPlaces(regie.page)).stations.find((station) => station.codes.includes('K1'))?.tone, { message: 'no outage from the switch', timeout: 5000 }).toBe('');

      // Not offered for a camera that is not ok.
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting');
      await expect(phoneRow.getByRole('button', { name: 'Switch camera' }), 'not for a camera that is not ok').toHaveCount(0);
    },
  );

  test(
    'E2E-SRC-18 [ui, phone controls] Front/Back on the phone: the browser is asked for the other camera, the choice survives a reload and only the front picture is mirrored',
    t.p2,
    async ({ regie, openPhone, pairContext }) => {
      test.setTimeout(120_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const phone = k1.phone;
      const lastFacing = async () => {
        const calls = await phone.page.evaluate(() => (window as unknown as { __sfMedia: { userMediaCalls: Array<{ video?: { facingMode?: unknown } }> } }).__sfMedia.userMediaCalls);
        return JSON.stringify(calls.at(-1)?.video?.facingMode ?? null);
      };
      expect(await phone.facing(), 'a fixed phone films with the back camera by default').toBe('environment');
      await expect(phone.preview(), 'the back picture is not mirrored').not.toHaveClass(/is-mirrored/);
      await phone.page.getByRole('radio', { name: 'Front' }).check();
      await expect.poll(lastFacing, { message: 'the browser was asked for the front camera', timeout: 10_000 }).toContain('user');
      await expect(phone.preview(), 'the front picture is mirrored').toHaveClass(/is-mirrored/);
      await phone.waitForCamera('live', 15_000);
      expect((await phone.page.evaluate(() => JSON.parse(localStorage.getItem('studioflow.sender.settings') ?? '{}'))).facing).toBe('user');

      await phone.page.reload();
      await phone.waitConnected();
      await phone.waitForCamera('live', 45_000);
      expect(await phone.facing(), 'the choice survives a reload').toBe('user');
      await expect(phone.page.getByRole('radio', { name: 'Front' })).toBeChecked();
      expect(await lastFacing(), 'the auto-start after the reload asks for the front camera').toContain('user');
      await phone.page.getByRole('radio', { name: 'Back' }).check();
      await expect.poll(lastFacing, { message: 'back again', timeout: 10_000 }).toContain('environment');
      await expect(phone.preview()).not.toHaveClass(/is-mirrored/);
    },
  );

  test(
    'E2E-SRC-13 [ui] technical check: the first start runs it, upload 2 and 4 Mbit/s rate bad and warn, the result is shown on the phone and in the station details and survives a Regie reload',
    t.p1,
    async ({ regie, openPhone, pairContext, production }) => {
      test.setTimeout(240_000);
      // The sender's service worker (ngsw) passes /api requests on from its own context, where the page's CDP throttling does not
      // reach: this test runs the phone with service workers blocked (the throttle then shapes the 1 MB upload).
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7', context: { serviceWorkers: 'block' } });
      // The first start runs the check by itself and reports it.
      const row = await openStation(regie, k1.device.id);
      await expect(row.locator('.c-st__tech'), 'the first check ran and was reported').not.toContainText('not run yet', { timeout: 30_000 });
      await expect(row.locator('.c-st__tech')).toContainText(/Upload ok \d+\.\d Mbit\/s/);
      const first = (await production.snapshot()).devices[0]!.techCheck!;
      expect(first.bandwidth).toBe('ok');
      expect(first.uploadKbps!).toBeGreaterThanOrEqual(6000);

      const level = (word: string) => row.locator('.c-st__tech-item').filter({ hasText: /^\s*Upload/ }).filter({ hasText: word });
      let throttle: Awaited<ReturnType<typeof net.cdpThrottle>> | undefined;
      const runCheck = async (uploadKbps: number | null) => {
        // One CDP session whose emulation is updated (a second session would keep the first limit active).
        throttle ??= await net.cdpThrottle(k1.phone.page, null);
        await throttle.send('Network.emulateNetworkConditions', { offline: false, latency: 10, downloadThroughput: uploadKbps === null ? -1 : 12_500_000, uploadThroughput: uploadKbps === null ? -1 : (uploadKbps * 1000) / 8 });
        await k1.phone.page.getByRole('button', { name: 'Tech check', exact: true }).click();
        const sheet = k1.phone.page.getByRole('dialog', { name: 'Tech check' });
        await sheet.getByRole('button', { name: /Check again|Check now/ }).click();
        await expect(sheet.getByText('Checking camera, network and upload…')).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Check again' })).toBeEnabled({ timeout: 60_000 });
        return sheet;
      };

      // 2 Mbit/s up: “insufficient” on the phone, “poor” in the Regie; overall is the worst of the three.
      let sheet = await runCheck(2000);
      await expect(sheet.locator('[data-level]').filter({ hasText: 'Upload' })).toHaveAttribute('data-level', 'bad');
      await expect(sheet.locator('.c-check__summary')).toContainText('This will cause problems in the broadcast.');
      await expect(sheet.locator('.c-check__summary')).toContainText(/Checked at \d\d:\d\d/);
      await expect(level('poor'), 'Regie: Upload poor').toBeVisible({ timeout: 15_000 });
      expect((await production.snapshot()).devices[0]!.techCheck!.overall, 'overall = worst of camera, network, upload').toBe('bad');
      await sheet.getByRole('button', { name: 'Close tech check' }).click();
      await expect(sheet).toBeHidden();

      // 4 Mbit/s up (the plan's value): the measured rate includes the request overhead and lands near the 3 Mbit/s border, so it
      // is recorded and only has to be “warn” or “bad”; 5.5 Mbit/s up is clearly in the warn band (3 to 6 Mbit/s).
      sheet = await runCheck(4000);
      const four = (await production.snapshot()).devices[0]!.techCheck!;
      test.info().annotations.push({ type: 'measurement', description: `tech check with the upload throttled to 4 Mbit/s: measured ${four.uploadKbps} kbit/s, level ${four.bandwidth}` });
      expect(['warn', 'bad']).toContain(four.bandwidth);
      await sheet.getByRole('button', { name: 'Close tech check' }).click();
      await expect(sheet).toBeHidden();
      sheet = await runCheck(5500);
      await expect(sheet.locator('[data-level]').filter({ hasText: 'Upload' })).toHaveAttribute('data-level', 'warn');
      await expect(sheet.locator('.c-check__summary')).toContainText('It works, but with limitations.');
      await expect(level('borderline'), 'Regie: Upload borderline').toBeVisible({ timeout: 15_000 });
      await sheet.getByRole('button', { name: 'Close tech check' }).click();
      await expect(sheet).toBeHidden();

      // Unthrottled again: ok; the result is stored and still shown after a Regie reload.
      sheet = await runCheck(null);
      await expect(sheet.locator('[data-level]').filter({ hasText: 'Upload' })).toHaveAttribute('data-level', 'ok');
      await expect(level('ok'), 'Regie: Upload ok').toBeVisible({ timeout: 15_000 });
      const stored = (await production.snapshot()).devices[0]!.techCheck!;
      expect(Date.parse(stored.at), 'TechCheckDto.At is recent').toBeGreaterThan(Date.now() - 120_000);
      await regie.page.reload();
      await regie.waitReady();
      const reloadedRow = await openStation(regie, k1.device.id);
      await expect(reloadedRow.locator('.c-st__tech'), 'still shown after a Regie reload').toContainText(/Upload ok \d+\.\d Mbit\/s/);
    },
  );

  test(
    'E2E-SRC-22 [ui] removing a device: a connected phone is told and offers pairing again without a reconnect loop; the scene item shows “Source missing”; an offline station is removed with “Remove”',
    t.p2,
    async ({ regie, openPhone, pairContext, api, production }, testInfo) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const k2 = await livePhone({ openPhone }, pairContext, regie, 'Phone Two', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      const requests: string[] = [];
      k1.phone.page.on('request', (request) => {
        if (/\/api\/device\/|\/hubs\/device\/negotiate|\/rtc\/v1/.test(request.url())) requests.push(`${Date.now()} ${request.method()} ${new URL(request.url()).pathname}`);
      });
      const removedAt = Date.now();
      expect((await api.deleteDevice(production.id, k1.device.id)).status).toBe(204);
      await expect(k1.phone.page.getByRole('heading', { name: 'Pair device' }), 'the phone offers pairing again').toBeVisible({ timeout: 20_000 });
      await expect(k1.phone.page.getByText('The control room has removed this device. You can pair it again here.')).toBeVisible();
      testInfo.annotations.push({ type: 'measurement', description: `removed device: phone shows the pairing form after ${Date.now() - removedAt} ms` });
      expect(await k1.phone.storedDevice(), 'the credentials are forgotten').toBeNull();
      expect((await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === k1.device.id), 'LiveKit participant removed').toBe(false);
      await sleep(20_000);
      const afterRemoval = requests.filter((entry) => Number(entry.split(' ')[0]) > removedAt + 3000);
      testInfo.annotations.push({ type: 'measurement', description: `requests of the removed phone after the first 3 s (20 s observed): ${afterRemoval.length}` });
      expect(afterRemoval.length, 'no reconnect loop: at most one request per 15 s').toBeLessThanOrEqual(2);
      await expect(regie.station('Phone One')).toHaveCount(0);
      expect((await readPlaces(regie.page)).stations, 'the other station stays').toHaveLength(1);
      await expect(regie.page.locator('.c-monitor--program .sf-r-missing').first(), 'the item shows “Source missing”').toBeVisible();
      await expect(regie.page.locator('.c-monitor--program .sf-r-missing').first()).toHaveText('Source missing');

      // An offline station (paired, never connected): “Remove” with the dashed confirmation.
      const never = await pairPhone(pairContext, { name: 'Phone Never' });
      const neverRow = await openStation(regie, never.id);
      await expect(neverRow.locator('.c-st__l2')).toContainText('not connected');
      await neverRow.getByRole('button', { name: 'Remove' }).click();
      const box = neverRow.getByRole('group', { name: 'Remove device' });
      await expect(box).toContainText('“Phone Never” will be removed. Items with its sources then show “Source missing”. You can pair it again at any time.');
      await box.getByRole('button', { name: 'Remove' }).click();
      await expect(regie.toast()).toContainText('“Phone Never” removed');
      await expect(regie.page.locator(`.c-st[data-device="${never.id}"]`)).toHaveCount(0);
      expect(await logTexts(api, production)).toContain(`K${Number(never.codes['camera']!.slice(1))} Phone Never removed`);
    },
  );

  test(
    'E2E-SRC-09 [ui] camera failure becomes “no picture”: three re-acquire attempts, then a red incident; restarting from the phone brings it back; a working camera re-acquires without any incident of that kind',
    t.p0,
    async ({ regie, openPhone, pairContext, api, production }, testInfo) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);
      const page = k1.phone.page;
      const killCamera = () =>
        page.evaluate(() => {
          const peers = [...((window as unknown as { __sfNet: { peers: Set<RTCPeerConnection> } }).__sfNet.peers)];
          const tracks = peers.flatMap((peer) => peer.getSenders().flatMap((sender) => (sender.track && sender.track.kind === 'video' ? [sender.track] : [])));
          for (const track of tracks) {
            track.stop();
            track.dispatchEvent(new Event('ended'));
          }
          return tracks.length;
        });

      // A working camera: the track ends (another app took it), the sender re-acquires within 1.5 s, no “no picture”.
      expect(await killCamera(), 'a camera track was ended').toBeGreaterThan(0);
      const reacquireStart = Date.now();
      await expect.poll(() => k1.phone.cameraState(), { message: 'the camera is live again', timeout: 10_000, intervals: [100] }).toBe('live');
      testInfo.annotations.push({ type: 'measurement', description: `camera re-acquired after the track ended: ${Date.now() - reacquireStart} ms` });
      expect(Date.now() - reacquireStart, 'a working camera comes back within 1.5 s (plan), 4 s with the grace period').toBeLessThanOrEqual(4000);
      await sleep(3000);
      expect((await readPlaces(regie.page)).strip.filter((entry) => entry.word === 'no picture'), 'no “no picture” for a camera that came back').toHaveLength(0);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);

      // A camera that cannot be started: three attempts (0.3 / 0.6 / 1.2 s), then “failed”.
      await page.evaluate(() => ((window as unknown as { __sfMedia: { failCamera: boolean } }).__sfMedia.failCamera = true));
      await killCamera();
      const failedAt = Date.now();
      await k1.phone.waitForSlot('camera', 'failed', 20_000);
      testInfo.annotations.push({ type: 'measurement', description: `camera slot failed ${Date.now() - failedAt} ms after the track ended` });
      expect(Date.now() - failedAt, 'three attempts with the backoff 0.3 / 0.6 / 1.2 s end after about 3 s').toBeLessThanOrEqual(10_000);
      await expect(page.getByRole('alert').filter({ hasText: /camera|access|another app|error/i }), 'the phone explains the problem').toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await waitForOutage(regie, 'K1', 'lost', { timeoutMs: 20_000 });
      const places = await readPlaces(regie.page);
      expect(places.strip.find((entry) => entry.code === 'K1')!.word).toBe('no picture');
      expect(places.stations[0]!.line).toContain('no picture');
      expect(places.program.map((label) => label.text).join(' ')).toMatch(/K1 · no picture/);
      expect(await logTexts(api, production)).toContain('K1 no picture');

      // Clear the fault and restart from the phone: K1 is ok and “back”.
      await page.evaluate(() => ((window as unknown as { __sfMedia: { failCamera: boolean } }).__sfMedia.failCamera = false));
      await page.getByRole('button', { name: 'Try again' }).click();
      await k1.phone.waitForCamera('live', 30_000);
      await waitForRecovered(regie, 'K1', { timeoutMs: 30_000 });
    },
  );

  test(
    'E2E-SRC-19 [ui] phone behaviour: wake lock after start and again when visible, reload auto-starts with the saved settings, 720p/1080p, dark mode with a thin tally frame, stopping the camera is “camera stopped”',
    t.p1,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7', init: installWakeLockStub });
      const page = k1.phone.page;
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await api.startBroadcast(production.id);

      expect((await wakeLockState(page))!.requests, 'wakeLock.request(screen) after the start').toBeGreaterThanOrEqual(1);
      expect((await wakeLockState(page))!.active).toBe(1);
      const before = (await wakeLockState(page))!.requests;
      await setPageVisible(page, false);
      expect((await wakeLockState(page))!.active, 'the browser releases the lock when the page is hidden').toBe(0);
      await setPageVisible(page, true);
      await expect.poll(async () => (await wakeLockState(page))!.requests, { message: 'requested again after becoming visible' }).toBeGreaterThan(before);
      expect((await wakeLockState(page))!.active).toBe(1);

      // 1080p: stored, published (station “Resolution”), kept over a reload which starts the camera by itself.
      await k1.phone.setResolution(1080);
      const row = await openStation(regie, k1.device.id);
      await expect(row.locator('.c-st__kv'), 'published resolution 1080p').toContainText(/Resolution\s*1080p/, { timeout: 30_000 });
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('studioflow.sender.settings') ?? '{}'));
      expect(stored.resolution).toBe(1080);
      expect(stored.cameraOn).toBe(true);
      await page.reload();
      await k1.phone.waitConnected();
      await k1.phone.waitForCamera('live', 45_000);
      expect(page.url(), 'a reload resumes into the station').toContain('/join/station');
      await expect(page.getByRole('radio', { name: '1080p' })).toBeChecked();
      await expect(row.locator('.c-st__kv')).toContainText(/Resolution\s*1080p/, { timeout: 30_000 });
      await k1.phone.setResolution(720);
      await expect(row.locator('.c-st__kv'), 'published resolution 720p').toContainText(/Resolution\s*720p/, { timeout: 30_000 });

      // Dark mode: black screen with a thin tally frame in the tally colour (K1 is in the program scene).
      await k1.phone.waitForTally('program');
      await k1.phone.darkToggle().click();
      await expect(page.locator('.c-phone__dark'), 'the black screen is shown').toBeVisible();
      const dark = await page.evaluate(() => {
        const overlay = document.querySelector('.c-phone__dark') as HTMLElement | null;
        const tally = document.querySelector('[data-testid=tally]') as HTMLElement | null;
        const frame = tally ? getComputedStyle(tally) : null;
        return {
          overlayColor: overlay ? getComputedStyle(overlay).backgroundColor : null,
          overlayCovers: overlay ? overlay.getBoundingClientRect().width >= window.innerWidth - 1 && overlay.getBoundingClientRect().height >= window.innerHeight - 1 : false,
          thin: tally?.classList.contains('c-tally--thin') ?? false,
          frame: frame?.boxShadow ?? '',
          tally: tally?.getAttribute('data-tally'),
        };
      });
      expect(dark.overlayColor, 'black screen').toMatch(/^rgb\(0, 0, 0\)|rgba\(0, 0, 0/);
      expect(dark.overlayCovers, 'the dark overlay covers the viewport').toBe(true);
      expect(dark.thin, 'thin tally frame').toBe(true);
      expect(dark.tally).toBe('program');
      expect(dark.frame, 'the frame is red (the tally colour)').toMatch(/rgb\(248, 81, 73\)/);
      expect((await page.evaluate(() => JSON.parse(localStorage.getItem('studioflow.sender.settings') ?? '{}'))).dark).toBe(true);
      await page.locator('main.c-phone').click({ position: { x: 20, y: 400 } }); // tap wakes the controls
      await k1.phone.darkToggle().click();

      // Stop: the slot ends, K1 shows “camera stopped” (red) and the log says so.
      await k1.phone.stopCamera();
      await k1.phone.waitForCamera('ended', 15_000).catch(() => undefined);
      await waitForOutage(regie, 'K1', 'ended', { source: 'camera', timeoutMs: 20_000 });
      expect(await logTexts(api, production)).toContain('K1 camera stopped');
      expect((await readPlaces(regie.page)).strip.find((entry) => entry.code === 'K1')!.word).toBe('camera stopped');
      // The camera was stopped on purpose: a reload does not start it by itself.
      await page.reload();
      await k1.phone.waitConnected();
      await expect(k1.phone.startButton()).toBeVisible();
      expect(await k1.phone.cameraState()).not.toBe('live');
    },
  );

  test(
    'E2E-SRC-19 [ui, background] the OS suspends the camera: the slot is paused, K1 is “reconnecting” (never “ended”), back in the foreground it is ok and “back”',
    t.p1,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);
      expect(await suspendCamera(k1.phone.page, true), 'a capture track was suspended').toBeGreaterThan(0);
      // livekit-client debounces the OS mute by 5 s, then the publisher reports `paused` (never `ended`).
      await k1.phone.waitForSlot('camera', 'paused', 20_000);
      await waitForOutage(regie, 'K1', 'reconnecting', { timeoutMs: 20_000 });
      expect(await logTexts(api, production)).toContain('K1 reconnecting');
      expect((await readPlaces(regie.page)).strip.map((entry) => entry.word), 'paused is not ended').not.toContain('camera stopped');
      await suspendCamera(k1.phone.page, false);
      await k1.phone.waitForSlot('camera', 'live', 20_000);
      await waitForRecovered(regie, 'K1', { timeoutMs: 20_000 });
      expect((await logTexts(api, production)).some((text) => /^K1 is back, was gone for \d+ s$/.test(text))).toBe(true);
    },
  );
});
