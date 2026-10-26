import type { Page } from '@playwright/test';
import type {
  SceneDto,
  TextSourceDto,
  TextThemeDto,
} from '../../../../packages/scene-model/src/contracts';
import { parseOutputUrl, type AdminApi } from '../../support/api';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import type { OutputPage } from '../../support/ui/output';
import { parseHex, type Rgba } from '../../support/ui/pixels';

/**
 * Format and resolution of the output (issue #8, docs/testing.md E2E-FMT-*): a production is created as 9:16, the
 * monitors and the output page take its shape, a text sits where the canvas puts it, and a change to 1:1 reaches the
 * open output page live. The Regie runs in English (`en-US`).
 */

const REGIE_CONTEXT = {
  context: { locale: 'en-US', viewport: { width: 1440, height: 900 } },
} as const;

/** The output window has the size of the 9:16 canvas, so one canvas pixel is one screen pixel. */
const OUTPUT_CONTEXT = { context: { context: { viewport: { width: 1080, height: 1920 } } } } as const;

const THEME: TextThemeDto = { accent: '#ff8800', background: '#202020', foreground: '#ffffff' };

const near = (pixel: Rgba, hex: string, tolerance = 14): boolean => {
  const [r, g, b] = parseHex(hex);
  return (
    Math.abs(pixel[0] - r) <= tolerance &&
    Math.abs(pixel[1] - g) <= tolerance &&
    Math.abs(pixel[2] - b) <= tolerance
  );
};

/** Opens the menu of the production and returns the entry with the label. */
async function menuItem(page: Page, label: string) {
  await page.locator('.c-prod__trigger').click();
  return page.getByRole('button', { name: label, exact: true });
}

/** Creates a production in the new-production form of the Regie and waits until the Regie follows it. */
async function createInRegie(page: Page, name: string, ratio: string): Promise<void> {
  await (await menuItem(page, 'New production…')).click();
  await page.locator('.c-prod__form input[type="text"]').fill(name);
  await expect(page.locator('.c-seg button[aria-pressed="true"]')).toHaveText(['16:9', '1080p']);
  await page.getByRole('button', { name: ratio, exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.c-prod__name')).toHaveText(name);
}

/** A lower third of the first scene of the production: shown, with the accent colour of THEME. */
async function seedLowerThird(
  api: AdminApi,
  productionId: string,
): Promise<{ scene: SceneDto; itemId: string }> {
  expect((await api.updateProduction(productionId, { textTheme: THEME })).status).toBe(200);
  const created = await api.call<TextSourceDto>('POST', `/api/productions/${productionId}/texts`, {
    json: { line1: 'Anna Keller', line2: 'Head of Product', style: 'lowerThird', align: null },
  });
  expect(created.status, created.raw.text()).toBe(201);
  const scene = (await api.getSnapshot(productionId)).body.scenes[0]!;
  const added = await api.addSceneItem(productionId, scene.id, { source: created.body.id });
  expect(added.status).toBe(200);
  const item = (added.body as SceneDto).items.at(-1)!;
  const shown = await api.updateSceneItem(productionId, scene.id, item.id, { ...item, hidden: false });
  expect(shown.status).toBe(200);
  return { scene: shown.body as SceneDto, itemId: item.id };
}

async function accentShare(output: OutputPage, rect: { x: number; y: number; w: number; h: number }) {
  const stage = await output.stagePixels();
  return stage.image.shareOfColor(THEME.accent, {
    x: rect.x * stage.scale,
    y: rect.y * stage.scale,
    width: rect.w * stage.scale,
    height: rect.h * stage.scale,
  });
}

async function stageSize(output: OutputPage): Promise<{ width: number; height: number }> {
  const frame = await output.frame();
  return frame.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.sf-r-stage')!;
    return { width: stage.offsetWidth, height: stage.offsetHeight };
  });
}

async function screenRatios(page: Page): Promise<number[]> {
  return page.locator('.c-monitor__screen').evaluateAll((screens) =>
    screens.map((screen) => {
      const box = screen.getBoundingClientRect();
      return Math.round((box.width / box.height) * 1000) / 1000;
    }),
  );
}

