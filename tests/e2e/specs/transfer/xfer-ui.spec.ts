import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { CUT, parseOutputUrl } from '../../support/api';
import { Scanner } from '../../support/a11y/axe';
import { FULL, LEFT, putInScene } from '../../support/devices/fleet';
import { openProbedOutput } from '../../support/output/open';
import { addCamera, goLive } from '../../support/output/world';
import { adoptProduction, cleanupProduction, pairLaptopByLink, pairPhone } from '../../support/production';
import { expectToast, sourcesDock } from '../../support/regie/kit';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { pairPhoneViaQr } from '../../support/ui/pairing';
import { readZip } from '../../support/zip';

/**
 * XFER in the Regie (docs/testing.md 2.19: E2E-XFER-10 ... 12): Settings › All productions offers "Duplicate…",
 * "Export" and "Import…" (the switcher in the toolbar leads there with "Import…"); the devices of a copy are
 * placeholders until a phone is paired and takes the place with one click ("Use as K1 · Stage phone"), after which its
 * picture shows in every scene that showed K1.
 */

const menuButton = (page: Page) => page.getByRole('button', { name: /^Production .*, menu$/ });

/** Settings › All productions in the Regie's tab. */
async function openProductions(page: Page) {
  await page.goto('/settings/productions');
  await expect(page.getByRole('heading', { level: 1, name: 'All productions' })).toBeVisible();
}

/** The row of a production on the page "All productions". */
const productionRow = (page: Page, name: string) =>
  page.getByTestId('production-row').filter({ has: page.getByText(name, { exact: true }) });

/** "Import…" in the switcher of the control room: the page "All productions" with the import form open. */
async function importFromSwitcher(page: Page) {
  await menuButton(page).click();
  await page.getByRole('dialog', { name: 'Production' }).getByRole('link', { name: 'Import…' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'All productions' })).toBeVisible();
}

