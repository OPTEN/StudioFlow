import type { SceneDto, SceneItemDto } from '@studioflow/scene-model';
import { vi } from 'vitest';

import { SCRATCH_CLASS } from '../hold-frame';
import { createSceneRenderer } from '../scene-renderer';
import type { SceneRenderer, SceneRendererOptions } from '../types';
import { FakeProvider } from './fake-provider';

/** Device and asset references that pass `parseSourceRef`. */
export const CAMERA = 'dev_phone001/camera';
export const CAMERA_2 = 'dev_phone002/camera';
export const SCREEN = 'dev_laptop01/screen-1';
export const IMAGE = 'ast_image001';
export const CLIP = 'ast_clip0001';
export const PAUSE_IMAGE = 'ast_pause001';

/** A device reference for the n-th phone (1-based). */
export function phone(n: number): string {
  return `dev_phone${String(n).padStart(3, '0')}/camera`;
}

/** A scene item with the server defaults; geometry and other fields can be overridden. */
export function sceneItem(
  id: string,
  source: string,
  overrides: Partial<SceneItemDto> = {},
): SceneItemDto {
  return {
    id,
    source,
    x: 100,
    y: 50,
    w: 640,
    h: 360,
    fit: 'cover',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 0,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: 3000, fallbackSource: null },
    ...overrides,
  };
}

/** A scene with the given items. */
export function scene(
  id: string,
  items: SceneItemDto[],
  overrides: Partial<SceneDto> = {},
): SceneDto {
  return {
    id,
    name: id,
    sortOrder: 0,
    version: 1,
    layoutMode: 'free',
    background: { color: '#000000', assetId: null },
    items,
    ...overrides,
  };
}

/** A renderer in a container of the given CSS size with a fake provider. */
export interface Mounted {
  readonly container: HTMLDivElement;
  readonly provider: FakeProvider;
  readonly renderer: SceneRenderer;
  /** Errors the renderer reported through `onError`. */
  readonly errors: unknown[];
  /** Simulates a container resize (happy-dom has no layout). */
  setSize(width: number, height: number): void;
  /** The element of an item by id (null when not rendered). */
  item(id: string): HTMLElement | null;
  /** First element matching a selector inside an item. */
  part<K extends keyof HTMLElementTagNameMap>(
    id: string,
    selector: K,
  ): HTMLElementTagNameMap[K] | null;
  part(id: string, selector: string): HTMLElement | null;
}

/** Mounts a renderer (default: output mode, 1920 × 1080 container). */
export function mount(
  options: Partial<SceneRendererOptions> = {},
  size: { readonly width: number; readonly height: number } = { width: 1920, height: 1080 },
): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const provider = options.provider instanceof FakeProvider ? options.provider : new FakeProvider();
  provider.urls.set(IMAGE, '/media/image.png');
  provider.urls.set(CLIP, '/media/clip.mp4');
  provider.urls.set(PAUSE_IMAGE, '/media/pause.png');
  const errors: unknown[] = [];
  const renderer = createSceneRenderer(container, {
    mode: 'output',
    onError: (error) => errors.push(error),
    ...options,
    provider,
  });
  const setSize = (width: number, height: number): void => {
    const viewport = container.firstElementChild;
    if (!viewport) {
      return;
    }
    Object.defineProperty(viewport, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: height, configurable: true });
    renderer.resize();
  };
  setSize(size.width, size.height);
  const item = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  function part(id: string, selector: string): HTMLElement | null {
    return item(id)?.querySelector<HTMLElement>(selector) ?? null;
  }
  return { container, provider, renderer, errors, setSize, item, part };
}

/** Pretends the video element has a decoded frame of the given size (`readyState` 4, HAVE_ENOUGH_DATA). */
export function giveFrame(video: HTMLVideoElement, width = 1280, height = 720): void {
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
}

/** Pretends the video element lost its frame (new srcObject without data yet). */
export function clearFrame(video: HTMLVideoElement): void {
  giveFrame(video, 0, 0);
  Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
}

/**
 * Pretends the video element knows its size from the metadata but has not decoded a frame yet (`readyState` 1,
 * HAVE_METADATA): what a video looks like for a moment after it starts, longer on a computer that is busy.
 */
export function giveMetadataOnly(video: HTMLVideoElement, width = 1280, height = 720): void {
  giveFrame(video, width, height);
  Object.defineProperty(video, 'readyState', { value: 1, configurable: true });
}

/** What the fake picture probe reads from the next video it is given. */
export type ProbedPicture = 'picture' | 'black' | 'transparent';

export interface FakePictureProbe {
  /** What the probe sees from now on: a picture, black pixels, or nothing painted (transparent). */
  show: ProbedPicture;
  /** How many frames were probed. */
  readonly probes: number;
}

/**
 * happy-dom has an `OffscreenCanvas` without pixels, so the renderer cannot tell a black frame from a picture. This puts a
 * probe in its place whose eight by eight pixels the test chooses (`show`). Remove it with `vi.unstubAllGlobals()`.
 */
