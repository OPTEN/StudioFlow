import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { OUTPUT_DIR } from '../../support/env';
import { PublicApi } from '../../support/api';
import { TEXT } from '../../support/text';
import { TEXT_DE } from '../../support/text.de';
import { auditTexts, collectTexts, type Violation } from '../../support/a11y/german';
import { openBusyRegie } from '../../support/a11y/regie-setup';
import { uniqueIp } from '../../support/production';
import { newUiContext, pairViaApi } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-17 (German text audit, docs/testing.md 2.8): the visible text and the aria-label / title / placeholder /
 * alt of every state of the Regie, the monitoring page, the sender, the login and the output slates, shown in German.
 * Rules: no «ß», names quoted with « », decimal comma in durations and rates («0,3 s», «2,5 Mbit/s»), 24 h clock,
 * lang de-CH, none of the English UI words of the plan (except the agreed terms).
 *
 * The page objects of the suite use the English labels, so the flows run in English and an audited state is read in
 * German for a moment (`inGerman`: the language setting changes live, like in a second tab). The output page has no
 * setting; it is opened with `?lang=de-CH`.
 */

const tags = t.with('@p1', '@a11y', '@german');
const VIEWPORT = { width: 1440, height: 900 };

const STORAGE_KEY = 'studioflow.locale';

/** Sets (or, with `null`, removes) the language setting the way another tab does: storage and a `storage` event. */
async function setStoredLocale(page: Page, locale: string | null): Promise<void> {
  const expected = locale ?? 'en';
  await page.evaluate(
    ([key, value]) => {
      if (value) localStorage.setItem(key!, value);
      else localStorage.removeItem(key!);
      window.dispatchEvent(new StorageEvent('storage', { key }));
    },
    [STORAGE_KEY, locale],
  );
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { message: `page switched to ${expected}` }).toBe(expected);
  // Two frames: the texts of the new language are rendered.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Reads the page in German and puts it back to English, so the page objects keep finding their English labels. */
async function inGerman<T>(page: Page, read: () => Promise<T>): Promise<T> {
  await setStoredLocale(page, 'de-CH');
  try {
    return await read();
  } finally {
    await setStoredLocale(page, null);
  }
}

/** Collects the texts of a state and keeps the violations with the state's label. */
class Audit {
  readonly violations: Array<Violation & { state: string }> = [];
  readonly states: string[] = [];
  private total = 0;

  /** `german: false` for a page that is already German (the output page, which has no setting). */
  constructor(
    private readonly page: Page,
    private readonly german = true,
  ) {}

  async state(label: string, page: Page = this.page): Promise<void> {
    const items = this.german ? await inGerman(page, () => collectTexts(page)) : await collectTexts(page);
    this.total += items.length;
    this.states.push(`${label} (${items.length})`);
    for (const violation of auditTexts(items)) this.violations.push({ ...violation, state: label });
  }

  async verify(name: string): Promise<void> {
    const result = JSON.stringify({ states: this.states, texts: this.total, violations: this.violations }, null, 2);
    fs.mkdirSync(path.join(OUTPUT_DIR, 'a11y'), { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'a11y', `german-${name}.json`), result);
    test.info().annotations.push({ type: 'german-audit', description: `${name}: ${this.states.length} states, ${this.total} texts, ${this.violations.length} violations` });
    await test.info().attach(`german-${name}.json`, { body: result, contentType: 'application/json' });
    const unique = [...new Set(this.violations.map((entry) => `[${entry.state}] ${entry.rule}: «${entry.text}» (${entry.kind} on ${entry.where})`))];
    expect(unique, `German text rules over ${this.states.length} states and ${this.total} texts`).toEqual([]);
  }
}

