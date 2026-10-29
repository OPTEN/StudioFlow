import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { goLive, placeItem, switchProgram } from '../../support/output/world';
import { pairPhone, waitForSource } from '../../support/production';
import { pairViaApi } from '../../support/ui/pairing';
import { openProbedOutput } from '../../support/output/open';
import { settle } from '../../support/a11y/regie-setup';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { newUiContext } from '../../support/ui/init';
import { demoSources } from '../../support/ui/demo-sources';
import { DeviceHub } from '../../support/hubs';

/**
 * Screenshots of every reachable screen of the Regie, the settings window, the sender and the output page, with the
 * relevant states (popovers, right-click menus, tabs, both themes, laptop and phone sizes), for the design review and
 * the pull request of a UI change. Not a test of behaviour: it only runs with `E2E_SCREENS=1` and writes one PNG per view
 * to `tests/e2e/.output/screens/` (or `E2E_SCREENS_DIR`) plus `index.json` and `missing.txt` (views that could not be
 * captured, with the reason). Demo content is synthetic (drawn presenters and slides, made-up names).
 *
 *   E2E_SCREENS=1 E2E_REUSE_STACK=1 tests/e2e/stack.sh test 5 --project=desktop-chromium specs/ui/ui-screens.spec.ts
 */

const OUTPUT = process.env['E2E_SCREENS_DIR'] ?? path.resolve(__dirname, '../../.output/screens');

test.skip(!process.env['E2E_SCREENS'], 'set E2E_SCREENS=1 to write the screenshots of every screen');

const shots: Array<{ file: string; title: string }> = [];
const missing: string[] = [];

/** Runs an optional action, waits for a quiet page and writes `<file>.png`; a failure is recorded, not thrown. */
async function shoot(page: Page, file: string, title: string, action?: () => Promise<unknown>, options: { fullPage?: boolean } = {}): Promise<boolean> {
  try {
    if (action) await action();
    await settle(page);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUTPUT, `${file}.png`), fullPage: options.fullPage ?? false });
    shots.push({ file: `${file}.png`, title });
    return true;
  } catch (error) {
    missing.push(`${file} (${title}): ${(error as Error).message.split('\n')[0]}`);
    return false;
  }
}

async function closeMenus(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 300);
  await page.waitForTimeout(150);
}

async function rightClick(target: Locator): Promise<void> {
  await target.first().scrollIntoViewIfNeeded();
  await target.first().click({ button: 'right' });
  await expect(target.page().locator('.c-ctx')).toBeVisible();
}

async function theme(page: Page, appearance: 'dark' | 'light'): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('studioflow.theme', value), appearance);
}