test.describe('XFER regie', () => {
  test(
    'E2E-XFER-10 [ui, K1] duplicate in the menu, pair a phone, "Use as K1 · Stage phone": the picture shows in every K1 scene on the output',
    t.smoke,
    async ({ browser, regie, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      await production.seed(['Welcome', 'Talk', 'Break']);
      const original = await addCamera(deps, 'Stage phone');
      expect(original.code).toBe('K1');
      await putInScene(api, production, 0, original.source, FULL);
      await putInScene(api, production, 1, original.source, LEFT);
      const page = regie.page;

      // Duplicate (Settings › All productions): the name of the copy starts as "<name> (copy)"; the copy is listed and
      // not active.
      await openProductions(page);
      await page.getByRole('button', { name: 'Duplicate…', exact: true }).click();
      const form = page.locator('[data-form="duplicate"]');
      const name = page.locator('#duplicate-name');
      await expect(name).toHaveValue(`${production.name} (copy)`);
      await expect(form).toContainText('Cameras and screens become placeholders');
      const scanner = new Scanner(page);
      await scanner.scan('xfer-duplicate-form', { include: ['[data-form="duplicate"]'] });
      await form.getByRole('button', { name: 'Duplicate', exact: true }).click();
      await expectToast(page, `Production “${production.name} (copy)” created.`);
      const copyRow = productionRow(page, `${production.name} (copy)`);
      await expect(copyRow).toBeVisible();
      await expect(copyRow).not.toHaveAttribute('aria-current', 'true');
      expect((await api.getActiveProduction()).body.id, 'the copy is not active').toBe(production.id);

      // Switch to the copy: its items say "Source missing", the Sources dock lists the missing K1.
      await copyRow.getByRole('button', { name: `Switch to “${production.name} (copy)”` }).click();
      await expect(copyRow).toHaveAttribute('aria-current', 'true');
      await regie.goto();
      await regie.waitReady();
      await expect(menuButton(page)).toHaveAccessibleName(`Production ${production.name} (copy), menu`);
      const copyDto = (await api.listProductions()).body.find((entry) => entry.name === `${production.name} (copy)`)!;
      const copy = await adoptProduction(api, production, copyDto);
      onCleanup(() => cleanupProduction(copy));
      const sources = sourcesDock(page);
      const missing = sources.getByTestId('placeholders');
      await expect(missing).toContainText('Missing sources');
      await expect(missing.locator('[data-code="K1"]')).toContainText('Stage phone');
      await expect(missing.locator('[data-code="K1"]')).toContainText('in 2 scenes');
      await expect(sources.locator('.c-src').first()).toContainText('K1');
      await expect(sources.locator('.c-src').first()).toContainText('Source missing');

      // Pair a phone with the QR code of the copy; it is offered the place of K1.
      const phone = await openPhone({ camera: 'stamp' });
      const paired = await pairPhoneViaQr(regie, phone);
      await phone.waitForCamera('live', 45_000);
      const offer = paired.row.locator('sf-placeholder-offer').getByRole('button', { name: 'Use as K1 · Stage phone' });
      await expect(offer).toBeVisible();
      await regie.closePairing();
      await scanner.scan('xfer-missing-sources-and-offer');
      scanner.verify();
      await offer.click();
      await expectToast(page, 'in place of K1 · Stage phone');
      await expect(offer).toHaveCount(0);
      await expect(missing).toHaveCount(0);
      // The new phone is K1 now, in both scenes of the copy.
      await expect(sources.locator('.c-src').first().locator('.c-code')).toHaveText('K1');
      await expect(paired.row.locator('.c-st__codes')).toContainText('K1');
      const scenes = (await api.getSnapshot(copy.id)).body.scenes;
      const newSource = `${paired.stored.deviceId}/camera`;
      expect(scenes.map((scene) => scene.items.map((item) => item.source))).toEqual([[newSource], [newSource], []]);

      // On the output the picture of the new phone shows in the first scene and, after the switch, in the second.
      await goLive(api, copy);
      const target = { slug: copy.slug, outputKey: parseOutputUrl((await api.getOutputSettings(copy.id)).body.url).key };
      const output = await openProbedOutput({ browser, onCleanup }, target, {}, { viewport: { width: 1280, height: 720 } });
      await output.output.waitForPlayingVideos(1, { minFps: 10, timeout: 45_000 });
      expect((await api.switchProgram(copy.id, { sceneId: scenes[1]!.id, transition: CUT })).status).toBe(200);
      await expect.poll(() => output.output.sceneIds(), { timeout: 15_000 }).toEqual([scenes[1]!.id]);
      await output.output.waitForPlayingVideos(1, { minFps: 10, timeout: 30_000 });
    },
  );

  test(
    'E2E-XFER-11 [ui, K1] export downloads a .studioflow.zip; import shows what it contains before anything is created, then makes a new production that is not active; a wrong file is explained',
    t.p1,
    async ({ regie, api, production, pairContext }, testInfo) => {
      test.setTimeout(180_000);
      await production.seed(['Welcome', 'Talk', 'Break']);
      const phone = await pairPhone(pairContext, { name: 'Stage phone' });
      await putInScene(api, production, 0, phone.sourceId('camera'), FULL);
      await putInScene(api, production, 1, phone.sourceId('camera'), LEFT);
      const page = regie.page;

      // Export (Settings › All productions › This production): a download with the extension.
      await openProductions(page);
      const downloading = page.waitForEvent('download');
      await page.getByTestId('export-production').click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/\.studioflow\.zip$/);
      const file = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(file);
      const files = readZip(fs.readFileSync(file));
      expect(files.map((entry) => entry.name)).toContain('manifest.json');
      await expectToast(page, `Export of “${production.name}” started`);

      // Import: choose the file, see the preview, nothing is created before "Import".
      const before = (await api.listProductions()).body.length;
      await regie.goto();
      await regie.waitReady();
      await importFromSwitcher(page);
      await page.locator('[data-testid="import-file"]').setInputFiles(file);
      const preview = page.locator('[data-testid="import-preview"]');
      await expect(preview).toContainText(`${production.name} (2)`);
      await expect(page.getByText('3 scenes', { exact: true })).toBeVisible();
      await expect(page.locator('[data-testid="import-placeholders"]')).toContainText('K1');
      await expect(page.locator('[data-testid="import-placeholders"]')).toContainText('Stage phone');
      await expect(page.getByText('A production with this name exists already.')).toBeVisible();
      const scanner = new Scanner(page);
      await scanner.scan('xfer-import-preview', { include: ['[data-form="import"]'] });
      scanner.verify();
      expect((await api.listProductions()).body, 'the preview creates nothing').toHaveLength(before);

      await page.locator('[data-testid="import-submit"]').click();
      await expectToast(page, `Production “${production.name} (2)” imported.`);
      const imported = productionRow(page, `${production.name} (2)`);
      await expect(imported).toBeVisible();
      await expect(imported).not.toHaveAttribute('aria-current', 'true');
      const list = (await api.listProductions()).body;
      expect(list).toHaveLength(before + 1);
      const created = list.find((entry) => entry.name === `${production.name} (2)`)!;
      expect(created.isActive).toBe(false);
      expect((await api.getActiveProduction()).body.id).toBe(production.id);
      const snapshot = (await api.getSnapshot(created.id)).body;
      expect(snapshot.scenes.map((scene) => scene.name)).toEqual(['Welcome', 'Talk', 'Break']);
      expect(snapshot.placeholders.map((entry) => entry.code)).toEqual(['K1']);

      // A file that is not an export is explained and creates nothing.
      await page.getByRole('button', { name: 'Import…', exact: true }).click();
      const notes = testInfo.outputPath('notes.zip');
      fs.writeFileSync(notes, 'this is not a zip file');
      await page.locator('[data-testid="import-file"]').setInputFiles(notes);
      await expect(page.getByRole('alert').filter({ hasText: 'not a valid StudioFlow export' })).toBeVisible();
      expect((await api.listProductions()).body).toHaveLength(before + 1);
    },
  );

  test(
    'E2E-XFER-12 [ui, K1 + S1] the Sources dock assigns a missing source to an existing phone with one click and removes another one from all scenes after a confirmation',
    t.p1,
    async ({ regie, api, production, pairContext }) => {
      test.setTimeout(180_000);
      await production.seed(['Welcome', 'Talk', 'Break']);
      const phone = await pairPhone(pairContext, { name: 'Stage phone' });
      const laptop = await pairLaptopByLink(pairContext, { name: 'Lea laptop' });
      await putInScene(api, production, 0, phone.sourceId('camera'), LEFT);
      await putInScene(api, production, 0, laptop.sourceId('screen-1'), { x: 960, y: 0, w: 960, h: 1080, fit: 'cover' });
      await putInScene(api, production, 1, phone.sourceId('camera'), FULL);
      const duplicated = await api.duplicateProduction(production.id, { name: null });
      expect(duplicated.status).toBe(201);
      const copy = await adoptProduction(api, production, duplicated.body);
      expect((await api.activateProduction(copy.id)).status).toBe(200);
      // Two devices of the copy: one camera that no scene uses.
      const spare = await pairPhone({ production: copy, stack: pairContext.stack }, { name: 'Spare phone' });
      await regie.goto();
      await regie.waitReady();
      const sources = sourcesDock(regie.page);
      const missing = sources.getByTestId('placeholders');
      await expect(missing.locator('[data-code="K1"]')).toContainText('in 2 scenes');
      await expect(missing.locator('[data-code="S1"]')).toContainText('in 1 scene');

      // Assign K1 to the spare phone in the Sources dock (the station row offers the same).
      await missing.locator('[data-code="K1"]').getByRole('button', { name: 'Assign K1 · Stage phone' }).click();
      await expect(missing.locator('[data-code="K1"] .c-ph__picker')).toContainText('Show K1 · Stage phone as');
      const scanner = new Scanner(regie.page);
      await scanner.scan('xfer-assign-picker');
      scanner.verify();
      await missing.locator(`[data-source="${spare.sourceId('camera')}"]`).click();
      await expectToast(regie.page, 'The scenes now show Spare phone in place of K1 · Stage phone.');
      await expect(missing.locator('[data-code="K1"]')).toHaveCount(0);
      const afterAssign = (await api.getSnapshot(copy.id)).body;
      expect(afterAssign.scenes.map((scene) => scene.items.map((item) => item.source))).toEqual([
        [spare.sourceId('camera'), expect.stringContaining('/screen-1')],
        [spare.sourceId('camera')],
        [],
      ]);
      expect(afterAssign.placeholders.map((entry) => entry.code)).toEqual(['S1']);

      // Remove S1: the confirmation names what goes; Cancel changes nothing, the button removes the item.
      await missing.locator('[data-code="S1"]').getByRole('button', { name: 'Assign S1 · Lea laptop · Screen 1' }).click();
      await missing.getByRole('button', { name: 'Remove from all scenes…' }).click();
      await expect(missing).toContainText('The 1 element that shows S1 · Lea laptop · Screen 1 is removed from its scene.');
      await missing.getByRole('button', { name: 'Cancel' }).click();
      expect((await api.getSnapshot(copy.id)).body.placeholders).toHaveLength(1);
      await missing.getByRole('button', { name: 'Remove from all scenes…' }).click();
      await missing.getByRole('button', { name: 'Remove S1 · Lea laptop · Screen 1' }).click();
      await expect(missing).toHaveCount(0);
      const afterRemove = (await api.getSnapshot(copy.id)).body;
      expect(afterRemove.placeholders).toEqual([]);
      expect(afterRemove.scenes.map((scene) => scene.items.length)).toEqual([1, 1, 0]);
    },
  );
});
