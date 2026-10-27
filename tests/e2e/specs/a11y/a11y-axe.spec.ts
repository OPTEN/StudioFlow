import { TEXT } from '../../support/text';
import { Scanner, scanAxe } from '../../support/a11y/axe';
import { knownBug } from '../../support/a11y/known-bug';
import { openBusyRegie } from '../../support/a11y/regie-setup';
import { newUiContext, pairViaApi } from '../../support/ui';
import { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-15 (docs/testing.md 2.8): axe-core (WCAG 2.1 A/AA) on login, Regie (direct mode, Studio Mode, pairing dock,
 * incident, station expanded, popovers), /monitoring, the sender (pairing form, waiting, denied, phone and laptop
 * station, banner) and the output slates; plus the semantic expectations of the Regie (regions, groups, pressed
 * and expanded states, names of every button). Zero critical/serious violations; every scan is attached and written to
 * `.output/<project>/a11y/axe/<label>.json`, the summary by impact to `a11y/axe-summary.jsonl`.
 * The nodes of confirmed open bugs (A11Y-01 .. A11Y-03) are scanned by a dedicated test each and left out of the
 * generic scans (support/a11y/axe.ts, KNOWN_BUG_EXCLUDES).
 */

const tags = (priority: 'p0' | 'p1' | 'p2') => t.with(`@${priority}`, '@a11y', '@axe');
const VIEWPORT = { width: 1440, height: 900 };

/** The slate fades in and out; axe measures the colours, so wait until the slate is fully opaque. */
async function slateOpaque(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() => page.locator('.sf-r-slate').first().evaluate((element) => getComputedStyle(element).opacity), { message: 'the slate is fully opaque (the fade is over)' })
    .toBe('1');
}

