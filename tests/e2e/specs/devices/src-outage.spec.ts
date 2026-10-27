import { THRESHOLD } from '../../support/constants';
import { knownDevBug } from '../../support/devices/bugs';
import { FULL, LEFT, RIGHT, livePhone, liveLaptop, logTexts, putInScene, studioPreview, openStation, type Rect } from '../../support/devices/fleet';
import { checkRecovered, readPlaces, waitForOutage, waitForRecovered } from '../../support/devices/places';
import { openStudio } from '../../support/helpers';
import { net } from '../../support/net';
import { sleep } from '../../support/shell';
import { expectVideoPlaying } from '../../support/ui/video';
import { newUiContext } from '../../support/ui/init';
import { RegiePage } from '../../support/ui/regie';
import { PixelImage, luma } from '../../support/ui/pixels';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * SRC (Regie side of phone and laptop senders), docs/testing.md 2.5: the picture of a live phone, an outage in the six
 * places, the recovery that stays until “Seen”, shared between operators, the returning source.
 *
 * Phone outage method (documented once for the whole folder): `net.cut(context)` = `context.setOffline(true)` plus closing
 * every WebSocket (device hub, LiveKit signalling) and RTCPeerConnection of that phone's browser context. It is the
 * method of docs/testing.md 1.6 ("the closest software equivalent of the Wi-Fi is gone"): HTTP, the hub and the media of
 * that phone die, nothing else does, and the connection ends with a close, so the measured time is T-DETECT-CLEAN (the
 * silent variant, where packets just stop, is in src-silent.spec.ts). `net.restore` lets the browser fire `online`.
 */

/** Sum of the decoded frames of the videos in the Program monitor (a replaced element resets its own counter). */
async function programFrames(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLVideoElement>('.c-monitor--program video')].reduce((sum, video) => sum + video.getVideoPlaybackQuality().totalVideoFrames, 0));
}

