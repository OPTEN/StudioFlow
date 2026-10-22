import { now } from './timers';

/** A running opacity fade of one element. */
export interface Fade {
  /** Resolves when the fade ended (completed, finished early or stopped). Never rejects. */
  readonly done: Promise<void>;
  /** Jumps to the end value. Idempotent. */
  finish(): void;
  /** Freezes the current value and returns it (to reverse a fade from where it is). Idempotent. */
  stop(): number;
}

/**
 * Extra time after which a fade completes even when the browser never reports the end (background tab, element not
 * rendered): a fade must always run to completion.
 */
const SAFETY_MARGIN_MS = 100;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Fades the opacity of an element linearly with the Web Animations API, or with a CSS transition where
 * `element.animate` is missing. The fade owns the element's inline `opacity` (and `transition` in the fallback); at the
 * end the final value stays inline and the animation is cancelled, so no animation objects are left behind.
 */
export function fadeOpacity(
  element: HTMLElement,
  from: number,
  to: number,
  durationMs: number,
): Fade {
  let settle: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const startedAt = now();
  let ended = false;
  let animation: Animation | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === element && event.propertyName === 'opacity') {
      end(to);
    }
  };

  function end(opacity: number): void {
    if (ended) {
      return;
    }
    ended = true;
    if (safetyTimer !== null) {
      clearTimeout(safetyTimer);
    }
    element.removeEventListener('transitionend', onTransitionEnd);
    element.style.removeProperty('transition');
    element.style.opacity = String(opacity);
    try {
      animation?.cancel();
    } catch {
      // A cancelled or detached animation has nothing left to stop.
    }
    animation = null;
    settle();
  }

  element.style.opacity = String(from);
  const fade: Fade = {
    done,
    finish: () => end(to),
    stop: () => {
      if (ended) {
        return Number(element.style.opacity);
      }
      const current = from + (to - from) * clamp01((now() - startedAt) / durationMs);
      end(current);
      return current;
    },
  };
  if (!(durationMs > 0)) {
    end(to);
    return fade;
  }

  if (typeof element.animate === 'function') {
    try {
      const running = element.animate([{ opacity: from }, { opacity: to }], {
        duration: durationMs,
        easing: 'linear',
        fill: 'forwards',
      });
      animation = running;
      running.finished.then(
        () => end(to),
        () => undefined, // Rejected because end() cancelled it.
      );
    } catch {
      animation = null;
    }
  }
  if (!animation) {
    element.style.transition = `opacity ${durationMs}ms linear`;
    // Reading layout commits the start value, so the change below transitions instead of jumping.
    void element.offsetWidth;
    element.addEventListener('transitionend', onTransitionEnd);
    element.style.opacity = String(to);
  }
  safetyTimer = setTimeout(() => end(to), durationMs + SAFETY_MARGIN_MS);
  return fade;
}
