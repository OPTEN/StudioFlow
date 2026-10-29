import type { Frame, Page } from '@playwright/test';
import type {
  SceneDto,
  TextSourceDto,
  TextThemeDto,
} from '../../../../packages/scene-model/src/contracts';
import type { AdminApi } from '../../support/api';
import type { Production } from '../../support/production';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { parseHex, type Rgba } from '../../support/ui/pixels';
import type { OutputPage } from '../../support/ui/output';

/**
 * Texts and lower thirds (issue #13, docs/testing.md E2E-TXT-*): the operator creates a lower third in the Sources dock,
 * edits it in the Properties dock and shows and hides it live; the output draws it as HTML text (DOM and pixels), follows
 * every edit without recreating the element, never interprets markup, and takes its colours from the production.
 * The Regie runs in English here (`en-US`), whatever the language of the other specs.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const REGIE_CONTEXT = {
  context: { locale: 'en-US', viewport: { width: 1440, height: 900 } },
} as const;

/** Accent bar of a lower third at its default place: left edge of the item (x 80), 9 px wide, vertical centre y 910. */
const ACCENT_PROBE = { x: 84, y: 910 };
const SCENE_GROUND = '#0d1117';
const THEME: TextThemeDto = { accent: '#ff8800', background: '#202020', foreground: '#ffffff' };

const near = (pixel: Rgba, hex: string, tolerance = 12): boolean => {
  const [r, g, b] = parseHex(hex);
  return (
    Math.abs(pixel[0] - r) <= tolerance &&
    Math.abs(pixel[1] - g) <= tolerance &&
    Math.abs(pixel[2] - b) <= tolerance
  );
};

async function accentPixel(output: OutputPage): Promise<Rgba> {
  return (await output.stagePixels()).at(ACCENT_PROBE.x, ACCENT_PROBE.y);
}

async function liveOutput(
  openOutput: (target: Production) => Promise<OutputPage>,
  api: AdminApi,
  production: Production,
): Promise<{ output: OutputPage; frame: Frame }> {
  expect((await api.startBroadcast(production.id)).status).toBe(200);
  const output = await openOutput(production);
  const frame = await output.frame();
  await expect(frame.locator('.sf-r-stage')).toBeVisible();
  await expect.poll(() => output.slateText(), { timeout: 15_000 }).toBe('');
  return { output, frame };
}

/** A text and its item (hidden or shown) in the first scene, made through the API. */
async function seedText(
  api: AdminApi,
  production: Production,
  content: Partial<TextSourceDto> & { line1: string },
  shown: boolean,
): Promise<{ text: TextSourceDto; scene: SceneDto; itemId: string }> {
  const created = await api.call<TextSourceDto>('POST', `/api/productions/${production.id}/texts`, {
    json: { line2: null, style: 'lowerThird', align: null, ...content },
  });
  expect(created.status, created.raw.text()).toBe(201);
  const sceneId = production.sceneIds[0]!;
  const added = await api.addSceneItem(production.id, sceneId, { source: created.body.id });
  expect(added.status).toBe(200);
  let scene = added.body as SceneDto;
  const item = scene.items.at(-1)!;
  if (shown) {
    const updated = await api.updateSceneItem(production.id, sceneId, item.id, {
      ...item,
      hidden: false,
    });
    expect(updated.status).toBe(200);
    scene = updated.body as SceneDto;
  }
  return { text: created.body, scene, itemId: item.id };
}

const rowOf = (page: Page, name: string) => page.locator('.c-src', { hasText: name });

