import { expect, type Locator, type Page } from '@playwright/test';
import type { AdminApi, AssetDto, SceneDto, SceneItemDto } from '../api';
import { makePng } from '../media-samples';
import type { Production } from '../production';
import { PixelImage, type Rect } from '../ui/pixels';

/**
 * Local helpers of the Regie specs (specs/regie): seeding scenes and sources through the API, reading the monitor DOM
 * (the scene renderer's `.sf-r-item` elements) and the edit overlay (`.c-edit-box`), a canvas-to-screen mapping for
 * pointer gestures, pixel sampling of a monitor, request recording and toasts. Nothing here changes a shared support
 * file; the specs of this folder are the only users.
 */

export const CANVAS = { w: 1920, h: 1080 } as const;
export type Rgb = readonly [number, number, number];

/** Flat colours of the image sources (distinct hues, well away from each other, so pixels tell them apart). */
export const COLOR = {
  red: [210, 50, 50],
  green: [40, 170, 90],
  blue: [50, 100, 230],
  yellow: [235, 200, 40],
  violet: [150, 80, 200],
  white: [245, 245, 245],
} as const satisfies Record<string, Rgb>;

/**
 * A client address from the benchmarking range 198.18.0.0/15 that no other test uses. The harness `uniqueIp()` counts up in
 * steps that can repeat an address within one worker (the last octet is `% 254`), and a failed login of an earlier test
 * would then count towards the lock of this one; lockout tests therefore take a random address.
 */
