import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { OutputApi, parseOutputUrl } from '../../support/api';
import { ERROR, THRESHOLD } from '../../support/constants';
import { expectProblem } from '../../support/fixtures';
import { expect, test } from '../../support/ui/fixtures';
import { OutputHub, negotiate, StudioHub } from '../../support/hubs';
import { t } from '../../support/tags';
import { OutputPage } from '../../support/ui/output';
import { newUiContext } from '../../support/ui/init';

/**
 * Output links and the output as a camera (issue #9, docs/testing.md E2E-LINK-01 .. E2E-LINK-03): a production has several
 * named output links, each with its own state, IP restriction and revocation; the popover downloads an OBS scene
 * collection whose browser source shows the chosen link. The Regie and the output run in English (`en-US`), whatever
 * the language of the other specs.
 */

test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

const ENGLISH_UI = { context: { locale: 'en-US' } } as const;

const chip = (page: Page): Locator => page.getByRole('button', { name: /^Output/ });
const popover = (page: Page): Locator => page.getByRole('dialog', { name: 'Output' });
const linkRow = (pop: Locator, name: string): Locator =>
  pop.locator('.c-output-pop__link').filter({ hasText: name });

async function openPopover(page: Page): Promise<Locator> {
  const pop = popover(page);
  if (!(await pop.isVisible())) await chip(page).click();
  await expect(pop).toBeVisible();
  return pop;
}

async function addLink(pop: Locator, name: string): Promise<void> {
  await pop.getByLabel('Name of the new link').fill(name);
  await pop.getByRole('button', { name: 'Create link' }).click();
  await expect(linkRow(pop, name)).toBeVisible();
}

