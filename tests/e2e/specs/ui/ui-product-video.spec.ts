import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { goLive, placeItem, switchProgram } from '../../support/output/world';
import { waitForSource } from '../../support/production';
import { pairPhoneViaQr, pairViaApi } from '../../support/ui/pairing';
import { openProbedOutput } from '../../support/output/open';
import { settle } from '../../support/a11y/regie-setup';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { newUiContext } from '../../support/ui/init';
import { demoSources } from '../../support/ui/demo-sources';
import { Screencast } from '../../support/ui/screencast';
import { inspector } from '../../support/regie/kit';

/**
 * Screen recordings of the real UI for the product video (issue 69, video/) and the landing page (issue 67, site/). Not a
 * test of behaviour: it only runs with `E2E_PRODUCT_VIDEO=1` and writes MP4 clips, cursor logs and PNG stills to
 * video/captures/ (git-ignored). The content is synthetic like the README screenshots (made-up people Lea, Jonas and
 * Mia and a made-up slide drawn on canvases, the production "Demo webinar"); the senders are the real sender app
 * publishing to the real SFU, the Regie and the output page are the real frontends.
 *
 *   tests/e2e/stack.sh up 5
 *   E2E_PRODUCT_VIDEO=1 E2E_REUSE_STACK=1 tests/e2e/stack.sh test 5 --project=desktop-chromium specs/ui/ui-product-video.spec.ts
 *   tests/e2e/stack.sh down 5
 *
 * Needs ffmpeg on the PATH (support/ui/screencast.ts encodes the clips).
 */

const OUTPUT = path.resolve(__dirname, '../../../../video/captures');
const FULL_HD = { width: 1920, height: 1080 };

test.skip(!process.env['E2E_PRODUCT_VIDEO'], 'set E2E_PRODUCT_VIDEO=1 to record the product video clips');

async function theme(page: Page, appearance: 'dark' | 'light'): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('studioflow.theme', value), appearance);
  await page.reload();
  await settle(page);
}

async function still(target: Page | Locator, file: string): Promise<void> {
  const page = 'page' in target && typeof target.page === 'function' ? (target as Locator).page() : (target as Page);
  await settle(page);
  await target.screenshot({ path: path.join(OUTPUT, file) });
}

