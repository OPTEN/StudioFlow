import type { Page } from '@playwright/test';
import { TEXT } from '../../support/text';
import { findGerman } from '../../support/a11y/english';
import { collectTexts } from '../../support/a11y/german';
import { openBusyRegie } from '../../support/a11y/regie-setup';
import { newUiContext } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-17 (text audit in English, docs/testing.md 2.8): the visible text and the aria-label / title / placeholder /
 * alt of the Regie, the monitoring page, the login and the output slates in `en-US` contain no German. The German
 * rules (no "ss" for the sharp s, decimal comma, ...) are audited in `specs/i18n/i18n-german-audit.spec.ts`.
 */

const tags = t.with('@p1', '@a11y');
const VIEWPORT = { width: 1440, height: 900 };

/** Collects the texts of the states and fails once with every German text, labelled with its state. */
class EnglishAudit {
  private readonly found: string[] = [];
  private states = 0;

  async state(label: string, page: Page): Promise<void> {
    this.states++;
    for (const finding of await findGerman(await collectTexts(page))) this.found.push(`[${label}] ${finding}`);
  }

  verify(): void {
    expect(this.found, `German text in ${this.states} English states`).toEqual([]);
  }
}

test.describe('English text audit', () => {
  test('E2E-DEV-17 [regie, en] every state of the Regie in English: popovers, docks, pairing, station detail, monitoring', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(240_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: false });
    const { page } = regie;
    const audit = new EnglishAudit();

    expect(await page.evaluate(() => document.documentElement.lang), 'lang of the document').toBe('en');
    await audit.state('direct mode with an incident', page);
    await regie.setStudioMode(true);
    await expect(regie.take()).toBeVisible();
    await audit.state('Studio mode', page);
    await regie.setStudioMode(false);

    const popovers: Array<[string, string | RegExp]> = [
      ['issues popover', /^\d+ issues?$/],
      ['layout popover', /^Layout$/],
      ['production menu', /^Production .*, menu$/],
    ];
    for (const [label, name] of popovers) {
      await page.getByRole('button', { name }).click();
      await expect(page.locator('.c-pop').first()).toBeVisible();
      await audit.state(label, page);
      await page.keyboard.press('Escape');
      await expect(page.locator('.c-pop')).toHaveCount(0);
    }
    // the keyboard shortcuts sheet (the ? key)
    await page.keyboard.press('?');
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcuts).toBeVisible();
    await audit.state('keyboard shortcuts', page);
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();

    const row = page.locator('.c-st__row').first();
    await row.click();
    await expect(page.locator('.c-st.is-open')).toHaveCount(1);
    await audit.state('station detail', page);
    await row.click();

    for (const tab of ['phone', 'laptop', 'link'] as const) {
      await regie.openPairing(tab);
      await audit.state(`pairing dock: ${tab}`, page);
    }
    await regie.closePairing();

    await page.goto('/monitoring');
    await expect(page.getByRole('table')).toBeVisible();
    await audit.state('monitoring', page);
    audit.verify();
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-17 [login, output, en] the login page with its error and the output slates in English', tags, async ({ browser, openOutput, api, production, onCleanup }) => {
    test.setTimeout(120_000);
    const audit = new EnglishAudit();
    const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => context.close());
    const login = await context.newPage();
    await login.goto('/login');
    await expect(login.getByLabel('Username')).toBeVisible();
    await audit.state('login', login);
    await login.getByLabel('Username').fill('nobody');
    await login.getByLabel('Password').fill('wrong-password-123');
    await login.getByRole('button', { name: 'Sign in' }).click();
    await expect(login.getByRole('alert').filter({ hasText: /\S/ })).toContainText('Wrong username or password.');
    await audit.state('login: wrong password', login);

    const output = await openOutput(production);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.standby);
    expect(await output.page.evaluate(() => document.documentElement.lang), 'lang of the output page').toBe('en');
    await audit.state('output: standby', output.page);
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.end);
    await audit.state('output: end', output.page);
    const denied = await openOutput({ slug: production.slug, outputKey: 'wrong-output-key-0123456789' });
    await expect.poll(() => denied.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.denied);
    await audit.state('output: denied', denied.page);
    audit.verify();
  });
});