test.describe('LINK output links and the camera', () => {
  test(
    'E2E-LINK-01 [regie + output] two links are shown with their own state; revoking one in the popover denies only its output page',
    t.p0,
    async ({ regie, openOutput, api, production }) => {
      test.setTimeout(120_000);
      const page = regie.page;
      const pop = await openPopover(page);
      await expect(linkRow(pop, 'Proxy')).toContainText('Proxy · not connected');
      await addLink(pop, 'Teams camera');
      const teamsKey = await production
        .snapshot()
        .then(() => api.getOutputSettings(production.id))
        .then((settings) => {
          const teams = settings.body.links.find((link) => link.name === 'Teams camera');
          expect(teams, 'the new link is on the server').toBeDefined();
          return parseOutputUrl(teams!.url).key;
        });
      expect(teamsKey).not.toBe(production.outputKey);

      // Two output pages, one per link: both show their own state in the popover and the chip.
      const proxyPage = await openOutput(production, {}, { context: ENGLISH_UI });
      const teamsPage = await openOutput({ slug: production.slug, outputKey: teamsKey }, {}, { context: ENGLISH_UI });
      await proxyPage.stage();
      await teamsPage.stage();
      await expect(linkRow(pop, 'Proxy')).toHaveText(/^Proxy · connected$/, { timeout: 15_000 });
      await expect(linkRow(pop, 'Teams camera')).toHaveText(/^Teams camera · connected$/, {
        timeout: 15_000,
      });
      await expect(chip(page)).toContainText('Proxy + Teams camera');

      // Revoke "Teams camera" in the popover: only its page is denied, within the key hard limit.
      await linkRow(pop, 'Teams camera').click();
      await pop.getByRole('button', { name: 'Revoke link' }).click();
      const clicked = Date.now();
      await pop
        .getByRole('group', { name: 'Revoke link' })
        .getByRole('button', { name: 'Revoke' })
        .click();
      await expect
        .poll(() => teamsPage.slateText(), {
          message: 'the revoked link shows “No access”',
          timeout: 8000,
          intervals: [100],
        })
        .toContain('No access');
      const deniedAfter = Date.now() - clicked;
      test.info().annotations.push({
        type: 'measurement',
        description: `output of the revoked link refused ${deniedAfter} ms after confirming`,
      });
      expect(deniedAfter, 'T-KEY hard limit').toBeLessThanOrEqual(THRESHOLD.keyHardMs);
      await expect(linkRow(pop, 'Teams camera')).toHaveCount(0);

      // The other link keeps playing: its page is not denied, still connected, and survives a few report ticks.
      expect(await proxyPage.slateText()).not.toContain('No access');
      await expect(linkRow(pop, 'Proxy')).toHaveText(/^Proxy · connected$/, { timeout: 10_000 });
      await expect(chip(page)).toContainText('Proxy');
      await expect(chip(page)).not.toContainText('Teams camera');
      await proxyPage.page.waitForTimeout(3000);
      expect(await proxyPage.slateText()).not.toContain('No access');

      // The revoked key stays dead after a reload; the other key still works.
      await teamsPage.page.reload();
      await expect
        .poll(() => teamsPage.slateText(), { timeout: 10_000 })
        .toContain('No access');
      expect((await production.output(teamsKey).getOutputSnapshot()).status).toBe(403);
      expect((await production.output().getOutputSnapshot()).status).toBe(200);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-LINK-02 [api, hubs] revoking or regenerating a link closes only its own hub connections; the revoked key fails on REST and negotiate at once',
    t.p0,
    async ({ config, api, production, onCleanup }) => {
      const first = (await api.createOutputLink(production.id, 'Teams camera')).body;
      const second = (await api.createOutputLink(production.id, 'Zoom room')).body;
      const keyOf = (url: string) => parseOutputUrl(url).key;
      const studio = StudioHub.connect(config.baseURL, api.cookie);
      onCleanup(() => studio.stop());
      await studio.open(production.id);
      const proxyHub = OutputHub.connect(config.baseURL, production.outputKey);
      const firstHub = OutputHub.connect(config.baseURL, keyOf(first.url));
      const secondHub = OutputHub.connect(config.baseURL, keyOf(second.url));
      for (const hub of [proxyHub, firstHub, secondHub]) {
        onCleanup(() => hub.stop());
        await hub.open();
        await hub.report({ rendering: true });
      }
      const status = await studio.waitForEvent(
        'outputStatusChanged',
        (event) => event.status.links.filter((link) => link.state === 'connected').length === 3,
      );
      expect(status.status.links.map((link) => link.name).sort()).toEqual([
        'Proxy',
        'Teams camera',
        'Zoom room',
      ]);

      // Revoke the first: its connection closes, the key is dead everywhere, the others stay.
      const revoked = Date.now();
      expect((await api.revokeOutputLink(production.id, first.id)).status).toBe(204);
      const closedAt = await firstHub.waitClosed(5000);
      expect(closedAt - revoked, 'kicked within T-KEY').toBeLessThanOrEqual(THRESHOLD.keyHardMs);
      expectProblem(
        await new OutputApi(config.baseURL, production.slug, keyOf(first.url)).getOutputSnapshot(),
        403,
        ERROR.forbidden,
      );
      expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: keyOf(first.url) })).status).toBe(403);
      const afterRevoke = await studio.waitForEvent(
        'outputStatusChanged',
        (event) => event.status.links.length === 2,
      );
      expect(afterRevoke.status.links.every((link) => link.state === 'connected')).toBe(true);
      expect([proxyHub.closedAt, secondHub.closedAt], 'the other connections stay open').toEqual([undefined, undefined]);

      // Regenerate the second: only its connection closes, the old key is dead, the new one works.
      expect((await api.regenerateOutputLinkKey(production.id, second.id)).status).toBe(200);
      await secondHub.waitClosed(5000);
      expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: keyOf(second.url) })).status).toBe(403);
      expect(proxyHub.closedAt, 'the proxy stays connected').toBeUndefined();
      expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: production.outputKey })).status).toBe(200);
    },
  );

  test(
    'E2E-LINK-03 [regie, download] “Use as camera …” downloads a valid OBS scene collection whose browser source is the chosen link at 1920 × 1080, 30 fps; that link works as an output page',
    t.p0,
    async ({ regie, browser, api, production, onCleanup }) => {
      test.setTimeout(120_000);
      const page = regie.page;
      const pop = await openPopover(page);
      await addLink(pop, 'Teams camera');
      await pop.getByRole('button', { name: 'Use as camera …' }).click();
      const steps = pop.locator('.c-output-camera__steps li');
      await expect(steps).toHaveCount(5);
      await expect(steps.nth(2)).toContainText('1920 × 1080');
      await expect(pop).toContainText('separate computer, not on the Regie laptop');

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        pop.getByRole('button', { name: 'Download OBS scene collection' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('StudioFlow-Teams-camera.json');
      const text = await readFile(await download.path(), 'utf8');
      const collection = JSON.parse(text) as {
        name: string;
        current_scene: string;
        sources: Array<{ id: string; name: string; mixers: number; settings: Record<string, unknown> }>;
      };
      expect(collection.name).toBe('StudioFlow – Teams camera');
      const browserSource = collection.sources.find((source) => source.id === 'browser_source')!;
      const settings = browserSource.settings;
      expect(settings['width']).toBe(1920);
      expect(settings['height']).toBe(1080);
      expect(settings['fps']).toBe(30);
      expect(settings['reroute_audio'], 'Control audio via OBS').toBe(true);
      expect(settings['shutdown'], 'keep running when hidden').toBe(false);
      expect(settings['restart_when_active'], 'no refresh when the scene becomes active').toBe(false);

      // The link in the file is the one of "Teams camera", not the Proxy link; the key appears once.
      const links = (await api.getOutputSettings(production.id)).body.links;
      const teams = links.find((link) => link.name === 'Teams camera')!;
      expect(settings['url']).toBe(teams.url);
      expect(text).not.toContain(production.outputKey);
      expect(collection.sources.find((source) => source.id === 'scene')?.name).toBe(collection.current_scene);

      // The URL of the file is a working output page: the link turns "connected" in the popover.
      const context = await newUiContext(browser, ENGLISH_UI);
      onCleanup(() => context.close());
      const output = await OutputPage.open(context, {
        slug: production.slug,
        outputKey: parseOutputUrl(settings['url'] as string).key,
      });
      await output.stage();
      await expect(linkRow(pop, 'Teams camera')).toHaveText(/^Teams camera · connected$/, {
        timeout: 15_000,
      });
      await expect(linkRow(pop, 'Proxy')).toContainText('not connected');

      // `bg=transparent` on the same link: the page, the stage and the letterbox see through (OBS overlays).
      const transparent = await OutputPage.open(
        context,
        { slug: production.slug, outputKey: parseOutputUrl(settings['url'] as string).key },
        { transparent: true },
      );
      await transparent.stage();
      expect(
        await transparent.page.evaluate(() => document.documentElement.classList.contains('is-transparent')),
      ).toBe(true);
      expect(
        await transparent.page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      ).toBe('rgba(0, 0, 0, 0)');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
