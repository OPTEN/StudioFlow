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

/** Where a tab stop belongs, in the order the plan expects: header, strip, monitors + control column, docks in zone order. */
function areaRank(info: FocusInfo): number {
  if (info.area === 'header') return 0;
  if (info.area === 'region:Meldungen') return 1;
  if (/^(group:Elemente der Szene|section:Monitore|group:Art des Übergangs|group:Dauer der Blende)/.test(info.area)) return 2;
  if (info.role === 'separator' && info.name === 'Höhe der Docks unten') return 3;
  const dock = /^region:(Szenen|Quellen der Szene|Eigenschaften|Gerät koppeln|Stationen)$/.exec(info.area)?.[1];
  if (dock) return { Szenen: 4, 'Quellen der Szene': 5, Eigenschaften: 6, 'Gerät koppeln': 6, Stationen: 7 }[dock]!;
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
    await expect(page.getByLabel('Benutzername')).toBeVisible();
    await focusTop(page);
    // the first Tab stop is the user name, the second the password, the third «Anmelden»
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'first stop').toBe('Benutzername');
    await page.keyboard.type(config.admin.username);
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'second stop').toBe('Passwort');
    await page.keyboard.type('falsches-Passwort-12345');
    await page.keyboard.press('Enter');
    const error = page.getByRole('alert').filter({ hasText: /\S/ });
    await expect(error, 'a wrong password is announced in an alert').toContainText('Benutzername oder Passwort ist falsch');
    await expect(page, 'still on the login page').toHaveURL(/\/login/);
    // the password is cleared or kept; type the right one by keyboard only
    await page.getByLabel('Passwort').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(config.admin.password);
    await page.keyboard.press('Tab');
    expect((await focused(page)).name, 'third stop is the submit button').toBe('Anmelden');
    const ring = (await describeActiveSettled(page))!.ring;
    expect(ring.kind, 'the submit button shows the focus outline').toBe('outline');
    await page.keyboard.press('Space');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByRole('button', { name: 'Docks und Layout' })).toBeVisible();
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

    // logical order: header -> strip -> monitors/control column -> docks in zone order
    const ranks = stops.map((stop) => areaRank(stop.info));
    expect(ranks.filter((rank) => rank === 99), 'every stop belongs to a known area').toEqual([]);
    const decreasing = ranks.flatMap((rank, index) => (index > 0 && rank < ranks[index - 1]! ? [`${labelOf(stops[index - 1]!.info)} -> ${labelOf(stops[index]!.info)}`] : []));
    expect(decreasing, 'the tab order follows header, strip, monitors and controls, then the docks left to right').toEqual([]);

    // the controls of the control column come after the monitor overlay, Take last
    const names = stops.map((stop) => stop.info.name);
    expect(names.indexOf('Studio-Modus'), 'the switch follows the monitors').toBeGreaterThan(names.findIndex((name) => name.startsWith('Elemente der Szene')));
    expect(names.findIndex((name) => /^Take/i.test(name)), 'Take follows the duration stepper').toBeGreaterThan(names.indexOf('Blende länger'));

    // closed station details are inert: none of their buttons is a stop
    expect(names.filter((name) => /^(Nachricht senden|Umbenennen|Gerät sperren|Kamera wechseln)$/.test(name)), 'collapsed station details are not focusable').toEqual([]);

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
    expect(inside.area, 'the next Tab enters the opened station detail').toBe('region:Stationen');
    expect(inside.name, 'the first control of the opened detail').toMatch(/Nachricht senden|Umbenennen|Kamera wechseln|Neu teilen lassen|Gerät sperren/);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    // hidden docks are never focusable: hide «Quellen» in «Docks und Layout» by keyboard
    await page.getByRole('button', { name: 'Docks und Layout' }).focus();
    await page.keyboard.press('Enter');
    const quellen = page.getByRole('checkbox', { name: 'Quellen' });
    await quellen.focus();
    await page.keyboard.press('Space');
    await expect(quellen).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Quellen der Szene' })).toHaveCount(0);
    const after = await tabThrough(page);
    expect(after.filter((stop) => stop.info.area === 'region:Quellen der Szene').map((stop) => labelOf(stop.info)), 'a hidden dock has no tab stops').toEqual([]);
    expect(after.some((stop) => stop.info.area === 'region:Szenen'), 'the other docks are still reachable').toBe(true);
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-13 [keys] keys 1-9 switch scenes, Schnitt and Studio-Modus by Space on their controls, Space takes, Space on a focused button activates it and does not take, Enter on Take takes once', tags('p0'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false });
    const { page } = regie;
    const id = (index: number) => seeded.scenes[index]!.id;
    expect(await programSceneId(regie, production.id), 'the first scene is on air').toBe(id(0));

    // the transition is chosen by keyboard: Tab to «Schnitt», Space (a button: Space activates it)
    await focusTop(page);
    await tabTo(page, byName('Schnitt', 'button'), { what: 'Schnitt' });
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Schnitt')).toHaveAttribute('aria-pressed', 'true');
    expect(await programSceneId(regie, production.id), 'Space on a button does not take or switch').toBe(id(0));

    // Studio-Modus off: a key goes live directly
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('3');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'key 3 switches the Program to scene 3' }).toBe(id(2));
    await expect(regie.scene('Pause')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    await expect.poll(() => programSceneId(regie, production.id), { message: 'key 1 switches back' }).toBe(id(0));

    // Studio-Modus by keyboard: Tab to the switch, Space toggles it and does not take
    await focusTop(page);
    await tabTo(page, byName('Studio-Modus', 'switch'), { what: 'the Studio-Modus switch' });
    await page.keyboard.press('Space');
    await expect(regie.studioModeSwitch()).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('flowstudio.studio')), 'the mode is stored').toBe('1');
    expect(await programSceneId(regie, production.id), 'Space on the switch toggles it and does not take').toBe(id(0));
    await expect(page.getByRole('button', { name: /^Take/ })).toHaveAttribute('aria-keyshortcuts', 'Space');

    // the scene keys work once the focus is on a control that is not a field (Tab leaves the switch): the Preview follows
    await page.keyboard.press('Tab');
    await page.keyboard.press('4');
    await expect.poll(() => previewSceneId(regie, production.id), { message: 'key 4 loads scene 4 into the Preview' }).toBe(id(3));
    expect(await programSceneId(regie, production.id), 'the Program is unchanged until Take').toBe(id(0));

    // Space and Enter on a focused button activate that button and do not take: the duration stepper (Blende first)
    await regie.transitionOption('Blende').focus();
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Blende')).toHaveAttribute('aria-pressed', 'true');
    const duration = page.getByRole('group', { name: 'Dauer der Blende' });
    await expect(duration).toContainText('0,3 s');
    await tabTo(page, byName('Blende länger', 'button'), { limit: 6, what: 'Blende länger' });
    await page.keyboard.press('Space');
    await expect(duration, 'Space on the stepper button steps the duration').toContainText('0,5 s');
    await page.keyboard.press('Enter');
    await expect(duration, 'Enter on the stepper button steps the duration').toContainText('0,8 s');
    expect(await programSceneId(regie, production.id), 'neither key took the Preview live').toBe(id(0));

    // back to a cut, then Space from the document takes
    await regie.transitionOption('Schnitt').focus();
    await page.keyboard.press('Space');
    await expect(regie.transitionOption('Schnitt')).toHaveAttribute('aria-pressed', 'true');
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

  test('E2E-DEV-13 [keys, switch focus] after toggling Studio-Modus the scene keys and Space still work while the switch keeps the focus', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-04', 'the Studio-Modus switch is an input element, so the global keys 1-9 and Space treat it as a text field and do nothing while it has the focus');
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false });
    const { page } = regie;
    await focusTop(page);
    await tabTo(page, byName('Studio-Modus', 'switch'), { what: 'the Studio-Modus switch' });
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
      { name: 'production menu', trigger: () => page.getByRole('button', { name: /^Produktion .*, Menü$/ }), popover: '[role=dialog][aria-label=Produktion]', focusInside: true, key: 'Enter' },
      { name: 'output chip', trigger: () => page.getByRole('button', { name: /^Output an Proxy/ }), popover: '[role=dialog][aria-label=Output]', focusInside: false, key: 'Space' },
      { name: 'Docks und Layout', trigger: () => page.getByRole('button', { name: 'Docks und Layout' }), popover: '[role=dialog][aria-label="Docks und Layout"]', focusInside: true, key: 'Enter' },
      { name: '+ Quelle', trigger: () => page.getByRole('button', { name: 'Quelle', exact: true }), popover: '[role=menu][aria-label="Quelle hinzufügen"]', focusInside: true, key: 'Space' },
      { name: 'scene menu', trigger: () => page.getByRole('button', { name: 'Aktionen für Szene Pause' }), popover: '[role=menu][aria-label="Szene Pause"]', focusInside: true, key: 'Enter' },
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
      expect(await page.locator('.c-pop').count(), `${entry.name}: exactly one popover is open`).toBe(1);
      await page.keyboard.press('Escape');
      await expect(popover, `${entry.name}: Escape closes it`).toBeHidden();
      await expect(trigger, `${entry.name}: aria-expanded is false again`).toHaveAttribute('aria-expanded', 'false');
      const back = (await describeActive(page))!;
      expect(await trigger.evaluate((element) => element === document.activeElement), `${entry.name}: the focus returns to the trigger (is on ${labelOf(back)})`).toBe(true);
    }

    // no keyboard trap: from inside an open popover Tab leaves it (the popover stays open or closes, the page stays operable)
    await page.getByRole('button', { name: 'Docks und Layout' }).focus();
    await page.keyboard.press('Enter');
    const leave = await tabTo(page, (info) => !info.area.startsWith('dialog'), { limit: 20, what: 'a stop outside the Docks und Layout popover' });
    expect(leave, 'Tab leaves the popover').not.toBeNull();
    await page.keyboard.press('Escape');

    // the pairing dock: «Gerät koppeln» is a disclosure (aria-expanded, aria-controls), Escape closes it, the focus returns
    const pair = regie.pairButton();
    await pair.focus();
    await expect(pair).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(pair).toHaveAttribute('aria-expanded', 'true');
    await expect(regie.pairingTab('phone')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(regie.pairingTab('phone')).toBeHidden();
    await expect(pair).toHaveAttribute('aria-expanded', 'false');
    expect(await pair.evaluate((element) => element === document.activeElement), 'the focus returns to «Gerät koppeln» after Escape').toBe(true);
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-13 [popovers, confirmations] «Sendung beenden» and the station confirmations open by keyboard with the focus on «Abbrechen»; Escape closes the broadcast popover and returns the focus; the media popover opens from the add-source menu', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    // on air: the header offers «Sendung beenden» with a confirmation popover
    expect((await regie.requireAdmin().startBroadcast(production.id)).status).toBe(200);
    const end = page.getByRole('button', { name: 'Sendung beenden' }).first();
    await expect(end).toBeVisible();
    await end.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Sendung beenden' });
    await expect(dialog, 'the confirmation popover opens').toBeVisible();
    await expect(end).toHaveAttribute('aria-expanded', 'true');
    const cancel = dialog.getByRole('button', { name: 'Abbrechen' });
    expect(await cancel.evaluate((element) => element === document.activeElement), 'the focus is on «Abbrechen», so a second Enter never confirms').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await end.evaluate((element) => element === document.activeElement), 'Escape returns the focus to «Sendung beenden»').toBe(true);
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.production.broadcast, 'nothing ended').toBe('live');
    // Enter twice does not end the broadcast: the first opens, the second activates «Abbrechen»
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.production.broadcast, 'a second Enter cancelled').toBe('live');

    // a station detail: «Gerät sperren» shows the confirmation with the focus on «Abbrechen»
    const row = page.locator('.c-st__row').first();
    await row.focus();
    await page.keyboard.press('Enter');
    const open = page.locator('.c-st.is-open');
    const block = open.getByRole('button', { name: 'Gerät sperren' });
    await block.focus();
    await page.keyboard.press('Enter');
    const station = open.getByRole('group', { name: 'Gerät sperren' });
    await expect(station, 'the confirmation box is a named group').toBeVisible();
    expect(await station.getByRole('button', { name: 'Abbrechen' }).evaluate((element) => element === document.activeElement), 'the focus is on «Abbrechen»').toBe(true);
    await page.keyboard.press('Enter');
    await expect(station).toBeHidden();
    await expect(block, 'the block button is still there and nothing was blocked').toBeVisible();
    expect((await regie.requireAdmin().getSnapshot(production.id)).body.devices.some((device) => device.state === 'blocked')).toBe(false);

    // the add-source popover leads to the media popover: keyboard open, Escape closes, the focus returns to «Quelle»
    const add = page.getByRole('button', { name: 'Quelle', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Quelle hinzufügen' });
    await expect(menu).toBeVisible();
    const manage = menu.getByRole('menuitem', { name: /Medien|Medium|hochladen/i }).first();
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
    // select an element of the Preview scene with the keyboard: the «Auswählen» button of its Quellen row
    await page.keyboard.press('2');
    await expect.poll(() => previewSceneId(regie, production.id)).toBe(seeded.scenes[1]!.id);
    const pick = page.getByRole('button', { name: /^Auswählen: / }).first();
    await pick.focus();
    await page.keyboard.press('Enter');
    const selected = page.locator('.c-edit-box.is-sel');
    await expect(selected, 'the element is selected in the monitor overlay').toHaveCount(1);
    // layer 2: the pairing dock, layer 1: a popover
    await regie.pairButton().focus();
    await page.keyboard.press('Enter');
    await expect(regie.pairingTab('phone')).toBeVisible();
    const layout = page.getByRole('button', { name: 'Docks und Layout' });
    await layout.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role=dialog][aria-label="Docks und Layout"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[role=dialog][aria-label="Docks und Layout"]'), 'first Escape: the popover').toBeHidden();
    await expect(regie.pairingTab('phone'), 'the pairing dock is still open').toBeVisible();
    await expect(selected, 'the selection is still there').toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(regie.pairingTab('phone'), 'second Escape: the pairing dock').toBeHidden();
    await expect(selected, 'the selection is still there').toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(selected, 'third Escape: the selection').toHaveCount(0);

    // a dock drag by pointer is the first layer: Escape ends it without moving the dock
    const grip = page.getByRole('button', { name: 'Dock Szenen verschieben, mit Pfeiltasten' });
    const gripBox = (await boxOf(grip))!;
    const zoneBefore = await page.locator('fs-dock-slot[aria-label=Szenen]').evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone'));
    await page.mouse.move(gripBox.x + gripBox.w / 2, gripBox.y + gripBox.h / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + 40, gripBox.y + 20, { steps: 4 });
    await page.mouse.move(60, 300, { steps: 8 });
    await expect(page.locator('.c-drop-zone'), 'the dock drag shows its drop strips').not.toHaveCount(0);
    // select an element again: Escape must end the drag, not the selection
    await page.keyboard.press('Escape');
    await expect(page.locator('.c-drop-zone'), 'Escape ends the dock drag').toHaveCount(0);
    await page.mouse.up();
    const zoneAfter = await page.locator('fs-dock-slot[aria-label=Szenen]').evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone'));
    expect(zoneAfter, 'the dock did not move').toBe(zoneBefore);
  });

  test('E2E-DEV-13 [element] an element is selected through the Quellen list, moved with the arrow keys on the overlay (1 px, Shift 10 px) and deselected with Escape', tags('p1'), async ({ openRegie, pairContext, onCleanup, production }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true });
    const { page } = regie;
    const api = regie.requireAdmin();
    await page.keyboard.press('2');
    await expect.poll(() => previewSceneId(regie, production.id)).toBe(seeded.scenes[1]!.id);
    const sceneId = seeded.scenes[1]!.id;
    const items = async () => (await api.getSnapshot(production.id)).body.scenes.find((scene) => scene.id === sceneId)!.items;
    const row = page.getByRole('button', { name: /^Auswählen: / }).first();
    await row.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.c-edit-box.is-sel')).toHaveCount(1);
    const selectedId = (await page.locator('.c-edit-box.is-sel').getAttribute('data-item-id'))!;
    const before = (await items()).find((entry) => entry.id === selectedId)!;
    // the overlay is a focusable group before the control column: Shift+Tab backwards from the Quellen row reaches it
    const overlay = await tabTo(page, (info) => info.role === 'group' && /^Elemente der Szene\./.test(info.name), { back: true, limit: 60, what: 'the monitor overlay' });
    expect(overlay.ring.visible, 'the overlay shows a focus indicator').toBe(true);
    for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => { const item = (await items()).find((entry) => entry.id === selectedId)!; return `${item.x - before.x},${item.y - before.y}`; }, { message: 'three ArrowRight = +3 px, Shift+ArrowDown = +10 px', timeout: 10_000 }).toBe('3,10');
    await page.keyboard.press('Escape');
    await expect(page.locator('.c-edit-box.is-sel'), 'Escape deselects').toHaveCount(0);
  });
});

