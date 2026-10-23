import { expect, type Locator } from '@playwright/test';
import type { AdminApi, SceneItemDto } from '../api';
import type { PairContext, PairedDevice, Production } from '../production';
import type { NewUiContextOptions } from '../ui/init';
import { pairViaApi } from '../ui/pairing';
import type { RegiePage } from '../ui/regie';
import type { LaptopSender, PhoneSender } from '../ui/sender';

/**
 * Building blocks of the device specs that are not about pairing: devices paired through the API (the sender resumes into
 * its station like a browser that paired earlier), put into scenes with a rectangle, and found again in the Regie.
 */

export interface PhoneFixture {
  phone: PhoneSender;
  device: PairedDevice;
  /** Slot code of the camera, e.g. K1. */
  code: string;
  sourceId: string;
  /** The station row in the Regie. */
  row: Locator;
}

export interface LaptopFixture {
  laptop: LaptopSender;
  device: PairedDevice;
  /** Code of screen-1, e.g. S1. */
  code: string;
  sourceId: string;
  row: Locator;
}

export interface PhoneOptions extends NewUiContextOptions {
  /** Runs on the new context before the sender starts (init scripts: wake lock, battery). */
  init?: (context: import('@playwright/test').BrowserContext) => Promise<void>;
  /** Wait for the camera to be live (default true). */
  waitForLiveCamera?: boolean;
}

export interface OpenFns {
  openPhone: (options?: NewUiContextOptions) => Promise<PhoneSender>;
  openLaptop: (options?: NewUiContextOptions) => Promise<LaptopSender>;
}

/** A phone paired through the API with its camera live; waits for the station row in the Regie. */
export async function livePhone(
  fns: Pick<OpenFns, 'openPhone'>,
  pairContext: PairContext,
  regie: RegiePage,
  name: string,
  options: PhoneOptions = {},
): Promise<PhoneFixture> {
  const { init, waitForLiveCamera = true, ...context } = options;
  const phone = await fns.openPhone(context);
  await init?.(phone.context);
  const device = await pairViaApi(pairContext, phone, { name });
  if (waitForLiveCamera) await phone.waitForCamera('live', 45_000);
  const row = await regie.waitForStation(name);
  return { phone, device, code: device.codes['camera']!, sourceId: device.sourceId('camera'), row };
}

/** A laptop paired through the API; `share` starts “Share screen” for screen-1 (the fake screen) and waits until it is live. */
export async function liveLaptop(
  fns: Pick<OpenFns, 'openLaptop'>,
  pairContext: PairContext,
  regie: RegiePage,
  name: string,
  options: NewUiContextOptions & { share?: boolean; init?: PhoneOptions['init'] } = {},
): Promise<LaptopFixture> {
  const { share = true, init, ...context } = options;
  const laptop = await fns.openLaptop(context);
  await init?.(laptop.context);
  const device = await pairViaApi(pairContext, laptop, { name });
  if (share) {
    await laptop.shareScreen();
    await laptop.waitForSlot('screen-1', 'live', 30_000);
  }
  const row = await regie.waitForStation(name);
  return { laptop, device, code: device.codes['screen-1']!, sourceId: device.sourceId('screen-1'), row };
}

/** Full-canvas rectangle of the 1920 x 1080 stage. */
export const FULL = { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover' } as const;
/** Half-canvas rectangles side by side. */
export const LEFT = { x: 0, y: 0, w: 960, h: 1080, fit: 'cover' } as const;
export const RIGHT = { x: 960, y: 0, w: 960, h: 1080, fit: 'cover' } as const;

export type Rect = { x: number; y: number; w: number; h: number; fit?: 'cover' | 'contain' };

/** Puts a source into the scene with the given index of the production; returns the new item. */
export async function putInScene(
  api: AdminApi,
  production: Production,
  sceneIndex: number,
  sourceId: string,
  rect: Rect = FULL,
): Promise<SceneItemDto> {
  const sceneId = production.sceneIds[sceneIndex]!;
  const before = (await api.getSnapshot(production.id)).body.scenes.find((scene) => scene.id === sceneId)!;
  const added = await api.addSceneItem(production.id, sceneId, { source: sourceId, ...rect });
  expect(added.status, `addSceneItem ${sourceId}: ${added.raw.text()}`).toBe(200);
  const known = new Set(before.items.map((item) => item.id));
  const item = added.body.items.find((candidate) => !known.has(candidate.id));
  if (!item) throw new Error(`the item for ${sourceId} was not added to scene ${sceneIndex}`);
  return item;
}

/** Studio Mode on with the given scene as preview (the Regie switch and the API preview). */
export async function studioPreview(regie: RegiePage, api: AdminApi, production: Production, sceneIndex: number): Promise<void> {
  await regie.setStudioMode(true);
  const response = await api.setPreview(production.id, { sceneId: production.sceneIds[sceneIndex]! });
  expect(response.status, response.raw.text()).toBe(200);
}

/** Opens the details of a station row (aria-expanded) and returns the row. */
export async function openStation(regie: RegiePage, deviceId: string): Promise<Locator> {
  const row = regie.page.locator(`.c-st[data-device="${deviceId}"]`);
  await expect(row).toBeVisible();
  const toggle = row.locator('.c-st__row');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return row;
}

/** Names of the log entries of the production (newest first, as the API holds them). */
export async function logTexts(api: AdminApi, production: Production): Promise<string[]> {
  return (await api.getSnapshot(production.id)).body.recentLog.map((entry) => entry.text);
}
