/**
 * Visibility of a picture on screen (issue #12): a monitor or a thumbnail that nobody can see should not make the
 * senders deliver (and the browser decode) a picture. A target counts as visible when it intersects the viewport
 * (`IntersectionObserver`: `display: none`, a dock that is not shown, a list scrolled away, a collapsed section) and
 * the page is in the foreground (`visibilitychange`).
 */

/** Margin around the viewport in which a target already counts as visible, so scrolling does not show an empty picture. */
const ROOT_MARGIN = '96px';

/** A visibility watcher. */
export interface VisibilityWatch {
  /** Visible now. */
  visible(): boolean;
  /** Stops watching. Idempotent. */
  dispose(): void;
}

/**
 * Watches `target` and calls `onChange` with the new state whenever it changes (not for the initial state, read it
 * with `visible()`). A target counts as visible until the observer says otherwise (it reports right after the first
 * layout), and without `IntersectionObserver` (old engines) only the page visibility counts.
 */
export function watchVisibility(
  target: Element,
  onChange: (visible: boolean) => void,
): VisibilityWatch {
  const doc = target.ownerDocument;
  let intersecting = true;
  let foreground = doc.visibilityState !== 'hidden';
  let last = intersecting && foreground;
  let disposed = false;

  const update = (): void => {
    const next = intersecting && foreground;
    if (!disposed && next !== last) {
      last = next;
      onChange(next);
    }
  };
  const onVisibilityChange = (): void => {
    foreground = doc.visibilityState !== 'hidden';
    update();
  };
  doc.addEventListener('visibilitychange', onVisibilityChange);

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        // The last entry is the newest state of the target.
        const entry = entries[entries.length - 1];
        if (entry) {
          intersecting = entry.isIntersecting;
          update();
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(target);
  }

  return {
    visible: () => last,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      observer?.disconnect();
    },
  };
}
