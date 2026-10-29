import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../fixtures';
import { TEXT } from '../text';
import { OUTPUT_DIR } from '../env';
import { OutputPage } from '../ui/output';
import { RegiePage } from '../ui/regie';
import { t } from '../tags';
import { saveScreen, expectNoOverflow, VIEWPORTS } from './layout';
import { seedBusyConsole } from './seed';
import { settle } from './regie-setup';
import {
  browserFacts,
  consoleProblems,
  expectStackOnly,
  loadedFontFamilies,
  newBrowserContext,
  openRegieIn,
  type KnownDifference,
} from './browser-flows';

/**
 * E2E-DEV-19 [Browsers for the Regie]: the same flows as in Chromium in Firefox and WebKit (docs/testing.md 2.8):
 * login, scene switch, Studio Mode and Take, dragging an element and a dock with the pointer, a splitter, the pairing
 * dock with its QR code, the layouts of 1180, 900 and 390 px, and the output page. Registered by the `*.firefox.spec.ts`
 * and `*.webkit.spec.ts` files (project desktop-firefox, webkit). WebKit has no WebRTC and no Web Audio in Playwright on Windows: its
 * media and audio warnings are the known differences below (UI only, docs/testing.md 1.3).
 */

const tags = t.with('@p1', '@a11y', '@browsers');
const SCREEN_PREFIX = (name: string) => `${name}`;