test.describe('axe scans: Regie', () => {
  test('E2E-DEV-15 [axe, login] the login page, empty and with the error message', tags('p1'), async ({ browser, onCleanup }) => {
    const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => context.close());
    const page = await context.newPage();
    const scanner = new Scanner(page);
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await scanner.scan('login');
    await page.getByLabel('Username').fill('nobody');
    await page.getByLabel('Password').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText('Wrong username or password');
    await scanner.scan('login-error');
    scanner.verify();
  });

  test('E2E-DEV-15 [axe, Regie] direct mode, Studio Mode, an incident in the strip, a station expanded, a toast', tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    const scanner = new Scanner(page);
    await expect(page.getByRole('region', { name: 'Messages' })).toContainText('reconnecting');
    await scanner.scan('regie-direct-incident');
    // a toast (direct mode: a scene click switches and confirms)
    await regie.clickScene('Break');
    await expect(regie.toast().first()).toBeVisible();
    await scanner.scan('regie-toast');
    await regie.setStudioMode(true);
    await expect(regie.take()).toBeVisible();
    await scanner.scan('regie-studio-mode');
    // a station expanded: the detail, the actions and the lamps
    const row = page.locator('.c-st__row').first();
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await scanner.scan('regie-station-expanded');
    // the block confirmation inside the detail
    await page.getByRole('button', { name: 'Block device' }).first().click();
    await expect(page.getByRole('button', { name: 'Block now' })).toBeVisible();
    await scanner.scan('regie-station-block-confirm');
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    // an element selected: the overlay box, the label tab and the handles (the first scene holds one)
    await regie.clickScene('Welcome');
    await page.getByRole('button', { name: /^Select: / }).first().click();
    await expect(page.locator('.c-edit-box.is-sel')).toHaveCount(1);
    await scanner.scan('regie-element-selected');
    scanner.verify();
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-15 [axe, pairing dock] the pairing dock open: phone (QR), laptop (knock card), link', tags('p0'), async ({ openRegie, pairContext, onCleanup, openLaptop, production }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 3 });
    const { page } = regie;
    const scanner = new Scanner(page);
    await regie.openPairing('phone');
    await expect(regie.pairingQr()).toBeVisible();
    await scanner.scan('regie-pairing-phone');
    // a laptop knocks: the knock card with its check code
    const laptop = await openLaptop();
    await laptop.gotoStart();
    await laptop.submitPairingForm('Laptop Axe', 'laptop');
    await laptop.checkCode();
    await regie.openPairing('laptop');
    await expect(regie.knockCard('Laptop Axe')).toBeVisible();
    await scanner.scan('regie-pairing-laptop-knock');
    await regie.openPairing('link');
    await scanner.scan('regie-pairing-link');
    scanner.verify();
    void production;
  });

  test('E2E-DEV-15 [axe, popovers] output, Docks and layout, production menu, add source, scene menu', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
    const { page } = regie;
    const scanner = new Scanner(page);
    const cases: Array<[string, () => ReturnType<typeof page.getByRole>, string]> = [
      ['output', () => page.getByRole('button', { name: /^Output/ }), '[role=dialog][aria-label=Output]'],
      ['layout', () => page.getByRole('button', { name: 'Docks and layout' }), '[role=dialog][aria-label="Docks and layout"]'],
      ['production-menu', () => page.getByRole('button', { name: /^Production .*, menu$/ }), '[role=dialog][aria-label=Production]'],
      ['add-source', () => page.getByRole('button', { name: 'Source', exact: true }), '[role=menu][aria-label="Add source"]'],
      ['scene-menu', () => page.getByRole('button', { name: 'Actions for scene Break' }), '[role=menu][aria-label="Scene Break"]'],
    ];
    for (const [label, trigger, popover] of cases) {
      await trigger().click();
      await expect(page.locator(popover), `${label} popover opens`).toBeVisible();
      await scanner.scan(`regie-popover-${label}`);
      await page.keyboard.press('Escape');
      await expect(page.locator(popover)).toBeHidden();
    }
    scanner.verify();
  });

  test('E2E-DEV-15 [axe, monitoring] the monitoring page with five stations and an incident', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    const scanner = new Scanner(page);
    await page.goto('/monitoring');
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(seeded.stations.length + 1);
    await scanner.scan('monitoring');
    // sorted by a column (aria-sort)
    await page.getByRole('button', { name: 'State' }).click();
    await expect(page.getByRole('columnheader', { name: 'State' })).toHaveAttribute('aria-sort', /ascending|descending/);
    await scanner.scan('monitoring-sorted');
    scanner.verify();
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-15 [axe, monitoring, empty] the monitoring page without stations', tags('p2'), async ({ regie, page }) => {
    const scanner = new Scanner(page);
    await page.goto('/monitoring');
    await expect(page.getByText('No stations yet.')).toBeVisible();
    await scanner.scan('monitoring-empty');
    scanner.verify();
    void regie;
  });

  test('E2E-DEV-15 [presence] the presence text counts the real number of operators: “One person”, “Two people”, then back', tags('p2'), async ({ regie, browser, api, onCleanup }) => {
    test.setTimeout(90_000);
    knownBug('A11Y-08', 'the header says “2 people in the control room” for two operators; docs/testing.md DEV-15 pins “Two people in the control room” (one is spelled out, two is a numeral)');
    const { page } = regie;
    await expect(page.getByText('One person in the control room').first()).toBeAttached();
    const second = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => second.close());
    await RegiePage.open(second, { login: 'api', cookie: api.cookie });
    await expect(page.getByText(/^(Two|2) people in the control room$/).first(), 'the presence text counts both operators').toBeAttached();
    expect(await page.locator('.c-header__presence .u-sr-only').textContent(), 'the text for assistive technology').toBe('Two people in the control room');
    await second.close();
    await expect(page.getByText('One person in the control room').first(), 'and drops back to one').toBeAttached({ timeout: 15_000 });
  });
});

