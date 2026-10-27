import { now } from './timers';

/** Extra time after the end of an animation before the first look at its clock, and between the looks after it. */
export const STALL_MARGIN_MS = 100;

/**
 * How long the clock of an animation has to stand still before the animation counts as stalled. A loaded machine stalls
 * the frames for a few hundred milliseconds (measured: up to 380 ms on a CPU-starved runner); a page that is hidden or not
 * rendered produces none at all, and nobody can see its fade, so waiting a second for it costs nothing.
 */
export const STALL_AFTER_MS = 1000;

/**
 * Calls `onStalled` once when an animation of `durationMs` that started now neither finished nor moved: a fade or a
 * presence animation must always run to completion, also when the browser never reports its end (background tab,
 * element not rendered). An animation whose time still advances, or stood still only for a moment, is left alone however
 * late it is: a loaded machine delivers the first frame late and the last ones in a stall, and cutting such an animation
 * short at the wall-clock end jumps the picture to the end state before the animation got there. A missing animation (the
 * CSS fallback) counts as stalled at the end. Returns the function that stops the watch.
 */
export function watchForStall(
  animation: Animation | null,
  durationMs: number,
  onStalled: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seenTime: number | null = null;
  let movedAt = now();

  const look = (): void => {
    const time = animation?.currentTime;
    if (typeof time === 'number') {
      if (time !== seenTime) {
        seenTime = time;
        movedAt = now();
      }
      if (now() - movedAt < STALL_AFTER_MS) {
        timer = setTimeout(look, STALL_MARGIN_MS);
        return;
      }
    }
    timer = null;
    onStalled();
  };

  timer = setTimeout(look, durationMs + STALL_MARGIN_MS);
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