const KNOWN: Record<string, KnownDifference[]> = {
  firefox: [],
  webkit: [
    { pattern: /LiveKit connect failed.*(doesn't seem to be supported|webRTC)/i, reason: 'Playwright WebKit on Windows has no RTCPeerConnection (typeof RTCPeerConnection === "undefined"): LiveKit cannot connect; the Regie shows “Video connection interrupted”' },
    { pattern: /audio context could not be created.*Web Audio is not available/i, reason: 'Playwright WebKit on Windows has no AudioContext: the page warns once and stays silent' },
  ],
};

const EXPECTED_STATUSES = [
  { status: 401, pathPattern: /^\/api\/auth\/me$/ },
  { status: 401, pathPattern: /^\/api\/auth\/login$/ },
];

export function registerBrowserSmoke(browserName: 'firefox' | 'webkit'): void {
  const known = KNOWN[browserName]!;
  const label = (name: string) => `E2E-DEV-19 [${browserName}, ${name}]`;

  test.describe(`Regie and output in ${browserName}`, () => {
    test(`${label('login')} the login form signs in; fonts load from the stack; no console error, CSP violation or foreign request`, tags, async ({ browser, config, onCleanup }) => {
      test.setTimeout(90_000);
      const session = await newBrowserContext(browser, browserName);
      onCleanup(() => session.context.close());
      const page = await session.context.newPage();
      await page.goto('/login');
      await expect(page.getByLabel('Username')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
      await page.getByLabel('Username').fill(config.admin.username);
      await page.getByLabel('Password').fill(config.admin.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
      expect(await loadedFontFamilies(page), 'the web fonts are loaded').toEqual(expect.arrayContaining(['Sofia Sans Semi Condensed', 'JetBrains Mono']));
      for (const request of session.watch.requests.filter((entry) => entry.type === 'font')) expect(new URL(request.url).origin, `font ${request.url}`).toBe(session.origin);
      await expectStackOnly(session.watch, session.origin, `${browserName} login`);
      const problems = consoleProblems(session.watch, known, EXPECTED_STATUSES);
      expect(problems.unexpected, 'console: no error or warning').toEqual([]);
    });

    test(`${label('regie')} scenes, Studio Mode, Take, an element dragged and a dock dragged with the pointer, a splitter, the pairing dock with a readable QR code`, tags, async ({ browser, api, production, pairContext, onCleanup }) => {
      test.setTimeout(240_000);
      const seeded = await seedBusyConsole(pairContext, onCleanup, { incident: 'reconnecting' });
      const session = await newBrowserContext(browser, browserName, { cookie: api.cookie });
      onCleanup(() => session.context.close());
      const regie = await openRegieIn(session, api);
      const { page } = regie;
      const program = async () => (await api.getSnapshot(production.id)).body.production.programSceneId;
      const preview = async () => (await api.getSnapshot(production.id)).body.production.previewSceneId;
      await expect(regie.station('Phone Entrance')).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await saveScreen(page, SCREEN_PREFIX(`${browserName}-regie-direct`));

      // render: monitors are 16:9 inside the viewport, the docks sit at the bottom
      const monitor = (await page.locator('sf-monitor[kind=program] .c-monitor__screen').boundingBox())!;
      expect(Math.abs(monitor.width / monitor.height - 16 / 9), 'the Program monitor is 16:9').toBeLessThan(0.012);
      expect(monitor.x + monitor.width, 'and inside the viewport').toBeLessThanOrEqual(page.viewportSize()!.width);
      await expectNoOverflow(page, { vertical: false, label: `${browserName} Regie` });

      // switch a scene (cut first, so a second switch is not ignored by the fade guard)
      await regie.transitionOption('Cut').click();
      await regie.clickScene('Break');
      await expect.poll(program, { message: 'a scene click switches the Program' }).toBe(seeded.scenes[2]!.id);
      await regie.clickScene('Welcome');
      await expect.poll(program).toBe(seeded.scenes[0]!.id);

      // Studio Mode, preview, Take
      await regie.setStudioMode(true);
      await regie.clickScene('Presentation');
      await expect.poll(preview, { message: 'in Studio Mode a scene click loads the Preview' }).toBe(seeded.scenes[1]!.id);
      // drag an element in the Preview with the pointer (pointer events, capture)
      const scene = () => api.getSnapshot(production.id).then((snapshot) => snapshot.body.scenes.find((entry) => entry.id === seeded.scenes[1]!.id)!);
      const item = (await scene()).items.find((entry) => entry.w === 600)!;
      expect(item, 'the picture-in-picture element exists').toBeDefined();
      const box = page.locator(`.c-edit-box[data-item-id="${item.id}"]`);
      await expect(box).toBeVisible();
      const rect = (await box.boundingBox())!;
      const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 120, start.y - 60, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await scene()).items.find((entry) => entry.id === item.id)!.x, { message: 'the element moved left', timeout: 15_000 }).toBeLessThan(item.x - 100);

      await regie.take().click();
      await expect.poll(program, { message: 'Take puts the Preview on air' }).toBe(seeded.scenes[1]!.id);
      await regie.clickScene('Welcome');
      await expect.poll(preview).toBe(seeded.scenes[0]!.id);

      // drag a dock to the left zone with the pointer
      const grip = page.getByRole('button', { name: 'Move dock Scenes with the arrow keys' });
      const gripBox = (await grip.boundingBox())!;
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(gripBox.x + 40, gripBox.y - 20, { steps: 4 });
      await page.mouse.move(40, 300, { steps: 10 });
      await expect(page.locator('.c-drop-zone--left, .c-drop-zone')).not.toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator('[data-zone=left] sf-dock-slot[aria-label=Scenes]'), 'the dock moved to the left zone').toHaveCount(1);
      await saveScreen(page, SCREEN_PREFIX(`${browserName}-regie-dock-left`));
      // the toast of the move offers "Undo", which puts the dock back
      await page.locator('sf-toast-host .c-toast').last().getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('[data-zone=bottom] sf-dock-slot[aria-label=Scenes]')).toHaveCount(1);

      // drag a splitter: the docks grow
      const split = page.getByRole('separator', { name: 'Height of the docks at the bottom' });
      const zoneHeight = async () => Math.round((await page.locator('[data-zone=bottom]').boundingBox())!.height);
      const before = await zoneHeight();
      const splitBox = (await split.boundingBox())!;
      await page.mouse.move(splitBox.x + 200, splitBox.y + splitBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(splitBox.x + 200, splitBox.y - 60, { steps: 8 });
      await page.mouse.up();
      await expect.poll(zoneHeight, { message: 'dragging the hairline up makes the docks higher' }).toBeGreaterThan(before + 30);
      await split.focus();
      await page.keyboard.press('Enter');
      await expect.poll(zoneHeight).toBe(before);

      // the pairing dock and its QR code
      const qr = await regie.readPairingQr();
      expect(qr.url, 'the QR code holds an invite link of the stack').toContain(`${new URL(session.config.baseURL).host}/join/i/`);
      await saveScreen(page, SCREEN_PREFIX(`${browserName}-regie-pairing`));
      await regie.closePairing();

      // keyboard in this browser: Escape layers and the popover focus
      await page.getByRole('button', { name: 'Layout', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Layout' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Layout' })).toBeHidden();

      await expectStackOnly(session.watch, session.origin, `${browserName} Regie`);
      const problems = consoleProblems(session.watch, known, EXPECTED_STATUSES);
      test.info().annotations.push({ type: 'known-difference', description: problems.known.length ? `${problems.known.length} x ${problems.known[0]}` : 'none' });
      expect(problems.unexpected, 'console: no error or warning beyond the known difference').toEqual([]);
      for (const request of session.watch.requests.filter((entry) => entry.type === 'font')) expect(new URL(request.url).origin).toBe(session.origin);
      expect(regie.problems.pageErrors).toEqual([]);
    });

    test(`${label('layouts')} the stacked layouts of 1180, 900 and 390 px have no horizontal scroll and keep the monitors 16:9`, tags, async ({ browser, api, pairContext, onCleanup }) => {
      test.setTimeout(180_000);
      await seedBusyConsole(pairContext, onCleanup, { incident: 'reconnecting' });
      const session = await newBrowserContext(browser, browserName, { cookie: api.cookie });
      onCleanup(() => session.context.close());
      const regie = await openRegieIn(session, api);
      const { page } = regie;
      for (const [name, viewport] of [['1180x800', VIEWPORTS.w1180], ['900x700', VIEWPORTS.w900], ['390x844', VIEWPORTS.w390], ['1280x720', VIEWPORTS.w1280]] as const) {
        await page.setViewportSize(viewport);
        await settle(page);
        for (const studio of [false, true]) {
          await regie.setStudioMode(studio);
          await settle(page);
          const l = `${browserName} ${name} ${studio ? 'Studio Mode' : 'direct'}`;
          await expectNoOverflow(page, { label: l });
          const programBox = (await page.locator('sf-monitor[kind=program] .c-monitor__screen').boundingBox())!;
          expect(Math.abs(programBox.width / programBox.height - 16 / 9), `${l}: Program is 16:9`).toBeLessThan(0.012);
          expect(programBox.x + programBox.width, `${l}: Program inside the viewport`).toBeLessThanOrEqual(viewport.width + 0.5);
          if (studio) {
            await expect(regie.take()).toBeVisible();
          }
        }
        await saveScreen(page, SCREEN_PREFIX(`${browserName}-regie-${name}-studio`));
      }
      await expectStackOnly(session.watch, session.origin, `${browserName} layouts`);
      expect(consoleProblems(session.watch, known, EXPECTED_STATUSES).unexpected).toEqual([]);
    });

    test(`${label('output')} the output page renders the slates and the program, loads its font from the stack, makes no foreign request and logs no error`, tags, async ({ browser, api, production, onCleanup }) => {
      test.setTimeout(150_000);
      const session = await newBrowserContext(browser, browserName, { viewport: { width: 1280, height: 720 } });
      onCleanup(() => session.context.close());
      const output = await OutputPage.open(session.context, production, { debug: true });
      await expect.poll(() => output.slateText(), { message: 'standby slate', timeout: 20_000 }).toContain(TEXT.slate.standby);
      expect(await loadedFontFamilies(output.page), 'the slate font is loaded').toContain('Sofia Sans Semi Condensed');
      await saveScreen(output.page, SCREEN_PREFIX(`${browserName}-output-standby`));
      const stage = (await output.page.locator('.sf-r-stage').boundingBox())!;
      expect(Math.abs(stage.width / stage.height - 16 / 9), 'the stage is 16:9').toBeLessThan(0.012);
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { message: 'the slate is gone while live', timeout: 20_000 }).not.toContain(TEXT.slate.standby);
      await expect(output.page.locator('.c-debug'), 'the debug overlay shows').toBeVisible();
      await saveScreen(output.page, SCREEN_PREFIX(`${browserName}-output-live`));
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { message: 'end slate', timeout: 20_000 }).toContain(TEXT.slate.end);
      for (const request of session.watch.requests.filter((entry) => entry.type === 'font')) expect(new URL(request.url).origin).toBe(session.origin);
      await expectStackOnly(session.watch, session.origin, `${browserName} output`);
      const problems = consoleProblems(session.watch, known);
      test.info().annotations.push({ type: 'known-difference', description: problems.known.length ? `${problems.known.length} x ${problems.known[0]}` : 'none' });
      expect(problems.unexpected, 'console: no error or warning beyond the known difference').toEqual([]);
    });

    test(`${label('facts')} records what the browser offers (WebRTC, ResizeObserver, pointer events, container queries) for the report`, tags, async ({ browser, onCleanup }) => {
      const session = await newBrowserContext(browser, browserName);
      onCleanup(() => session.context.close());
      const page = await session.context.newPage();
      await page.goto('/login');
      const facts = await browserFacts(page);
      fs.mkdirSync(path.join(OUTPUT_DIR, 'a11y'), { recursive: true });
      fs.writeFileSync(path.join(OUTPUT_DIR, 'a11y', `browser-facts-${browserName}.json`), JSON.stringify(facts, null, 2));
      test.info().annotations.push({ type: 'facts', description: JSON.stringify(facts) });
      expect(facts['resizeObserver'], 'ResizeObserver (monitor sizing)').toBe('function');
      expect(facts['pointerEvents'], 'pointer events (drag)').toBe('function');
      expect(facts['webAnimations'], 'Web Animations (fades)').toBe('function');
      expect(facts['containerQueries'], 'container queries (stage layout)').toBe(true);
      expect(facts['secure'], 'secure context').toBe(true);
      if (browserName === 'firefox') expect(facts['rtc'], 'Firefox has WebRTC').toBe('function');
    });
  });
}

void RegiePage;