test.describe('Dock moves and splitters by keyboard', () => {
  const zoneOf = (page: Page, name: string) => page.locator(`fs-dock-slot[aria-label="${name}"]`).evaluate((dock) => dock.closest('[data-zone]')?.getAttribute('data-zone') ?? null);

  test('E2E-DEV-14 [grip] the grip arrows move a dock step by step through left, bottom and right with a toast and «Layout zurücksetzen»; the focus stays on the grip, no move beyond the ends, persisted', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    const grip = page.getByRole('button', { name: 'Dock Szenen verschieben, mit Pfeiltasten' });
    const toast = regie.toast().first();
    const focusIsOnGrip = () => grip.evaluate((element) => element === document.activeElement);
    const bottomOrder = () => page.locator('[data-zone=bottom] fs-dock-slot').evaluateAll((docks) => docks.map((dock) => dock.getAttribute('aria-label')));
    await grip.focus();
    expect(await zoneOf(page, 'Szenen')).toBe('bottom');
    expect(await bottomOrder(), 'default order').toEqual(['Szenen', 'Quellen der Szene', 'Eigenschaften', 'Stationen']);

    // ArrowLeft at the start of the bottom zone continues in the left zone
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Szenen'), { message: 'ArrowLeft: left zone' }).toBe('left');
    await expect(toast).toContainText('Szenen ist links angedockt');
    await expect(toast.getByRole('button', { name: 'Layout zurücksetzen' }), 'the toast offers «Layout zurücksetzen»').toBeVisible();
    await expect.poll(focusIsOnGrip, { message: 'the focus stays on the grip' }).toBe(true);
    // no move beyond the left end: nothing changes
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    expect(await zoneOf(page, 'Szenen'), 'no move beyond the left end').toBe('left');
    expect(await focusIsOnGrip()).toBe(true);

    // ArrowDown: back to the bottom zone, then one place per key press through the zone, then the right zone
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => zoneOf(page, 'Szenen')).toBe('bottom');
    await expect(toast).toContainText('Szenen ist unten angedockt');
    await expect.poll(focusIsOnGrip).toBe(true);
    for (let press = 1; press <= 3; press++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await bottomOrder()).indexOf('Szenen'), { message: `press ${press}: the dock moves one place inside the bottom zone` }).toBe(press);
      await expect.poll(focusIsOnGrip, { message: `the focus stays on the grip after press ${press}` }).toBe(true);
      expect(await zoneOf(page, 'Szenen')).toBe('bottom');
    }
    // the fourth press leaves the bottom zone for the right zone
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => zoneOf(page, 'Szenen'), { message: 'the dock reaches the right zone' }).toBe('right');
    await expect.poll(focusIsOnGrip).toBe(true);
    await expect(toast).toContainText('Szenen ist rechts angedockt');
    // no move beyond the right end
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await zoneOf(page, 'Szenen'), 'no move beyond the right end').toBe('right');
    // back one step: the bottom zone again
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Szenen')).toBe('bottom');
    await expect(toast).toContainText('Szenen ist unten angedockt');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => zoneOf(page, 'Szenen')).toBe('right');

    // aria: the toast is a polite live region in German
    const live = await page.locator('fs-toast-host').evaluate((host) => ({ role: host.getAttribute('role'), live: host.getAttribute('aria-live'), lang: host.getAttribute('lang') }));
    expect(live).toEqual({ role: 'status', live: 'polite', lang: 'de-CH' });
    // persisted: the layout survives a reload
    const stored = await page.evaluate(() => localStorage.getItem('flowstudio.layout'));
    expect(stored, 'the layout is stored').not.toBeNull();
    await page.reload();
    await regie.waitReady();
    expect(await zoneOf(page, 'Szenen'), 'the layout survives a reload').toBe('right');
    // «Layout zurücksetzen» from the toast by keyboard
    await page.getByRole('button', { name: 'Dock Szenen verschieben, mit Pfeiltasten' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => zoneOf(page, 'Szenen')).toBe('bottom');
    const reset = regie.toast().first().getByRole('button', { name: 'Layout zurücksetzen' });
    await expect(reset).toBeVisible();
    await reset.focus();
    await page.keyboard.press('Enter');
    await expect(regie.toast().first()).toContainText('Layout zurückgesetzt');
    expect(await bottomOrder(), 'the default order is back').toEqual(['Szenen', 'Quellen der Szene', 'Eigenschaften', 'Stationen']);
  });

  test('E2E-DEV-14 [splitters] separators are named and oriented; arrows move them 16 px (Shift 64 px) within their bounds, Enter resets, the change persists', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true, stations: 2 });
    const { page } = regie;
    const splitters = await page.getByRole('separator').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('aria-label'), orientation: element.getAttribute('aria-orientation'), tabindex: element.getAttribute('tabindex') })));
    expect(splitters.map((entry) => entry.name).sort(), 'the separators of the default layout').toEqual(
      ['Grösse von Eigenschaften und Stationen', 'Grösse von Preview und Program', 'Grösse von Quellen und Eigenschaften', 'Grösse von Szenen und Quellen', 'Höhe der Docks unten'].sort(),
    );
    for (const entry of splitters) {
      expect(entry.orientation, `${entry.name}: aria-orientation`).toBe(entry.name === 'Höhe der Docks unten' ? 'horizontal' : 'vertical');
      expect(entry.tabindex, `${entry.name}: focusable`).toBe('0');
    }
    const settleLayout = () => settle(page);

    // bottom zone height: ArrowUp grows the docks by 16 px, Shift+ArrowUp by 64 px, ArrowDown shrinks, Enter resets
    const bottom = page.getByRole('separator', { name: 'Höhe der Docks unten' });
    const dockHeight = async () => Math.round((await boxOf(page.locator('[data-zone=bottom]')))!.h);
    const start = await dockHeight();
    await bottom.focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(dockHeight, { message: 'ArrowUp: docks 16 px higher' }).toBe(start + 16);
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(dockHeight, { message: 'Shift+ArrowUp: another 64 px' }).toBe(start + 80);
    await page.keyboard.press('ArrowDown');
    await expect.poll(dockHeight, { message: 'ArrowDown: 16 px lower' }).toBe(start + 64);
    expect(await page.evaluate(() => localStorage.getItem('flowstudio.layout')), 'the height is stored').toContain('bottomH');
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
    const between = page.getByRole('separator', { name: 'Grösse von Quellen und Eigenschaften' });
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

    // monitor split (Studio-Modus): ArrowLeft moves the hairline, Enter resets
    const split = page.getByRole('separator', { name: 'Grösse von Preview und Program' });
    const previewWidth = async () => Math.round((await boxOf(page.locator('fs-monitor[kind=preview] .c-monitor__screen')))!.w);
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
    knownBug('A11Y-13', 'the seam between Szenen and Quellen moves 20.3 px and the seam between Eigenschaften and Stationen 11.6 px per ArrowRight instead of 16 px (the dock at the window edge carries a 16 px gutter inside its flex weight); same finding as REGIE-02 of the regie area');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 2 });
    const { page } = regie;
    const problems: string[] = [];
    for (const name of ['Grösse von Szenen und Quellen', 'Grösse von Eigenschaften und Stationen']) {
      const seam = page.getByRole('separator', { name });
      await seam.focus();
      const x = async () => (await boxOf(seam))!.x;
      for (const [key, delta] of [['ArrowRight', 16], ['Shift+ArrowRight', 64], ['ArrowLeft', -16], ['Shift+ArrowLeft', -64]] as const) {
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
    await page.getByRole('button', { name: 'Dock Stationen verschieben, mit Pfeiltasten' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-zone=right] fs-dock-slot[aria-label=Stationen]')).toHaveCount(1);
    const splitter = page.getByRole('separator', { name: 'Breite der Docks rechts' });
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