test.describe('SRC outage, phone', () => {
  test(
    'E2E-SRC-01 [ui] a live phone camera shows as ok: lamp, metrics, details, health chip, playing picture in the Program monitor',
    t.smoke,
    async ({ regie, openPhone, pairContext, api, production }, testInfo) => {
      test.setTimeout(120_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone Stage', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      expect(k1.code).toBe('K1');

      const row = await openStation(regie, k1.device.id);
      await expect(row.locator('.c-st__row .c-lamp')).not.toHaveClass(/is-(warn|bad|idle)/);
      // Line 2: “2.8 Mbit/s 31 ms” once the first telemetry is there.
      const line = row.locator('.c-st__l2');
      await expect(line, 'metrics line “<n.n> Mbit/s <n> ms”').toHaveText(/^\s*\d+\.\d\s*Mbit\/s\s*\d+\s*ms/, { timeout: 15_000 });

      const details = row.locator('.c-st__kv');
      await expect(details).toContainText('Device');
      await expect(details, 'platform text of the Pixel 7 profile (Chrome reduces the user agent: no model)').toContainText(/(Android|Pixel 7) · Chrome/);
      await expect(details).toContainText('Resolution');
      await expect(details, 'published resolution').toContainText(/720p/, { timeout: 15_000 });
      await expect(details).toContainText(/Paired\s*today \d\d:\d\d/);
      await expect(details).toContainText(/Packet loss\s*\d+\.\d%/, { timeout: 15_000 });
      const hasBattery = await k1.phone.page.evaluate(() => typeof (navigator as unknown as { getBattery?: unknown }).getBattery === 'function');
      if (hasBattery) await expect(details, 'Battery row where the Battery API exists').toContainText(/Battery\s*\d+%/, { timeout: 15_000 });

      // Docs: “All N stations ok” (regex ^All \d+ stations ok$). The product writes “1 station ok” for one station.
      const chip = (await readPlaces(regie.page)).header;
      expect(chip.text, 'health chip').toMatch(/^(All \d+ stations ok|1 station ok)$/);
      expect(chip.lamp, 'green lamp').toBe('');

      // Values change within 3 s (telemetry every 2 s).
      const first = (await line.textContent())!.replace(/\s+/g, ' ').trim();
      await expect
        .poll(async () => ((await line.textContent()) ?? '').replace(/\s+/g, ' ').trim(), { message: 'telemetry changes the line', timeout: 8_000, intervals: [250] })
        .not.toBe(first);

      const program = regie.page.locator('.c-monitor--program');
      const measured = await expectVideoPlaying(program.locator('video').first(), { minFps: 8, timeout: 30_000 });
      testInfo.annotations.push({ type: 'measurement', description: `Program monitor video of K1: ${Math.round(measured.fps)} fps, ${measured.width}x${measured.height}` });
      expect(k1.phone.problems.pageErrors, 'no uncaught error in the sender').toEqual([]);
    },
  );

  test(
    'E2E-SRC-02 [ui] a phone loses its network: the outage shows in all six places within T-DETECT-CLEAN',
    t.smoke,
    async ({ regie, openPhone, openLaptop, openOutput, pairContext, api, production }, testInfo) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const k2 = await livePhone({ openPhone }, pairContext, regie, 'Phone Two', { profile: 'pixel7' });
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      expect([k1.code, k2.code, s1.code]).toEqual(['K1', 'K2', 'S1']);
      // K1 in the program scene (A) and in the preview scene (B); K2 and S1 in scene C.
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await putInScene(api, production, 1, k1.sourceId, FULL);
      await putInScene(api, production, 2, k2.sourceId, LEFT);
      await putInScene(api, production, 2, s1.sourceId, RIGHT);
      await studioPreview(regie, api, production, 1);
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.waitForPlayingVideos(1);
      // “hold 3 s”: every station has reported at least once (metrics line), so nothing is still “connecting…”.
      for (const code of ['K1', 'K2', 'S1']) {
        await expect.poll(async () => (await readPlaces(regie.page)).stations.find((row) => row.codes.includes(code))?.line ?? '', { message: `${code} shows its metrics`, timeout: 20_000 }).toMatch(/Mbit\/s/);
      }
      await sleep(3000);
      expect((await readPlaces(regie.page)).header.text).toBe('All 3 stations ok');

      // The clock starts when the phone's connections were closed (inside its page) and stops at the DOM read of the Regie
      // that shows all six places; the round trips of the harness (CDP, polling) are not part of the product's time.
      const cut = await net.cut(k1.phone.context);
      expect(cut.clean, 'the phone closed its WebSockets with a close handshake: a clean loss, not a silent one').toBe(true);
      const outage = await waitForOutage(regie, 'K1', 'reconnecting', { inProgram: true, inPreview: true, startedAt: cut.at, timeoutMs: 15_000 });
      testInfo.annotations.push({ type: 'measurement', description: `T-DETECT-CLEAN (connections closed -> six places): ${outage.elapsedMs} ms` });
      await testInfo.attach('detect-clean.json', { body: JSON.stringify({ elapsedMs: outage.elapsedMs, detail: outage.check.detail }, null, 2), contentType: 'application/json' });
      expect(outage.elapsedMs, 'T-DETECT-CLEAN hard limit 3 s').toBeLessThanOrEqual(THRESHOLD.detectCleanHardMs);

      // The timer counts; K2 and S1 are untouched.
      const strip = outage.places.strip.find((entry) => entry.code === 'K1')!;
      expect(strip.name).toContain('Phone One');
      expect(strip.place, 'where it is on air').toBe('on Program');
      const timerA = strip.timer;
      await expect.poll(async () => (await readPlaces(regie.page)).strip.find((entry) => entry.code === 'K1')?.timer, { message: 'the timer counts', timeout: 5_000 }).not.toBe(timerA);
      for (const other of ['K2', 'S1']) {
        const station = (await readPlaces(regie.page)).stations.find((row) => row.codes.includes(other))!;
        expect(station.tone, `${other} stays calm`).toBe('');
        expect(station.line).not.toContain('reconnecting');
      }
      expect(await logTexts(api, production), 'log entry').toContain('K1 reconnecting');

      // The output keeps K1's item on the stage with its last frame (OUT-06 owns the hold timings; the output page has no
      // data-state attribute, so this only checks that the item and its video element stay).
      const items = await output.items();
      expect(items.filter((item) => item.hasVideo && item.visible).length, 'K1 is in the program scene: its item stays').toBeGreaterThanOrEqual(1);
    },
  );

  test(
    'E2E-SRC-03 [ui] the recovery stays until “Seen”: still there after 30 s, then a calm strip with the last events',
    t.smoke,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);

      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting');
      await sleep(9000); // “goOnline() after 9 s”
      await net.restore(k1.phone.context);
      const back = await waitForRecovered(regie, 'K1', { timeoutMs: 40_000 });
      expect(back.seconds, '“was gone for N s” is a number').not.toBeNull();

      const row = regie.page.locator(`.c-st[data-device="${k1.device.id}"]`);
      await expect(row.locator('.c-st__ack')).toContainText('The station is back. Confirm to dismiss the message.');
      const chip = (await readPlaces(regie.page)).header;
      expect(chip.text, 'recovered entries are no faults').toMatch(/^(All \d+ stations ok|1 station ok)$/);
      expect(chip.lamp).toBe('');

      // Nobody pressed “Seen”: the entry is still there after 30 s.
      await sleep(30_000);
      expect(checkRecovered(await readPlaces(regie.page), 'K1').ok, 'still recovered after 30 s').toBe(true);

      const logBefore = await logTexts(api, production);
      await regie.page.locator('sf-status-line').getByRole('button', { name: 'Seen' }).click();
      await expect(regie.page.locator('sf-status-line .c-status__ok')).toHaveText(/No open messages/);
      await expect(regie.page.locator('sf-status-line .c-status__label')).toHaveText('Recent events');
      const entries = (await regie.page.locator('sf-status-line .c-status__entry').allTextContents()).map((entry) => entry.replace(/\s+/g, ' ').trim());
      expect(entries.length).toBeLessThanOrEqual(4);
      expect(entries[0], 'newest first').toMatch(/^\d\d:\d\d\s*K1 is back, was gone for \d+ s$/);
      expect(entries.some((entry) => /^\d\d:\d\d\s*K1 reconnecting$/.test(entry)), 'the outage is in the last events').toBe(true);
      expect(await logTexts(api, production), 'an acknowledgement writes no log entry').toEqual(logBefore);
    },
  );

  test(
    'E2E-SRC-03 [ui, T-RECOVER-SHORT] after an outage of 9 s the picture is back within 3 s of the network (DEV-02)',
    t.p0,
    async ({ regie, openPhone, pairContext, api, production }, testInfo) => {
      knownDevBug('DEV-02', 'the media reconnect waits for an escalated SDK backoff although the network is back: 7-9 s');
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await expectVideoPlaying(regie.page.locator('.c-monitor--program video').first(), { minFps: 8, timeout: 30_000 });
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting');
      await sleep(9000);
      const baseline = await programFrames(regie.page);
      const restoredAt = Date.now();
      await net.restore(k1.phone.context);
      let framesMs = -1;
      let okMs = -1;
      let okSince = -1;
      // “ok” counts when it holds for 1 s: the false recovery of DEV-01 flashes for a few milliseconds and is replaced by a new outage.
      for (let attempt = 0; attempt < 400 && (framesMs < 0 || okMs < 0); attempt++) {
        if (framesMs < 0 && (await programFrames(regie.page)) > baseline + 3) framesMs = Date.now() - restoredAt;
        if (checkRecovered(await readPlaces(regie.page), 'K1').ok) {
          if (okSince < 0) okSince = Date.now();
          if (okMs < 0 && Date.now() - okSince >= 1000) okMs = okSince - restoredAt;
        } else okSince = -1;
        await sleep(100);
      }
      testInfo.annotations.push({ type: 'measurement', description: `T-RECOVER-SHORT (outage 9 s, network back -> frames advancing in the Program monitor ${framesMs} ms, -> ok + “back” ${okMs} ms)` });
      await testInfo.attach('recover-short.json', { body: JSON.stringify({ outageSeconds: 9, framesMs, okMs }, null, 2), contentType: 'application/json' });
      expect(framesMs, 'frames advancing again').toBeGreaterThan(-1);
      expect(framesMs, 'T-RECOVER-SHORT hard limit: network back -> frames advancing 3 s').toBeLessThanOrEqual(3000);
      expect(okMs, '“ok” after the frames, hard limit 1 s').toBeLessThanOrEqual(framesMs + 1000);
    },
  );

  test(
    'E2E-SRC-03 [ui, no false recovery] one outage is one incident: a single “reconnecting”, a single “back” with the real length (DEV-01)',
    t.p0,
    async ({ regie, openPhone, pairContext, api, production, config, onCleanup }, testInfo) => {
      knownDevBug('DEV-01', 'the first report after the hub reconnect flips the slot ok -> reconnecting: a bogus “back” and a second incident');
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);

      const cutAt = Date.now();
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting');
      await sleep(6000);
      await net.restore(k1.phone.context);
      await waitForRecovered(regie, 'K1', { timeoutMs: 40_000 });
      // Let a late flap arrive too.
      await sleep(1500);
      const backAt = Date.now();

      const log = await logTexts(api, production);
      const sourceEvents = hub
        .events()
        .filter((event) => event.type === 'sourceUpserted' && (event as unknown as { source: { code: string } }).source.code === 'K1')
        .map((event) => `${event.revision} ${(event as unknown as { source: { status: string } }).source.status}`);
      await testInfo.attach('hub-events.txt', { body: [`log: ${JSON.stringify(log.slice(0, 8))}`, `K1 source events: ${sourceEvents.join(', ')}`].join('\n'), contentType: 'text/plain' });
      expect(log.filter((text) => text === 'K1 reconnecting'), 'one outage, one “reconnecting”').toHaveLength(1);
      const recovered = log.filter((text) => /^K1 is back, was gone for \d+ s$/.test(text));
      expect(recovered, 'one outage, one “back”').toHaveLength(1);
      const seconds = Number(/was gone for (\d+) s/.exec(recovered[0]!)![1]);
      const real = (backAt - cutAt) / 1000;
      expect(seconds, `“was gone for N s” is the length of the outage (about ${Math.round(real)} s)`).toBeGreaterThanOrEqual(Math.floor(real) - 4);
      expect(sourceEvents.filter((entry) => entry.endsWith('ok')).length, 'the slot is ok again exactly once after the cut').toBe(1);
    },
  );

  test(
    'E2E-SRC-04 [ui] “Seen” is shared between two operators; a simultaneous click of the second one is answered 404 without an error toast',
    t.p0,
    async ({ regie, openRegie, openPhone, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const other = await openRegie();
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting');
      await sleep(3000);
      await net.restore(k1.phone.context);
      await waitForRecovered(regie, 'K1', { timeoutMs: 40_000 });
      await waitForRecovered(other, 'K1');

      const acks: Array<{ who: string; status: number }> = [];
      for (const [who, page] of [['A', regie.page], ['B', other.page]] as const) {
        page.on('response', (response) => {
          if (/\/incidents\/[^/]+\/ack$/.test(response.url())) acks.push({ who, status: response.status() });
        });
      }
      // Both operators hold the button of the same entry; the clicks are fired in the same instant by the page itself (a
      // Playwright click waits for actionability and would miss the button once the first acknowledgement removed it).
      const arm = (page: typeof regie.page) => page.evaluate(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('sf-status-line .c-status__inc.is-ok button')].find((candidate) => candidate.textContent?.trim() === 'Seen');
        (window as unknown as { __ack?: HTMLButtonElement }).__ack = button;
        return Boolean(button);
      });
      expect(await arm(regie.page) && await arm(other.page), 'both operators see the button').toBe(true);
      const fire = (page: typeof regie.page) => page.evaluate(() => (window as unknown as { __ack: HTMLButtonElement }).__ack.click());
      await Promise.all([fire(regie.page), fire(other.page)]);
      for (const page of [regie.page, other.page]) {
        await expect(page.locator('sf-status-line .c-status__ok'), 'entry gone in both within 1 s').toHaveText(/No open messages/, { timeout: 1500 });
      }
      await expect.poll(() => acks.length, { message: 'both operators sent an acknowledgement', timeout: 5000 }).toBe(2);
      expect(acks.map((ack) => ack.status).sort(), 'one wins (204), the other is told it is gone (404)').toEqual([204, 404]);
      for (const regiePage of [regie, other]) {
        await expect(regiePage.toast().filter({ hasText: /error|did not work|unknown/i }), 'no error toast').toHaveCount(0);
      }
    },
  );

  test(
    'E2E-SRC-05 [ui] incident timers use server time: a Regie whose clock is 5 minutes ahead shows 00:20, not 05:20',
    t.p1,
    async ({ browser, regie, openPhone, pairContext, api, production, onCleanup }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);

      // A second Regie whose page clock runs 5 minutes ahead (it keeps ticking).
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const page = await context.newPage();
      await page.clock.install({ time: Date.now() + 300_000 });
      const shifted = new RegiePage(page);
      await shifted.loginViaApi(api.cookie);
      await page.goto('/');
      await shifted.waitReady();
      expect((await page.evaluate(() => Date.now())) - Date.now(), 'the page clock is about 5 minutes ahead').toBeGreaterThan(290_000);

      await net.cut(k1.phone.context);
      const cutAt = Date.now();
      await waitForOutage(shifted, 'K1', 'reconnecting');
      await sleep(Math.max(0, 20_000 - (Date.now() - cutAt)));
      const places = await readPlaces(page);
      const seconds = (text: string) => {
        const match = /(\d+):(\d\d)/.exec(text);
        return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
      };
      const strip = seconds(places.strip.find((entry) => entry.code === 'K1')!.timer);
      const station = seconds(places.stations.find((row) => row.codes.includes('K1'))!.line);
      const source = seconds(places.sources.find((row) => row.code === 'K1')?.state ?? '');
      for (const [place, value] of Object.entries({ strip, station, sources: source })) {
        expect(value, `${place} timer (mm:ss) is about 00:20 and not 05:20`).toBeGreaterThanOrEqual(17);
        expect(value, `${place} timer`).toBeLessThanOrEqual(24);
      }
      // mm:ss format, passing 00:59 -> 01:00 correctly.
      await expect
        .poll(async () => (await readPlaces(page)).strip.find((entry) => entry.code === 'K1')?.timer, { message: 'passing 00:59 -> 01:00', timeout: 60_000, intervals: [500] })
        .toMatch(/^01:0\d$/);
    },
  );

  test(
    'E2E-SRC-20 [ui] a returning source keeps its place: same item, rectangle, z-order and code; no duplicate row; the output picture returns',
    t.p0,
    async ({ regie, openPhone, openOutput, pairContext, api, production }) => {
      test.setTimeout(240_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      const k2 = await livePhone({ openPhone }, pairContext, regie, 'Phone Two', { profile: 'pixel7' });
      const rect: Rect = { x: 240, y: 135, w: 960, h: 540, fit: 'cover' };
      const itemK1 = await putInScene(api, production, 0, k1.sourceId, rect);
      const itemK2 = await putInScene(api, production, 0, k2.sourceId, { x: 960, y: 405, w: 800, h: 450, fit: 'cover' });
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.waitForPlayingVideos(2);
      const sceneBefore = (await production.snapshot()).scenes[0]!;
      const boxBefore = (await output.items()).map((item) => ({ ...item.box }));
      const rowsBefore = (await readPlaces(regie.page)).sources.map((row) => row.code);
      const stationsBefore = (await readPlaces(regie.page)).stations.length;
      expect(sceneBefore.items.map((item) => item.id)).toEqual([itemK1.id, itemK2.id]);

      // K1 offline 10 s and back (clean cut), then a reload of the phone page.
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting', { source: 'camera', wide: true });
      await sleep(10_000);
      await net.restore(k1.phone.context);
      await waitForRecovered(regie, 'K1', { timeoutMs: 40_000 });
      await k1.phone.page.reload();
      await k1.phone.waitConnected();
      await k1.phone.waitForCamera('live', 45_000);
      await output.waitForPlayingVideos(2, { timeout: 40_000 });

      const sceneAfter = (await production.snapshot()).scenes[0]!;
      expect(sceneAfter.items, 'the scene items (id, source, rectangle, order) are unchanged').toEqual(sceneBefore.items);
      expect(sceneAfter.items.map((item) => item.id)).toEqual([itemK1.id, itemK2.id]);
      const placesAfter = await readPlaces(regie.page);
      expect(placesAfter.sources.map((row) => row.code), 'Sources dock: no duplicate row').toEqual(rowsBefore);
      expect(placesAfter.stations.length, 'no duplicate station').toBe(stationsBefore);
      expect(placesAfter.stations.find((row) => row.name === 'Phone One')!.codes, 'code K1 unchanged').toEqual(['K1']);
      expect((await production.snapshot()).sources.filter((source) => source.deviceId === k1.device.id)).toHaveLength(1);
      const boxAfter = (await output.items()).map((item) => ({ ...item.box }));
      expect(boxAfter.length).toBe(boxBefore.length);
      for (const [index, box] of boxAfter.entries()) {
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(box[key] - boxBefore[index]![key]), `output item ${index} ${key}`).toBeLessThanOrEqual(1.5);
      }
    },
  );

  test(
    'E2E-SRC-21 [ui] hold frame on the Regie monitors: the last picture stays (sharp, not black) with the dashed outline, then it is dimmed',
    t.p1,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7' });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await putInScene(api, production, 1, k1.sourceId, FULL);
      await studioPreview(regie, api, production, 1);
      const monitors = [regie.page.locator('.c-monitor--program'), regie.page.locator('.c-monitor--preview')];
      for (const monitor of monitors) await expectVideoPlaying(monitor.locator('video').first(), { minFps: 6, timeout: 30_000 });
      // The rolling hold frame is refreshed about once per second: give it one round, then cut.
      await sleep(2500);
      await net.cut(k1.phone.context);
      await waitForOutage(regie, 'K1', 'reconnecting', { inProgram: true, inPreview: true });

      // The picture that was last seen stays on both monitors: not black (the renderer keeps the last frame or a copy of it).
      const screens = [regie.page.locator('.c-monitor--program .c-monitor__screen'), regie.page.locator('.c-monitor--preview .c-monitor__screen')];
      const brightness = async (screen: typeof screens[number]) => {
        const box = (await screen.boundingBox())!;
        const image = PixelImage.fromPng(await screen.screenshot({ animations: 'allow' }));
        // The middle third: clear of the label tab (top left) and of the outline.
        return image.mean({ x: image.width / 3, y: image.height / 3, width: image.width / 3, height: image.height / 3 || box.height / 3 });
      };
      const holding = [await brightness(screens[0]!), await brightness(screens[1]!)];
      for (const [index, name] of ['Program', 'Preview'].entries()) {
        const [r, g, b] = holding[index]!;
        expect(luma(r, g, b), `${name}: the frozen picture is not black`).toBeGreaterThan(25);
        expect(g, `${name}: it is still the green picture of the fake camera`).toBeGreaterThan(r + 20);
        const outline = await monitors[index]!.evaluate((element) => getComputedStyle(element.querySelector('.sf-r-alert') as HTMLElement).borderTopStyle);
        expect(outline, `${name}: dashed outline`).toBe('dashed');
      }
      // After the item's hold time (3 s default, counted from the moment LiveKit drops the track at the Regie, which is
      // later than the API's “reconnecting”) the monitor shows the blurred, dimmed picture (and the sentence on a wide item).
      const lostAt = Date.now();
      await expect
        .poll(() => monitors[0]!.evaluate((element) => Boolean(element.querySelector('.sf-r-held') && getComputedStyle(element.querySelector('.sf-r-held')!).display !== 'none')), { message: 'dimmed after the hold time', timeout: 60_000, intervals: [250] })
        .toBe(true);
      test.info().annotations.push({ type: 'measurement', description: `Program monitor dimmed ${Date.now() - lostAt} ms after the six places showed the outage (hold time 3 s)` });
      const [r0, g0, b0] = holding[0]!;
      const [r1, g1, b1] = await brightness(screens[0]!);
      expect(luma(r1, g1, b1), 'the dimmed picture is darker than the held one').toBeLessThan(luma(r0, g0, b0) * 0.8);
      expect(await monitors[0]!.evaluate((element) => getComputedStyle(element.querySelector('.sf-r-held-text') as HTMLElement).display), 'a full-canvas item is wide enough for “Picture returns shortly”').not.toBe('none');
    },
  );
});