test('screenshots of every screen', async ({ api, production, pairContext, openPhone, openLaptop, browser, onCleanup }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUTPUT, { recursive: true });

  // --- a demo production: three real senders with drawn pictures, one phone that reconnects (an incident) ---
  expect((await api.updateProduction(production.id, { name: 'Demo webinar' })).status).toBe(200);
  await production.seed(['Welcome', 'Presentation', 'Interview', 'Panel', 'Q&A', 'Break', 'Goodbye']);
  const withDemo = async (hue: number, name: string, context: BrowserContext) => context.addInitScript(demoSources(hue, name));
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
  const cameraA = await addPhone(phoneA, 'Stage camera');
  const cameraB = await addPhone(phoneB, 'Guest camera');
  const deviceLaptop = await pairViaApi(pairContext, laptop, { name: 'Laptop Mia' });
  await laptop.shareScreen();
  await laptop.waitForSlot('screen-1', 'live', 45_000);
  const screen = deviceLaptop.sourceId('screen-1');
  await waitForSource(api, production.id, screen, (candidate) => candidate.status === 'ok', 30_000);
  const broken = await pairPhone(pairContext, { name: 'Hall camera', platform: 'Pixel 7 · Chrome' });
  const hub = DeviceHub.connect(pairContext.stack.anonymousBase, broken.credentials, { reconnect: true });
  onCleanup(() => hub.stop());
  await hub.open();
  await hub.reportLive(['camera']);

  const [welcome, presentation, interview] = production.sceneIds as [string, string, string];
  await placeItem(api, production, welcome, cameraA, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover' });
  await placeItem(api, production, presentation, screen, { x: 0, y: 0, w: 1920, h: 1080, fit: 'contain' });
  await placeItem(api, production, presentation, cameraA, { x: 1400, y: 760, w: 480, h: 270, fit: 'cover', radius: 24 });
  await placeItem(api, production, interview, cameraA, { x: 0, y: 0, w: 960, h: 1080, fit: 'cover' });
  await placeItem(api, production, interview, cameraB, { x: 960, y: 0, w: 960, h: 1080, fit: 'cover' });
  await placeItem(api, production, interview, broken.sourceId('camera'), { x: 1500, y: 60, w: 360, h: 203, fit: 'cover' });
  await switchProgram(api, production, presentation);
  await goLive(api, production);
  expect((await api.setPreview(production.id, { sceneId: interview })).status).toBe(200);
  const send = () =>
    hub
      .report({ rtc: 'connected', slots: [{ slot: 'camera', state: 'paused', width: 1280, height: 720, fps: 30, bitrateKbps: 2500, packetLossPct: 0, codec: 'h264' }] })
      .catch(() => undefined);
  await send();
  const timer = setInterval(() => void send(), 1000);
  onCleanup(() => clearInterval(timer));

  // --- the control room ---
  const context = await newUiContext(browser, { context: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } });
  onCleanup(() => context.close());
  const regie = await RegiePage.open(context, { login: 'api', cookie: api.cookie });
  const page = regie.page;
  await expect(regie.station('Stage camera')).toBeVisible({ timeout: 20_000 });
  await regie.setStudioMode(false);
  await page.waitForTimeout(3500);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await shoot(page, '01-regie-direct', 'Control room, Studio Mode off: Program only, the Preview area explains Studio Mode');
  await regie.setStudioMode(true);
  await page.waitForTimeout(2500);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await shoot(page, '02-regie-studio', 'Control room, Studio Mode on: Preview, Program, control column, docks, an incident in the activity bar');
  await shoot(page, '03-switcher', 'Toolbar: production switcher', () => page.getByRole('button', { name: /^Production .*, menu$/ }).click());
  await closeMenus(page);
  await shoot(page, '04-output-popover', 'Toolbar: Output status and links', () => page.getByRole('button', { name: /^Output/ }).click());
  await closeMenus(page);
  await shoot(page, '05-output-menu', 'Right-click on the Output capsule', () => rightClick(page.getByRole('button', { name: /^Output/ })));
  await closeMenus(page);
  await shoot(page, '06-layout-popover', 'Toolbar: Layout (docks, reset, shortcuts)', () => page.getByRole('button', { name: 'Layout', exact: true }).click());
  await closeMenus(page);
  await shoot(page, '07-shortcuts', 'Keyboard shortcuts sheet (?)', async () => {
    await page.locator('body').click({ position: { x: 700, y: 120 } });
    await page.keyboard.press('Shift+?');
    await expect(page.getByRole('dialog').filter({ hasText: /shortcut/i }).first()).toBeVisible();
  });
  await closeMenus(page);
  await shoot(page, '08-issues', 'Activity bar: issues popover', () => page.locator('.c-status__health').click());
  await closeMenus(page);
  await shoot(page, '09-incident-menu', 'Right-click on an incident', () => rightClick(page.locator('sf-status-line .c-status__inc')));
  await closeMenus(page);
  await shoot(page, '10-end-broadcast', 'Broadcast capsule: End broadcast asks first', () => page.getByRole('button', { name: 'End broadcast' }).first().click());
  await closeMenus(page);
  await shoot(page, '11-scene-menu', 'Right-click on a scene', () => rightClick(page.locator('button.c-scene').filter({ hasText: 'Panel' })));
  await closeMenus(page);
  await shoot(page, '12-add-source', 'Sources: Add source menu', () => page.getByRole('button', { name: 'Add source' }).click());
  await closeMenus(page);
  await shoot(page, '13-source-menu', 'Right-click on a source', () => rightClick(page.locator('sf-sources-dock .c-src')));
  await closeMenus(page);
  await shoot(page, '14-item-selected', 'An item selected: Properties with tabs, the selection on the Preview monitor', () => page.locator('sf-sources-dock .c-src').first().click());
  for (const tab of ['Style', 'When it fails']) {
    await shoot(page, `15-properties-${tab.toLowerCase().replaceAll(' ', '-')}`, `Properties: tab ${tab}`, () => page.getByRole('tab', { name: tab }).click());
  }
  await shoot(page, '16-item-menu', 'Right-click on an item on the Preview monitor', () => rightClick(page.locator('.c-edit-box').first()));
  await closeMenus(page);
  await shoot(page, '17-monitor-menu', 'Preview monitor menu', () => page.getByRole('button', { name: 'Preview options' }).click());
  await closeMenus(page);
  await shoot(page, '18-media-library', 'Media library', async () => {
    await page.getByRole('button', { name: 'Add source' }).click();
    await page.getByRole('menuitem', { name: /Media library/ }).click();
  });
  await closeMenus(page);
  await shoot(page, '19-device-open', 'Devices: an open device with its tabs', () => page.locator('.c-st__row').filter({ hasText: 'Stage camera' }).click());
  for (const tab of ['Camera', 'Message']) {
    await shoot(page, `20-device-${tab.toLowerCase()}`, `Device detail: tab ${tab}`, () => page.locator('.c-st__tabs').getByRole('tab', { name: tab }).click());
  }
  await shoot(page, '21-device-menu', 'Right-click on a device', () => rightClick(page.locator('.c-st__row').filter({ hasText: 'Guest camera' })));
  await closeMenus(page);
  await shoot(page, '22-pairing-phone', 'Add device: Phone (QR code)', () => regie.openPairing('phone'));
  await shoot(page, '23-pairing-laptop', 'Add device: Laptop (short address and code)', () => regie.openPairing('laptop'));
  await shoot(page, '24-pairing-link', 'Add device: invite link', () => regie.openPairing('link'));
  await regie.closePairing().catch(() => undefined);

  // a laptop knocks: the request in the control room and the waiting screen on the laptop
  const knocker = await openLaptop();
  await knocker.gotoStart();
  await shoot(knocker.page, '60-sender-start-laptop', 'Sender on a laptop: connect this device');
  await knocker.submitPairingForm('Laptop Ben', 'laptop').catch(() => undefined);
  await shoot(knocker.page, '61-sender-waiting', 'Sender: waiting for approval with the check code', () => knocker.page.waitForTimeout(1500));
  await shoot(page, '25-knock', 'Control room: a laptop asks to join', () => regie.knockCard('Laptop Ben').waitFor({ timeout: 10_000 }));
  await regie.closePairing().catch(() => undefined);

  await shoot(page, '26-regie-light', 'Control room, light appearance', async () => {
    await theme(page, 'light');
    await page.reload();
    await regie.waitReady();
    await page.waitForTimeout(2500);
  });
  await theme(page, 'dark');
  for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.reload();
    await regie.waitReady();
    await page.waitForTimeout(2500);
    await shoot(page, `27-regie-${size.width}x${size.height}`, `Control room at ${size.width} × ${size.height}`, undefined, { fullPage: size.width < 1100 });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- the settings window ---
  const pages: Array<[string, string, string]> = [
    ['/settings/production', '30-settings-general', 'Settings › General (name, format and resolution)'],
    ['/settings/slates', '31-settings-slates', 'Settings › Slates'],
    ['/settings/text-style', '32-settings-text-style', 'Settings › Text style'],
    ['/settings/output', '33-settings-output', 'Settings › Output links'],
    ['/settings/productions', '34-settings-productions', 'Settings › All productions'],
    ['/settings/appearance', '35-settings-appearance', 'Settings › Appearance and language'],
    ['/settings/media', '36-settings-media', 'Settings › Media server'],
    ['/settings/network', '37-settings-network', 'Settings › Address and certificate'],
    ['/settings/embedding', '38-settings-embedding', 'Settings › Embedding'],
    ['/settings/backups', '39-settings-backups', 'Settings › Backups'],
    ['/monitoring', '40-monitoring', 'Diagnostics › Monitoring'],
    ['/audit', '41-activity-log', 'Diagnostics › Activity log'],
    ['/settings/account', '42-settings-account', 'Settings › Account'],
    ['/settings/about', '43-settings-about', 'Settings › About StudioFlow'],
  ];
  for (const [url, file, title] of pages) {
    await page.goto(url);
    await shoot(page, file, title, () => page.waitForTimeout(1500), { fullPage: true });
  }
  await page.goto('/settings/slates');
  await shoot(page, '31b-settings-slates-end', 'Settings › Slates, the end slate tab', () => page.getByRole('tab', { name: /After/ }).click(), { fullPage: true });
  await page.goto('/settings/output');
  await page.waitForTimeout(1200);
  await shoot(page, '33b-output-link-open', 'Output links: a link opened (tab Link)', () => page.locator('.c-links__head').first().click(), { fullPage: true });
  for (const tab of ['Access', 'Use in OBS']) {
    await shoot(page, `33c-output-${tab.toLowerCase().replaceAll(' ', '-')}`, `Output link detail: tab ${tab}`, () => page.getByRole('tab', { name: tab }).click(), { fullPage: true });
  }
  await shoot(page, '33d-output-menu', 'Right-click on an output link', () => rightClick(page.locator('.c-links__head')));
  await closeMenus(page);
  await page.goto('/settings/productions');
  await page.waitForTimeout(1200);
  await shoot(page, '34b-productions-menu', 'Right-click on a production', () => rightClick(page.locator('.c-prods__row, .c-prods li').filter({ hasText: 'Demo webinar' })));
  await closeMenus(page);
  await page.goto('/audit');
  await page.waitForTimeout(1500);
  await shoot(page, '41b-activity-details', 'Activity log: an entry opened (details tabs)', () => page.locator('tbody tr').first().locator('button').first().click());
  await shoot(page, '41c-activity-menu', 'Right-click on an activity entry', () => rightClick(page.locator('tbody tr')));
  await closeMenus(page);
  await page.goto('/settings/network');
  await theme(page, 'light');
  await shoot(page, '44-settings-light', 'Settings window, light appearance', () => page.reload().then(() => page.waitForTimeout(1500)), { fullPage: true });
  await theme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/production');
  await shoot(page, '45-settings-phone', 'Settings window at 390 × 844', () => page.waitForTimeout(1200), { fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- sign in ---
  const visitor = await (await newUiContext(browser, { context: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } })).newPage();
  onCleanup(() => visitor.context().close());
  await visitor.goto('/login');
  await shoot(visitor, '50-login', 'Sign in');
  await visitor.evaluate(() => localStorage.setItem('studioflow.theme', 'light'));
  await visitor.reload();
  await shoot(visitor, '51-login-light', 'Sign in, light appearance');

  // --- the sender ---
  await phoneA.waitForTally('program').catch(() => undefined);
  await shoot(phoneA.page, '62-sender-phone-live', 'Sender on a phone: camera live (red frame)', () => phoneA.page.waitForTimeout(1500));
  await shoot(phoneB.page, '63-sender-phone-preview', 'Sender on a phone: camera in Preview (green frame)');
  await shoot(laptop.page, '64-sender-laptop', 'Sender on a laptop: a shared screen');
  const fresh = await openPhone();
  await fresh.gotoStart();
  await shoot(fresh.page, '65-sender-start-phone', 'Sender on a phone: connect this device', () => expect(fresh.page.getByLabel('Device name')).toBeVisible());

  // --- the output page ---
  const output = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
  await output.output.waitForPlayingVideos(1, { minFps: 5, timeout: 30_000 }).catch(() => undefined);
  await shoot(output.output.page, '70-output-live', 'Output page: the program', () => output.output.page.waitForTimeout(2000));
  const denied = await (await newUiContext(browser, { context: { viewport: { width: 1280, height: 720 } } })).newPage();
  onCleanup(() => denied.context().close());
  await denied.goto(`/o/${production.slug}?k=wrong-key`);
  await shoot(denied, '71-output-no-access', 'Output page: a wrong link (No access)', () => denied.waitForTimeout(2500));
  expect((await api.endBroadcast(production.id)).status).toBe(200);
  await shoot(output.output.page, '72-output-end', 'Output page: the end slate', () => output.output.page.waitForTimeout(2500));

  fs.writeFileSync(path.join(OUTPUT, 'index.json'), JSON.stringify(shots, null, 1));
  fs.writeFileSync(path.join(OUTPUT, 'missing.txt'), missing.join('\n'));
  console.log(`${shots.length} screenshots in ${OUTPUT}; ${missing.length} missing`);
});