export function randomClientIp(): string {
  return `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
}

export const hex = (rgb: Rgb): string =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

export const SCENES = ['Szene A', 'Szene B', 'Szene C'] as const;

// --- seeding --------------------------------------------------------------------------------------------------------

/** Uploads a flat-colour PNG (640 x 360) as a media source and returns the asset (code M1, M2, ...). */
export async function uploadSolid(
  api: AdminApi,
  production: Production,
  name: string,
  rgb: Rgb,
): Promise<AssetDto> {
  const result = await api.uploadAsset(production.id, {
    fileName: `${name}.png`,
    contentType: 'image/png',
    data: makePng(640, 360, [...rgb] as [number, number, number]),
  });
  if (result.status !== 201)
    throw new Error(`upload of ${name} failed: ${result.status} ${result.raw.text()}`);
  return result.body;
}

/** The scene with this id from the snapshot. */
export async function getScene(
  api: AdminApi,
  production: Production,
  sceneId: string,
): Promise<SceneDto> {
  const scene = (await api.getSnapshot(production.id)).body.scenes.find(
    (entry) => entry.id === sceneId,
  );
  if (!scene) throw new Error(`scene ${sceneId} is not in the snapshot`);
  return scene;
}

/** Adds the sources to a scene one by one (server defaults, or `rect`) and returns the scene. */
export async function addItems(
  api: AdminApi,
  production: Production,
  sceneId: string,
  sources: readonly string[],
  rect?: { x: number; y: number; w: number; h: number; fit?: 'cover' | 'contain'; radius?: number },
): Promise<SceneDto> {
  let scene: SceneDto | undefined;
  for (const source of sources) {
    const result = await api.addSceneItem(production.id, sceneId, { source, ...rect });
    if (result.status !== 200)
      throw new Error(`addSceneItem ${source} failed: ${result.status} ${result.raw.text()}`);
    scene = result.body;
  }
  return scene ?? (await getScene(api, production, sceneId));
}

/** Replaces the items of a scene (exact geometry); every item gets the defaults of `newItem`. */
export function item(
  id: string,
  source: string,
  rect: { x: number; y: number; w: number; h: number },
  extra: Partial<SceneItemDto> = {},
): SceneItemDto {
  return {
    id,
    source,
    ...rect,
    fit: 'cover',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 0,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: 3000, fallbackSource: null },
    ...extra,
  };
}

export async function replaceItems(
  api: AdminApi,
  production: Production,
  sceneId: string,
  items: SceneItemDto[],
): Promise<SceneDto> {
  const result = await api.replaceSceneItems(production.id, sceneId, { items });
  if (result.status !== 200)
    throw new Error(`replaceSceneItems failed: ${result.status} ${result.raw.text()}`);
  return result.body;
}

/** Waits until the scene in the API satisfies `predicate` and returns it. */
export async function expectScene(
  api: AdminApi,
  production: Production,
  sceneId: string,
  predicate: (scene: SceneDto) => boolean,
  message: string,
  timeout = 10_000,
): Promise<SceneDto> {
  let last: SceneDto | undefined;
  await expect
    .poll(
      async () => {
        last = await getScene(api, production, sceneId);
        return predicate(last);
      },
      { message, timeout, intervals: [100, 200, 400] },
    )
    .toBe(true);
  return last!;
}

/**
 * Like {@link expectScene}, and the scene version must stay the same for `quietMs` after the predicate holds: a drag sends
 * coalesced requests, so a predicate such as «crop.right > 0.15» can be true for an intermediate state long before the
 * last request has landed.
 */
export async function expectStableScene(
  api: AdminApi,
  production: Production,
  sceneId: string,
  predicate: (scene: SceneDto) => boolean,
  message: string,
  quietMs = 600,
  timeout = 15_000,
): Promise<SceneDto> {
  let last: SceneDto | undefined;
  let version = -1;
  let since = 0;
  await expect
    .poll(
      async () => {
        last = await getScene(api, production, sceneId);
        if (!predicate(last)) {
          version = -1;
          return false;
        }
        if (last.version !== version) {
          version = last.version;
          since = Date.now();
        }
        return Date.now() - since >= quietMs;
      },
      { message, timeout, intervals: [100, 150, 200] },
    )
    .toBe(true);
  return last!;
}

// --- the monitors ---------------------------------------------------------------------------------------------------

export type MonitorKind = 'program' | 'preview';

export const monitorOf = (page: Page, kind: MonitorKind): Locator =>
  page.locator(`sf-monitor.c-monitor--${kind}`);

/** An item as the scene renderer draws it, in canvas pixels (inline styles of `.sf-r-item`). */
export interface RenderedItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `z-index` = position in the item array (first = back). */
  z: number;
  visible: boolean;
  radius: string;
  /** `object-fit` and `transform` of the `<img>` / `<video>` inside. */
  fit: string | null;
  mirrored: boolean;
  tag: string | null;
  text: string;
}

/** The items of the top scene layer of a monitor (or of a container selector), as drawn, back to front (sorted by z-index: the DOM nodes keep their creation order). */
export async function renderedItems(
  page: Page,
  where: MonitorKind | string = 'program',
): Promise<RenderedItem[]> {
  const selector =
    where === 'program' || where === 'preview' ? `sf-monitor.c-monitor--${where}` : where;
  return page.evaluate((root) => {
    const container = document.querySelector(root);
    if (!container) return [];
    const layers = [...container.querySelectorAll<HTMLElement>('.sf-r-layer[data-scene-id]')];
    const layer = layers[layers.length - 1];
    if (!layer) return [];
    return [...layer.querySelectorAll<HTMLElement>('.sf-r-item[data-item-id]')]
      .map((element) => {
        const transform = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(element.style.transform);
        const media = element.querySelector<HTMLElement>('img, video');
        return {
          id: element.getAttribute('data-item-id') ?? '',
          x: transform ? Number(transform[1]) : Number.NaN,
          y: transform ? Number(transform[2]) : Number.NaN,
          w: parseFloat(element.style.width),
          h: parseFloat(element.style.height),
          z: Number(element.style.zIndex),
          visible: element.style.display !== 'none',
          radius: element.style.borderRadius,
          fit: media ? getComputedStyle(media).objectFit : null,
          mirrored: media ? /scaleX\(-1\)/.test(media.style.transform) : false,
          tag: media?.tagName.toLowerCase() ?? null,
          text: element.innerText.trim(),
        };
      })
      .sort((a, b) => a.z - b.z);
  }, selector);
}

/** Ids of the scene layers of a monitor (two while a fade runs). */
export async function renderedSceneIds(
  page: Page,
  kind: MonitorKind = 'program',
): Promise<string[]> {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} .sf-r-layer[data-scene-id]`)].map(
        (element) => element.getAttribute('data-scene-id') ?? '',
      ),
    `sf-monitor.c-monitor--${kind}`,
  );
}

// --- the edit overlay -----------------------------------------------------------------------------------------------

export interface OverlayBox {
  id: string;
  label: string;
  selected: boolean;
  locked: boolean;
  alert: boolean;
  handles: boolean;
  /** Client pixels. */
  rect: Rect;
}

export const overlayOf = (page: Page, kind: MonitorKind = 'program'): Locator =>
  monitorOf(page, kind).locator('sf-edit-overlay');

export async function overlayBoxes(
  page: Page,
  kind: MonitorKind = 'program',
): Promise<OverlayBox[]> {
  return page.evaluate((selector) => {
    return [
      ...document.querySelectorAll<HTMLElement>(`${selector} sf-edit-overlay .c-edit-box`),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        id: element.getAttribute('data-item-id') ?? '',
        label: element.querySelector('.c-edit-box__label')?.textContent?.trim() ?? '',
        selected: element.classList.contains('is-sel'),
        locked: element.classList.contains('is-locked'),
        alert: element.classList.contains('is-alert'),
        handles: element.querySelector('[data-handle]') !== null,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    });
  }, `sf-monitor.c-monitor--${kind}`);
}

