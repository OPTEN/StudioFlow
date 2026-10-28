import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { goLive, placeItem, switchProgram } from '../../support/output/world';
import { waitForSource } from '../../support/production';
import { pairViaApi } from '../../support/ui/pairing';
import { openProbedOutput } from '../../support/output/open';
import { settle } from '../../support/a11y/regie-setup';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { newUiContext } from '../../support/ui/init';
import { demoSources } from '../../support/ui/demo-sources';

/**
 * Screenshots of the README (docs/assets/screenshot-*.png). Not a test of behaviour: it only runs with
 * `E2E_README_SCREENSHOTS=1` and writes the PNGs with synthetic demo content (made-up people and slides, drawn on canvases that
 * stand in for the cameras and the screen), so no real person or customer appears. The senders are the real sender app
 * publishing to the real SFU, the Regie and the output page are the real frontends.
 *
 *   tests/e2e/stack.sh up 1
 *   E2E_README_SCREENSHOTS=1 E2E_REUSE_STACK=1 tests/e2e/stack.sh test 1 --project=desktop-chromium specs/ui/ui-readme-screens.spec.ts
 *   tests/e2e/stack.sh down 1
 *
 * Then optimise the PNGs (docs/assets stays small); see docs/open-source-checklist.md.
 */

const OUTPUT = path.resolve(__dirname, '../../../../docs/assets');

test.skip(!process.env['E2E_README_SCREENSHOTS'], 'set E2E_README_SCREENSHOTS=1 to write the README screenshots');

async function theme(page: Page, appearance: 'dark' | 'light'): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('studioflow.theme', value), appearance);
  await page.reload();
  await settle(page);
}

async function shoot(page: Page, file: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(OUTPUT, file) });
}

test('README screenshots: Regie in studio mode, sender with tally, output', async ({
  api,
  production,
  pairContext,
  openPhone,
  openLaptop,
  browser,
  onCleanup,
}) => {
  test.setTimeout(300_000);
  expect((await api.updateProduction(production.id, { name: 'Demo webinar' })).status).toBe(200);
  const scenes = await production.seed(['Welcome', 'Presentation', 'Interview', 'Panel', 'Q&A', 'Break', 'Goodbye']);

  const withDemo = async (hue: number, name: string, context: BrowserContext) => context.addInitScript(demoSources(hue, name));
  // Cameras and the screen publish through the real sender; the demo sources replace the fake devices of the harness.
  const makePhone = async (name: string, hue: number) => {
    const phone = await openPhone({ camera: 'stamp' });
    await withDemo(hue, name, phone.context);
    return phone;
  };
  const phoneA = await makePhone('Lea', 205);
  const phoneB = await makePhone('Jonas', 20);
  const laptop = await openLaptop({ screen: 'canvas' });
  await withDemo(220, 'screen', laptop.context);

  const addPhone = async (phone: typeof phoneA, name: string) => {
    const device = await pairViaApi(pairContext, phone, { name });
    await phone.waitForCamera('live', 45_000);
    const source = device.sourceId('camera');
    await waitForSource(api, production.id, source, (candidate) => candidate.status === 'ok', 30_000);
    return source;
  };
  const cameraA = await addPhone(phoneA, 'Phone Lea');
  const cameraB = await addPhone(phoneB, 'Phone Jonas');
  const deviceLaptop = await pairViaApi(pairContext, laptop, { name: 'Laptop Mia' });
  await laptop.shareScreen();
  await laptop.waitForSlot('screen-1', 'live', 45_000);
  const screen = deviceLaptop.sourceId('screen-1');
  await waitForSource(api, production.id, screen, (candidate) => candidate.status === 'ok', 30_000);

  const [welcome, presentation, interview] = production.sceneIds as [string, string, string];
  await placeItem(api, production, welcome, cameraA, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover' });
  await placeItem(api, production, presentation, screen, { x: 0, y: 0, w: 1920, h: 1080, fit: 'contain' });
  await placeItem(api, production, presentation, cameraA, { x: 1400, y: 760, w: 480, h: 270, fit: 'cover', radius: 24 });
  await placeItem(api, production, interview, cameraA, { x: 0, y: 0, w: 960, h: 1080, fit: 'cover' });
  await placeItem(api, production, interview, cameraB, { x: 960, y: 0, w: 960, h: 1080, fit: 'cover' });
  expect(scenes.length).toBe(7);

  await switchProgram(api, production, presentation);
  await goLive(api, production);
  expect((await api.setPreview(production.id, { sceneId: interview })).status).toBe(200);

  // The Regie: studio mode, preview and program, docks, stations (a desktop-size window).
  const context = await newUiContext(browser, { context: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } });
  onCleanup(() => context.close());
  const regie = await RegiePage.open(context, { login: 'api', cookie: api.cookie });
  await regie.setStudioMode(true);
  await expect(regie.station('Phone Lea')).toBeVisible({ timeout: 20_000 });
  await regie.page.waitForTimeout(4000);
  await theme(regie.page, 'dark');
  await regie.setStudioMode(true);
  await regie.page.waitForTimeout(4000);
  await regie.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await shoot(regie.page, 'screenshot-regie.png');
  await theme(regie.page, 'light');
  await regie.setStudioMode(true);
  await regie.page.waitForTimeout(4000);
  await shoot(regie.page, 'screenshot-regie-light.png');

  // The sender of the camera that is in the program: tally "program".
  await phoneA.waitForTally('program');
  await phoneA.page.waitForTimeout(1500);
  await shoot(phoneA.page, 'screenshot-sender.png');

  // The output page, 16:9, as the proxy shows it.
  const output = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
  await output.output.waitForPlayingVideos(2, { minFps: 10, timeout: 30_000 });
  await output.output.page.waitForTimeout(2500);
  await shoot(output.output.page, 'screenshot-output.png');
});
