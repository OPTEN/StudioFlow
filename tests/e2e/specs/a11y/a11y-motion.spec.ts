import type { Browser, Page } from '@playwright/test';
import { knownBug } from '../../support/a11y/known-bug';
import { clearMotion, installMotionRecorder, nonZeroDurations, readMotion, type MotionEntry } from '../../support/a11y/motion';
import { seedBusyConsole } from '../../support/a11y/seed';
import { settle } from '../../support/a11y/regie-setup';
import { DeviceHub } from '../../support/hubs';
import { pairPhone, uniqueIp, type PairContext } from '../../support/production';
import { newUiContext, OutputPage } from '../../support/ui';
import { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-16 (reduced motion, docs/testing.md 2.8) with GAP-28: the Regie and the sender honour
 * `prefers-reduced-motion: reduce`; the output page does not (the programme looks the same for the audience whatever
 * the OS setting of the proxy machine). Every test runs the same actions with `reduce` and, as the positive control that
 * proves the recorder would see motion, with `no-preference`.
 */

const tags = (priority: 'p0' | 'p1' | 'p2') => t.with(`@${priority}`, '@a11y', '@motion');
const VIEWPORT = { width: 1440, height: 900 };

type Motion = 'reduce' | 'no-preference';

async function openRegieWithMotion(browser: Browser, cookie: string, motion: Motion, onCleanup: (fn: () => Promise<unknown> | unknown) => void): Promise<RegiePage> {
  const context = await newUiContext(browser, { context: { viewport: VIEWPORT, reducedMotion: motion } });
  onCleanup(() => context.close());
  await installMotionRecorder(context);
  return RegiePage.open(context, { login: 'api', cookie });
}

/** The same actions in both modes: switch with a fade, station detail, dock move, popover, mode switch, a new outage. */
async function runScenario(regie: RegiePage, pairContext: PairContext, onCleanup: (fn: () => Promise<unknown> | unknown) => void, label: string, scene: string): Promise<{ transitionPosts: Array<{ kind?: string; durationMs?: number }> }> {
  const { page } = regie;
  const transitionPosts: Array<{ kind?: string; durationMs?: number }> = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !/\/api\/productions\/[^/]+\/(program|take)$/.test(new URL(request.url()).pathname)) return;
    const body = request.postDataJSON() as { transition?: { kind?: string; durationMs?: number } } | null;
    if (body?.transition) transitionPosts.push(body.transition);
  });
  // fade 1 s: Fade (default) and three steps up (0.3 -> 0.5 -> 0.8 -> 1 s)
  await regie.transitionOption('Fade').click();
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Longer fade' }).click();
  await expect(page.getByRole('group', { name: 'Fade duration' })).toContainText(/^\s*[−-]?\s*1(\.0)? s\s*\+?\s*$/);
  await clearMotion(page);

  // a scene switch (Studio Mode off): the renderer fades the Program monitor, the thumbnails and the flash follow
  await regie.clickScene(scene);
  await expect(regie.scene(scene)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.getByRole('img', { name: new RegExp(`^Program monitor: ${scene}`) }).count(), { message: 'the Program monitor shows the new scene' }).toBe(1);
  // a station detail opens (grid-row reveal), a popover, the mode switch, a dock move
  await page.locator('.c-st__row').first().click();
  await page.getByRole('button', { name: 'Docks and layout' }).click();
  await page.keyboard.press('Escape');
  await regie.setStudioMode(true);
  await page.getByRole('button', { name: 'Move dock Stations with the arrow keys' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(regie.toast().first()).toContainText('Stations is');
  // a new outage: a phone that was live stops reporting its camera (reconnecting)
  const phone = await pairPhone(pairContext, { name: `Phone Pulse ${label}` });
  const hub = DeviceHub.connect(pairContext.stack.anonymousBase, phone.credentials, { headers: pairContext.stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {}, reconnect: true });
  onCleanup(() => hub.stop());
  await hub.open();
  await hub.reportLive(['camera']);
  await expect(regie.station(`Phone Pulse ${label}`)).toBeVisible();
  await hub.report({ rtc: 'connected', slots: [{ slot: 'camera', state: 'paused', width: 1280, height: 720, fps: 30, bitrateKbps: 2500, packetLossPct: 0, codec: 'h264' }] });
  await expect(page.getByRole('region', { name: 'Messages' })).toContainText(`Phone Pulse ${label}`);
  // give the 1.2 s pulse and the 1 s station flash time to show up in the recorder
  await page.waitForTimeout(1500);
  return { transitionPosts };
}

const moving = (entries: MotionEntry[]) => entries.filter((entry) => entry.duration > 0);

test.describe('Reduced motion', () => {
  test('E2E-DEV-16 [regie, renderer] with reduce a fade of 1 s is sent but the monitors and thumbnails cut: no opacity animation, no Program flash, one scene layer; with no-preference they fade (control)', tags('p1'), async ({ browser, api, pairContext, onCleanup }) => {
    test.setTimeout(240_000);
    await seedBusyConsole(pairContext, onCleanup, { incident: null });

    // --- control: no-preference shows that the recorder sees the fade and the flash
    const normal = await openRegieWithMotion(browser, api.cookie, 'no-preference', onCleanup);
    await expect(normal.station('Phone Entrance')).toBeVisible();
    await settle(normal.page);
    expect(await normal.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the control context does not ask for reduced motion').toBe(false);
    const control = await runScenario(normal, pairContext, onCleanup, 'normal', 'Presentation');
    const controlMotion = moving((await readMotion(normal.page)).entries);
    await test.info().attach('motion-no-preference.json', { body: JSON.stringify(controlMotion, null, 2), contentType: 'application/json' });
    expect(control.transitionPosts.at(-1), 'the request carries the fade').toMatchObject({ kind: 'fade', durationMs: 1000 });
    expect(controlMotion.filter((entry) => entry.kind === 'animate' && /opacity/.test(entry.name) && entry.duration === 1000).length, 'control: the renderer fades the monitors over 1 s (Web Animation on opacity)').toBeGreaterThan(0);
    expect(controlMotion.filter((entry) => entry.kind === 'animate' && /outline/i.test(entry.name)).length, 'control: the Program outline flashes once').toBeGreaterThan(0);
    await normal.page.context().close();

    // --- reduced motion
    const reduced = await openRegieWithMotion(browser, api.cookie, 'reduce', onCleanup);
    await expect(reduced.station('Phone Entrance')).toBeVisible();
    await settle(reduced.page);
    expect(await reduced.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced motion is on').toBe(true);
    const run = await runScenario(reduced, pairContext, onCleanup, 'reduced', 'Interview');
    const recorded = await readMotion(reduced.page);
    await test.info().attach('motion-reduce.json', { body: JSON.stringify(recorded.entries, null, 2), contentType: 'application/json' });
    expect(run.transitionPosts.at(-1), 'with reduced motion the request still sends the fade (the output fades)').toMatchObject({ kind: 'fade', durationMs: 1000 });
    const webAnimations = recorded.entries.filter((entry) => entry.kind === 'animate');
    expect(webAnimations.map((entry) => `${entry.name} ${entry.duration} ms on ${entry.target}`), 'no Web Animation: no fade of the monitors or thumbnails, no flash of the Program outline').toEqual([]);
    // the monitors cut: the Program monitor holds exactly one scene layer and shows the new scene
    expect(await reduced.page.locator('sf-monitor[kind=program] .sf-r-layer').count(), 'the Program monitor holds one scene layer (no outgoing layer)').toBe(1);
    // the stepper keeps its value
    await expect(reduced.page.getByRole('group', { name: 'Fade duration' })).toContainText(/1(\.0)? s/);
    expect(reduced.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-16 [regie, CSS] with reduce every computed transition-duration and animation-duration is 0 s, the lamp pulse and the station flash do not run; with no-preference they do (control)', tags('p1'), async ({ browser, api, pairContext, onCleanup }) => {
    test.setTimeout(240_000);
    knownBug('A11Y-10', 'prefers-reduced-motion has no effect on the CSS of the Regie: the :root overrides of the --dur-* tokens in _base.scss come before the :root token block of styles.scss and lose (--dur-state stays 0.15 s, --dur-lamp-pulse 1.2 s); the universal 0 s rule loses to every component rule');
    await seedBusyConsole(pairContext, onCleanup, { incident: null });

    const normal = await openRegieWithMotion(browser, api.cookie, 'no-preference', onCleanup);
    await expect(normal.station('Phone Entrance')).toBeVisible();
    await settle(normal.page);
    await runScenario(normal, pairContext, onCleanup, 'normal', 'Presentation');
    const controlMotion = moving((await readMotion(normal.page)).entries);
    expect(controlMotion.filter((entry) => entry.kind === 'css-animation').length, 'control: the lamp pulse / station flash are CSS animations').toBeGreaterThan(0);
    expect(controlMotion.filter((entry) => entry.kind === 'css-transition').length, 'control: states and reveals are CSS transitions').toBeGreaterThan(0);
    await normal.page.context().close();

    const reduced = await openRegieWithMotion(browser, api.cookie, 'reduce', onCleanup);
    await expect(reduced.station('Phone Entrance')).toBeVisible();
    await settle(reduced.page);
    const tokens = await reduced.page.evaluate(() => { const root = getComputedStyle(document.documentElement); return { state: root.getPropertyValue('--dur-state').trim(), pulse: root.getPropertyValue('--dur-lamp-pulse').trim(), flash: root.getPropertyValue('--dur-station-flash').trim() }; });
    test.info().annotations.push({ type: 'tokens', description: JSON.stringify(tokens) });
    const idle = await nonZeroDurations(reduced.page);
    await test.info().attach('durations-at-rest.json', { body: JSON.stringify(idle, null, 2), contentType: 'application/json' });
    expect(idle.map((entry) => `${entry.element}${entry.pseudo} ${entry.property}: ${entry.value}`).slice(0, 12), `at rest: transition-duration and animation-duration are 0 s on every element (${idle.length} elements are not; --dur-state is ${tokens.state})`).toEqual([]);
    await runScenario(reduced, pairContext, onCleanup, 'reduced', 'Interview');
    const recorded = moving((await readMotion(reduced.page)).entries.filter((entry) => entry.kind !== 'animate'));
    expect(recorded.map((entry) => `${entry.kind} ${entry.name} ${entry.duration} ms on ${entry.target}`).slice(0, 12), 'no CSS animation or transition with a duration ran').toEqual([]);
  });

  test('E2E-DEV-16 [regie, scrollIntoView] showing a station from the strip scrolls with behavior auto under reduce and smooth otherwise', tags('p1'), async ({ browser, api, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    await seedBusyConsole(pairContext, onCleanup, { incident: 'reconnecting' });
    const behaviours: Record<string, string[]> = {};
    for (const motion of ['reduce', 'no-preference'] as const) {
      const regie = await openRegieWithMotion(browser, api.cookie, motion, onCleanup);
      await expect(regie.station('Phone Entrance')).toBeVisible();
      await settle(regie.page);
      await clearMotion(regie.page);
      await regie.page.getByRole('button', { name: /Show \S+ .+ in Stations/ }).first().click();
      await expect(regie.page.locator('.c-st__row[aria-expanded=true]').first(), 'the station is opened').toBeVisible();
      await expect.poll(async () => (await readMotion(regie.page)).scrolls.length, { message: 'the dock scrolled the row into view' }).toBeGreaterThan(0);
      behaviours[motion] = (await readMotion(regie.page)).scrolls.map((entry) => entry.options);
      await regie.page.context().close();
    }
    test.info().annotations.push({ type: 'scrollIntoView', description: JSON.stringify(behaviours) });
    expect(behaviours['no-preference']!.some((options) => /"behavior":"smooth"/.test(options)), 'control: smooth scrolling without the preference').toBe(true);
    expect(behaviours['reduce']!.some((options) => /"behavior":"smooth"/.test(options)), 'reduced motion never scrolls smoothly').toBe(false);
    expect(behaviours['reduce']!.some((options) => /"behavior":"auto"/.test(options)), 'reduced motion scrolls with behavior auto').toBe(true);
  });

  test('E2E-DEV-16 [output, GAP-28] the output page ignores the OS setting: a 1 s fade is played in full although the browser asks for reduced motion', tags('p1'), async ({ browser, api, production, onCleanup }) => {
    test.setTimeout(150_000);
    const scenes = (await production.snapshot()).scenes;
    const seen: Record<string, MotionEntry[]> = {};
    for (const motion of ['reduce', 'no-preference'] as const) {
      expect((await api.switchProgram(production.id, { sceneId: scenes[0]!.id, transition: { kind: 'cut', durationMs: 0 } })).status).toBeLessThan(300);
      expect((await api.startBroadcast(production.id)).status).toBeLessThan(400);
      const context = await newUiContext(browser, { context: { viewport: { width: 1280, height: 720 }, reducedMotion: motion } });
      onCleanup(() => context.close());
      await installMotionRecorder(context);
      const output = await OutputPage.open(context, production);
      await expect.poll(() => output.sceneIds(), { message: 'the output renders the first scene', timeout: 20_000 }).toContain(scenes[0]!.id);
      await expect.poll(() => output.slateText(), { message: 'the slate is gone while live', timeout: 20_000 }).toBe('');
      expect(await output.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce');
      await clearMotion(output.page);
      expect((await api.switchProgram(production.id, { sceneId: scenes[1]!.id, transition: { kind: 'fade', durationMs: 1000 } })).status).toBeLessThan(300);
      await expect.poll(async () => (await readMotion(output.page)).entries.filter((entry) => entry.kind === 'animate' && /opacity/.test(entry.name)).length, { message: `the output fades (${motion})`, timeout: 15_000 }).toBeGreaterThan(0);
      seen[motion] = (await readMotion(output.page)).entries.filter((entry) => entry.kind === 'animate' && /opacity/.test(entry.name));
      await expect.poll(() => output.sceneIds(), { message: 'the fade completed: one layer left', timeout: 15_000 }).toEqual([scenes[1]!.id]);
      await context.close();
      await api.resetBroadcast(production.id);
    }
    test.info().annotations.push({ type: 'motion', description: JSON.stringify(seen) });
    for (const motion of ['reduce', 'no-preference'] as const) {
      const fade = seen[motion]!.find((entry) => entry.duration === 1000);
      expect(fade, `the output plays the full 1000 ms fade with ${motion}`).toBeDefined();
    }
  });

  test('E2E-DEV-16 [sender] the sender turns transitions and the waiting animation off with reduce and keeps them otherwise', tags('p1'), async ({ browser, production, onCleanup }) => {
    test.setTimeout(150_000);
    void production; // the active production the sender pairs into
    const result: Record<string, { button: string; dot: string; dotAnimation: string }> = {};
    for (const motion of ['reduce', 'no-preference'] as const) {
      const context = await newUiContext(browser, { context: { viewport: { width: 1280, height: 720 }, reducedMotion: motion } });
      onCleanup(() => context.close());
      const page = await context.newPage();
      await page.goto('/join/');
      await page.getByLabel('Device name').fill(`Laptop Motion ${motion}`);
      await page.getByRole('radio', { name: 'Laptop (screen)' }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByTestId('check-code')).toBeVisible();
      result[motion] = await page.evaluate(() => {
        const button = document.querySelector('.c-button') as HTMLElement;
        const dot = document.querySelector('.c-pulse__dot') as HTMLElement;
        return { button: getComputedStyle(button).transitionDuration, dot: getComputedStyle(dot).animationDuration, dotAnimation: getComputedStyle(dot).animationName };
      });
      if (motion === 'reduce') {
        const offenders = await nonZeroDurations(page);
        expect(offenders.map((entry) => `${entry.element}${entry.pseudo} ${entry.property}: ${entry.value}`), 'sender: every computed duration is 0 s with reduce').toEqual([]);
      }
      await context.close();
    }
    test.info().annotations.push({ type: 'sender-motion', description: JSON.stringify(result) });
    expect(parseFloat(result['no-preference']!.button), 'control: buttons transition without the preference').toBeGreaterThan(0);
    expect(result['no-preference']!.dotAnimation, 'control: the waiting dots animate without the preference').not.toBe('none');
    expect(parseFloat(result['reduce']!.button), 'buttons do not transition with reduce').toBe(0);
    expect(result['reduce']!.dotAnimation === 'none' || parseFloat(result['reduce']!.dot) === 0, 'the waiting dots are static with reduce').toBe(true);
  });
});

void (undefined as unknown as Page);