test.describe('axe scans: sender', () => {
  test('E2E-DEV-15 [axe, sender form] the pairing form on a phone and on a laptop, with a validation error', tags('p1'), async ({ openPhone, openLaptop }) => {
    const phone = await openPhone({ profile: 'pixel7' });
    await phone.gotoStart();
    await expect(phone.page.getByLabel('Device name')).toBeVisible();
    const phoneScanner = new Scanner(phone.page);
    await phoneScanner.scan('sender-form-phone');
    // the form proposes a name: empty it, then “Continue” shows the validation message
    await phone.page.getByLabel('Device name').fill('');
    await phone.page.getByRole('button', { name: 'Continue' }).click();
    await expect(phone.page.locator('#device-name-error')).toBeVisible();
    await phoneScanner.scan('sender-form-phone-error');
    phoneScanner.verify();

    const laptop = await openLaptop();
    await laptop.gotoStart();
    await expect(laptop.page.getByLabel('Device name')).toBeVisible();
    const laptopScanner = new Scanner(laptop.page);
    await laptopScanner.scan('sender-form-laptop');
    laptopScanner.verify();
  });

  test('E2E-DEV-15 [axe, sender waiting] the waiting screen with the check code, then the denied screen', tags('p1'), async ({ regie, openLaptop, production }) => {
    test.setTimeout(90_000);
    const laptop = await openLaptop();
    await laptop.gotoStart();
    await laptop.submitPairingForm('Laptop Axe Waiting', 'laptop');
    await laptop.checkCode();
    const scanner = new Scanner(laptop.page);
    await scanner.scan('sender-waiting');
    // the Regie denies: the denied screen
    await regie.openPairing('laptop');
    await regie.denyKnock('Laptop Axe Waiting');
    await expect(laptop.page.getByTestId('pairing-denied')).toBeVisible();
    await scanner.scan('sender-denied');
    scanner.verify();
    void production;
  });

  test('E2E-DEV-15 [axe, sender phone station] the phone station: camera live, dark mode, technical check, message banner', tags('p0'), async ({ openPhone, pairContext, api, production }) => {
    test.setTimeout(120_000);
    const phone = await openPhone({ profile: 'pixel7' });
    const device = await pairViaApi(pairContext, phone, { name: 'Phone Axe' });
    await phone.waitForCamera('live');
    const scanner = new Scanner(phone.page);
    await scanner.scan('sender-phone-station');
    // a message from the Regie: the banner (role alert / status)
    const sent = await api.sendDeviceCommand(production.id, device.id, { kind: 'message', text: 'Please move closer to the window, the light is too weak.' });
    expect(sent.status).toBeLessThan(300);
    await expect(phone.messageBanner()).toBeVisible();
    await scanner.scan('sender-phone-banner');
    await phone.page.getByRole('button', { name: 'Tech check' }).click();
    await expect(phone.page.getByRole('button', { name: /close|done|back/i }).first()).toBeVisible();
    await scanner.scan('sender-phone-techcheck');
    scanner.verify();
    expect(phone.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-15 [axe, sender phone dark] the dark station (touch to operate)', tags('p2'), async ({ openPhone, pairContext }) => {
    test.setTimeout(120_000);
    const phone = await openPhone({ profile: 'pixel7' });
    await pairViaApi(pairContext, phone, { name: 'Phone Axe Dark' });
    await phone.waitForCamera('live');
    await phone.darkToggle().click();
    const scanner = new Scanner(phone.page);
    await scanner.scan('sender-phone-dark');
    scanner.verify();
  });

  test('E2E-DEV-15 [axe, sender laptop station] the laptop station: before sharing, screen live, share ended, camera added', tags('p0'), async ({ openLaptop, pairContext }) => {
    test.setTimeout(120_000);
    const laptop = await openLaptop();
    await pairViaApi(pairContext, laptop, { name: 'Laptop Axe Station' });
    const scanner = new Scanner(laptop.page);
    await expect(laptop.page.getByRole('heading', { name: /Sources of this laptop/ })).toBeVisible();
    await scanner.scan('sender-laptop-before-share');
    await laptop.shareScreen();
    await laptop.waitForSlot('screen-1', 'live');
    await scanner.scan('sender-laptop-screen-live');
    expect(await laptop.browserStopsSharing()).toBe(true);
    await laptop.waitForSlot('screen-1', 'ended');
    await scanner.scan('sender-laptop-screen-ended');
    await laptop.addCamera();
    await expect(laptop.slot('camera')).toBeVisible();
    await scanner.scan('sender-laptop-with-camera');
    scanner.verify();
    expect(laptop.problems.pageErrors).toEqual([]);
  });
});

test.describe('axe scans: output', () => {
  test('E2E-DEV-15 [axe, output slates] the standby, the end and the denied slate', tags('p1'), async ({ openOutput, api, production }) => {
    test.setTimeout(90_000);
    const output = await openOutput(production);
    const scanner = new Scanner(output.page);
    await expect.poll(() => output.slateText(), { message: 'standby slate', timeout: 20_000 }).toContain(TEXT.slate.standby);
    await slateOpaque(output.page);
    await scanner.scan('output-standby');
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { message: 'the standby slate is gone while live', timeout: 20_000 }).not.toContain(TEXT.slate.standby);
    await scanner.scan('output-live');
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { message: 'end slate', timeout: 20_000 }).toContain(TEXT.slate.end);
    await slateOpaque(output.page);
    await scanner.scan('output-end');
    const denied = await openOutput({ slug: production.slug, outputKey: 'wrong-key' });
    await expect.poll(() => denied.slateText(), { message: 'denied slate', timeout: 20_000 }).toContain(TEXT.slate.denied);
    await slateOpaque(denied.page);
    const deniedScanner = new Scanner(denied.page);
    await deniedScanner.scan('output-denied');
    scanner.verify();
    deniedScanner.verify();
  });
});

