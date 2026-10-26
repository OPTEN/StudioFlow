/** A running show or hide animation of a text. */
export interface PresenceAnimation {
  /** Jumps to the end state (calls `onEnd` if it did not run yet). Idempotent. */
  finish(): void;
}

/** Where a text comes from when it is shown (and goes to when it is hidden), in canvas pixels. */
export interface PresenceOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * Extra time after which an animation counts as complete even when the browser never reports the end (background
 * tab, element not rendered): showing and hiding must always run to completion.
 */
const SAFETY_MARGIN_MS = 100;

/** Decelerates when showing, accelerates when hiding. */
const EASING_SHOW = 'cubic-bezier(0.2, 0, 0, 1)';
const EASING_HIDE = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * Fades and slides `element` in (`showing`) or out with the Web Animations API. Without the API, or with a duration
 * of 0 (reduced motion), it ends at once. `onEnd` runs exactly once, synchronously, before the animation is
 * cancelled: a hiding caller hides the element there, so the resting state never flashes between the last frame and
 * the hide. No inline style is left behind.
 */
export function animatePresence(
  element: HTMLElement,
  showing: boolean,
  offset: PresenceOffset,
  durationMs: number,
  onEnd: () => void,
): PresenceAnimation {
  let ended = false;
  let animation: Animation | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  function end(): void {
    if (ended) {
      return;
    }
    ended = true;
    if (safetyTimer !== null) {
      clearTimeout(safetyTimer);
    }
    onEnd();
    try {
      animation?.cancel();
    } catch {
      // A cancelled or detached animation has nothing left to stop.
    }
    animation = null;
  }

  if (durationMs > 0 && typeof element.animate === 'function') {
    const away: Keyframe = { opacity: 0, transform: `translate(${offset.x}px, ${offset.y}px)` };
    const rest: Keyframe = { opacity: 1, transform: 'none' };
    try {
      animation = element.animate(showing ? [away, rest] : [rest, away], {
        duration: durationMs,
        easing: showing ? EASING_SHOW : EASING_HIDE,
        fill: 'forwards',
      });
      animation.finished.then(end, () => undefined);
      safetyTimer = setTimeout(end, durationMs + SAFETY_MARGIN_MS);
    } catch {
      end();
    }
  } else {
    end();
  }
  return { finish: end };
}
