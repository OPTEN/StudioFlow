/**
 * Page lifecycle signals relevant for reconnecting media:
 * - «wake» moments where an immediate retry is worthwhile: `online`, the document becoming visible, `pageshow`
 *   (bfcache restore) and `resume` (Chromium un-freeze);
 * - «suspended» phases where no connect attempt should start: between `pagehide`/`freeze` and the matching
 *   `pageshow`/`resume`. livekit-client itself disconnects on `pagehide` and `freeze` (CLIENT_INITIATED), so a retry
 *   during that phase would only open a socket that the browser is about to freeze.
 *
 * Visibility alone never suspends: a laptop sharing its screen usually has the sender tab in the background, and it
 * must keep reconnecting there.
 */
export interface PageLifecycle {
  /** True while the page is frozen or in the back/forward cache. */
  readonly suspended: boolean;
  /** Subscribes to wake signals; returns the unsubscribe function. */
  onWake(listener: () => void): () => void;
  /** Removes every DOM listener. */
  dispose(): void;
}

/** Event targets the lifecycle watcher listens to (injectable for tests). */
export interface PageLifecycleTargets {
  readonly window: EventTarget;
  readonly document: EventTarget & { readonly visibilityState: DocumentVisibilityState };
}

const NOOP_LIFECYCLE: PageLifecycle = {
  suspended: false,
  onWake: () => () => undefined,
  dispose: () => undefined,
};

function defaultTargets(): PageLifecycleTargets | null {
  return typeof window === 'undefined' || typeof document === 'undefined'
    ? null
    : { window, document };
}

/** Starts watching the page lifecycle. Outside a browser it returns an inert watcher. */
export function watchPageLifecycle(
  targets: PageLifecycleTargets | null = defaultTargets(),
): PageLifecycle {
  if (targets === null) {
    return NOOP_LIFECYCLE;
  }
  const wakeListeners = new Set<() => void>();
  let suspended = false;
  const wake = (): void => {
    suspended = false;
    for (const listener of [...wakeListeners]) {
      listener();
    }
  };
  const suspend = (): void => {
    suspended = true;
  };
  const onVisibility = (): void => {
    if (targets.document.visibilityState === 'visible') {
      wake();
    }
  };
  const bindings: readonly (readonly [EventTarget, string, () => void])[] = [
    [targets.window, 'online', wake],
    [targets.window, 'pageshow', wake],
    [targets.window, 'pagehide', suspend],
    [targets.document, 'resume', wake],
    [targets.document, 'freeze', suspend],
    [targets.document, 'visibilitychange', onVisibility],
  ];
  for (const [target, type, handler] of bindings) {
    target.addEventListener(type, handler);
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
      for (const [target, type, handler] of bindings) {
        target.removeEventListener(type, handler);
      }
    },
  };
}
