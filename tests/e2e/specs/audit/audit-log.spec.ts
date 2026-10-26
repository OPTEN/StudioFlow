import fs from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { Scanner } from '../../support/a11y/axe';
import { expectNoOverflow } from '../../support/a11y/layout';
import { expectToast } from '../../support/regie/kit';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';

/**
 * AUDIT in the Regie (docs/testing.md 2.15: E2E-AUDIT-01 ... 04): the audit log page `/audit`. A broadcast with two
 * switches is "Last broadcast" and the CSV download has the same rows; the filters, the details and the keyboard;
 * the page at 1024 px and on a tablet; axe in the dark and the light theme. The specs run in English.
 */

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

/** One CSV record per element (RFC 4180: quotes, doubled quotes, line breaks inside quotes). */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(cell);
      cell = '';
    } else if (char === '\n') {
      record.push(cell.replace(/\r$/, ''));
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

async function readDownload(download: Download): Promise<Buffer> {
  const file = await download.path();
  return fs.readFileSync(file);
}

/** The rows of the table: the cells of each entry (time, who, what, production). */
async function tableRows(page: Page): Promise<string[][]> {
  return page.locator('.c-audit-table tbody tr:not(.c-audit-table__details)').evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
    ),
  );
}

async function openAuditLog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Production .*, menu$/ }).click();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
}

