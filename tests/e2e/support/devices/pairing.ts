import { expect } from '@playwright/test';
import type { RegiePage, PairingTab } from '../ui/regie';
import type { LaptopSender } from '../ui/sender';
import type { UiPairedDevice } from '../ui/pairing';

/**
 * Pairing helpers with a workaround for DEV-04: at 1280 x 720 the tab row of the pairing dock collapses to 2 px while the
 * «Handy» tab shows its QR code, and the tab buttons are covered by the panel, so a pointer click on «Laptop» / «Link» is
 * intercepted. The tab is switched with a DOM click (what a keyboard user gets with Enter) instead.
 */

/** Opens the pairing dock on a tab (the dock stays open between calls). */
export async function openPairingTab(regie: RegiePage, tab: PairingTab = 'phone'): Promise<void> {
  const button = regie.pairButton();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const selected = regie.pairingTab(tab);
  await expect(selected).toBeVisible();
  if ((await selected.getAttribute('aria-selected')) !== 'true') await selected.evaluate((element) => (element as HTMLElement).click());
  await expect(selected).toHaveAttribute('aria-selected', 'true');
}

/** Like `pairLaptopViaKnock` of support/ui/pairing.ts, with {@link openPairingTab}. */
export async function pairLaptopViaKnock(regie: RegiePage, laptop: LaptopSender, name: string): Promise<UiPairedDevice<LaptopSender> & { checkCode: string }> {
  await laptop.gotoStart();
  await laptop.submitPairingForm(name, 'laptop');
  const checkCode = await laptop.checkCode();
  await openPairingTab(regie, 'laptop');
  expect(await regie.knockCheckCode(name), 'the knock card shows the check code of the laptop').toBe(checkCode);
  await regie.approveKnock(name);
  await laptop.waitConnected();
  const stored = await laptop.waitForStoredDevice();
  const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
  await expect(row, 'the laptop appears in the Stationen dock').toBeVisible({ timeout: 15_000 });
  return { sender: laptop, stored, row, checkCode };
}
