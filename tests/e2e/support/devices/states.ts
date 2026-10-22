import { expect, type Page } from '@playwright/test';
import type { AdminApi } from '../api';
import { pairLaptopByLink, pairPhone, type PairContext } from '../production';
import type { NewUiContextOptions } from '../ui/init';
import { PhoneSender, type LaptopSender } from '../ui/sender';
import { sleep } from '../shell';

/**
 * Every screen of the sender, reached one after the other in one browser context, so the layout specs (DEV-07 ... DEV-22)
 * can look at the same states at different viewports and in different modes. `visit` is called with the label of the
 * state once it is rendered and settled.
 */

export interface SenderStateEnv {
  api: AdminApi;
  production: { id: string; name: string };
  pairContext: PairContext;
  openPhone: (options?: NewUiContextOptions) => Promise<PhoneSender>;
  openLaptop: (options?: NewUiContextOptions) => Promise<LaptopSender>;
}

export type Visit = (label: string, page: Page) => Promise<void>;

/** A 60-character device name (the maximum): long names must wrap or ellipsize. */
export const LONG_NAME = 'Handy Buehne links neben dem Mischpult im zweiten Stock 4711'.slice(0, 60);
/** A 140-character Regie message (the maximum). */
export const LONG_MESSAGE = 'In 10 Sekunden gehen wir live: bitte die Kamera ruhig halten, nach links schauen, kurz lächeln und auf das Zeichen der Regie warten, danke!'.slice(0, 140);

/** Waits until the page shows something other than the empty shell (Angular has rendered a heading or the station). */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('h1, main').first()).toBeVisible({ timeout: 20_000 });
  await sleep(350); // route transition and focus move
}

/**
 * The phone: pairing form, expired invite, waiting screen with the check code, the live station (camera), a Regie message,
 * the technical check, dark mode, replaced by a second tab, blocked.
 */
export async function visitPhoneStates(env: SenderStateEnv, visit: Visit, options: NewUiContextOptions = {}): Promise<PhoneSender> {
  const phone = await env.openPhone({ profile: 'pixel7', ...options });
  const page = phone.page;
  await phone.gotoStart();
  await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible();
  await settled(page);
  await visit('form', page);

  await page.goto('/join/i/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
  await expect(page.getByTestId('pairing-expired')).toBeVisible({ timeout: 20_000 });
  await settled(page);
  await visit('redeem-expired', page);

  await phone.gotoStart();
  await expect(page.getByLabel('Name des Geräts')).toBeVisible();
  await phone.submitPairingForm(LONG_NAME, 'phone');
  await phone.checkCode();
  await settled(page);
  try {
    await visit('waiting', page);
  } finally {
    // The request is cancelled even when a check failed: pending requests count towards the cap of 20 for ten minutes.
    await page.getByRole('button', { name: 'Abbrechen' }).click().catch(() => undefined);
  }
  await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible();

  // Paired through the API: the station with a live camera.
  const device = await pairPhone(env.pairContext, { name: LONG_NAME });
  await phone.seedCredentials(device.credentials);
  await phone.gotoStart();
  await phone.waitConnected();
  await phone.waitForCamera('live', 45_000);
  await settled(page);
  await visit('station', page);

  await env.api.sendDeviceCommand(env.production.id, device.id, { kind: 'message', slot: null, text: LONG_MESSAGE });
  await expect(phone.messageBanner()).toBeVisible();
  await visit('banner', page);
  await phone.messageBanner().getByRole('button', { name: 'OK' }).click();

  await page.getByRole('button', { name: 'Technik-Check', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Technik-Check' })).toBeVisible();
  await settled(page);
  await visit('tech-check', page);
  await page.getByRole('button', { name: 'Technik-Check schliessen' }).click();
  await expect(page.getByRole('dialog', { name: 'Technik-Check' })).toBeHidden();

  await phone.darkToggle().click();
  await expect(page.locator('.c-phone__dark')).toBeVisible();
  await visit('dark', page);
  await page.locator('main.c-phone').click({ position: { x: 10, y: 200 } });
  await phone.darkToggle().click();
  await expect(page.locator('.c-phone__dark')).toBeHidden();

  // A second tab takes the session over: this tab is «In einem anderen Tab geöffnet».
  const second = await PhoneSender.inContext(phone.context, options.profile ?? 'pixel7');
  await second.gotoStart();
  await second.waitConnected();
  await phone.waitForConnection('replaced', 20_000);
  await settled(page);
  await visit('replaced', page);
  await second.page.close();

  await env.api.blockDevice(env.production.id, device.id);
  await page.getByRole('button', { name: 'Hier weitermachen' }).click();
  await expect(page.getByRole('heading', { name: 'Dieses Gerät ist gesperrt' })).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await visit('blocked', page);
  return phone;
}

/**
 * The laptop: station with a screen not shared yet, a live share, an ended one, the reshare request, nine screens with a
 * 60-character name, the technical check.
 */
export async function visitLaptopStates(env: SenderStateEnv, visit: Visit, options: NewUiContextOptions = {}): Promise<LaptopSender> {
  const laptop = await env.openLaptop(options);
  const page = laptop.page;
  await laptop.gotoStart();
  await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible();
  await settled(page);
  await visit('form', page);

  const device = await pairLaptopByLink(env.pairContext, { name: LONG_NAME });
  await laptop.seedCredentials(device.credentials);
  await laptop.gotoStart();
  await laptop.waitConnected();
  await settled(page);
  await visit('station-idle', page);

  await laptop.shareScreen();
  await laptop.waitForSlot('screen-1', 'live', 30_000);
  await settled(page);
  await visit('station-live', page);

  await laptop.browserStopsSharing();
  await laptop.waitForSlot('screen-1', 'ended', 15_000);
  await env.api.sendDeviceCommand(env.production.id, device.id, { kind: 'reshare', slot: 'screen-1', text: null });
  await expect(laptop.reshareBanner()).toBeVisible();
  await settled(page);
  await visit('station-reshare', page);

  await env.api.sendDeviceCommand(env.production.id, device.id, { kind: 'message', slot: null, text: LONG_MESSAGE });
  await expect(laptop.messageBanner()).toBeVisible();
  await visit('station-banner', page);
  await laptop.messageBanner().getByRole('button', { name: 'OK' }).click();

  for (let index = 0; index < 8; index++) {
    const allocated = await device.api.allocateSlot({ kind: 'screen' });
    expect([200, 201]).toContain(allocated.status);
  }
  await page.reload();
  await laptop.waitConnected();
  await expect(page.locator('[data-testid^="slot-screen-"]')).toHaveCount(9);
  await settled(page);
  await visit('station-nine-screens', page);

  await page.getByRole('button', { name: 'Technik-Check', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Technik-Check' })).toBeVisible();
  await settled(page);
  await visit('station-tech-check', page);
  await page.getByRole('button', { name: 'Technik-Check schliessen' }).click();
  return laptop;
}