test.describe('AUDIT audit log page', () => {
  test(
    'E2E-AUDIT-01 [regie] "Last broadcast" shows exactly the entries of a broadcast in the right order, and the CSV has the same rows',
    t.smoke,
    async ({ regie, api, production }) => {
      const page = regie.page;
      const [welcome, presentation, pause] = (await api.getSnapshot(production.id)).body.scenes;
      await api.startBroadcast(production.id);
      await api.switchProgram(production.id, { sceneId: presentation!.id, transition: { kind: 'cut', durationMs: 0 } });
      await api.switchProgram(production.id, { sceneId: pause!.id, transition: { kind: 'cut', durationMs: 0 } });
      await api.endBroadcast(production.id);
      expect(welcome).toBeDefined();

      await openAuditLog(page);
      await page.getByLabel('Time range').selectOption({ label: 'Last broadcast' });

      const expected = ['Broadcast ended', `Scene “${pause!.name}” is live`, `Scene “${presentation!.name}” is live`, 'Broadcast started'];
      await expect.poll(async () => (await tableRows(page)).map((row) => row[2])).toEqual(expected);
      const rows = await tableRows(page);
      expect(rows.map((row) => row[1])).toEqual(['Admin', 'Admin', 'Admin', 'Admin']);
      expect(rows.map((row) => row[3])).toEqual(Array(4).fill(production.name));
      await expect(page.locator('.c-audit__count')).toHaveText('4 entries loaded');

      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
      await expectToast(page, /exported$/);
      expect(download.suggestedFilename()).toMatch(/^studioflow-audit-\d{4}-\d{2}-\d{2}\.csv$/);
      const bytes = await readDownload(download);
      expect([...bytes.subarray(0, 3)], 'UTF-8 byte order mark').toEqual([0xef, 0xbb, 0xbf]);
      const records = parseCsv(bytes.subarray(3).toString('utf8'));
      expect(records[0]).toEqual(['time', 'actor', 'category', 'action', 'description', 'production', 'production_id', 'details']);
      expect(records.slice(1).map((record) => record[4])).toEqual(expected);
      expect(records.slice(1).map((record) => record[3])).toEqual(['broadcast.ended', 'scene.live', 'scene.live', 'broadcast.started']);
      expect(records.slice(1).map((record) => record[6])).toEqual(Array(4).fill(production.id));
      expect(JSON.parse(records[2]![7]!)).toEqual({ scene: pause!.name, via: 'click' });

      // The export itself is in the log.
      await page.getByLabel('Time range').selectOption({ label: 'Any time' });
      await page.getByLabel('Production').selectOption({ label: 'All productions' });
      await expect(page.getByRole('table').getByText(/^Audit log exported as csv, 4 rows$/)).toBeVisible();
    },
  );

  test(
    'E2E-AUDIT-02 [regie] filters by category and text, shows the raw details of an entry, and everything works with the keyboard',
    t.p1,
    async ({ regie, api, production }) => {
      const page = regie.page;
      const snapshot = (await api.getSnapshot(production.id)).body;
      await api.switchProgram(production.id, { sceneId: snapshot.scenes[2]!.id, transition: { kind: 'cut', durationMs: 0 } });
      await api.updateProduction(production.id, { name: `${production.name} renamed`, standbySlate: null, endSlate: null });
      await openAuditLog(page);
      await expect.poll(async () => (await tableRows(page)).length).toBeGreaterThanOrEqual(3);

      await page.getByRole('button', { name: 'Production', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Production', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await tableRows(page)).map((row) => row[2])).toEqual(
        expect.arrayContaining([`Production “${production.name}” renamed to “${production.name} renamed”`, `Scene “${snapshot.scenes[2]!.name}” is live`]),
      );

      await page.getByRole('button', { name: 'Security', exact: false }).first().click();
      await page.getByRole('button', { name: 'Production', exact: true }).click();
      await expect.poll(async () => (await tableRows(page)).map((row) => row[2])).not.toContainEqual(expect.stringContaining('Scene'));

      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByLabel('Production').selectOption({ label: `${production.name} renamed (active)` });
      await page.getByLabel('Search').fill(snapshot.scenes[2]!.name);
      await expect(page.locator('.c-audit__count')).toHaveText('1 entry loaded');
      expect(await tableRows(page)).toEqual([[expect.any(String), 'Admin', `Scene “${snapshot.scenes[2]!.name}” is live`, `${production.name} renamed`]]);

      // Keyboard only: the details button of the entry opens its raw details.
      const toggle = page.locator('.c-audit-table__toggle');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const details = page.locator('.c-audit-details');
      await expect(details).toContainText('scene.live');
      await expect(details.locator('dt', { hasText: /^via$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('click');
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // An empty result says so.
      await page.getByLabel('Search').fill('no-entry-has-this-text');
      await expect(page.getByText('No entries match.')).toBeVisible();
    },
  );

  test('E2E-AUDIT-03 [regie] loads more pages and fits 1024 px and a tablet', t.p1, async ({ regie, api, production }) => {
    const page = regie.page;
    const scenes = (await api.getSnapshot(production.id)).body.scenes;
    for (let round = 0; round < 30; round++) {
      await api.switchProgram(production.id, { sceneId: scenes[round % 2 === 0 ? 1 : 0]!.id, transition: { kind: 'cut', durationMs: 0 } });
    }
    await openAuditLog(page);
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await expect.poll(async () => (await tableRows(page)).length).toBeGreaterThanOrEqual(30);
    const first = (await tableRows(page)).length;
    await page.getByRole('button', { name: 'Load more' }).scrollIntoViewIfNeeded();
    await expect.poll(async () => (await tableRows(page)).length).toBeGreaterThan(first);

    for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await expectNoOverflow(page, { label: `the audit log at ${viewport.width} px` });
      for (const name of ['Time range', 'Production', 'Search']) await expect(page.getByLabel(name)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'What' })).toBeVisible();
    }
  });

  test('E2E-AUDIT-04 [a11y] the page has no serious axe violations in the dark and the light theme', t.p1, async ({ regie, api, production }) => {
    const page = regie.page;
    const snapshot = (await api.getSnapshot(production.id)).body;
    await api.switchProgram(production.id, { sceneId: snapshot.scenes[1]!.id, transition: { kind: 'cut', durationMs: 0 } });
    await openAuditLog(page);
    await page.getByRole('button', { name: /^Show the details of the entry from/ }).first().click();
    const scanner = new Scanner(page);

    await scanner.scan('audit-dark');
    await page.evaluate(() => localStorage.setItem('studioflow.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('table')).toBeVisible();
    await scanner.scan('audit-light');
    scanner.verify();
  });
});
