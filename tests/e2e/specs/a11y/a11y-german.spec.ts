import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { OUTPUT_DIR } from '../../support/env';
import { PublicApi } from '../../support/api';
import { DE } from '../../support/constants';
import { auditTexts, collectTexts, type Violation } from '../../support/a11y/german';
import { openBusyRegie } from '../../support/a11y/regie-setup';
import { uniqueIp } from '../../support/production';
import { newUiContext, pairViaApi } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-17 (German text audit, docs/testing.md 2.8): the visible text and the aria-label / title / placeholder /
 * alt of every state of the Regie, the monitoring page, the sender, the login and the output slates. Rules: no «ß»,
 * names quoted with « », decimal comma in durations and rates («0,3 s», «2,5 Mbit/s»), 24 h clock, lang de-CH,
 * none of the English UI words of the plan (except the agreed terms).
 */

const tags = t.with('@p1', '@a11y', '@german');
const VIEWPORT = { width: 1440, height: 900 };

/** Collects the texts of a state and keeps the violations with the state's label. */
class Audit {
  readonly violations: Array<Violation & { state: string }> = [];
  readonly states: string[] = [];
  private total = 0;

  constructor(private readonly page: Page) {}

  async state(label: string, page: Page = this.page): Promise<void> {
    const items = await collectTexts(page);
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
  test('E2E-DEV-17 [regie] every state of the Regie: header, strip, monitors, docks, popovers, pairing dock, station detail, toasts', tags, async ({ openRegie, pairContext, onCleanup, api, production }) => {
    test.setTimeout(240_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    const audit = new Audit(page);

    expect(await page.evaluate(() => document.documentElement.lang), 'lang of the document').toBe('de-CH');
    expect(await page.locator('sf-studio-page').getAttribute('lang'), 'lang of the app root').toBe('de-CH');
    await audit.state('direct mode with an incident');

    // toasts: a scene switch, the mode switch, a dock move, the reset
    await regie.clickScene('Pause');
    await expect(regie.toast().first()).toBeVisible();
    await audit.state('toast: scene switch');
    expect(await page.locator('sf-toast-host').getAttribute('lang'), 'lang of the toast').toBe('de-CH');
    await regie.setStudioMode(true);
    await expect(regie.take()).toBeVisible();
    await audit.state('Studio-Modus');
    await page.getByRole('button', { name: 'Dock Stationen verschieben, mit Pfeiltasten' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(regie.toast().first()).toContainText('Stationen ist');
    await audit.state('toast: dock moved (with «Layout zurücksetzen»)');
    await page.getByRole('button', { name: 'Layout zurücksetzen' }).click();
    await expect(regie.toast().first()).toContainText('Layout zurückgesetzt');
    await regie.setStudioMode(false);

    // popovers and menus
    const popovers: Array<[string, () => ReturnType<Page['getByRole']>]> = [
      ['output popover', () => page.getByRole('button', { name: /^Output an Proxy/ })],
      ['layout popover', () => page.getByRole('button', { name: 'Docks und Layout' })],
      ['production menu', () => page.getByRole('button', { name: /^Produktion .*, Menü$/ })],
      ['add-source popover', () => page.getByRole('button', { name: 'Quelle', exact: true })],
      ['scene menu', () => page.getByRole('button', { name: 'Aktionen für Szene Pause' })],
    ];
    for (const [label, trigger] of popovers) {
      await trigger().click();
      await expect(page.locator('.c-pop').first()).toBeVisible();
      await audit.state(label);
      await page.keyboard.press('Escape');
      await expect(page.locator('.c-pop')).toHaveCount(0);
    }
    // the production menu in its three modes
    await page.getByRole('button', { name: /^Produktion .*, Menü$/ }).click();
    for (const [item, label, heading] of [['Umbenennen', 'production: rename', 'Produktion umbenennen'], ['Slates bearbeiten', 'production: slates', 'Vor der Sendung'], ['Neue Produktion …', 'production: new', 'Neue Produktion']] as const) {
      const menu = page.getByRole('dialog', { name: 'Produktion' });
      await menu.getByRole('button', { name: item }).click();
      await expect(menu.locator('.c-pop-h', { hasText: heading })).toBeVisible();
      await audit.state(label);
      await menu.getByRole('button', { name: 'Abbrechen' }).click();
    }
    await page.keyboard.press('Escape');
    // the add-source popover of a scene with elements, the layout popover with a hidden dock
    await regie.clickScene('Begrüssung');
    await page.getByRole('button', { name: 'Quelle', exact: true }).click();
    await audit.state('add-source popover (scene with elements)');
    await page.keyboard.press('Escape');

    // a station detail with its confirmations, the composer and the rename field
    const row = page.locator('.c-st__row').first();
    await row.click();
    const open = page.locator('.c-st.is-open');
    await expect(open).toHaveCount(1);
    await audit.state('station detail');
    await open.getByRole('button', { name: 'Gerät sperren' }).click();
    await audit.state('station: block confirmation');
    await open.getByRole('button', { name: 'Abbrechen' }).click();
    await open.getByRole('button', { name: 'Nachricht senden' }).click();
    await audit.state('station: message composer');
    await open.getByRole('button', { name: 'Nachricht senden' }).click();
    await open.getByRole('button', { name: 'Umbenennen' }).click();
    await audit.state('station: rename');
    await page.keyboard.press('Escape');
    await row.click();

    // an element selected, with the label tab
    await page.getByRole('button', { name: /^Auswählen: / }).first().click();
    await audit.state('element selected (Eigenschaften of the element)');

    // the pairing dock on its three tabs, with a knock card
    const anonymous = new PublicApi(pairContext.stack.anonymousBase, uniqueIp());
    const knock = await anonymous.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Chrome' });
    expect(knock.status).toBe(201);
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    await regie.openPairing('phone');
    await audit.state('pairing dock: Handy');
    await regie.openPairing('laptop');
    await expect(regie.knockCard('Laptop Anna')).toBeVisible();
    await audit.state('pairing dock: Laptop with a knock card');
    await regie.openPairing('link');
    await audit.state('pairing dock: Link');
    await regie.closePairing();

    // broadcast states: start, live, end
    await page.getByRole('button', { name: 'Sendung starten' }).click();
    await expect(page.getByRole('button', { name: 'Sendung beenden' }).first()).toBeVisible();
    await audit.state('on air');
    await page.getByRole('button', { name: 'Sendung beenden' }).first().click();
    await audit.state('end broadcast: confirmation');
    await page.getByRole('button', { name: 'Abbrechen' }).first().click();
    expect((await api.endBroadcast(production.id)).status).toBeLessThan(300);
    await expect(page.getByText('BEENDET')).toBeVisible();
    await audit.state('broadcast ended');

    // the monitoring page
    await page.goto('/monitoring');
    await expect(page.getByRole('table')).toBeVisible();
    await audit.state('monitoring');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de-CH');
    await audit.verify('regie');
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-17 [regie, numbers] durations with a decimal comma («0,2 s» ... «2 s»), rates «2,5 Mbit/s», the 24 h clock «HH:mm:ss», the elapsed times', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
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
    await expect(loginPage.getByLabel('Benutzername')).toBeVisible();
    const loginAudit = new Audit(loginPage);
    expect(await loginPage.evaluate(() => document.documentElement.lang)).toBe('de-CH');
    await loginAudit.state('login');
    await loginPage.getByLabel('Benutzername').fill('nobody');
    await loginPage.getByLabel('Passwort').fill('falsches-Passwort-123');
    await loginPage.getByRole('button', { name: 'Anmelden' }).click();
    await expect(loginPage.getByRole('alert').filter({ hasText: /\S/ })).toContainText(DE.loginFailed.replace(/\.$/, ''));
    await loginAudit.state('login: wrong password');
    await loginAudit.verify('login');

    // sender: phone
    const phone = await openPhone({ profile: 'pixel7' });
    await phone.gotoStart();
    await expect(phone.page.getByLabel('Name des Geräts')).toBeVisible();
    expect(await phone.page.evaluate(() => document.documentElement.lang), 'lang of the sender').toBe('de-CH');
    const audit = new Audit(phone.page);
    await audit.state('sender: pairing form');
    await phone.page.getByLabel('Name des Geräts').fill('');
    await phone.page.getByRole('button', { name: 'Weiter' }).click();
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
    const device = await pairViaApi(pairContext, station, { name: 'Handy Anna' });
    await station.waitForCamera('live');
    const stationAudit = new Audit(station.page);
    await stationAudit.state('sender: phone station');
    expect((await api.sendDeviceCommand(production.id, device.id, { kind: 'message', text: 'Bitte näher ans Fenster, das Licht ist zu schwach.' })).status).toBeLessThan(300);
    await expect(station.messageBanner()).toBeVisible();
    await stationAudit.state('sender: message banner');
    await station.page.getByRole('button', { name: 'Technik-Check' }).click();
    await stationAudit.state('sender: technical check');
    await station.page.getByRole('button', { name: 'Technik-Check schliessen' }).click();
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
    const output = await openOutput(production);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(DE.slateStandby);
    expect(await output.page.evaluate(() => document.documentElement.lang), 'lang of the output page').toBe('de-CH');
    const audit = new Audit(output.page);
    await audit.state('output: standby');
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).not.toContain(DE.slateStandby);
    await audit.state('output: live');
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(DE.slateEnd);
    await audit.state('output: end');
    const denied = await openOutput({ slug: production.slug, outputKey: 'falscher-schluessel' });
    await expect.poll(() => denied.slateText(), { timeout: 20_000 }).toContain(DE.slateDenied);
    await audit.state('output: denied', denied.page);
    // the debug overlay is a developer aid (English keys by design): only the numbers are audited
    await audit.verify('output');
  });
});
