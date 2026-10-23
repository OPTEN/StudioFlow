import { DE } from '../../support/constants';
import { stackConfig } from '../../support/env';
import {
  CdpCounters,
  EMBED_ORIGIN,
  FOREIGN_ORIGIN,
  PROFILE_FACTS,
  colorsClose,
  describeDevice,
  describeLatency,
  growth,
  newUiContext,
  openTimecodeTab,
  pairLaptopViaKnock,
  pairPhoneViaQr,
  pairViaApi,
  runAxe,
  SCREEN_COLORS,
} from '../../support/ui';
import { uniqueIp } from '../../support/fixtures';
import { LIMITS } from '../../support/constants';
import { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { expectNoSeriousViolations } from '../../support/ui/a11y';
import { t } from '../../support/tags';

/**
 * H-UI-* - smoke tests of the UI fixtures (support/ui): one per fixture, so the UI test wave can rely on them. They prove
 * the fixtures work against the real stack; they do not test the product's UI behaviour (that is the job of the
 * E2E-* specs that use them). Run with `--grep @ui-fixture`; they belong to the desktop-chromium project.
 */

const tags = t.with('@p1', '@ui-fixture', '@harness');

test.describe('UI fixtures', () => {
  test(
    'H-UI-01 [regie] login through the form and by session cookie; ready when the hub is live; state through the hooks and the API',
    tags,
    async ({ openRegie, production, api }) => {
      for (const login of ['ui', 'api'] as const) {
        const regie = await openRegie({ login });
        expect(new URL(regie.page.url()).pathname, `${login} login lands on the Regie`).toBe('/');
        for (const name of DE.defaultScenes)
          await expect(regie.scene(name), `scene ${name} (${login} login)`).toBeVisible();
        // The API client of the page object sees the same production as the browser.
        const snapshot = (await regie.requireAdmin().getSnapshot(production.id)).body;
        expect(snapshot.scenes.map((scene) => scene.name)).toEqual([...DE.defaultScenes]);

        const hooks = await regie.hooks();
        if (hooks) {
          expect(hooks.hub, `${login}: hub state through window.__sfStudio`).toBe('connected');
          await regie.waitForConvergence(production.id);
        } else {
          test.info().annotations.push({
            type: 'gap',
            description: `window.__sfStudio is not exposed (readiness fell back to ${(await regie.readiness()).source})`,
          });
        }
        expect(regie.problems.pageErrors, `${login}: no uncaught error in the Regie`).toEqual([]);
        expect(regie.problems.cspViolations, `${login}: no CSP violation in the Regie`).toEqual([]);
      }
      // The session cookie of the test's API client works in a browser that never saw the login form.
      expect(api.cookie).toMatch(/^sf_session=/);
    },
  );

  test(
    'H-UI-02 [pairing, phone] the QR code of the pairing dock is read with jsqr and opened in a Pixel 7; the camera goes live',
    tags,
    async ({ regie, openPhone, api, production }) => {
      test.setTimeout(120_000);
      const invite = (await api.getPhoneInvite(production.id)).body.url;
      const phone = await openPhone({ profile: 'pixel7' });
      const paired = await pairPhoneViaQr(regie, phone);
      expect(paired.qrUrl, 'the QR code holds the invite URL of the API').toBe(invite);
      await phone.waitForCamera('live');
      expect(
        (await phone.mediaCalls()).userMedia,
        'the sender asked for the camera',
      ).toBeGreaterThan(0);
      const device = await describeDevice(phone);
      expect(device.userAgent).toMatch(PROFILE_FACTS.pixel7.userAgent);
      expect(device.touchPoints).toBeGreaterThan(0);
      expect(await phone.tally(), 'not in the program').toBe('off');
      const hooks = await phone.hooks();
      if (hooks) expect(hooks.slots['camera'], 'window.__sfSender.slots()').toBe('live');
      await expect(paired.row).toContainText(/K\d/);
      expect(phone.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'H-UI-03 [sender, iPhone 15 profile] a mobile profile defaults to a phone, has touch and the fake camera',
    tags,
    async ({ openPhone }) => {
      const phone = await openPhone({ profile: 'iphone15' });
      await phone.gotoStart();
      expect(await phone.defaultKind(), 'kind default of a mobile profile').toBe('phone');
      const device = await describeDevice(phone);
      expect(device.userAgent).toMatch(PROFILE_FACTS.iphone15.userAgent);
      expect(device.touchPoints).toBeGreaterThan(0);
      expect(device.secure, 'secure context').toBe(true);
      const camera = await phone.page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = stream.getVideoTracks()[0]!;
        const result = { state: track.readyState, width: track.getSettings().width ?? 0 };
        stream.getTracks().forEach((candidate) => candidate.stop());
        return result;
      });
      expect(camera.state).toBe('live');
      expect(camera.width).toBeGreaterThan(0);
    },
  );

  test(
    'H-UI-04 [pairing, laptop] knock, check code on both screens, approval on the knock card, a fake screen share goes live and ends',
    tags,
    async ({ regie, openLaptop }) => {
      test.setTimeout(120_000);
      const laptop = await openLaptop();
      await laptop.gotoStart();
      expect(await laptop.defaultKind(), 'kind default of a desktop profile').toBe('laptop');
      const paired = await pairLaptopViaKnock(regie, laptop, 'Laptop Mia');
      expect(paired.checkCode).toMatch(DE.checkCodeFormat);

      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live');
      expect((await laptop.mediaCalls()).display, 'one getDisplayMedia call').toBe(1);
      const fake = await laptop.fakeSources();
      expect(
        fake.filter((source) => source.kind === 'screen' && source.live && source.frames > 0),
      ).toHaveLength(1);

      // The browser's «Stop sharing»: the slot ends, the sender offers «Erneut teilen», nothing re-shares by itself.
      expect(await laptop.browserStopsSharing()).toBe(true);
      await laptop.waitForSlot('screen-1', 'ended');
      await expect(
        laptop.slot('screen-1').getByRole('button', { name: 'Erneut teilen' }),
      ).toBeVisible();
      expect((await laptop.mediaCalls()).display, 'no automatic re-share').toBe(1);
    },
  );

  test(
    'H-UI-11 [pairing, deny] «Ablehnen» on the knock card shows the denial on the laptop and no station appears',
    tags,
    async ({ regie, openLaptop }) => {
      const laptop = await openLaptop();
      await laptop.gotoStart();
      await laptop.submitPairingForm('Laptop Nein', 'laptop');
      const code = await laptop.checkCode();
      await regie.openPairing('laptop');
      expect(await regie.knockCheckCode('Laptop Nein')).toBe(code);
      await regie.denyKnock('Laptop Nein');
      await expect(laptop.page.getByTestId('pairing-denied')).toBeVisible();
      await expect(regie.station('Laptop Nein')).toHaveCount(0);
    },
  );

  test(
    'H-UI-05 [output] direct and embedded on a fake origin: standby slate, then a playing video with known pixels',
    tags,
    async ({ regie, openLaptop, openOutput, embedOutput, api, production }) => {
      test.setTimeout(180_000);
      const laptop = await openLaptop();
      const paired = await pairLaptopViaKnock(regie, laptop, 'Laptop Pixel');
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live');
      const added = await api.addSceneItem(production.id, production.sceneIds[0]!, {
        source: `${paired.stored.deviceId}/screen-1`,
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
        fit: 'cover',
      });
      expect(added.status, added.raw.text()).toBe(200);

      // Before the broadcast starts the output holds the standby slate (the picture is already behind it).
      const direct = await openOutput(production);
      await expect
        .poll(() => direct.slateText(), { message: 'standby slate', timeout: 15_000 })
        .toContain(DE.slateStandby);
      expect((await api.startBroadcast(production.id)).status).toBe(200);

      await direct.waitForPlayingVideos(1);
      await expect
        .poll(() => direct.slateText(), { message: 'the slate is gone while live' })
        .not.toContain(DE.slateStandby);
      const stage = await direct.stagePixels();
      // S1 is red; the stamp bar covers the top 13 % of the picture.
      const sample = stage.at(200, 300);
      expect(
        colorsClose(sample, SCREEN_COLORS[0], 48),
        `stage pixel (200,300) is the colour of S1, got rgb(${sample.slice(0, 3).map(Math.round).join(',')})`,
      ).toBe(true);

      const embedded = await embedOutput(production, {
        size: { width: 960, height: 540 },
        title: 'Webinar live',
      });
      const frame = await embedded.frame();
      expect(
        frame.url().startsWith(embedded.config.baseURL),
        'the iframe holds the output of the stack',
      ).toBe(true);
      expect(new URL(embedded.page.url()).origin, 'the embedding page is on the fake origin').toBe(
        EMBED_ORIGIN,
      );
      const [measured] = await embedded.waitForPlayingVideos(1);
      expect(measured!.muted, 'output videos are muted (autoplay without a gesture)').toBe(true);
      const stageBox = await (await embedded.stage()).boundingBox();
      expect(stageBox!.width, 'the stage fits the 960 px frame').toBeCloseTo(960, 0);
      const embeddedStage = await embedded.stagePixels();
      expect(
        colorsClose(embeddedStage.at(200, 300), SCREEN_COLORS[0], 48),
        'embedded stage shows the same screen',
      ).toBe(true);

      // A 4:3 frame letterboxes the 16:9 stage: full width, height 450 inside the 600 px.
      await embedded.resizeFrame({ width: 800, height: 600 });
      await expect
        .poll(async () => Math.round((await (await embedded.stage()).boundingBox())!.width), {
          message: 'the stage follows the iframe size',
        })
        .toBe(800);
      expect(Math.round((await (await embedded.stage()).boundingBox())!.height)).toBe(450);
      expect(
        embedded.problems.cspViolations,
        'no frame-ancestors violation for the allowed origin',
      ).toEqual([]);

      // An origin the stack does not list is refused by frame-ancestors: the iframe never holds the output.
      const foreign = await embedOutput(production, {
        origin: FOREIGN_ORIGIN,
        waitForFrame: false,
      });
      await expect
        .poll(() => foreign.page.frames().map((frame) => frame.url()), {
          message: 'the foreign origin cannot frame the output',
        })
        .toContainEqual(expect.stringMatching(/^chrome-error:/));
      expect(
        foreign.page.frames().some((frame) => frame.url().startsWith(foreign.config.baseURL)),
      ).toBe(false);
      expect(
        foreign.problems.cspViolations.length,
        'the browser reported the refusal',
      ).toBeGreaterThan(0);
    },
  );

  test(
    "H-UI-06 [latency] the stamp camera is the sender's camera; the output page decodes its stamps with ?latency=1",
    tags,
    async ({ regie, openPhone, openOutput, api, production }) => {
      test.setTimeout(180_000);
      const phone = await openPhone({ profile: 'desktop', camera: 'stamp' });
      // A webcam sender on the desktop profile: the pairing form asks for the kind explicitly.
      await phone.gotoStart();
      await phone.submitPairingForm('Stempel-Kamera', 'phone');
      await regie.openPairing('laptop');
      await regie.approveKnock('Stempel-Kamera');
      await phone.waitConnected();
      const stored = await phone.waitForStoredDevice();
      await phone.waitForCamera('live');
      const fake = await phone.fakeSources();
      expect(
        fake.some((source) => source.kind === 'camera' && source.live && source.frames > 0),
        'the app uses the stamp camera, not the native fake device',
      ).toBe(true);

      const added = await api.addSceneItem(production.id, production.sceneIds[0]!, {
        source: `${stored.deviceId}/camera`,
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
        fit: 'cover',
      });
      expect(added.status, added.raw.text()).toBe(200);
      await api.startBroadcast(production.id);

      const output = await openOutput(production, { latency: true });
      await output.waitForPlayingVideos(1);
      const { samples, stats } = await output.collectLatency({
        count: 30,
        skip: 5,
        timeout: 45_000,
      });
      const described = describeLatency(samples, { skip: 5 });
      test.info().annotations.push({
        type: 'measurement',
        description: `glass-to-glass (stamp camera -> sender -> SFU -> output): ${described.summary}`,
      });
      expect(stats.count).toBeGreaterThanOrEqual(30);
      expect(
        stats.p50,
        'a stamp from the future or an absurd delay means the decoder or the clocks are wrong',
      ).toBeGreaterThan(0);
      expect(stats.p95, 'plausible on one machine').toBeLessThan(5000);
      expect(
        new Set(samples.map((sample) => sample.sourceId)),
        'samples belong to the camera source',
      ).toEqual(new Set([`${stored.deviceId}/camera`]));
    },
  );

  test(
    'H-UI-09 [sender, native capture] with screen: native the laptop uses the browser capture (the titled tab), not the canvas fake',
    tags,
    async ({ regie, openLaptop }) => {
      test.setTimeout(120_000);
      const laptop = await openLaptop({ screen: 'native' });
      await openTimecodeTab(laptop.context);
      await pairLaptopViaKnock(regie, laptop, 'Laptop Native');
      await laptop.page.bringToFront();
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live');
      expect((await laptop.mediaCalls()).display).toBe(1);
      expect(
        (await laptop.fakeSources()).filter((source) => source.kind === 'screen'),
        'no canvas screen was made',
      ).toEqual([]);
    },
  );

  test(
    'H-UI-12 [pairing, API fast path] a phone and a laptop paired through the API resume into their stations without a pairing request',
    tags,
    async ({ openPhone, openLaptop, pairContext }) => {
      test.setTimeout(120_000);
      const phone = await openPhone();
      const handy = await pairViaApi(pairContext, phone, { name: 'Handy API' });
      await phone.waitForCamera('live');
      expect((await phone.storedDevice())!.deviceId).toBe(handy.id);
      expect(phone.page.url()).toContain('/join/station');

      const laptop = await openLaptop();
      const lap = await pairViaApi(pairContext, laptop, { name: 'Laptop API' });
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live');
      expect((await laptop.storedDevice())!.deviceId).toBe(lap.id);
    },
  );

  test(
    'H-UI-13 [client address] every context has its own allowance for pairing requests: 10 per address, the 11th is refused; an address of its own is not',
    tags,
    async ({ browser, production, onCleanup }) => {
      const send = async (context: Awaited<ReturnType<typeof newUiContext>>, count: number) => {
        const page = await context.newPage();
        await page.goto('/join/');
        const statuses = await page.evaluate(async (n) => {
          const result: Array<{ status: number; requestId?: string; pollToken?: string }> = [];
          for (let index = 0; index < n; index++) {
            const response = await fetch('/api/pairing/requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: 'Rate Limit',
                kind: 'laptop',
                platform: 'Windows · Chrome',
              }),
            });
            const body = response.status === 201 ? await response.json() : {};
            result.push({
              status: response.status,
              requestId: body.requestId,
              pollToken: body.pollToken,
            });
          }
          return result;
        }, count);
        for (const entry of statuses) {
          if (entry.requestId)
            production.pendingRequests.push({
              requestId: entry.requestId,
              pollToken: entry.pollToken!,
            });
        }
        return statuses.map((entry) => entry.status);
      };
      const shared = uniqueIp();
      const a = await newUiContext(browser, { clientIp: shared });
      const b = await newUiContext(browser, { clientIp: 'unique' });
      const c = await newUiContext(browser, { clientIp: shared });
      for (const context of [a, b, c]) onCleanup(() => context.close());

      const first = await send(a, LIMITS.pairingRequestsPerIpPer10Min + 1);
      expect(first.slice(0, LIMITS.pairingRequestsPerIpPer10Min), 'the allowance').toEqual(
        Array(LIMITS.pairingRequestsPerIpPer10Min).fill(201),
      );
      expect(first[LIMITS.pairingRequestsPerIpPer10Min], 'the next one is refused').toBe(429);
      expect(await send(b, 1), 'another context has an address of its own').toEqual([201]);
      expect(await send(c, 1), 'a context with the same address shares the allowance').toEqual([
        429,
      ]);
    },
  );

  test(
    'H-UI-14 [login, client address] failed logins lock out the address of one context, not the machine: another context still logs in',
    tags,
    async ({ browser, onCleanup }) => {
      const config = stackConfig();
      const stranger = {
        username: `nobody-${Date.now().toString(36)}`,
        password: 'falsches-Passwort-123',
      };
      const a = await newUiContext(browser);
      const b = await newUiContext(browser);
      for (const context of [a, b]) onCleanup(() => context.close());
      const locked = new RegiePage(await a.newPage(), config);
      const statuses: number[] = [];
      while (!statuses.includes(429) && statuses.length < LIMITS.loginFailuresPerIp + 3) {
        statuses.push(await locked.submitLoginForm(stranger));
      }
      expect(
        statuses.filter((status) => status === 401),
        'wrong credentials are 401 until the fifth failure, which itself starts the lock',
      ).toHaveLength(LIMITS.loginFailuresPerIp - 1);
      expect(statuses.at(-1), 'the fifth failure of one address answers 429').toBe(429);
      await expect(locked.loginError()).toContainText(/Zu viele Fehlversuche/);
      await expect(locked.page.getByRole('button', { name: 'Anmelden' })).toBeDisabled();

      // The second context has another address: the admin logs in through the form without trouble.
      const other = new RegiePage(await b.newPage(), config);
      await other.loginViaUi();
      expect(new URL(other.page.url()).pathname).toBe('/');
    },
  );

  test(
    'H-UI-07 [counters] CDP counters follow retained DOM nodes, listeners and elements of a page',
    tags,
    async ({ regie }) => {
      const counters = await CdpCounters.attach(regie.page);
      try {
        const before = await counters.sample();
        expect(before.nodes).toBeGreaterThan(0);
        expect(before.net, 'the init script tracks sockets (hub) and peers').not.toBeNull();
        expect(before.net!.sockets, 'the Regie hub WebSocket is open').toBeGreaterThanOrEqual(1);
        await regie.page.evaluate(() => {
          const holder = document.createElement('div');
          holder.id = 'leak-probe';
          for (let index = 0; index < 400; index++) {
            const video = document.createElement('video');
            video.addEventListener('playing', () => undefined);
            holder.appendChild(video);
          }
          document.body.appendChild(holder);
        });
        const grown = growth(before, await counters.sample());
        expect(grown.videos).toBe(400);
        expect(grown.nodes, 'node counter').toBeGreaterThanOrEqual(400);
        expect(grown.listeners, 'listener counter').toBeGreaterThanOrEqual(400);
        await regie.page.evaluate(() => document.getElementById('leak-probe')?.remove());
        let released = await counters.sample();
        for (let attempt = 0; attempt < 8 && growth(before, released).videos !== 0; attempt++)
          released = await counters.sample();
        expect(growth(before, released).videos, 'the DOM count is back').toBe(0);
      } finally {
        await counters.detach();
      }
    },
  );

  test(
    'H-UI-08 [axe] the helper finds a known critical violation, passes a clean page, and runs on the login page',
    tags,
    async ({ page, config }) => {
      const serve = (path: string, body: string) =>
        page.route(`${config.baseURL}${path}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Axe</title></head><body>${body}</body></html>`,
          }),
        );
      await serve(
        '/__e2e/axe-bad',
        '<main><h1>Seite</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button></main>',
      );
      await serve(
        '/__e2e/axe-clean',
        '<main><h1>Seite</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Punkt"><button>Weiter</button></main>',
      );

      await page.goto(`${config.baseURL}/__e2e/axe-bad`);
      const bad = await runAxe(page);
      expect(
        bad.blocking.map((violation) => violation.id),
        'image-alt and button-name are critical',
      ).toEqual(expect.arrayContaining(['image-alt', 'button-name']));
      const accepted = await runAxe(page, {
        accepted: {
          'image-alt': 'fixture: decorative probe',
          'button-name': 'fixture: empty probe',
        },
      });
      expect(
        accepted.blocking,
        'accepted rules are switched off, with the reason attached to the call',
      ).toEqual([]);

      await page.goto(`${config.baseURL}/__e2e/axe-clean`);
      const clean = await expectNoSeriousViolations(page, 'clean-page');
      expect(clean.passes).toBeGreaterThan(0);

      // The product's own login page: informational (attached), the E2E-A11Y specs assert on it.
      await page.goto('/login');
      await page.getByLabel('Benutzername').waitFor();
      const login = await runAxe(page);
      await test.info().attach('axe-login.json', {
        body: JSON.stringify(login, null, 2),
        contentType: 'application/json',
      });
      expect(login.passes, 'axe ran on the login page').toBeGreaterThan(0);
    },
  );
});
