import { expect } from '@playwright/test';
import { CUT, type AdminApi, type SceneDto, type SceneItemDto } from '../api';
import { waitForSource, type PairContext, type PairedDevice, type Production } from '../production';
import { pairViaApi } from '../ui/pairing';
import type { FakeScreenOptions, FakeSourceOptions, NewUiContextOptions } from '../ui/init';
import type { LaptopSender, PhoneSender } from '../ui/sender';

/**
 * Building blocks of the OUT specs: cameras (real phone senders in their own contexts publishing the latency stamp
 * camera), laptops with fake screens, and items placed in the scenes of the production fixture. Everything goes through
 * the product: the real sender publishes to the real LiveKit, the scene items are created with the REST API.
 */

export interface WorldDeps {
  api: AdminApi;
  production: Production;
  pairContext: PairContext;
  openPhone: (options?: NewUiContextOptions) => Promise<PhoneSender>;
  openLaptop: (options?: NewUiContextOptions) => Promise<LaptopSender>;
}

export interface Camera {
  phone: PhoneSender;
  device: PairedDevice;
  /** Source reference `{deviceId}/camera`. */
  source: string;
  /** Slot code, e.g. K1. */
  code: string;
  name: string;
}

export interface Screens {
  laptop: LaptopSender;
  device: PairedDevice;
  sources: string[];
  codes: string[];
  name: string;
}

/** A phone that publishes a stamp camera (default 1280 x 720, 30 fps) and is live in the production. */
export async function addCamera(
  deps: WorldDeps,
  name: string,
  options: { camera?: 'stamp' | FakeSourceOptions; context?: NewUiContextOptions } = {},
): Promise<Camera> {
  const phone = await deps.openPhone({ camera: options.camera ?? 'stamp', ...options.context });
  const device = await pairViaApi(deps.pairContext, phone, { name });
  await phone.waitForCamera('live', 45_000);
  const source = device.sourceId('camera');
  await waitForSource(deps.api, deps.production.id, source, (candidate) => candidate.status === 'ok', 30_000);
  const code = (await deps.api.getSnapshot(deps.production.id)).body.sources.find((candidate) => candidate.id === source)?.code ?? '';
  return { phone, device, source, code, name };
}

/** A laptop that shares `count` fake screens (flat colours S1 red, S2 green, S3 blue, ...). */
export async function addScreens(
  deps: WorldDeps,
  name: string,
  count = 1,
  options: { screen?: FakeScreenOptions; context?: NewUiContextOptions } = {},
): Promise<Screens> {
  const laptop = await deps.openLaptop({ screen: options.screen ?? 'canvas', ...options.context });
  const device = await pairViaApi(deps.pairContext, laptop, { name });
  const sources: string[] = [];
  for (let index = 1; index <= count; index++) {
    if (index === 1) await laptop.shareScreen();
    else await laptop.addScreen();
    await laptop.waitForSlot(`screen-${index}`, 'live', 45_000);
    sources.push(device.sourceId(`screen-${index}`));
  }
  const snapshot = (await deps.api.getSnapshot(deps.production.id)).body;
  const codes = sources.map((source) => snapshot.sources.find((candidate) => candidate.id === source)?.code ?? '');
  return { laptop, device, sources, codes, name };
}

export interface PlaceOptions {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fit?: 'cover' | 'contain';
  radius?: number;
  /** `null` keeps the last frame for ever; undefined keeps the default (3000). */
  holdMs?: number | null;
  /** Fallback source reference (an image asset or another camera). */
  fallback?: string | null;
}

export const FULL: Required<Pick<PlaceOptions, 'x' | 'y' | 'w' | 'h' | 'fit' | 'radius'>> = {
  x: 0,
  y: 0,
  w: 1920,
  h: 1080,
  fit: 'cover',
  radius: 0,
};

/** Adds an item with a source to a scene (full canvas by default); applies hold time and fallback when given. */
export async function placeItem(
  api: AdminApi,
  production: Production,
  sceneId: string,
  source: string,
  options: PlaceOptions = {},
): Promise<SceneItemDto> {
  const geometry = { ...FULL, ...options };
  const added = await api.addSceneItem(production.id, sceneId, {
    source,
    x: geometry.x,
    y: geometry.y,
    w: geometry.w,
    h: geometry.h,
    fit: geometry.fit,
    radius: geometry.radius,
  });
  expect(added.status, `addSceneItem ${source}: ${added.raw.text().slice(0, 300)}`).toBe(200);
  let item = added.body.items.at(-1)!;
  if (options.holdMs !== undefined || options.fallback !== undefined) {
    const updated = await api.updateSceneItem(production.id, sceneId, item.id, {
      ...item,
      onLost: {
        holdMs: options.holdMs !== undefined ? options.holdMs : item.onLost.holdMs,
        fallbackSource: options.fallback !== undefined ? options.fallback : item.onLost.fallbackSource,
      },
    });
    expect(updated.status, `updateSceneItem: ${updated.raw.text().slice(0, 300)}`).toBe(200);
    item = updated.body.items.find((candidate) => candidate.id === item.id)!;
  }
  return item;
}

/** Replaces the whole item list of a scene (back to front), keeping the item ids of the DTOs. */
export async function replaceItems(api: AdminApi, production: Production, sceneId: string, items: SceneItemDto[], layoutMode: 'free' | 'autoGrid' = 'free'): Promise<SceneDto> {
  const result = await api.replaceSceneItems(production.id, sceneId, { items, layoutMode });
  expect(result.status, `replaceSceneItems: ${result.raw.text().slice(0, 300)}`).toBe(200);
  return result.body;
}

export interface Switch {
  status: number;
  /** `Date.now()` before the request was sent. */
  sentAt: number;
  /** `Date.now()` when the answer arrived. */
  answeredAt: number;
}

/** Program switch through the API (what the Regie does on a click), timed. */
export async function switchProgram(
  api: AdminApi,
  production: Production,
  sceneId: string,
  transition: { kind: 'cut' | 'fade'; durationMs: number } = CUT,
): Promise<Switch> {
  const sentAt = Date.now();
  const result = await api.switchProgram(production.id, { sceneId, transition });
  return { status: result.status, sentAt, answeredAt: Date.now() };
}

/** Starts the broadcast and checks the answer. */
export async function goLive(api: AdminApi, production: Production): Promise<void> {
  const started = await api.startBroadcast(production.id);
  expect(started.status, `startBroadcast: ${started.raw.text().slice(0, 200)}`).toBe(200);
}