/** Mapping between canvas pixels (1920 x 1080) and client pixels of the editable monitor. */
export class CanvasSpace {
  constructor(readonly rect: Rect) {}

  get scale(): number {
    return this.rect.width / CANVAS.w;
  }

  client(x: number, y: number): { x: number; y: number } {
    return {
      x: this.rect.x + (x / CANVAS.w) * this.rect.width,
      y: this.rect.y + (y / CANVAS.h) * this.rect.height,
    };
  }

  canvas(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: ((clientX - this.rect.x) / this.rect.width) * CANVAS.w,
      y: ((clientY - this.rect.y) / this.rect.height) * CANVAS.h,
    };
  }
}

/** The canvas space of a monitor's edit overlay, measured now. */
export async function canvasSpace(page: Page, kind: MonitorKind = 'program'): Promise<CanvasSpace> {
  const box = await overlayOf(page, kind).boundingBox();
  if (!box) throw new Error(`the ${kind} monitor has no edit overlay`);
  return new CanvasSpace(box);
}

export type Modifier = 'Shift' | 'Alt' | 'Control';

/** A pointer gesture on the page: press, move in steps, release; modifier keys are held for the whole gesture. */
export class Gesture {
  private down = false;

  constructor(
    private readonly page: Page,
    private readonly modifiers: readonly Modifier[] = [],
  ) {}

  async begin(point: { x: number; y: number }): Promise<this> {
    for (const key of this.modifiers) await this.page.keyboard.down(key);
    await this.page.mouse.move(point.x, point.y);
    await this.page.mouse.down();
    this.down = true;
    return this;
  }

  async to(point: { x: number; y: number }, steps = 10): Promise<this> {
    await this.page.mouse.move(point.x, point.y, { steps });
    return this;
  }

  async end(): Promise<void> {
    if (this.down) await this.page.mouse.up();
    this.down = false;
    for (const key of [...this.modifiers].reverse()) await this.page.keyboard.up(key);
  }
}

/** One complete drag from `from` to `to` (client pixels). */
export async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { modifiers?: readonly Modifier[]; steps?: number } = {},
): Promise<void> {
  const gesture = new Gesture(page, options.modifiers ?? []);
  await gesture.begin(from);
  await gesture.to(to, options.steps ?? 12);
  await gesture.end();
}

/** The centre (client pixels) of an item on the overlay. */
export function centerOf(
  space: CanvasSpace,
  rect: { x: number; y: number; w: number; h: number },
): {
  x: number;
  y: number;
} {
  return space.client(rect.x + rect.w / 2, rect.y + rect.h / 2);
}

// --- pixels ---------------------------------------------------------------------------------------------------------

export interface MonitorPixels {
  image: PixelImage;
  scale: number;
  mean: (canvasRect: Rect) => readonly [number, number, number, number];
  share: (color: string, canvasRect: Rect, tolerance?: number) => number;
}

/** Screenshot of a monitor's 16:9 screen as pixels with canvas-coordinate accessors. */
export async function monitorPixels(
  page: Page,
  kind: MonitorKind = 'program',
): Promise<MonitorPixels> {
  const screen = monitorOf(page, kind).locator('.c-monitor__screen');
  const image = PixelImage.fromPng(await screen.screenshot({ animations: 'allow' }));
  const scale = image.width / CANVAS.w;
  const toImage = (rect: Rect): Rect => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: Math.max(1, rect.width * scale),
    height: Math.max(1, rect.height * scale),
  });
  return {
    image,
    scale,
    mean: (rect) => image.mean(toImage(rect)),
    share: (color, rect, tolerance = 28) => image.shareOfColor(color, toImage(rect), tolerance),
  };
}

/** A rectangle shrunk by `by` canvas pixels on every side (to stay clear of outlines and rounded corners). */
export function inset(rect: { x: number; y: number; w: number; h: number }, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, width: rect.w - 2 * by, height: rect.h - 2 * by };
}

// --- requests -------------------------------------------------------------------------------------------------------

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  startedAt: number;
  endedAt: number | null;
  status: number | null;
}

