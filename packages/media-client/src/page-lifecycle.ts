/**
 * Page lifecycle signals relevant for reconnecting media:
 * - “wake” moments where an immediate retry is worthwhile: the wake signals shared with the hubs (`pageWakeSignals`
 *   of `@studioflow/realtime-client`: `online`, the document becoming visible, `pageshow` and `resume`);
 * - “suspended” phases where no connect attempt should start: between `pagehide`/`freeze` and the next wake signal.
 *   livekit-client itself disconnects on `pagehide` and `freeze` (CLIENT_INITIATED), so a retry during that phase
 *   would only open a socket that the browser is about to freeze.
 *
 * Visibility alone never suspends: a laptop sharing its screen usually has the sender tab in the background, and it
 * must keep reconnecting there.
 */
import { browserWakeTargets, pageWakeSignals, type WakeTargets } from '@studioflow/realtime-client';

/** Wake signals plus the suspended phase of the page (see the module comment). */
export interface PageLifecycle {
  /** True while the page is frozen or in the back/forward cache. */
  readonly suspended: boolean;
  /** Subscribes to wake signals; returns the unsubscribe function. */
  onWake(listener: () => void): () => void;
  /** Removes every DOM listener. */
  dispose(): void;
}

/** Event targets the lifecycle watcher listens to (injectable for tests). */
export type PageLifecycleTargets = WakeTargets;

const NOOP_LIFECYCLE: PageLifecycle = {
  suspended: false,
  onWake: () => () => undefined,
  dispose: () => undefined,
};

/** Starts watching the page lifecycle. Outside a browser it returns an inert watcher. */
export function watchPageLifecycle(
  targets: PageLifecycleTargets | null = browserWakeTargets(),
): PageLifecycle {
  if (targets === null) {
    return NOOP_LIFECYCLE;
  }
  const wakeListeners = new Set<() => void>();
  let suspended = false;
  const suspend = (): void => {
    suspended = true;
  };
  const stopWakeSignals = pageWakeSignals(targets)(() => {
    suspended = false;
    for (const listener of [...wakeListeners]) {
      listener();
    }
  });
  const suspensions: readonly (readonly [EventTarget, string])[] = [
    [targets.window, 'pagehide'],
    [targets.document, 'freeze'],
  ];
  for (const [target, type] of suspensions) {
    target.addEventListener(type, suspend);
  }
  return {
    get suspended() {
      return suspended;
    },
    onWake: (listener) => {
      wakeListeners.add(listener);
      return () => {
        wakeListeners.delete(listener);
      };
    },
    dispose: () => {
      wakeListeners.clear();
      stopWakeSignals();
      for (const [target, type] of suspensions) {
        target.removeEventListener(type, suspend);
      }
    },
  };
}