test.describe('axe scans: open bugs, isolated', () => {
  test('E2E-DEV-15 [axe, separators] splitters (role=separator, focusable) expose aria-valuenow', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-01', 'every splitter is role=separator with tabindex=0 but has no aria-valuenow: axe aria-required-attr (critical)');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true, stations: 2 });
    const scan = await scanAxe(regie.page, 'regie-separators', { include: ['[role=separator]'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`), 'a focusable separator carries aria-valuenow (ARIA 1.2: separator that is focusable is a widget)').toEqual([]);
    const separators = await regie.page.getByRole('separator').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('aria-label'), now: element.getAttribute('aria-valuenow'), min: element.getAttribute('aria-valuemin'), max: element.getAttribute('aria-valuemax') })));
    expect(separators.filter((entry) => entry.now === null).map((entry) => entry.name), 'every splitter exposes its position').toEqual([]);
  });

  test('E2E-DEV-15 [axe, contrast PGM tag] the PGM tag of scene and station rows meets 4.5:1', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-02', 'the PGM tag (10 px bold, #f85149 on the red wash #31262e) has a contrast of 4.32:1 (needs 4.5:1)');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 3 });
    const scan = await scanAxe(regie.page, 'regie-pgm-tag', { include: ['.c-tag--pgm'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id} ${violation.nodes.map((node) => `${node.target} ${JSON.stringify(node.data)}`).join(' | ')}`), 'PGM tags have enough contrast').toEqual([]);
  });

  test('E2E-DEV-15 [axe, contrast Take hint] the “Space” hint on the blue Take button meets 4.5:1', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-03', 'the “Space” hint (11 px, #dde9fc on #1f6feb) on Take has a contrast of 3.78:1 (needs 4.5:1)');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: true, stations: 2 });
    const scan = await scanAxe(regie.page, 'regie-take-hint', { include: ['.c-take'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id} ${violation.nodes.map((node) => `${node.target} ${JSON.stringify(node.data)}`).join(' | ')}`), 'the Take hint has enough contrast').toEqual([]);
  });

  test('E2E-DEV-15 [axe, label in name] scene rows, source rows, station rows and incident targets have accessible names that contain their visible text (WCAG 2.5.3)', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-06', 'aria-labels of scene rows, source rows, station rows and the incident target omit visible text (axe label-content-name-mismatch, WCAG 2.5.3 Label in Name)');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
    const scan = await scanAxe(regie.page, 'regie-label-in-name', { include: ['.c-status__target', 'button.c-scene', '.c-src__select', '.c-st__row'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id} x${violation.nodes.length}: ${violation.nodes.map((node) => node.target).slice(0, 4).join(' | ')}`), 'names contain the visible text').toEqual([]);
  });

  test('E2E-DEV-15 [axe, empty source list] the Sources list of an empty scene is a list with items, or no list at all', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-09', 'an empty scene renders the Sources list as role=list without any listitem (the empty-state text is its only child): axe aria-required-children (critical)');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: null, studio: false, stations: 3 });
    await regie.clickScene('Break');
    await expect(regie.page.getByText('This scene is empty.')).toBeVisible();
    const scan = await scanAxe(regie.page, 'regie-empty-source-list', { include: ['.c-src-dock'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`), 'the empty list has no required-children violation').toEqual([]);
  });

  test('E2E-DEV-15 [axe, contrast phone dark mode] the dimmed code and hint of the phone sender in dark mode meet 4.5:1', tags('p2'), async ({ openPhone, pairContext }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-07', 'dark mode of the phone sender: the station code is 2.96:1 and “Tap for controls” 2.35:1 (needs 4.5:1)');
    const phone = await openPhone({ profile: 'pixel7' });
    await pairViaApi(pairContext, phone, { name: 'Phone Contrast' });
    await phone.waitForCamera('live');
    await phone.darkToggle().click();
    const scan = await scanAxe(phone.page, 'sender-phone-dark-contrast', { include: ['.c-phone__dark'], includeKnownBugs: true, noBestPractice: true });
    expect(scan.blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => `${node.target} ${JSON.stringify(node.data)}`).join(' | ')}`), 'the dark overlay text has enough contrast').toEqual([]);
  });
});

