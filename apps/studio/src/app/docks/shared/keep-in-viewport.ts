/** Distance a popover keeps from the window edges (px). */
const EDGE = 8;

/**
 * Keeps an anchored popover (`.c-pop`, `right: 0` below its trigger) inside the window: limits its height to the
 * space below its top edge (at least `minHeight`) and shifts it right when a dock in the left zone would push it past
 * the left window edge. Call once after the panel rendered.
 */
export function keepInViewport(panel: HTMLElement, minHeight = 160): void {
  const view = panel.ownerDocument.defaultView;
  if (!view) {
    return;
  }
  const rect = panel.getBoundingClientRect();
  panel.style.maxHeight = `${Math.max(minHeight, view.innerHeight - rect.top - EDGE * 1.5)}px`;
  if (rect.left < EDGE) {
    panel.style.right = `${rect.left - EDGE}px`;
  }
}