test('product video: pairing, sender tally, take, layout, output and OBS', async ({
  api,
  production,
  pairContext,
  openPhone,
  openLaptop,
  browser,
  onCleanup,
}) => {
  test.setTimeout(600_000);
  mkdirSync(OUTPUT, { recursive: true });
  const clips: string[] = [];
  const done = async (cast: Screencast): Promise<void> => {
    await cast.stop();
    clips.push(`${cast.name}: ${cast.encode().toFixed(1)} s`);
  };

  expect((await api.updateProduction(production.id, { name: 'Demo webinar' })).status).toBe(200);
  await production.seed(['Welcome', 'Presentation', 'Interview', 'Panel', 'Q&A', 'Break', 'Goodbye']);
  const [welcome, presentation, interview, panel] = production.sceneIds as [string, string, string, string];

  const withDemo = async (hue: number, name: string, context: BrowserContext) => context.addInitScript(demoSources(hue, name));
  // Lea's phone is the one the video follows: a phone-sized page at 3x, paired through the real QR code.
  const phoneA = await openPhone({ camera: 'stamp', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } });
  await withDemo(205, 'Lea', phoneA.context);
  const phoneB = await openPhone({ camera: 'stamp' });
  await withDemo(20, 'Jonas', phoneB.context);
  const laptop = await openLaptop({ screen: 'canvas' });
  await withDemo(220, 'screen', laptop.context);

  // Jonas and Mia are paired beforehand, so the Stations dock is not empty when Lea joins.
  const deviceB = await pairViaApi(pairContext, phoneB, { name: 'Phone Jonas' });
  await phoneB.waitForCamera('live', 45_000);
  const cameraB = deviceB.sourceId('camera');
  const deviceLaptop = await pairViaApi(pairContext, laptop, { name: 'Laptop Mia' });
  await laptop.shareScreen();
  await laptop.waitForSlot('screen-1', 'live', 45_000);
  const screen = deviceLaptop.sourceId('screen-1');
  await waitForSource(api, production.id, cameraB, (candidate) => candidate.status === 'ok', 30_000);
  await waitForSource(api, production.id, screen, (candidate) => candidate.status === 'ok', 30_000);
  await placeItem(api, production, welcome, cameraB, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover' });
  await placeItem(api, production, panel, cameraB, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover' });
  await placeItem(api, production, panel, screen, { x: 560, y: 315, w: 800, h: 450, fit: 'contain' });

  // The Regie at full HD, dark.
  const context = await newUiContext(browser, { context: { viewport: FULL_HD, colorScheme: 'dark' } });
  onCleanup(() => context.close());
  const regie = await RegiePage.open(context, { login: 'api', cookie: api.cookie });
  const page = regie.page;
  await theme(page, 'dark');
  await page.waitForTimeout(1500);

  // 1 + 2. Pairing: the QR code in the Regie, Lea's phone opens it, goes live, the station appears; the phone ends red.
  const pairing = await Screencast.start(page, OUTPUT, 'regie-pairing');
  await page.mouse.move(1500, 700);
  pairing.markStart();
  await page.waitForTimeout(800);
  await pairing.click(regie.pairButton());
  // A desktop browser opens on the Laptop tab; the video shows the phone's QR code.
  await page.waitForTimeout(700);
  if ((await regie.pairingTab('phone').getAttribute('aria-selected')) !== 'true') await pairing.click(regie.pairingTab('phone'));
  await expect(regie.pairingQr()).toBeVisible();
  await page.waitForTimeout(2500);
  await still(page, 'still-regie-pairing-qr.png');
  const sender = await Screencast.start(phoneA.page, OUTPUT, 'sender-phone', { screenshots: true });
  sender.markStart();
  const paired = await pairPhoneViaQr(regie, phoneA);
  await phoneA.waitForCamera('live', 45_000);
  await page.waitForTimeout(3000);
  await done(pairing);
  const cameraA = `${paired.stored.deviceId}/camera`;
  await waitForSource(api, production.id, cameraA, (candidate) => candidate.status === 'ok', 30_000).catch(async () => {
    throw new Error(`camera source of Lea not ok: ${cameraA}`);
  });
  await regie.closePairing();
  // A phone paired by QR code is called "Phone 1"; the operator names it.
  expect((await api.renameDevice(production.id, paired.stored.deviceId, 'Phone Lea')).status).toBe(200);

  await placeItem(api, production, presentation, screen, { x: 0, y: 0, w: 1920, h: 1080, fit: 'contain' });
  await placeItem(api, production, presentation, cameraA, { x: 1400, y: 760, w: 480, h: 270, fit: 'cover', radius: 24 });
  await placeItem(api, production, interview, cameraA, { x: 0, y: 0, w: 960, h: 1080, fit: 'cover' });
  await placeItem(api, production, interview, cameraB, { x: 960, y: 0, w: 960, h: 1080, fit: 'cover' });
  await phoneA.page.waitForTimeout(1500);
  expect((await switchProgram(api, production, presentation)).status).toBe(200);
  await goLive(api, production);
  await phoneA.waitForTally('program', 20_000);
  await phoneA.page.waitForTimeout(3000);
  await done(sender);

  // 3 + 6. Studio Mode: a scene into Preview, Take with Fade, twice; the output page records the program at the same time.
  await regie.setStudioMode(true);
  await regie.transitionOption('Fade').click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await still(page, 'still-regie-studio-dark.png');
  const audio = page.getByRole('region', { name: 'Audio' }).first();
  if (await audio.isVisible().catch(() => false)) await still(audio, 'still-regie-audio-dock.png');
  const output = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: FULL_HD });
  await output.output.waitForPlayingVideos(2, { minFps: 10, timeout: 30_000 });
  await output.output.page.waitForTimeout(1500);
  const outputCast = await Screencast.start(output.output.page, OUTPUT, 'output');
  const take = await Screencast.start(page, OUTPUT, 'regie-take');
  outputCast.markStart();
  take.markStart();
  await page.waitForTimeout(1200);
  for (const name of ['Interview', 'Welcome']) {
    await take.click(regie.scene(name));
    await page.waitForTimeout(1600);
    await take.click(regie.take());
    await page.waitForTimeout(2600);
  }
  await done(take);
  await done(outputCast);
  await still(output.output.page, 'still-output.png');

  // 5. Layout: Panel into Preview, then two templates from the Properties dock.
  const layout = await Screencast.start(page, OUTPUT, 'regie-layout');
  layout.markStart();
  await page.waitForTimeout(800);
  await layout.click(regie.scene('Panel'));
  await page.waitForTimeout(1500);
  for (const template of ['Side by side', 'Picture in picture']) {
    const button = inspector(page).getByRole('button', { name: template, exact: true });
    await expect(button).toBeEnabled({ timeout: 10_000 });
    await layout.click(button);
    await page.waitForTimeout(2200);
  }
  await done(layout);

  // 7. The output as a camera: the output popover, a link "OBS" and the steps with the scene collection download.
  const obs = await Screencast.start(page, OUTPUT, 'output-obs');
  obs.markStart();
  await page.waitForTimeout(600);
  await obs.click(page.getByRole('button', { name: /^Output/ }));
  const pop = page.getByRole('dialog', { name: 'Output' });
  await expect(pop).toBeVisible();
  await page.waitForTimeout(1000);
  const name = pop.getByLabel('Name of the new link');
  await obs.click(name);
  await name.pressSequentially('OBS', { delay: 140 });
  await page.waitForTimeout(400);
  await obs.click(pop.getByRole('button', { name: 'Create link' }));
  await expect(pop.locator('.c-output-pop__link').filter({ hasText: 'OBS' })).toBeVisible();
  await page.waitForTimeout(1000);
  await obs.click(pop.getByRole('button', { name: 'Use as camera …' }));
  await expect(pop.getByRole('button', { name: 'Download OBS scene collection' })).toBeVisible();
  await page.waitForTimeout(3500);
  await done(obs);
  await still(page, 'still-regie-output-obs.png');
  await page.keyboard.press('Escape');
  await page.mouse.move(1500, 700);

  // 4. The same switching in the light theme.
  await theme(page, 'light');
  await regie.setStudioMode(true);
  await page.waitForTimeout(3000);
  await still(page, 'still-regie-studio-light.png');
  const light = await Screencast.start(page, OUTPUT, 'regie-take-light');
  light.markStart();
  await page.waitForTimeout(1000);
  for (const name of ['Presentation', 'Interview']) {
    await light.click(regie.scene(name));
    await page.waitForTimeout(1400);
    await light.click(regie.take());
    await page.waitForTimeout(2400);
  }
  await done(light);

  console.log(`product video clips in ${OUTPUT}:\n  ${clips.join('\n  ')}`);
});