test.describe('Regie semantics', () => {
  test('E2E-DEV-15 [semantics] regions, groups, pressed and expanded states, names, decorative icons and the toast', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
    const { page } = regie;
    // landmarks and regions
    for (const name of ['Monitors', 'Scenes', 'Sources of the scene', 'Properties', 'Stations', 'Messages']) await expect(page.getByRole('region', { name }), `region “${name}”`).toHaveCount(1);
    await expect(page.getByRole('banner'), 'the header is the banner landmark').toHaveCount(1);
    expect(await page.locator('sf-status-line').evaluate((element) => element.getAttribute('role')), 'the message strip is a region').toBe('region');
    // switch and groups
    await expect(page.getByRole('switch', { name: 'Studio Mode' })).toBeChecked();
    await expect(page.getByRole('group', { name: 'Transition type' }).getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('group', { name: 'Fade duration' }).getByRole('button')).toHaveCount(2);
    // scene buttons: aria-pressed, tally and health text in the name
    const program = page.getByRole('button', { name: 'Welcome, live on Program' });
    await expect(program).toHaveAttribute('aria-pressed', 'false');
    const preview = page.getByRole('button', { name: /^Presentation, in Preview, K3 disrupted$/ });
    await expect(preview, 'the Preview scene is pressed and carries the tally and the health word').toHaveAttribute('aria-pressed', 'true');
    // sources: role=list with listitems
    await expect(page.getByRole('list', { name: 'Items of the scene' }).getByRole('listitem')).toHaveCount(2);
    // stations: aria-expanded on every row
    const rows = page.locator('.c-st__row');
    expect(await rows.count()).toBe(5);
    for (const row of await rows.all()) await expect(row).toHaveAttribute('aria-expanded', /true|false/);
    // monitors: role=img with the scene names
    await expect(page.getByRole('img', { name: 'Program monitor: Welcome, matches the output' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Preview monitor: Presentation' })).toBeVisible();
    // decorative lamps and icons are hidden from assistive technology; every other svg is named
    const lamps = await page.locator('.c-lamp').evaluateAll((elements) => elements.filter((element) => element.getAttribute('aria-hidden') !== 'true').length);
    expect(lamps, 'every lamp is aria-hidden').toBe(0);
    const icons = await page.locator('svg').evaluateAll((elements) => elements.filter((element) => element.getAttribute('aria-hidden') !== 'true' && !element.getAttribute('aria-label') && !element.closest('[aria-hidden=true]') && !element.getAttribute('role')).map((element) => element.outerHTML.slice(0, 80)));
    expect(icons, 'every svg is aria-hidden or named').toEqual([]);
    // every button has an accessible name
    for (const button of await page.getByRole('button').all()) await expect(button).toHaveAccessibleName(/\S/);
    for (const control of await page.locator('input:visible, select:visible, textarea:visible').all()) await expect(control).toHaveAccessibleName(/\S/);
    // toast: polite live region (in Studio Mode a click on a scene only loads the Preview; the toast comes with the program switch)
    await regie.take().click();
    await expect(regie.toast().first()).toBeVisible();
    expect(await page.locator('sf-toast-host').evaluate((element) => ({ role: element.getAttribute('role'), live: element.getAttribute('aria-live'), atomic: element.getAttribute('aria-atomic') }))).toEqual({ role: 'status', live: 'polite', atomic: 'true' });
    expect(await page.evaluate(() => document.documentElement.lang), 'the toast text is announced in the language of the document').toBe('en');
  });
});
