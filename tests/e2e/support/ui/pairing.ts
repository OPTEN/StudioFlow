import { expect } from '@playwright/test';
import { LaptopSender, PhoneSender, type StoredDevice } from './sender';
import { pairLaptopByLink, pairPhone, type PairContext, type PairedDevice } from '../production';
import type { RegiePage } from './regie';

/**
 * Pairing through the user interface, the way people do it (docs/testing.md 1.2.5 `pairPhone(via:'ui')`,
 * `pairLaptop`): the phone opens the invite link the Regie shows as a QR code; the laptop opens `/join/`, enters a name
 * and waits for the operator to approve the check code on the knock card. API-level pairing for tests that are not
 * about pairing stays in `support/production.ts`.
 */

export interface UiPairedDevice<S> {
  sender: S;
  /** Credentials the sender stored after pairing. */
  stored: StoredDevice;
  /** The station row in the Regie (`.c-st[data-device]`). */
  row: ReturnType<RegiePage['station']>;
}

/**
 * QR flow: reads the code from the Regie's pairing dock with `jsqr`, opens its URL in the phone, waits for “Connected”
 * and for the station row in the Regie. Returns the invite URL that was in the QR code as well.
 */
export async function pairPhoneViaQr(
  regie: RegiePage,
  phone: PhoneSender,
): Promise<UiPairedDevice<PhoneSender> & { qrUrl: string }> {
  const qr = await regie.readPairingQr();
  await phone.gotoInvite(qr.url);
  await phone.waitConnected();
  const stored = await phone.waitForStoredDevice();
  const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
  await expect(row, 'the phone appears in the Stations dock').toBeVisible({ timeout: 15_000 });
  return { sender: phone, stored, row, qrUrl: qr.url };
}

/**
 * Knock flow: `/join/` on the laptop, name and “Continue”, the check code appears on the laptop and on the Regie's knock
 * card (the same digits), “Allow”, then the laptop station and the station row in the Regie. Returns the code.
 */
export async function pairLaptopViaKnock(
  regie: RegiePage,
  laptop: LaptopSender,
  name: string,
): Promise<UiPairedDevice<LaptopSender> & { checkCode: string }> {
  await laptop.gotoStart();
  await laptop.submitPairingForm(name, 'laptop');
  const checkCode = await laptop.checkCode();
  await regie.openPairing('laptop');
  expect(
    await regie.knockCheckCode(name),
    'the knock card shows the check code of the laptop',
  ).toBe(checkCode);
  await regie.approveKnock(name);
  await laptop.waitConnected();
  const stored = await laptop.waitForStoredDevice();
  const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
  await expect(row, 'the laptop appears in the Stations dock').toBeVisible({ timeout: 15_000 });
  return { sender: laptop, stored, row, checkCode };
}

/**
 * API fast path for tests that are not about pairing: pairs a device through the REST API (a phone by invite, a laptop
 * by link; both use the direct API port with a made-up client address, so no rate limit is touched), hands the
 * credentials to the sender and lets it resume into its station. Returns the API view of the device.
 */
export async function pairViaApi(
  context: PairContext,
  sender: PhoneSender | LaptopSender,
  options: { name?: string } = {},
): Promise<PairedDevice> {
  const device =
    sender.kind === 'phone'
      ? await pairPhone(context, options)
      : await pairLaptopByLink(context, options);
  await sender.seedCredentials(device.credentials);
  await sender.gotoStart();
  await sender.waitConnected();
  return device;
}