test.describe('German text audit', () => {
  // The flows use the English page objects; the audited states are read in German (see above).
  test.use({ locale: 'en-US' });

  test('E2E-DEV-17 [regie] every state of the Regie: header, strip, monitors, docks, popovers, pairing dock, station detail, toasts', tags, async ({ openRegie, pairContext, onCleanup, api, production }) => {
    test.setTimeout(240_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    const audit = new Audit(page);

    await audit.state('direct mode with an incident');

    // toasts: a scene switch, the mode switch, a dock move, the reset
    await regie.clickScene('Break');
    await expect(regie.toast().first()).toBeVisible();
    await audit.state('toast: scene switch');
    await regie.setStudioMode(true);
    await expect(regie.take()).toBeVisible();
    await audit.state('Studio Mode');
    await page.getByRole('button', { name: 'Move dock Stations with the arrow keys' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(regie.toast().first()).toContainText('Stations is');
    await audit.state('toast: dock moved (with the “Reset layout” button)');
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect(regie.toast().first()).toContainText('Layout reset');
    await regie.setStudioMode(false);

    // popovers and menus
    const popovers: Array<[string, () => ReturnType<Page['getByRole']>]> = [
      ['output popover', () => page.getByRole('button', { name: /^Output/ })],
      ['layout popover', () => page.getByRole('button', { name: 'Docks and layout' })],
      ['production menu', () => page.getByRole('button', { name: /^Production .*, menu$/ })],
      ['add-source popover', () => page.getByRole('button', { name: 'Source', exact: true })],
      ['scene menu', () => page.getByRole('button', { name: 'Actions for scene Break' })],
    ];
    for (const [label, trigger] of popovers) {
      await trigger().click();
      await expect(page.locator('.c-pop').first()).toBeVisible();
      await audit.state(label);
      await page.keyboard.press('Escape');
      await expect(page.locator('.c-pop')).toHaveCount(0);
    }
    // the production menu in its three modes
    await page.getByRole('button', { name: /^Production .*, menu$/ }).click();
    for (const [item, label, heading] of [['Rename', 'production: rename', 'Rename production'], ['Edit slates', 'production: slates', 'Before the broadcast'], ['New production…', 'production: new', 'New production']] as const) {
      const menu = page.getByRole('dialog', { name: 'Production' });
      // exact: the dialog also lists one button per production of the stack (“... renamed”)
      await menu.getByRole('button', { name: item, exact: true }).click();
      await expect(menu.locator('.c-pop-h', { hasText: heading })).toBeVisible();
      await audit.state(label);
      await menu.getByRole('button', { name: 'Cancel' }).click();
    }
    await page.keyboard.press('Escape');
    // the add-source popover of a scene with elements, the layout popover with a hidden dock
    await regie.clickScene('Welcome');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await audit.state('add-source popover (scene with elements)');
    await page.keyboard.press('Escape');

    // a station detail with its confirmations, the composer and the rename field
    const row = page.locator('.c-st__row').first();
    await row.click();
    const open = page.locator('.c-st.is-open');
    await expect(open).toHaveCount(1);
    await audit.state('station detail');
    await open.getByRole('button', { name: 'Block device' }).click();
    await audit.state('station: block confirmation');
    await open.getByRole('button', { name: 'Cancel' }).click();
    await open.getByRole('button', { name: 'Send message' }).click();
    await audit.state('station: message composer');
    await open.getByRole('button', { name: 'Send message' }).click();
    await open.getByRole('button', { name: 'Rename' }).click();
    await audit.state('station: rename');
    await page.keyboard.press('Escape');
    await row.click();

    // an element selected, with the label tab
    await page.getByRole('button', { name: /^Select: / }).first().click();
    await audit.state('element selected (properties of the element)');

    // the pairing dock on its three tabs, with a knock card
    const anonymous = new PublicApi(pairContext.stack.anonymousBase, uniqueIp());
    const knock = await anonymous.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Chrome' });
    expect(knock.status).toBe(201);
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    await regie.openPairing('phone');
    await audit.state('pairing dock: Phone');
    await regie.openPairing('laptop');
    await expect(regie.knockCard('Laptop Anna')).toBeVisible();
    await audit.state('pairing dock: Laptop with a knock card');
    await regie.openPairing('link');
    await audit.state('pairing dock: Link');
    await regie.closePairing();

    // broadcast states: start, live, end
    await page.getByRole('button', { name: 'Start broadcast' }).click();
    await expect(page.getByRole('button', { name: 'End broadcast' }).first()).toBeVisible();
    await audit.state('on air');
    await page.getByRole('button', { name: 'End broadcast' }).first().click();
    await audit.state('end broadcast: confirmation');
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    expect((await api.endBroadcast(production.id)).status).toBeLessThan(300);
    await expect(page.getByText('ENDED')).toBeVisible();
    await audit.state('broadcast ended');

    // the monitoring page
    await page.goto('/monitoring');
    await expect(page.getByRole('table')).toBeVisible();
    await audit.state('monitoring');
    await audit.verify('regie');
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-17 [regie, numbers] durations with a decimal comma («0,2 s» ... «2 s»), rates «2,5 Mbit/s», the 24 h clock «HH:mm:ss», the elapsed times', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    await setStoredLocale(page, 'de-CH');
    // every fade duration, stepped through with the buttons
    const value = () => page.locator('.c-duration__value').innerText();
    const seen: string[] = [await value()];
    const longer = page.getByRole('button', { name: 'Blende länger' });
    const shorter = page.getByRole('button', { name: 'Blende kürzer' });
    let current = seen[0]!;
    for (let index = 0; index < 8 && (await longer.isEnabled()); index++) {
      await longer.click();
      await expect.poll(value).not.toBe(current);
      current = await value();
      seen.push(current);
    }
    for (let index = 0; index < 8 && (await shorter.isEnabled()); index++) {
      await shorter.click();
      await expect.poll(value).not.toBe(current);
      current = await value();
      if (!seen.includes(current)) seen.push(current);
    }
    await test.info().attach('durations.json', { body: JSON.stringify(seen), contentType: 'application/json' });
    for (const text of seen) expect(text, 'duration of the stepper').toMatch(/^\d(,\d)? s$/);
    expect(seen.join(' | '), 'the seven fade durations 0,2 / 0,3 / 0,5 / 0,8 / 1 / 1,5 / 2 s').toMatch(/0,2 s/);
    expect(seen.some((text) => /^0,3 s$/.test(text)) && seen.some((text) => /^0,5 s$/.test(text)) && seen.some((text) => /^0,8 s$/.test(text)) && seen.some((text) => /^1(,0)? s$/.test(text)) && seen.some((text) => /^1,5 s$/.test(text)) && seen.some((text) => /^2(,0)? s$/.test(text))).toBe(true);
    // rates in the Stationen dock and in the monitoring table
    await expect(page.locator('.c-st__met').filter({ hasText: 'Mbit/s' }).first()).toContainText(/^2,5\s*Mbit\/s$/);
    // clock: 24 h with seconds
    const clock = (await page.locator('.c-header__clock').innerText()).trim();
    expect(clock, 'the header clock').toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
    // elapsed times of an incident («00:03»)
    await expect(page.getByRole('region', { name: 'Meldungen' })).toContainText(/\d{2}:\d{2}/);
    // the log texts: times as HH:mm
    // monitoring: decimal comma in the rate column, «Mbit/s» header
    await page.goto('/monitoring');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('cell', { name: '2,5', exact: true }).first()).toBeVisible();
    const cells = await page.getByRole('cell').allInnerTexts();
    expect(cells.filter((text) => /\d\.\d/.test(text)), 'no decimal point in the table').toEqual([]);
  });

  test('E2E-DEV-17 [login, sender] the login page, the pairing form with its error, waiting, denied, both stations, the banner and the technical check', tags, async ({ browser, openPhone, openLaptop, regie, pairContext, api, production, onCleanup }) => {
    test.setTimeout(240_000);
    // login
    const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => context.close());
    const loginPage = await context.newPage();
    await loginPage.goto('/login');
    await expect(loginPage.getByLabel('Username')).toBeVisible();
    const loginAudit = new Audit(loginPage);
    await loginAudit.state('login');
    await loginPage.getByLabel('Username').fill('nobody');
    await loginPage.getByLabel('Password').fill('wrong-password-123');
    await loginPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(loginPage.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    await loginAudit.state('login: wrong password');
    await loginAudit.verify('login');

    // sender: phone
    const phone = await openPhone({ profile: 'pixel7' });
    await phone.gotoStart();
    await expect(phone.page.getByLabel('Device name')).toBeVisible();
    const audit = new Audit(phone.page);
    await audit.state('sender: pairing form');
    await phone.page.getByLabel('Device name').fill('');
    await phone.page.getByRole('button', { name: 'Continue' }).click();
    await expect(phone.page.locator('#device-name-error')).toBeVisible();
    await audit.state('sender: form error');

    // sender: laptop waiting and denied
    const knocking = await openLaptop();
    await knocking.gotoStart();
    await knocking.submitPairingForm('Laptop Anna', 'laptop');
    await knocking.checkCode();
    const laptopAudit = new Audit(knocking.page);
    await laptopAudit.state('sender: waiting for the Regie');
    await regie.openPairing('laptop');
    await regie.denyKnock('Laptop Anna');
    await expect(knocking.page.getByTestId('pairing-denied')).toBeVisible();
    await laptopAudit.state('sender: denied');
    await laptopAudit.verify('sender-pairing');

    // sender: phone station, banner, technical check
    const station = await openPhone({ profile: 'pixel7' });
    const device = await pairViaApi(pairContext, station, { name: 'Phone Anna' });
    await station.waitForCamera('live');
    const stationAudit = new Audit(station.page);
    await stationAudit.state('sender: phone station');
    expect((await api.sendDeviceCommand(production.id, device.id, { kind: 'message', text: 'Please move closer to the window, the light is too weak.' })).status).toBeLessThan(300);
    await expect(station.messageBanner()).toBeVisible();
    await stationAudit.state('sender: message banner');
    await station.page.getByRole('button', { name: 'Tech check' }).click();
    await stationAudit.state('sender: technical check');
    await station.page.getByRole('button', { name: 'Close tech check' }).click();
    await station.darkToggle().click();
    await stationAudit.state('sender: dark mode');
    await stationAudit.verify('sender-phone-station');

    // sender: laptop station: before sharing, live, ended, camera
    const laptop = await openLaptop();
    await pairViaApi(pairContext, laptop, { name: 'Laptop Ben' });
    const laptopStation = new Audit(laptop.page);
    await laptopStation.state('sender: laptop before sharing');
    await laptop.shareScreen();
    await laptop.waitForSlot('screen-1', 'live');
    await laptopStation.state('sender: laptop screen live');
    expect(await laptop.browserStopsSharing()).toBe(true);
    await laptop.waitForSlot('screen-1', 'ended');
    await laptopStation.state('sender: laptop share ended');
    await laptop.addCamera();
    await expect(laptop.slot('camera')).toBeVisible();
    await laptopStation.state('sender: laptop with camera');
    await laptopStation.verify('sender-laptop-station');
  });

  test('E2E-DEV-17 [output] the slates of the output page: standby, end and denied; lang de-CH', tags, async ({ openOutput, api, production }) => {
    test.setTimeout(120_000);
    const output = await openOutput(production, { lang: 'de-CH' });
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.standby);
    expect(await output.page.evaluate(() => document.documentElement.lang), 'lang of the output page').toBe('de-CH');
    const audit = new Audit(output.page, false);
    await audit.state('output: standby');
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).not.toContain(TEXT.slate.standby);
    await audit.state('output: live');
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.end);
    await audit.state('output: end');
    const denied = await openOutput({ slug: production.slug, outputKey: 'wrong-output-key-0123456789' }, { lang: 'de-CH' });
    await expect.poll(() => denied.slateText(), { timeout: 20_000 }).toContain(TEXT_DE.slate.denied);
    await audit.state('output: denied', denied.page);
    // the debug overlay is a developer aid (English keys by design): only the numbers are audited
    await audit.verify('output');
  });
});
