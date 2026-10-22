/**
 * Subscribes to environment events after which an immediate reconnect attempt is worthwhile and returns a function
 * that removes the listeners again. Injected into the reconnect loops so tests (and non-browser hosts) can drive it.
 */
export type WakeSignals = (wake: () => void) => () => void;

/**
 * Browser wake signals (spec 6): `online` on `window` and `visibilitychange` to visible on `document` (a phone or
 * laptop coming back from sleep). Without `window`/`document` (Node, workers) it subscribes to nothing.
 */
export const browserWakeSignals: WakeSignals = (wake) => {
  const target = typeof window === 'undefined' ? null : window;
  const doc = typeof document === 'undefined' ? null : document;
  const onOnline = (): void => wake();
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === 'visible') {
      wake();
    }
  };
  target?.addEventListener('online', onOnline);
  doc?.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    target?.removeEventListener('online', onOnline);
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
  };
};