test.describe('REGIE texts', () => {
  test(
    'E2E-TXT-01 [regie, output] a lower third is created hidden, edited with a live preview, shown and hidden live; the output draws HTML text (DOM and pixels) and follows every edit without recreating it',
    t.p1,
    async ({ openRegie, openOutput, api, production }) => {
      expect((await api.updateProduction(production.id, { textTheme: THEME })).status).toBe(200);
      const { output, frame } = await liveOutput(openOutput, api, production);
      const regie = await openRegie({ contextOptions: { context: REGIE_CONTEXT.context } });
      const page = regie.page;

      // "+ Source" > "Lower third": a hidden row T1 with placeholder content; the editor is open with a preview.
      await page.getByRole('button', { name: 'Add source', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Lower third' }).click();
      const row = rowOf(page, 'Name');
      await expect(row).toBeVisible();
      await expect(row.locator('.c-code')).toHaveText('T1');
      await expect(row).toHaveClass(/is-hidden/);
      await expect(page.locator('#sf-text-line1')).toHaveValue('Name');
      await expect(page.locator('sf-text-preview .sf-r-text-line1')).toHaveText('Name');
      await expect(frame.locator('.sf-r-text:visible'), 'hidden: nothing on the output').toHaveCount(0);
      expect(near(await accentPixel(output), SCENE_GROUND)).toBe(true);

      // Typing shows in the preview at once and reaches the server after a short pause; the output still hides it.
      await page.locator('#sf-text-line1').fill('Anna Keller');
      await page.locator('#sf-text-line2').fill('Head of Product');
      await expect(page.locator('sf-text-preview .sf-r-text-line1')).toHaveText('Anna Keller');
      await expect(page.locator('sf-text-preview .sf-r-text-line2')).toHaveText('Head of Product');
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.sources.find((s) => s.code === 'T1')?.text?.line1)
        .toBe('Anna Keller');
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(0);

      // Show: the row shows the eye state; the output draws the text within a moment.
      await page.getByRole('button', { name: 'Show: Anna Keller' }).click();
      await expect(frame.locator('.sf-r-text:visible'), 'shown within 2 s').toHaveCount(1, {
        timeout: 2_000,
      });
      await expect(frame.locator('.sf-r-text-line1')).toHaveText('Anna Keller');
      await expect(frame.locator('.sf-r-text-line2')).toHaveText('Head of Product');
      await expect
        .poll(async () => near(await accentPixel(output), THEME.accent), {
          message: 'the accent bar of the production shows on the stage',
          timeout: 3_000,
        })
        .toBe(true);
      const stage = await output.stagePixels();
      expect(
        stage.image.shareOfColor(THEME.background, { x: 100 * stage.scale, y: 830 * stage.scale, width: 400 * stage.scale, height: 20 * stage.scale }),
        'the bar behind the text has the production background',
      ).toBeGreaterThan(0.9);
      expect(
        stage.image.shareOfColor(THEME.foreground, { x: 100 * stage.scale, y: 840 * stage.scale, width: 700 * stage.scale, height: 150 * stage.scale }),
        'the letters are drawn in the text colour (sharp text, no picture)',
      ).toBeGreaterThan(0.01);
      expect(await frame.locator('.sf-r-text img, .sf-r-text canvas, .sf-r-text video').count()).toBe(0);

      // A change of the content is applied in place: the same element, new text, no gap.
      await frame.evaluate(() => {
        (window as unknown as { __line1: Element | null }).__line1 = document.querySelector('.sf-r-text-line1');
      });
      await page.locator('#sf-text-line1').fill('Anna Keller-Roth');
      await expect(frame.locator('.sf-r-text-line1')).toHaveText('Anna Keller-Roth', { timeout: 3_000 });
      expect(
        await frame.evaluate(() => {
          const kept = (window as unknown as { __line1: Element | null }).__line1;
          return kept === document.querySelector('.sf-r-text-line1') && kept?.isConnected === true;
        }),
        'the element was not recreated',
      ).toBe(true);
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(1);

      // Hide: gone after the animation.
      await page.getByRole('button', { name: 'Hide: Anna Keller-Roth' }).click();
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(0, { timeout: 2_000 });
      await expect
        .poll(async () => near(await accentPixel(output), SCENE_GROUND), { timeout: 3_000 })
        .toBe(true);
      expect(regie.problems.pageErrors).toEqual([]);
      expect(output.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-TXT-02 [regie, output] the text editor in the Properties dock: style and alignment, counter, empty first line, and "Delete text" removes the text from the scene and the output',
    t.p1,
    async ({ openRegie, openOutput, api, production }) => {
      const { text, itemId } = await seedText(api, production, { line1: 'Welcome to the show', line2: 'Season 3' }, true);
      const { frame } = await liveOutput(openOutput, api, production);
      const regie = await openRegie({ contextOptions: { context: REGIE_CONTEXT.context } });
      const page = regie.page;
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(1);

      await rowOf(page, 'Welcome to the show').locator('.c-src__select').click();
      await expect(page.locator('#sf-text-line1')).toHaveValue('Welcome to the show');
      // The counter only shows near the limit of 120 characters.
      await expect(page.locator('#sf-text-line1-count')).toHaveCount(0);

      // A title is centred; the output changes style without a reload.
      await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Title' }).click();
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.sources.find((s) => s.id === text.id)?.text?.style)
        .toBe('title');
      await expect(page.getByRole('group', { name: 'Alignment' })).toBeVisible();
      await page.getByRole('group', { name: 'Alignment' }).getByRole('button', { name: 'Right' }).click();
      await expect(frame.locator('.sf-r-text')).toHaveCSS('text-align', 'right', { timeout: 3_000 });

      // An empty first line is not sent and says why; the output keeps the last text.
      await page.locator('#sf-text-line1').fill('');
      await expect(page.locator('#sf-text-line1-error')).toHaveText('Enter the first line.');
      await expect(frame.locator('.sf-r-text-line1')).toHaveText('Welcome to the show');
      await page.locator('#sf-text-line1').fill('Welcome back');

      // Delete after the confirmation.
      await page.getByRole('button', { name: 'Delete text' }).click();
      await expect(page.locator('.c-confirm')).toContainText('T1 is deleted and removed from 1 scene.');
      await page.locator('.c-confirm').getByRole('button', { name: 'Delete this text' }).click();
      await expect(rowOf(page, 'Welcome back')).toHaveCount(0);
      await expect(frame.locator('.sf-r-text')).toHaveCount(0, { timeout: 3_000 });
      const snapshot = (await api.getSnapshot(production.id)).body;
      expect(snapshot.sources.some((source) => source.id === text.id)).toBe(false);
      expect(snapshot.scenes[0]!.items.some((item) => item.id === itemId)).toBe(false);
    },
  );

  test(
    'E2E-TXT-03 [settings, output] the settings page Text style: hex fields, warning below 4.5 : 1, nothing is sent for an invalid colour, saving recolours the output',
    t.p1,
    async ({ openRegie, openOutput, api, production }) => {
      await seedText(api, production, { line1: 'Mia Meier', line2: 'Host' }, true);
      const { output, frame } = await liveOutput(openOutput, api, production);
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(1);
      const regie = await openRegie({ contextOptions: { context: REGIE_CONTEXT.context } });
      const page = regie.page;

      await page.goto('/settings/text-style');
      await expect(page.getByRole('heading', { level: 1, name: 'Text style' })).toBeVisible();
      const field = (name: string) => page.getByLabel(`${name}, hex value`);
      const advice = page.getByRole('status').filter({ hasText: /^\s*Contrast/ });
      await expect(field('Accent')).toHaveValue('#1f6feb');
      await expect(advice).toHaveCount(0);

      // Grey on white is below 4.5 : 1: the warning names the ratio (rounded down); the colours can still be saved.
      await field('Background').fill('#ffffff');
      await field('Text').fill('#777777');
      await expect(advice).toHaveText(/^\s*Contrast 4\.4 : 1\./);
      await field('Text').fill('#767676');
      await expect(advice).toHaveCount(0);

      // An invalid colour is refused in the form; the API is not called.
      await field('Accent').fill('orange');
      await page.getByRole('button', { name: 'Save colours', exact: true }).click();
      await expect(page.locator('.c-field-error')).toContainText('Enter the colour as #rrggbb');
      expect((await api.getSnapshot(production.id)).body.production.textTheme.accent).toBe('#1f6feb');

      await field('Accent').fill('#00aa55');
      await page.getByRole('button', { name: 'Save colours', exact: true }).click();
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.production.textTheme).toEqual({
        accent: '#00aa55',
        background: '#ffffff',
        foreground: '#767676',
      });
      await expect
        .poll(async () => near(await accentPixel(output), '#00aa55'), { timeout: 3_000, message: 'the output uses the new accent' })
        .toBe(true);
      await expect(frame.locator('.sf-r-text')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    },
  );

  test(
    'E2E-TXT-04 [output] markup in a text is shown literally and never runs; long lines end in an ellipsis; right-to-left lines read right-to-left; emoji are drawn',
    t.p1,
    async ({ openOutput, api, production }) => {
      const injected = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
      await seedText(api, production, { line1: injected, line2: 'x'.repeat(120) }, true);
      const { frame } = await liveOutput(openOutput, api, production);

      await expect(frame.locator('.sf-r-text-line1')).toHaveText(injected);
      expect(await frame.locator('.sf-r-text img, .sf-r-text script').count()).toBe(0);
      await frame.page().waitForTimeout(500);
      expect(await frame.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

      const long = frame.locator('.sf-r-text-line2');
      await expect(long).toHaveCSS('text-overflow', 'ellipsis');
      await expect(long).toHaveCSS('white-space', 'nowrap');
      expect(await long.evaluate((element) => element.scrollWidth > element.clientWidth), 'the line is cut, not wrapped').toBe(true);

      const arabic = 'مرحبا بالعالم';
      await seedTextUpdate(api, production, { line1: arabic, line2: 'שלום עולם 😀 👨‍👩‍👧‍👦' });
      await expect(frame.locator('.sf-r-text-line1')).toHaveText(arabic, { timeout: 3_000 });
      await expect(frame.locator('.sf-r-text-line1')).toHaveCSS('direction', 'rtl');
      await expect(frame.locator('.sf-r-text-line2')).toHaveText('שלום עולם 😀 👨‍👩‍👧‍👦');
    },
  );

  test(
    'E2E-TXT-05 [output] the output page scales text with the canvas: the same lower third in a small and a large window',
    t.p2,
    async ({ openOutput, api, production }) => {
      await seedText(api, production, { line1: 'Scaling', line2: 'Sharp at every size' }, true);
      const { output, frame } = await liveOutput(openOutput, api, production);
      await expect(frame.locator('.sf-r-text:visible')).toHaveCount(1);
      const share = async (): Promise<number> => {
        const stage = await output.stagePixels();
        return stage.image.shareOfColor(THEME_DEFAULT_ACCENT, { x: 81 * stage.scale, y: 820 * stage.scale, width: 6 * stage.scale, height: 180 * stage.scale });
      };

      await output.page.setViewportSize({ width: 960, height: 540 });
      await expect.poll(share, { message: 'the accent bar fills its strip at 960 x 540' }).toBeGreaterThan(0.8);
      await output.page.setViewportSize({ width: 1920, height: 1080 });
      await expect.poll(share, { message: 'and at 1920 x 1080' }).toBeGreaterThan(0.8);
      const sizes = await frame.locator('.sf-r-text-line1').evaluate((element) => getComputedStyle(element).fontSize);
      expect(sizes, 'the font size is in canvas pixels, not in screen pixels').toBe('61.2px');
    },
  );
});

const THEME_DEFAULT_ACCENT = '#1f6feb';

async function seedTextUpdate(
  api: AdminApi,
  production: Production,
  content: { line1: string; line2: string | null },
): Promise<void> {
  const snapshot = (await api.getSnapshot(production.id)).body;
  const text = snapshot.sources.find((source) => source.kind === 'text')!.text!;
  const updated = await api.call('PUT', `/api/productions/${production.id}/texts/${text.id}`, {
    json: { ...content, style: text.style, align: text.align },
  });
  expect(updated.status).toBe(200);
}
