/** Current device pixel ratio (1 where unknown or malformed). */
export function devicePixelRatioNow(): number {
  const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Calls `onChange` when the device pixel ratio changes (window moved to another display, browser zoom); a
 * ResizeObserver does not notice that, but desired picture sizes depend on it. Returns a stop function.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') {
    return () => undefined;
  }
  let query: MediaQueryList | null = null;
  const listen = (): void => {
    const next = matchMedia(`(resolution: ${devicePixelRatioNow()}dppx)`);
    // Old engines only know addListener; without change events the ratio is still re-read on every render.
    if (typeof next?.addEventListener === 'function') {
      next.addEventListener('change', changed);
      query = next;
    }
  };
  const stop = (): void => {
    query?.removeEventListener('change', changed);
    query = null;
  };
  function changed(): void {
    // The query was for the old ratio: listen for the new one, then report.
    stop();
    listen();
    onChange();
  }
  listen();
  return stop;
}
