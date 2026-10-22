/**
 * Subscribes to environment events after which an immediate reconnect attempt is worthwhile and returns a function
 * that removes the listeners again. Injected into the reconnect loops so tests (and non-browser hosts) can drive it.
 */
export type WakeSignals = (wake: () => void) => () => void;

/** Event targets of a page that carry wake signals (injectable for tests). */
export interface WakeTargets {
  readonly window: EventTarget;
  readonly document: EventTarget & { readonly visibilityState: DocumentVisibilityState };
}

/**
 * Wake signals of a page (spec 6): `online` and `pageshow` (back/forward cache restore) on `window`, `resume`
 * (Chromium un-freeze) and `visibilitychange` to visible on `document` – a phone or laptop coming back from sleep,
 * the background or the network. Used by the hubs (`ResilientHub`) and, through `watchPageLifecycle`, by the LiveKit
 * sessions of `@flowstudio/media-client`. With `null` targets (no DOM) it subscribes to nothing.
 */
export function pageWakeSignals(targets: WakeTargets | null): WakeSignals {
  return (wake) => {
    if (targets === null) {
      return () => undefined;
    }
    const onWake = (): void => wake();
    const onVisibilityChange = (): void => {
      if (targets.document.visibilityState === 'visible') {
        wake();
      }
    };
    const bindings: readonly (readonly [EventTarget, string, () => void])[] = [
      [targets.window, 'online', onWake],
      [targets.window, 'pageshow', onWake],
      [targets.document, 'resume', onWake],
      [targets.document, 'visibilitychange', onVisibilityChange],
    ];
    for (const [target, type, handler] of bindings) {
      target.addEventListener(type, handler);
    }
    return () => {
      for (const [target, type, handler] of bindings) {
        target.removeEventListener(type, handler);
      }
    };
  };
}

/** The page's own `window` and `document`, or null outside a browser (Node, workers). */
export function browserWakeTargets(): WakeTargets | null {
  return typeof window === 'undefined' || typeof document === 'undefined'
    ? null
    : { window, document };
}

/**
 * {@link pageWakeSignals} of the running page. The targets are looked up on every subscription, so the function can
 * be created before a DOM exists (and does nothing without one).
 */
export const browserWakeSignals: WakeSignals = (wake) =>
  pageWakeSignals(browserWakeTargets())(wake);