export function fakePictureProbe(show: ProbedPicture = 'picture'): FakePictureProbe {
  const state = { show, probes: 0 };
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    getContext(): unknown {
      return {
        clearRect: () => undefined,
        drawImage: () => {
          state.probes += 1;
        },
        getImageData: (_x: number, _y: number, width: number, height: number) => {
          const data = new Uint8ClampedArray(width * height * 4);
          if (state.show !== 'transparent') {
            for (let i = 0; i < data.length; i += 4) {
              const level = state.show === 'picture' ? 120 : 0;
              data[i] = level;
              data[i + 1] = level;
              data[i + 2] = level;
              data[i + 3] = 255;
            }
          }
          return { data };
        },
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return state;
}

/** What {@link fakeCanvas2d} records. */
export interface FakeCanvas2d {
  readonly drawImage: ReturnType<typeof vi.fn>;
  readonly clearRect: ReturnType<typeof vi.fn>;
  /** Values assigned to `context.filter` (only with the `filter` option). */
  readonly filters: string[];
  /** Values assigned to `context.globalCompositeOperation`. */
  readonly compositeOperations: string[];
  /** The draw calls whose source is a video: every frame that was looked at, also one that was refused (the others are canvas to canvas). */
  videoDraws(): unknown[][];
  /** The copies that replaced a hold frame or a still: the draws from the scratch canvas, which only a frame that shows a picture gets to. */
  copies(): unknown[][];
}

/**
 * happy-dom has no 2D canvas: installs a fake context whose calls are recorded. With `filter: true` the context has a
 * `filter` property like Chromium and Firefox (and records what is assigned to it); without it the context is like
 * Safari's, which cannot filter.
 */
export function fakeCanvas2d(options: { readonly filter?: boolean } = {}): FakeCanvas2d {
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  const filters: string[] = [];
  const compositeOperations: string[] = [];
  const context: Record<string, unknown> = { drawImage, clearRect, imageSmoothingEnabled: true };
  let composite = 'source-over';
  Object.defineProperty(context, 'globalCompositeOperation', {
    get: () => composite,
    set: (value: string) => {
      composite = value;
      compositeOperations.push(value);
    },
  });
  if (options.filter) {
    let filter = 'none';
    Object.defineProperty(context, 'filter', {
      get: () => filter,
      set: (value: string) => {
        filter = value;
        filters.push(value);
      },
    });
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  // The stills of thumbnails are encoded as images: every encoding gives a URL of its own.
  let encoded = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    encoded += 1;
    return `data:image/jpeg;base64,still-${this.width}x${this.height}-${encoded}`;
  });
  return {
    drawImage,
    clearRect,
    filters,
    compositeOperations,
    videoDraws: () =>
      drawImage.mock.calls.filter((call: unknown[]) => call[0] instanceof HTMLVideoElement),
    copies: () =>
      drawImage.mock.calls.filter(
        (call: unknown[]) =>
          call[0] instanceof HTMLCanvasElement && call[0].className === SCRATCH_CLASS,
      ),
  };
}

/** An IntersectionObserver whose reports a test drives; see {@link stubIntersectionObserver}. */
class FakeIntersectionObserver {
  static readonly instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
  }

  report(isIntersecting: boolean): void {
    for (const target of this.targets) {
      this.callback(
        [{ isIntersecting, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
  }
}

/** Replaces `IntersectionObserver` (happy-dom's never reports); the controller reports to every observer that is not disconnected. */
export function stubIntersectionObserver(): {
  /** Observers created so far, newest last. */
  readonly observers: readonly FakeIntersectionObserver[];
  /** Tells every connected observer that its target does (not) intersect the viewport. */
  report(isIntersecting: boolean): void;
} {
  FakeIntersectionObserver.instances.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  return {
    observers: FakeIntersectionObserver.instances,
    report: (isIntersecting) => {
      for (const observer of FakeIntersectionObserver.instances) {
        observer.report(isIntersecting);
      }
    },
  };
}

/** Moves the page to the foreground or the background (`visibilitychange`). */
export function setPageVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A Web Animations stand-in driven by (fake) timers. */
export interface FakeAnimation {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly duration: number;
  cancelled: boolean;
}

/**
 * Replaces `Element.prototype.animate` with a fake whose `finished` promise resolves after `duration` on the (fake)
 * timer queue, and rejects on `cancel()` like the real API.
 */
export function fakeAnimate(): FakeAnimation[] {
  const animations: FakeAnimation[] = [];
  vi.spyOn(Element.prototype, 'animate').mockImplementation(function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0);
    const record: FakeAnimation = {
      element: this,
      keyframes: keyframes as Keyframe[],
      duration,
      cancelled: false,
    };
    animations.push(record);
    let resolve: () => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => resolve(), duration);
    const animation = {
      finished,
      cancel: () => {
        record.cancelled = true;
        clearTimeout(timer);
        reject(new DOMException('The animation was canceled.', 'AbortError'));
      },
      finish: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    return animation as unknown as Animation;
  });
  return animations;
}

/** Removes `Element.prototype.animate` (browsers without Web Animations); returns a restore function. */
export function withoutAnimate(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(Element.prototype, 'animate', descriptor);
    }
  };
}

/** Lets pending promise callbacks run (fake timers do not flush microtasks by themselves). */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
