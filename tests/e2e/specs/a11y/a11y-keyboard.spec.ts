import type { Page } from '@playwright/test';
import { describeActive, describeActiveSettled, labelOf, tabThrough, type FocusInfo } from '../../support/a11y/focus';
import { byName, focusTop, focused, tabTo } from '../../support/a11y/keys';
import { boxOf } from '../../support/a11y/layout';
import { openBusyRegie, settle } from '../../support/a11y/regie-setup';
import { knownBug } from '../../support/a11y/known-bug';
import { newUiContext } from '../../support/ui';
import { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-13 (keyboard-only Regie) and E2E-DEV-14 (dock moves and splitters by keyboard), docs/testing.md 2.8.
 * Nothing here uses the mouse except where a test says so (the Escape layer of a running dock drag is a pointer drag
 * by definition). State is read through the API and the DOM, never through the pointer.
 */

const tags = (priority: 'p0' | 'p1' | 'p2') => t.with(`@${priority}`, '@a11y', '@keyboard');
const VIEWPORT = { width: 1440, height: 900 };

/** Where a tab stop belongs, in the order the plan expects: toolbar, activity bar, monitors + control column, docks in zone order. */
function areaRank(info: FocusInfo): number {
  if (info.area === 'header') return 0;
  if (info.area === 'region:Activity') return 1;
  if (/^(group:Items of the scene|section:Monitors|region:Preview$|region:Program$|group:Transition type|group:Fade duration)/.test(info.area)) return 2;
  if (info.role === 'separator' && info.name === 'Height of the docks at the bottom') return 3;
  // a toast's Dismiss is a transient stop wherever the toast host sits; a labelled group counts for its dock
  if (info.area === 'status') return -1;
  const dock = /^region:(Scenes|Sources of the scene|Properties|Add device|Devices|Audio)$/.exec(info.area)?.[1] ?? /^(Scenes|Sources of the scene|Properties|Add device|Devices|Audio)$/.exec(info.region ?? '')?.[1];
  if (dock) return { Scenes: 4, 'Sources of the scene': 5, Properties: 6, 'Add device': 6, Devices: 7, Audio: 8 }[dock]!;
  return 99;
}

async function programSceneId(regie: RegiePage, productionId: string): Promise<string | null> {
  return (await regie.requireAdmin().getSnapshot(productionId)).body.production.programSceneId;
}
async function previewSceneId(regie: RegiePage, productionId: string): Promise<string | null> {
  return (await regie.requireAdmin().getSnapshot(productionId)).body.production.previewSceneId;
}

test.describe('Keyboard-only Regie', () => {
  test('E2E-DEV-13 [login] the login form works without a mouse: Tab to the fields, Enter submits, a wrong password is announced', tags('p0'), async ({ browser, onCleanup, config }) => {
    const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => context.close());
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await focusTop(page);
    // the first Tab stop is the user name, the second the password, the third “Sign in”
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'first stop').toBe('Username');
    await page.keyboard.type(config.admin.username);
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'second stop').toBe('Password');
    await page.keyboard.type('wrong-password-12345');
    await page.keyboard.press('Enter');
    const error = page.getByRole('alert').filter({ hasText: /\S/ });
    await expect(error, 'a wrong password is announced in an alert').toContainText('Wrong username or password');
    await expect(page, 'still on the login page').toHaveURL(/\/login/);
    // the password is cleared or kept; type the right one by keyboard only
    await page.getByLabel('Password').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(config.admin.password);
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'third stop shows the password').toBe('Show password');
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'fourth stop explains a forgotten password').toBe('Forgot your password?');
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'fifth stop is the submit button').toBe('Sign in');
    const ring = (await describeActiveSettled(page))!.ring;
    expect(ring.kind, 'the submit button shows the focus outline').toBe('outline');
    await page.keyboard.press('Space');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
  });

  test('E2E-DEV-13 [tab order] every control is reachable in a logical order with a visible focus indicator, closed station details and hidden docks are skipped, there is no trap', tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
    const { page } = regie;
    const stops = await tabThrough(page);
    await test.info().attach('tab-order.txt', { body: stops.map((stop) => `${String(stop.index).padStart(3)} ${stop.info.ring.kind.padEnd(8)} ${stop.info.role.padEnd(10)} ${stop.info.name.slice(0, 60)}  [${stop.info.area}]`).join('\n'), contentType: 'text/plain' });
    expect(stops.length, 'a lot of stops, and the walk ended by wrapping or leaving the page (no trap)').toBeGreaterThan(40);
    expect(stops.length, 'the walk ended before the safety limit').toBeLessThan(200);

    // every stop shows a focus indicator (2 px blue outline; hairline for separators; blue border for fields)
    const without = stops.filter((stop) => !stop.info.ring.visible).map((stop) => labelOf(stop.info));
    expect(without, 'every tab stop shows a visible focus indicator').toEqual([]);
    for (const stop of stops.filter((entry) => entry.info.ring.kind === 'outline')) {
      expect(stop.info.ring.outlineWidth, `outline width of ${labelOf(stop.info)}`).toBeGreaterThanOrEqual(2);
    }
    // every stop has an accessible name and is inside the viewport (the browser scrolled it in)
    expect(stops.filter((stop) => stop.info.name.trim() === '').map((stop) => `${stop.info.role} (${stop.info.area}) ${stop.info.className}`), 'every tab stop has an accessible name').toEqual([]);
    expect(stops.filter((stop) => !stop.info.inViewport).map((stop) => labelOf(stop.info)), 'every tab stop is inside the viewport').toEqual([]);

    // logical order: toolbar -> activity bar -> monitors/control column -> docks in zone order
    const ranked = stops.filter((stop) => areaRank(stop.info) >= 0);
    const ranks = ranked.map((stop) => areaRank(stop.info));
    expect(ranks.filter((rank) => rank === 99), 'every stop belongs to a known area').toEqual([]);
    const decreasing = ranks.flatMap((rank, index) => (index > 0 && rank < ranks[index - 1]! ? [`${labelOf(ranked[index - 1]!.info)} -> ${labelOf(ranked[index]!.info)}`] : []));
    expect(decreasing, 'the tab order follows toolbar, activity bar, monitors and controls, then the docks left to right').toEqual([]);

    // the controls of the control column come after the monitor overlay, Take last
    const names = stops.map((stop) => stop.info.name);
    expect(names.indexOf('Studio Mode'), 'the switch follows the monitors').toBeGreaterThan(names.findIndex((name) => name.startsWith('Items of the scene')));
    expect(names.findIndex((name) => /^Take/i.test(name)), 'Take follows the duration stepper').toBeGreaterThan(names.indexOf('Longer fade'));

    // closed station details are inert: none of their buttons is a stop
    expect(names.filter((name) => /^(Camera|Message|Details|Rename|Block device|Remove|Switch camera)$/.test(name)), 'collapsed station details are not focusable').toEqual([]);

    // Shift+Tab walks back over the same stops
    await focusTop(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const third = (await describeActive(page))!;
    await page.keyboard.press('Shift+Tab');
    const second = (await describeActive(page))!;
    expect(second.name, 'Shift+Tab goes back one stop').toBe(stops[1]!.info.name);
    expect(third.name).toBe(stops[2]!.info.name);

    // expanding a station by keyboard makes its detail buttons reachable
    const row = page.locator('.c-st__row').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    const inside = (await describeActive(page))!;
    expect(inside.area, 'the next Tab enters the opened device detail').toBe('region:Devices');
    expect(inside.name, 'the first control of the opened detail').toMatch(/^(Camera|Message|Details|Rename|Ask to share again|Block device)$/);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    // hidden docks are never focusable: hide “Sources” in “Layout” by keyboard
    await page.getByRole('button', { name: 'Layout', exact: true }).focus();
    await page.keyboard.press('Enter');
    const sources = page.getByRole('switch', { name: 'Sources' });
    await sources.focus();
    await page.keyboard.press('Space');
    await expect(sources).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Sources of the scene' })).toHaveCount(0);
    const after = await tabThrough(page);
    expect(after.filter((stop) => stop.info.area === 'region:Sources of the scene').map((stop) => labelOf(stop.info)), 'a hidden dock has no tab stops').toEqual([]);
    expect(after.some((stop) => stop.info.area === 'region:Scenes'), 'the other docks are still reachable').toBe(true);
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-13 [keys] keys 1-9 switch scenes, Cut and Studio Mode by Space on their controls, Space takes, Space on a focused button activates it and does not take, Enter on Take takes once', tags('p0'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false });
    const { page } = regie;
    const id = (index: number) => seeded.scenes[index]!.id;
    expect(await programSceneId(regie, production.id), 'the first scene is on air').toBe(id(0));

    // the transition is chosen by keyboard: Tab to “Cut”, Space (a button: Space activates it)
    await focusTop(page);
    await tabTo(page, byName('Cut', 'button'), { what: 'Cut' });
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Cut')).toHaveAttribute('aria-pressed', 'true');
    expect(await programSceneId(regie, production.id), 'Space on a button does not take or switch').toBe(id(0));

    // Studio Mode off: a key goes live directly
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('3');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'key 3 switches the Program to scene 3' }).toBe(id(2));
    await expect(regie.scene('Break')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'key 1 switches back' }).toBe(id(0));

    // Studio Mode by keyboard: Tab to the switch, Space toggles it and does not take
    await focusTop(page);
    await tabTo(page, byName('Studio Mode', 'switch'), { what: 'the Studio Mode switch' });
    await page.keyboard.press('Space');
    await expect(regie.studioModeSwitch()).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('studioflow.studio')), 'the mode is stored').toBe('1');
    expect(await programSceneId(regie, production.id), 'Space on the switch toggles it and does not take').toBe(id(0));
    await expect(page.getByRole('button', { name: /^Take/ })).toHaveAttribute('aria-keyshortcuts', 'Space');

    // the scene keys work once the focus is on a control that is not a field (Tab leaves the switch): the Preview follows
    await page.keyboard.press('Tab');
    await page.keyboard.press('4');
    await expect.poll(() => previewSceneId(regie, production.id), { message: 'key 4 loads scene 4 into the Preview' }).toBe(id(3));
    expect(await programSceneId(regie, production.id), 'the Program is unchanged until Take').toBe(id(0));

    // Space and Enter on a focused button activate that button and do not take: the duration stepper (Fade first)
    await regie.transitionOption('Fade').focus();
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Fade')).toHaveAttribute('aria-pressed', 'true');
    const duration = page.getByRole('group', { name: 'Fade duration' });
    await expect(duration).toContainText('0.3 s');
    await tabTo(page, byName('Longer fade', 'button'), { limit: 6, what: 'Longer fade' });
    await page.keyboard.press('Space');
    await expect(duration, 'Space on the stepper button steps the duration').toContainText('0.5 s');
    await page.keyboard.press('Enter');
    await expect(duration, 'Enter on the stepper button steps the duration').toContainText('0.8 s');
    expect(await programSceneId(regie, production.id), 'neither key took the Preview live').toBe(id(0));

    // back to a cut, then Space from the document takes
    await regie.transitionOption('Cut').focus();
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Cut')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'Space from the document takes the Preview live' }).toBe(id(3));

    // Enter on the focused Take button takes once (no second take from the Space handler)
    await page.keyboard.press('5');
    await expect.poll(() => previewSceneId(regie, production.id)).toBe(id(4));
    await tabTo(page, byName(/^Take/i, 'button'), { what: 'Take' });
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/productions\//.test(request.url())) posts.push(new URL(request.url()).pathname.replace(/^\/api\/productions\/[^/]+/, ''));
    });
    await page.keyboard.press('Enter');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'Enter on Take takes the Preview live' }).toBe(id(4));
    await expect.poll(() => posts.length, { message: 'the take request was sent' }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(posts, 'Enter on the focused Take button sends exactly one request').toHaveLength(1);
  });

  test('E2E-DEV-13 [keys, switch focus] after toggling Studio Mode the scene keys and Space still work while the switch keeps the focus', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-04', 'the Studio Mode switch is an input element, so the global keys 1-9 and Space treat it as a text field and do nothing while it has the focus');
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false });
    const { page } = regie;
    await focusTop(page);
    await tabTo(page, byName('Studio Mode', 'switch'), { what: 'the Studio Mode switch' });
    await page.keyboard.press('Space');
    await expect(regie.studioModeSwitch()).toBeChecked();
    expect((await focused(page)).role, 'the switch still has the focus after Space').toBe('switch');
    await page.keyboard.press('4');
    await expect.poll(() => previewSceneId(regie, production.id), { message: 'key 4 loads scene 4 into the Preview while the switch has the focus', timeout: 4000 }).toBe(seeded.scenes[3]!.id);
  });

  test('E2E-DEV-13 [popovers] every popover opens by keyboard, focuses its first item (the output chip keeps the focus), closes with Escape and returns the focus to its trigger', tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
    const { page } = regie;
    const cases: Array<{ name: string; trigger: () => ReturnType<Page['getByRole']>; popover: string; focusInside: boolean; key: 'Enter' | 'Space' }> = [
      { name: 'production menu', trigger: () => page.getByRole('button', { name: /^Production .*, menu$/ }), popover: '[role=dialog][aria-label=Production]', focusInside: true, key: 'Enter' },
      { name: 'output chip', trigger: () => page.getByRole('button', { name: /^Output/ }), popover: '[role=dialog][aria-label=Output]', focusInside: false, key: 'Space' },
      { name: 'Layout', trigger: () => page.getByRole('button', { name: 'Layout', exact: true }), popover: '[role=dialog][aria-label="Layout"]', focusInside: true, key: 'Enter' },
      { name: 'issues', trigger: () => page.getByRole('region', { name: 'Activity' }).getByRole('button', { name: /^\d+ issues?$/ }), popover: '#sf-pop-issues', focusInside: true, key: 'Enter' },
      { name: '+ Source', trigger: () => page.getByRole('button', { name: 'Add source', exact: true }), popover: '[role=menu][aria-label="Add source"]', focusInside: true, key: 'Space' },
      { name: 'scene menu', trigger: () => page.getByRole('button', { name: 'Actions for scene Break' }), popover: '[role=menu][aria-label="Scene Break"]', focusInside: true, key: 'Enter' },
    ];
    for (const entry of cases) {
      const trigger = entry.trigger();
      await trigger.focus();
      await expect(trigger, `${entry.name}: closed at first`).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press(entry.key);
      const popover = page.locator(entry.popover);
      await expect(popover, `${entry.name}: opens with ${entry.key}`).toBeVisible();
      await expect(trigger, `${entry.name}: aria-expanded is true`).toHaveAttribute('aria-expanded', 'true');
      const inside = (await describeActive(page))!;
      const isInside = await popover.evaluate((element) => element.contains(document.activeElement));
      if (entry.focusInside) {
        expect(isInside, `${entry.name}: the focus moves into the popover (${labelOf(inside)})`).toBe(true);
        expect((await describeActiveSettled(page))!.ring.visible, `${entry.name}: the focused item shows an indicator`).toBe(true);
      } else {
        expect(inside.name, `${entry.name}: the trigger keeps the focus`).toBe((await trigger.getAttribute('aria-label')) ?? inside.name);
      }
      // the popover has an accessible name and is the only one open
      // (the ⋯ menus of the redesign are the shared context menu, .c-ctx, not a .c-pop)
      expect(await page.locator('.c-pop, .c-ctx').count(), `${entry.name}: exactly one popover is open`).toBe(1);
      await page.keyboard.press('Escape');
      await expect(popover, `${entry.name}: Escape closes it`).toBeHidden();
      await expect(trigger, `${entry.name}: aria-expanded is false again`).toHaveAttribute('aria-expanded', 'false');
      const back = (await describeActive(page))!;
      expect(await trigger.evaluate((element) => element === document.activeElement), `${entry.name}: the focus returns to the trigger (is on ${labelOf(back)})`).toBe(true);
    }

    // no keyboard trap: from inside an open popover Tab leaves it (the popover stays open or closes, the page stays operable)
    await page.getByRole('button', { name: 'Layout', exact: true }).focus();
    await page.keyboard.press('Enter');
    const leave = await tabTo(page, (info) => !info.area.startsWith('dialog'), { limit: 20, what: 'a stop outside the Layout popover' });
    expect(leave, 'Tab leaves the popover').not.toBeNull();
    await page.keyboard.press('Escape');

    // the pairing dock: “Add device” is a disclosure (aria-expanded, aria-controls), Escape closes it, the focus returns
    const pair = regie.pairButton();
    await pair.focus();
    await expect(pair).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(pair).toHaveAttribute('aria-expanded', 'true');
    await expect(regie.pairingTab('phone')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(regie.pairingTab('phone')).toBeHidden();
    await expect(pair).toHaveAttribute('aria-expanded', 'false');
    expect(await pair.evaluate((element) => element === document.activeElement), 'the focus returns to “Add device” after Escape').toBe(true);
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-13 [popovers, confirmations] “Start broadcast”, “End broadcast” and the station confirmations open by keyboard with the focus on “Cancel”; Escape closes the broadcast popover and returns the focus; the media popover opens from the add-source menu', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    // off air: “Start broadcast” asks first, with the pre-flight check; the focus is on “Cancel”
    const start = page.getByRole('button', { name: 'Start broadcast' });
    await start.focus();
    await page.keyboard.press('Enter');
    const preflight = page.getByRole('dialog', { name: 'Start the broadcast?' });
    await expect(preflight, 'the pre-flight popover opens').toBeVisible();
    expect(await preflight.getByRole('button', { name: 'Cancel' }).evaluate((element) => element === document.activeElement), 'the focus is on “Cancel”').toBe(true);
    await page.keyboard.press('Escape');
    await expect(preflight).toBeHidden();
    expect(await start.evaluate((element) => element === document.activeElement), 'Escape returns the focus to “Start broadcast”').toBe(true);
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.production.broadcast, 'nothing started').toBe('standby');
    // on air: the toolbar offers “End broadcast” with a confirmation popover
    expect((await regie.requireAdmin().startBroadcast(production.id)).status).toBe(200);
    const end = page.getByRole('button', { name: 'End broadcast' }).first();
    await expect(end).toBeVisible();
    await end.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'End the broadcast?' });
    await expect(dialog, 'the confirmation popover opens').toBeVisible();
    await expect(end).toHaveAttribute('aria-expanded', 'true');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    expect(await cancel.evaluate((element) => element === document.activeElement), 'the focus is on “Cancel”, so a second Enter never confirms').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await end.evaluate((element) => element === document.activeElement), 'Escape returns the focus to “End broadcast”').toBe(true);
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.production.broadcast, 'nothing ended').toBe('live');
    // Enter twice does not end the broadcast: the first opens, the second activates “Cancel”
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.production.broadcast, 'a second Enter cancelled').toBe('live');

    // a station detail: “Block device” shows the confirmation with the focus on “Cancel”
    const row = page.locator('.c-st__row').first();
    await row.focus();
    await page.keyboard.press('Enter');
    const open = page.locator('.c-st.is-open');
    const block = open.getByRole('button', { name: 'Block device' });
    await block.focus();
    await page.keyboard.press('Enter');
    const station = open.getByRole('group', { name: 'Block device' });
    await expect(station, 'the confirmation box is a named group').toBeVisible();
    expect(await station.getByRole('button', { name: 'Cancel' }).evaluate((element) => element === document.activeElement), 'the focus is on “Cancel”').toBe(true);
    await page.keyboard.press('Enter');
    await expect(station).toBeHidden();
    await expect(block, 'the block button is still there and nothing was blocked').toBeVisible();
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.devices.some((device) => device.state === 'blocked')).toBe(false);

    // the add-source popover leads to the media popover: keyboard open, Escape closes, the focus returns to “Source”
    const add = page.getByRole('button', { name: 'Add source', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Add source' });
    await expect(menu).toBeVisible();
    const manage = menu.getByRole('menuitem', { name: /media|upload/i }).first();
    if (await manage.count()) {
      await manage.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.c-pop').first(), 'a popover is open after the media entry').toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.c-pop')).toHaveCount(0);
    }
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-13 [Escape chain] Escape closes layer by layer: popover, then the pairing dock, then the element selection; a running dock drag ends first', tags('p0'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true });
    const { page } = regie;
    // select an element of the Preview scene with the keyboard: the “Select” button of its Sources row
    await page.keyboard.press('2');
    await expect.poll(() => previewSceneId(regie, production.id)).toBe(seeded.scenes[1]!.id);
    const pick = page.getByRole('button', { name: /^Select: / }).first();
    await pick.focus();
    await page.keyboard.press('Enter');
    const selected = page.locator('.c-edit-box.is-sel');
    await expect(selected, 'the element is selected in the monitor overlay').toHaveCount(1);
    // layer 2: the pairing dock, layer 1: a popover
    await regie.pairButton().focus();
    await page.keyboard.press('Enter');
    await expect(regie.pairingTab('phone')).toBeVisible();
    const layout = page.getByRole('button', { name: 'Layout', exact: true });
    await layout.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role=dialog][aria-label="Layout"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[role=dialog][aria-label="Layout"]'), 'first Escape: the popover').toBeHidden();
    await expect(regie.pairingTab('phone'), 'the pairing dock is still open').toBeVisible();
    await expect(selected, 'the selection is still there').toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(regie.pairingTab('phone'), 'second Escape: the pairing dock').toBeHidden();
    await expect(selected, 'the selection is still there').toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(selected, 'third Escape: the selection').toHaveCount(0);

    // a dock drag by pointer is the first layer: Escape ends it without moving the dock
    const grip = page.getByRole('button', { name: 'Move dock Scenes with the arrow keys' });
    const gripBox = (await boxOf(grip))!;
    const zoneBefore = await page.locator('sf-dock-slot[aria-label=Scenes]').evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone'));
    await page.mouse.move(gripBox.x + gripBox.w / 2, gripBox.y + gripBox.h / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + 40, gripBox.y + 20, { steps: 4 });
    await page.mouse.move(60, 300, { steps: 8 });
    await expect(page.locator('.c-drop-zone'), 'the dock drag shows its drop strips').not.toHaveCount(0);
    // select an element again: Escape must end the drag, not the selection
    await page.keyboard.press('Escape');
    await expect(page.locator('.c-drop-zone'), 'Escape ends the dock drag').toHaveCount(0);
    await page.mouse.up();
    const zoneAfter = await page.locator('sf-dock-slot[aria-label=Scenes]').evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone'));
    expect(zoneAfter, 'the dock did not move').toBe(zoneBefore);
  });

  test('E2E-DEV-13 [element] an element is selected through the Sources list, moved with the arrow keys on the overlay (1 px, Shift 10 px) and deselected with Escape', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true });
    const { page } = regie;
    const api = regie.requireAdmin();
    await page.keyboard.press('2');
    await expect.poll(() => previewSceneId(regie, production.id)).toBe(seeded.scenes[1]!.id);
    const sceneId = seeded.scenes[1]!.id;
    const items = async () => (await api.getSnapshot(production.id)).body.scenes.find((scene) => scene.id === sceneId)!.items;
    const row = page.getByRole('button', { name: /^Select: / }).first();
    await row.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.c-edit-box.is-sel')).toHaveCount(1);
    const selectedId = (await page.locator('.c-edit-box.is-sel').getAttribute('data-item-id'))!;
    const before = (await items()).find((entry) => entry.id === selectedId)!;
    // the overlay is a focusable group before the control column: Shift+Tab backwards from the Sources row reaches it
    const overlay = await tabTo(page, (info) => info.role === 'group' && /^Items of the scene\./.test(info.name), { back: true, limit: 60, what: 'the monitor overlay' });
    expect(overlay.ring.visible, 'the overlay shows a focus indicator').toBe(true);
    for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => { const item = (await items()).find((entry) => entry.id === selectedId)!; return `${item.x - before.x},${item.y - before.y}`; }, { message: 'three ArrowRight = +3 px, Shift+ArrowDown = +10 px', timeout: 10_000 }).toBe('3,10');
    await page.keyboard.press('Escape');
    await expect(page.locator('.c-edit-box.is-sel'), 'Escape deselects').toHaveCount(0);
  });
});

