import { MONO_FONT_PROBE, UI_FONT_PROBE, whenFontsReady } from './fonts';
import { clockHint } from './slates';

/**
 * `/o/_uhr`: running clock for glass-to-glass measurements (plan phase 0: «Glass-to-Glass messen, indem wir eine
 * laufende Uhr filmen»). A camera that is live in StudioFlow films this screen; a photo that shows this clock and the
 * output side by side shows the latency as the difference. No key, no API, no LiveKit. The digits are redrawn on
 * every animation frame (that is the point of this page) in tabular JetBrains Mono, so nothing moves sideways.
 */

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Local time «HH:MM:SS.mmm» (24 h). */
export function formatClockMs(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return '--:--:--.---';
  }
  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

/** Renders the clock into `root` and starts it; returns the function that stops it. */
export function startClockPage(doc: Document, root: HTMLElement): () => void {
  const view = doc.defaultView;
  doc.title = 'StudioFlow Uhr';
  root.setAttribute('aria-label', 'Messuhr');
  const clock = doc.createElement('div');
  clock.className = 'c-clock';
  const time = doc.createElement('div');
  time.className = 'c-clock__time';
  time.setAttribute('role', 'timer');
  time.textContent = formatClockMs(new Date());
  const hint = doc.createElement('p');
  hint.className = 'c-clock__hint';
  hint.textContent = clockHint();
  clock.append(time, hint);
  clock.style.visibility = 'hidden';
  root.replaceChildren(clock);

  let frame: number | null = null;
  let stopped = false;
  const tick = (): void => {
    if (stopped) {
      return;
    }
    time.textContent = formatClockMs(new Date());
    frame = view?.requestAnimationFrame(tick) ?? null;
  };
  void whenFontsReady(doc, [MONO_FONT_PROBE, UI_FONT_PROBE]).then(() => {
    if (!stopped) {
      clock.style.visibility = '';
      tick();
    }
  });
  return () => {
    stopped = true;
    if (frame !== null) {
      view?.cancelAnimationFrame(frame);
    }
  };
}
