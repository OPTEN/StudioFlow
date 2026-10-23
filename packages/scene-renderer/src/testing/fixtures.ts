import type { SceneDto, SceneItemDto } from '@studioflow/scene-model';
import { vi } from 'vitest';

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

/** Pretends the video element has a decoded frame of the given size. */
export function giveFrame(video: HTMLVideoElement, width = 1280, height = 720): void {
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
}

/** Pretends the video element lost its frame (new srcObject without data yet). */
export function clearFrame(video: HTMLVideoElement): void {
  giveFrame(video, 0, 0);
}

/** happy-dom has no 2D canvas: installs a fake context whose drawImage calls are recorded. */
export function fakeCanvas2d(): { readonly drawImage: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  return { drawImage };
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
