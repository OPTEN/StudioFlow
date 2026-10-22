/** Time without pointer movement after which the cursor disappears. */
export const CURSOR_IDLE_MS = 3000;

/** Class on `<html>` that hides the cursor (styles.css). */
export const CURSOR_IDLE_CLASS = 'is-cursor-idle';

/**
 * Hides the mouse cursor after {@link CURSOR_IDLE_MS} without movement (proxies often show the page full screen) and
 * shows it again on the next movement. Event driven: no timer runs while the pointer rests. Returns a stop function.
 */
export function hideIdleCursor(doc: Document, idleMs = CURSOR_IDLE_MS): () => void {
  const root = doc.documentElement;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      root.classList.add(CURSOR_IDLE_CLASS);
    }, idleMs);
  };
  const onMove = (): void => {
    root.classList.remove(CURSOR_IDLE_CLASS);
    arm();
  };
  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerdown', onMove, { passive: true });
  arm();
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerdown', onMove);
    root.classList.remove(CURSOR_IDLE_CLASS);
  };
}