test.describe('Dock moves and splitters by keyboard', () => {
  const zoneOf = (page: Page, name: string) => page.locator(`sf-dock-slot[aria-label="${name}"]`).evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone') ?? null);

  test('E2E-DEV-14 [grip] the grip arrows move a dock step by step through left, bottom and right with a toast and “Undo”; the focus stays on the grip, no move beyond the ends, persisted', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    const grip = page.getByRole('button', { name: 'Move dock Scenes with the arrow keys' });
    const toast = regie.toast().first();
    const focusIsOnGrip = () => grip.evaluate((element) => element === document.activeElement);
    const bottomOrder = () => page.locator('[data-zone=bottom] sf-dock-slot').evaluateAll((docks) => docks.map((dock) => dock.getAttribute('aria-label')));
    await grip.focus();
    expect(await zoneOf(page, 'Scenes')).toBe('bottom');
    expect(await bottomOrder(), 'default order').toEqual(['Scenes', 'Sources of the scene', 'Properties', 'Devices', 'Audio']);

    // ArrowLeft at the start of the bottom zone continues in the left zone
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Scenes'), { message: 'ArrowLeft: left zone' }).toBe('left');
    await expect(toast).toContainText('Scenes is docked on the left');
    await expect(toast.getByRole('button', { name: 'Undo' }), 'the toast offers “Undo”').toBeVisible();
    await expect.poll(focusIsOnGrip, { message: 'the focus stays on the grip' }).toBe(true);
    // no move beyond the left end: nothing changes
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    expect(await zoneOf(page, 'Scenes'), 'no move beyond the left end').toBe('left');
    expect(await focusIsOnGrip()).toBe(true);

    // ArrowDown: back to the bottom zone, then one place per key press through the zone, then the right zone
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => zoneOf(page, 'Scenes')).toBe('bottom');
    await expect(toast).toContainText('Scenes is docked at the bottom');
    await expect.poll(focusIsOnGrip).toBe(true);
    for (let press = 1; press <= 4; press++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await bottomOrder()).indexOf('Scenes'), { message: `press ${press}: the dock moves one place inside the bottom zone` }).toBe(press);
      await expect.poll(focusIsOnGrip, { message: `the focus stays on the grip after press ${press}` }).toBe(true);
      expect(await zoneOf(page, 'Scenes')).toBe('bottom');
    }
    // the fifth press leaves the bottom zone for the right zone
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => zoneOf(page, 'Scenes'), { message: 'the dock reaches the right zone' }).toBe('right');
    await expect.poll(focusIsOnGrip).toBe(true);
    await expect(toast).toContainText('Scenes is docked on the right');
    // no move beyond the right end
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await zoneOf(page, 'Scenes'), 'no move beyond the right end').toBe('right');
    // back one step: the bottom zone again
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Scenes')).toBe('bottom');
    await expect(toast).toContainText('Scenes is docked at the bottom');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => zoneOf(page, 'Scenes')).toBe('right');

    // aria: the toast is a polite live region in the language of the document
    const live = await page.locator('sf-toast-host').evaluate((host) => ({ role: host.getAttribute('role'), live: host.getAttribute('aria-live') }));
    expect(live).toEqual({ role: 'status', live: 'polite' });
    expect(await page.evaluate(() => document.documentElement.lang), 'the toast text is announced in the language of the document').toBe('en');
    // persisted: the layout survives a reload
    const stored = await page.evaluate(() => localStorage.getItem('studioflow.layout'));
    expect(stored, 'the layout is stored').not.toBeNull();
    await page.reload();
    await regie.waitReady();
    expect(await zoneOf(page, 'Scenes'), 'the layout survives a reload').toBe('right');
    // “Undo” from the toast by keyboard puts the dock back where it was before the last move
    await page.getByRole('button', { name: 'Move dock Scenes with the arrow keys' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Scenes')).toBe('bottom');
    const undo = regie.toast().first().getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(regie.toast().first()).toContainText('Move of Scenes undone');
    await expect.poll(() => zoneOf(page, 'Scenes'), { message: 'the move is undone' }).toBe('right');
  });

  test('E2E-DEV-14 [splitters] separators are named and oriented; arrows move them 16 px (Shift 64 px) within their bounds, Enter resets, the change persists', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true, stations: 2 });
    const { page } = regie;
    const splitters = await page.getByRole('separator').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('aria-label'), orientation: element.getAttribute('aria-orientation'), tabindex: element.getAttribute('tabindex') })));
    expect(splitters.map((entry) => entry.name).sort(), 'the separators of the default layout').toEqual(
      ['Size of Devices and Audio', 'Size of Properties and Devices', 'Size of Preview and Program', 'Size of Sources and Properties', 'Size of Scenes and Sources', 'Height of the docks at the bottom'].sort(),
    );
    for (const entry of splitters) {
      expect(entry.orientation, `${entry.name}: aria-orientation`).toBe(entry.name === 'Height of the docks at the bottom' ? 'horizontal' : 'vertical');
      expect(entry.tabindex, `${entry.name}: focusable`).toBe('0');
    }
    const settleLayout = () => settle(page);

    // bottom zone height: ArrowUp grows the docks by 16 px, Shift+ArrowUp by 64 px, ArrowDown shrinks, Enter resets
    const bottom = page.getByRole('separator', { name: 'Height of the docks at the bottom' });
    const dockHeight = async () => Math.round((await boxOf(page.locator('[data-zone=bottom]')))!.h);
    const start = await dockHeight();
    await bottom.focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(dockHeight, { message: 'ArrowUp: docks 16 px higher' }).toBe(start + 16);
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(dockHeight, { message: 'Shift+ArrowUp: another 64 px' }).toBe(start + 80);
    await page.keyboard.press('ArrowDown');
    await expect.poll(dockHeight, { message: 'ArrowDown: 16 px lower' }).toBe(start + 64);
    expect(await page.evaluate(() => localStorage.getItem('studioflow.layout')), 'the height is stored').toContain('bottomH');
    await page.keyboard.press('Enter');
    await expect.poll(dockHeight, { message: 'Enter resets the height' }).toBe(start);
    // bounds: pushing the hairline up and down never leaves the allowed range (stage >= 160 px, docks >= 150 px)
    for (let index = 0; index < 20; index++) await page.keyboard.press('Shift+ArrowUp');
    await settleLayout();
    const tallest = await dockHeight();
    const stageMin = (await boxOf(page.locator('.c-workspace__stage')))!.h;
    expect(stageMin, 'the stage keeps at least 160 px').toBeGreaterThanOrEqual(159);
    expect(tallest, 'the docks stay lower than the viewport').toBeLessThan(900);
    for (let index = 0; index < 30; index++) await page.keyboard.press('Shift+ArrowDown');
    await settleLayout();
    expect(await dockHeight(), 'the docks keep at least 150 px').toBeGreaterThanOrEqual(150);
    await page.keyboard.press('Enter');
    await expect.poll(dockHeight).toBe(start);

    // vertical hairline between two docks (the middle seam): every arrow key moves it by exactly 16 px, Shift by 64 px, Enter resets
    const between = page.getByRole('separator', { name: 'Size of Sources and Properties' });
    const seamX = async () => (await boxOf(between))!.x;
    const seam0 = await seamX();
    await between.focus();
    for (const [key, delta] of [['ArrowRight', 16], ['ArrowRight', 16], ['Shift+ArrowRight', 64], ['ArrowLeft', -16], ['Shift+ArrowLeft', -64], ['ArrowLeft', -16]] as const) {
      const before = await seamX();
      await page.keyboard.press(key);
      await expect.poll(async () => Math.abs((await seamX()) - before - delta), { message: `${key} moves the seam by ${delta} px` }).toBeLessThan(0.75);
    }
    await page.keyboard.press('Enter');
    await expect.poll(async () => Math.abs((await seamX()) - seam0), { message: 'Enter resets the dock weights' }).toBeLessThan(0.75);

    // monitor split (Studio Mode): ArrowLeft moves the hairline, Enter resets
    const split = page.getByRole('separator', { name: 'Size of Preview and Program' });
    const previewWidth = async () => Math.round((await boxOf(page.locator('sf-monitor[kind=preview] .c-monitor__screen')))!.w);
    const preview0 = await previewWidth();
    await split.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(previewWidth, { message: 'ArrowLeft: the Preview gets narrower' }).toBeLessThan(preview0);
    await page.keyboard.press('Enter');
    await expect.poll(previewWidth, { message: 'Enter resets the split' }).toBe(preview0);
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-14 [splitters, edge docks] the seams next to the outer docks move by exactly 16 px (Shift 64 px) per arrow key', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    knownBug('A11Y-13', 'the seam between Scenes and Sources moves 20.3 px and the seam between Devices and Audio (the outer docks) 11.6 px per ArrowRight instead of 16 px (the dock at the window edge carries a 16 px gutter inside its flex weight); same finding as REGIE-02 of the regie area');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    const problems: string[] = [];
    for (const name of ['Size of Scenes and Sources', 'Size of Devices and Audio']) {
      const seam = page.getByRole('separator', { name });
      await seam.focus();
      const x = async () => (await boxOf(seam))!.x;
      // Each step is undone before the next one: a dock is at least 180 px wide, so at 1440 px Scenes and Sources have no room for 16 + 64 px in one direction.
      for (const [key, delta] of [['ArrowRight', 16], ['ArrowLeft', -16], ['Shift+ArrowRight', 64], ['Shift+ArrowLeft', -64]] as const) {
        const before = await x();
        await page.keyboard.press(key);
        await page.waitForTimeout(250);
        const moved = (await x()) - before;
        if (Math.abs(moved - delta) > 0.75) problems.push(`${name}: ${key} moved ${moved.toFixed(1)} px instead of ${delta}`);
      }
      await page.keyboard.press('Enter');
    }
    expect(problems, 'every arrow key moves the seam by 16 px (64 px with Shift)').toEqual([]);
  });

  test('E2E-DEV-14 [side zone] a dock moved to the right zone gets a width splitter that follows the same keys', tags('p2'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    await page.getByRole('button', { name: 'Move dock Audio with the arrow keys' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-zone=right] sf-dock-slot[aria-label=Audio]')).toHaveCount(1);
    const splitter = page.getByRole('separator', { name: 'Width of the docks on the right' });
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    const width = async () => Math.round((await boxOf(page.locator('[data-zone=right]')))!.w);
    const start = await width();
    await splitter.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width, { message: 'ArrowLeft widens the right zone by 16 px' }).toBe(start + 16);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(width, { message: 'Shift+ArrowRight narrows it by 64 px' }).toBe(start - 48);
    await page.keyboard.press('Enter');
    await expect.poll(width).toBe(start);
  });
});