/** Records the requests of a page that match `filter`, with start and end time (`Date.now()`) and status. */
export function recordRequests(
  page: Page,
  filter: (path: string, method: string) => boolean,
): RecordedRequest[] {
  const entries: RecordedRequest[] = [];
  const byRequest = new WeakMap<object, RecordedRequest>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!filter(url.pathname, request.method())) return;
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    const entry: RecordedRequest = {
      method: request.method(),
      path: url.pathname,
      body,
      startedAt: Date.now(),
      endedAt: null,
      status: null,
    };
    byRequest.set(request, entry);
    entries.push(entry);
  });
  page.on('response', (response) => {
    const entry = byRequest.get(response.request());
    if (entry) {
      entry.status = response.status();
      entry.endedAt = Date.now();
    }
  });
  return entries;
}

// --- feedback -------------------------------------------------------------------------------------------------------

/** The visible toast (`sf-toast-host`), without the message strip or other `role=status` regions. */
export const toastOf = (page: Page): Locator => page.locator('sf-toast-host .c-toast');

export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(toastOf(page), `toast ${String(text)}`).toContainText(text);
}

// --- Regie regions --------------------------------------------------------------------------------------------------

export const scenesDock = (page: Page): Locator =>
  page.getByRole('region', { name: 'Szenen', exact: true });
export const sourcesDock = (page: Page): Locator =>
  page.getByRole('region', { name: 'Quellen der Szene' });
export const inspector = (page: Page): Locator =>
  page.getByRole('region', { name: 'Eigenschaften' });
export const stationsDock = (page: Page): Locator =>
  page.getByRole('region', { name: 'Stationen', exact: true });

/** A row of the Quellen dock by the accessible name of its select button, e.g. `K1 Handy Eins`. */
export const sourceRow = (page: Page, codeAndName: string | RegExp): Locator =>
  sourcesDock(page).getByRole('button', {
    name: typeof codeAndName === 'string' ? `Auswählen: ${codeAndName}` : codeAndName,
  });

/** A number field of the element inspector: `x`, `y`, `w`, `h`. */
export const field = (page: Page, key: 'x' | 'y' | 'w' | 'h'): Locator =>
  page.locator(`#sf-insp-${key}`);
export const radiusField = (page: Page): Locator => page.getByLabel('Eckenradius');

/** Dock title text in the inspector header (`Szene` or `Element`) and its subtitle. */
export const inspectorTitle = (page: Page): Locator =>
  inspector(page).locator('.c-dock-frame__title');
export const inspectorSub = (page: Page): Locator => inspector(page).locator('.c-dock-frame__sub');

/** Rounds like the product does for comparisons of canvas pixels. */
export const near = (actual: number, expected: number, tolerance = 1): boolean =>
  Math.abs(actual - expected) <= tolerance;

/** Selects an item through its Quellen row and waits until the inspector shows the element. */
export async function selectViaRow(page: Page, codeAndName: string | RegExp): Promise<void> {
  const row = sourceRow(page, codeAndName);
  if ((await row.getAttribute('aria-pressed')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(inspectorTitle(page)).toHaveText('Element');
}

// --- animations, toasts and probes (installed into a page at run time) ---------------------------------------------

/** One call of `Element.prototype.animate` seen by {@link installAnimationHook}. */
export interface RecordedAnimation {
  /** `data-scene-id` of the element or of its scene layer (the fade of a program switch runs on the new layer). */
  sceneId: string | null;
  className: string;
  /** Option `duration` of the call (ms). */
  duration: number | null;
  /** Properties named in the keyframes, e.g. `opacity` or `outlineWidth`. */
  properties: string[];
  startedAt: number;
  /** `Date.now()` when the animation finished (null while it runs or after a cancel). */
  endedAt: number | null;
  /**
   * Time the animation ran on the document timeline, from its first frame to the frame in which it finished: the duration
   * without the jitter of the callbacks (`endedAt - startedAt` also contains the wait for the first frame and the promise).
   */
  elapsedMs: number | null;
  cancelled: boolean;
}

/** Wraps `Element.prototype.animate` of the page (idempotent) so tests can see every Web Animation the app starts. */
export async function installAnimationHook(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sfAnims?: unknown[]; __sfAnimHook?: boolean };
    if (w.__sfAnimHook) return;
    w.__sfAnimHook = true;
    w.__sfAnims = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      const animation = original.call(this, keyframes, options);
      const frames = Array.isArray(keyframes) ? keyframes : keyframes ? [keyframes] : [];
      const properties = [...new Set(frames.flatMap((frame) => Object.keys(frame)))].filter(
        (name) => name !== 'offset' && name !== 'easing',
      );
      const record = {
        sceneId:
          this.getAttribute('data-scene-id') ??
          this.closest('[data-scene-id]')?.getAttribute('data-scene-id') ??
          null,
        className: String((this as HTMLElement).className ?? ''),
        duration:
          typeof options === 'number'
            ? options
            : typeof options?.duration === 'number'
              ? options.duration
              : null,
        properties,
        startedAt: Date.now(),
        endedAt: null as number | null,
        elapsedMs: null as number | null,
        timelineStart: null as number | null,
        cancelled: false,
      };
      w.__sfAnims!.push(record);
      animation.ready.then(
        () => {
          record.timelineStart = Number(animation.startTime);
        },
        () => undefined,
      );
      animation.finished.then(
        () => {
          record.endedAt = Date.now();
          if (record.timelineStart !== null)
            record.elapsedMs = Number(document.timeline.currentTime) - record.timelineStart;
        },
        () => {
          record.cancelled = true;
        },
      );
      return animation;
    } as typeof Element.prototype.animate;
  });
}

