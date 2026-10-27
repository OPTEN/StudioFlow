/**
 * Extra time after the end of an animation after which it counts as stalled when its time no longer moves. Short,
 * because a stalled animation (background tab, element not rendered) has nobody who could see it.
 */
export const STALL_MARGIN_MS = 100;

/**
 * Calls `onStalled` once when an animation of `durationMs` that started now neither finished nor moved: a fade or a
 * presence animation must always run to completion, also when the browser never reports its end (background tab,
 * element not rendered). An animation whose time still advances is left alone however late it is: a loaded machine
 * delivers the first frame late and the last ones in a stall, and cutting such an animation short at the wall-clock end
 * jumps the picture to the end state before the animation got there. A missing animation (the CSS fallback) counts as
 * stalled at the end. Returns the function that stops the watch.
 */
export function watchForStall(
  animation: Animation | null,
  durationMs: number,
  onStalled: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seenTime: number | null = null;

  const look = (): void => {
    const time = animation?.currentTime;
    if (typeof time === 'number' && time !== seenTime) {
      seenTime = time;
      timer = setTimeout(look, STALL_MARGIN_MS);
      return;
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