test.describe('REGIE format and resolution', () => {
  test(
    'E2E-FMT-01 [regie, output] a production is created as 9:16: monitors and output page take its shape, a text sits where the portrait canvas puts it; a change to 1:1 reaches the open output live, and while the broadcast is live nothing can be changed',
    t.p1,
    async ({ openRegie, openOutput, api, production }) => {
      void production;
      const regie = await openRegie({ contextOptions: REGIE_CONTEXT });
      const page = regie.page;
      const name = `e2e portrait ${Math.random().toString(36).slice(2, 7)}`;

      // New production, 9:16 · 1080p picked in the form.
      await createInRegie(page, name, '9:16');
      const created = (await api.listProductions()).body.find((entry) => entry.name === name)!;
      expect(created, 'the production exists').toBeTruthy();
      const snapshot = (await api.getSnapshot(created.id)).body;
      expect(snapshot.production.canvas).toEqual({
        format: 'portrait',
        resolution: 'p1080',
        width: 1080,
        height: 1920,
      });

      // The Program monitor is narrow and says its size.
      await expect(page.locator('sf-monitor.c-monitor--program .c-monitor__meta')).toHaveText(
        '1080 × 1920 · 30 fps',
      );
      expect((await screenRatios(page))[0]).toBeCloseTo(0.5625, 2);

      // The output page of the new production draws the 1080 × 1920 stage with bars left and right.
      const { key } = parseOutputUrl((await api.getOutputSettings(created.id)).body.links[0]!.url);
      const target = { slug: created.slug, outputKey: key };
      const { itemId, scene } = await seedLowerThird(api, created.id);
      expect((await api.startBroadcast(created.id)).status).toBe(200);
      const output = await openOutput(target, {}, OUTPUT_CONTEXT);
      const frame = await output.frame();
      await expect(frame.locator('.sf-r-stage')).toBeVisible();
      await expect.poll(() => output.slateText(), { timeout: 15_000 }).toBe('');
      expect(await stageSize(output)).toEqual({ width: 1080, height: 1920 });
      const portrait = await output.stagePixels();
      expect(portrait.canvas).toEqual({ width: 1080, height: 1920 });
      expect(portrait.image.width / portrait.image.height).toBeCloseTo(0.5625, 2);
      await expect
        .poll(async () => near((await output.stagePixels()).at(47, 1824), THEME.accent), {
          message: 'the accent bar of the lower third sits at the bottom left of the portrait canvas',
          timeout: 5_000,
        })
        .toBe(true);
      const item = scene.items.find((entry) => entry.id === itemId)!;
      expect({ x: item.x, y: item.y, w: item.w, h: item.h }).toEqual({
        x: 45,
        y: 1774,
        w: 540,
        h: 101,
      });

      // Live: the menu says why nothing can be changed, the API refuses.
      await (await menuItem(page, 'Format and resolution…')).click();
      await expect(page.getByRole('status').filter({ hasText: 'while the broadcast is live' })).toBeVisible();
      await expect(page.locator('.c-seg button[aria-pressed="true"]')).toHaveText(['9:16', '1080p']);
      for (const button of await page.locator('.c-seg button').all()) {
        await expect(button).toBeDisabled();
      }
      const refused = await api.changeCanvas(created.id, { format: 'square', resolution: 'p1080' });
      expect(refused.status).toBe(409);
      expect((refused.body as { code?: string }).code).toBe('broadcast_live');
      await page.keyboard.press('Escape');

      // Not live any more: the change to 1:1 asks first, because the scene has an element.
      expect((await api.resetBroadcast(created.id)).status).toBe(200);
      await (await menuItem(page, 'Format and resolution…')).click();
      await page.getByRole('button', { name: '1:1', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('sf-confirm-box')).toContainText('scaled to fit the new canvas');
      expect((await api.getSnapshot(created.id)).body.production.canvas.format).toBe('portrait');
      await page.getByRole('button', { name: 'Change format', exact: true }).click();

      // The open output page follows without a reload; the monitors are square.
      await expect.poll(() => stageSize(output), { timeout: 5_000 }).toEqual({ width: 1080, height: 1080 });
      await expect(page.locator('sf-monitor.c-monitor--program .c-monitor__meta')).toHaveText(
        '1080 × 1080 · 30 fps',
      );
      expect((await screenRatios(page))[0]).toBeCloseTo(1, 2);
      const fitted = (await api.getSnapshot(created.id)).body.scenes[0]!.items.find(
        (entry) => entry.id === itemId,
      )!;
      expect({ x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }).toEqual({
        x: 262,
        y: 998,
        w: 304,
        h: 57,
      });

      // The fitted element is where the square canvas shows it: the accent bar at its left edge.
      expect((await api.startBroadcast(created.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 15_000 }).toBe('');
      await expect
        .poll(
          async () =>
            (await accentShare(output, { x: fitted.x, y: fitted.y + 8, w: 3, h: fitted.h - 16 })) > 0.6,
          { message: 'the accent bar sits at the fitted position', timeout: 5_000 },
        )
        .toBe(true);
      expect((await api.endBroadcast(created.id)).status).toBe(200);
      expect(regie.problems.pageErrors).toEqual([]);
      expect(output.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-FMT-02 [api, output] the default production is 16:9 at 1080p; another resolution scales the elements in proportion and the open output follows; bad values are refused',
    t.p1,
    async ({ openOutput, api, production }) => {
      const created = (await api.getSnapshot(production.id)).body;
      expect(created.production.canvas).toEqual({
        format: 'widescreen',
        resolution: 'p1080',
        width: 1920,
        height: 1080,
      });
      const { itemId } = await seedLowerThird(api, production.id);
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      const output = await openOutput(production, {}, { context: { context: { viewport: { width: 1280, height: 720 } } } });
      await expect.poll(() => output.slateText(), { timeout: 15_000 }).toBe('');
      expect(await stageSize(output)).toEqual({ width: 1920, height: 1080 });
      expect((await api.endBroadcast(production.id)).status).toBe(200);

      const changed = await api.changeCanvas(production.id, { format: 'widescreen', resolution: 'p720' });
      expect(changed.status).toBe(200);
      await expect.poll(() => stageSize(output), { timeout: 5_000 }).toEqual({ width: 1280, height: 720 });
      const scaled = (await api.getSnapshot(production.id)).body.scenes[0]!.items.find(
        (entry) => entry.id === itemId,
      )!;
      expect({ x: scaled.x, y: scaled.y, w: scaled.w, h: scaled.h }).toEqual({
        x: 53,
        y: 547,
        w: 640,
        h: 120,
      });

      for (const body of [
        { format: 'cinemascope', resolution: 'p1080' },
        { format: 'widescreen', resolution: 'p4320' },
        { format: 'widescreen' },
        {},
      ]) {
        expect((await api.changeCanvas(production.id, body as never)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await api.getSnapshot(production.id)).body.production.canvas.resolution).toBe('p720');
      expect((await api.changeCanvas(production.id, { format: 'widescreen', resolution: 'p1080' })).status).toBe(200);
      expect(output.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-FMT-03 [regie] "Format and resolution…" offers four formats and two resolutions; another resolution is saved without a question, the monitors and the scene thumbnails follow the shape',
    t.p2,
    async ({ openRegie, api, production }) => {
      const regie = await openRegie({ contextOptions: REGIE_CONTEXT });
      const page = regie.page;
      await (await menuItem(page, 'Format and resolution…')).click();
      await expect(page.locator('.c-seg').nth(0).locator('button')).toHaveText(['16:9', '9:16', '1:1', '4:3']);
      await expect(page.locator('.c-seg').nth(1).locator('button')).toHaveText(['720p', '1080p']);
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

      await page.getByRole('button', { name: '720p', exact: true }).click();
      await expect(page.getByText('every element is scaled in proportion')).toBeVisible();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('sf-confirm-box')).toHaveCount(0);
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.production.canvas.width)
        .toBe(1280);
      await expect(page.locator('sf-monitor.c-monitor--program .c-monitor__meta')).toHaveText(
        '1280 × 720 · 30 fps',
      );

      // Another format, no scene has elements: saved without a question; the thumbnails are as tall as before.
      await (await menuItem(page, 'Format and resolution…')).click();
      await page.getByRole('button', { name: '9:16', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.production.canvas.format)
        .toBe('portrait');
      const thumb = page.locator('.c-scene__thumb').first();
      await expect
        .poll(async () => {
          const box = (await thumb.boundingBox())!;
          return Math.round((box.width / box.height) * 100) / 100;
        })
        .toBeCloseTo(0.56, 1);
      expect((await thumb.boundingBox())!.height).toBeCloseTo(36, 0);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