export async function animationsOf(page: Page): Promise<RecordedAnimation[]> {
  return page.evaluate(
    () =>
      ((window as unknown as { __sfAnims?: unknown[] }).__sfAnims ?? []).map((entry) => ({
        ...(entry as object),
      })) as never,
  );
}

/** Opacity fades only (the transition of a program switch), optionally of one scene. */
export async function opacityFades(page: Page, sceneId?: string): Promise<RecordedAnimation[]> {
  return (await animationsOf(page)).filter(
    (entry) =>
      entry.properties.includes('opacity') && (sceneId === undefined || entry.sceneId === sceneId),
  );
}

/** The flash of the Program monitor (outline animation of `.c-monitor__screen`). */
export async function flashes(page: Page): Promise<RecordedAnimation[]> {
  return (await animationsOf(page)).filter((entry) => entry.properties.includes('outlineWidth'));
}

/** Records the text of every toast that appears (the toast lives 3.2 s; a test may look late). Read with {@link toastLog}. */
export async function trackToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sfToasts?: string[]; __sfToastObserver?: MutationObserver };
    if (w.__sfToastObserver) return;
    w.__sfToasts = [];
    const host = document.querySelector('sf-toast-host');
    if (!host) return;
    const take = () => {
      const text = host.querySelector('.c-toast span')?.textContent?.trim();
      if (text && w.__sfToasts![w.__sfToasts!.length - 1] !== text) w.__sfToasts!.push(text);
    };
    w.__sfToastObserver = new MutationObserver(take);
    w.__sfToastObserver.observe(host, { childList: true, subtree: true, characterData: true });
    take();
  });
}

export async function toastLog(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __sfToasts?: string[] }).__sfToasts ?? []),
  ]);
}

/** Opens a pointerdown probe: `window.__sfT0` is `Date.now()` of the last pointerdown (capture phase, before the app). */
export async function installPointerProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sfT0?: number; __sfPointerProbe?: boolean };
    if (w.__sfPointerProbe) return;
    w.__sfPointerProbe = true;
    document.addEventListener('pointerdown', () => (w.__sfT0 = Date.now()), true);
  });
}

export async function lastPointerDown(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __sfT0?: number }).__sfT0 ?? null);
}

/**
 * On the output page: `watchScene(id)` notes the first moment a scene layer with that id is in the document
 * (`window.__sfHit`), through a MutationObserver, so the time is not limited by polling.
 */
export async function installSceneProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __sfTarget?: string | null;
      __sfHit?: number | null;
      __sfSceneProbe?: boolean;
    };
    if (w.__sfSceneProbe) return;
    w.__sfSceneProbe = true;
    w.__sfTarget = null;
    w.__sfHit = null;
    const check = () => {
      if (
        w.__sfTarget &&
        w.__sfHit === null &&
        document.querySelector(`.sf-r-layer[data-scene-id="${w.__sfTarget}"]`)
      )
        w.__sfHit = Date.now();
    };
    new MutationObserver(check).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scene-id'],
    });
  });
}

export async function watchScene(page: Page, sceneId: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __sfTarget?: string | null; __sfHit?: number | null };
    w.__sfTarget = id;
    w.__sfHit = null;
  }, sceneId);
}

export async function sceneHit(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __sfHit?: number | null }).__sfHit ?? null);
}

/** The data-scene-id layers of an output page (two while a fade runs) with their computed opacity. */
export async function outputLayers(
  page: Page,
): Promise<Array<{ sceneId: string; opacity: number }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#output .sf-r-layer[data-scene-id]')].map(
      (element) => ({
        sceneId: element.getAttribute('data-scene-id') ?? '',
        opacity: Number(getComputedStyle(element).opacity),
      }),
    ),
  );
}
