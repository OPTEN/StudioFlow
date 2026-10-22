import type { BrowserContext, Page } from '@playwright/test';

/**
 * Motion recorder of the reduced-motion tests (docs/testing.md E2E-DEV-16, GAP-28). An init script wraps
 * `Element.prototype.animate` and `scrollIntoView` and samples `document.getAnimations()` every 50 ms, so a test sees
 * every Web Animation (the renderer's fades, the Program flash), every CSS animation (lamp pulse, station flash) and
 * every CSS transition (switch, reveal, splitter) that really ran, with its duration. None of it ships in the product.
 */

export interface MotionEntry {
  /** `animate`: Element.animate() call, `css-animation`, `css-transition`. */
  kind: 'animate' | 'css-animation' | 'css-transition';
  /** Animation name, transition property or the animated keyframe properties. */
  name: string;
  /** Duration in ms (0 when the effect has none). */
  duration: number;
  /** Tag and classes of the target element. */
  target: string;
}

export interface MotionLog {
  entries: MotionEntry[];
  scrolls: Array<{ options: string; target: string }>;
}

const INIT = `
(() => {
  if (window.__a11yMotion) return;
  const log = { entries: [], scrolls: [] };
  const seen = new Set();
  Object.defineProperty(window, '__a11yMotion', { value: log, enumerable: false });
  const describe = (el) => {
    if (!el || !el.tagName) return 'unknown';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const record = (entry) => { log.entries.push(entry); };
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    try {
      const frames = Array.isArray(keyframes) ? keyframes : keyframes ? [keyframes] : [];
      const props = new Set();
      for (const frame of frames) for (const key of Object.keys(frame)) if (key !== 'offset' && key !== 'easing' && key !== 'composite') props.add(key);
      const duration = typeof options === 'number' ? options : (options && typeof options.duration === 'number' ? options.duration : 0);
      record({ kind: 'animate', name: [...props].join(','), duration, target: describe(this) });
    } catch (error) { /* the recorder never breaks the page */ }
    return nativeAnimate.call(this, keyframes, options);
  };
  const nativeScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg) {
    try { log.scrolls.push({ options: JSON.stringify(arg === undefined ? null : arg), target: describe(this) }); } catch (error) { /* ignore */ }
    return nativeScroll.call(this, arg);
  };
  setInterval(() => {
    try {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect && animation.effect.getTiming ? animation.effect.getTiming() : null;
        const target = animation.effect ? animation.effect.target : null;
        const isCss = animation.constructor && animation.constructor.name;
        const kind = isCss === 'CSSTransition' ? 'css-transition' : isCss === 'CSSAnimation' ? 'css-animation' : null;
        if (!kind) continue;
        const name = kind === 'css-transition' ? animation.transitionProperty : animation.animationName;
        const duration = timing && typeof timing.duration === 'number' ? timing.duration : 0;
        const key = kind + '|' + name + '|' + describe(target) + '|' + duration;
        if (seen.has(key)) continue;
        seen.add(key);
        record({ kind, name, duration, target: describe(target) });
      }
    } catch (error) { /* ignore */ }
  }, 40);
})();
`;

/** Installs the recorder before any page script of the context runs. */
export async function installMotionRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: INIT });
}

export async function readMotion(page: Page): Promise<MotionLog> {
  return page.evaluate(() => {
    const log = (window as unknown as { __a11yMotion?: { entries: unknown[]; scrolls: unknown[] } }).__a11yMotion;
    return JSON.parse(JSON.stringify(log ?? { entries: [], scrolls: [] })) as never;
  });
}

export async function clearMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = (window as unknown as { __a11yMotion?: { entries: unknown[]; scrolls: unknown[] } }).__a11yMotion;
    if (log) {
      log.entries.length = 0;
      log.scrolls.length = 0;
    }
  });
}

export interface DurationOffender {
  element: string;
  pseudo: string;
  property: 'transition-duration' | 'animation-duration';
  value: string;
}

/**
 * Every element (and its ::before / ::after) whose computed transition-duration or animation-duration is not 0 s. With
 * `prefers-reduced-motion: reduce` there must be none (docs/testing.md DEV-16). Elements inside the scene renderer are
 * skipped: the renderer animates through the Web Animations API, which the recorder measures.
 */
export async function nonZeroDurations(page: Page): Promise<DurationOffender[]> {
  return page.evaluate(() => {
    const offenders: Array<{ element: string; pseudo: string; property: 'transition-duration' | 'animation-duration'; value: string }> = [];
    const zero = (list: string) => list.split(',').every((part) => parseFloat(part) === 0 || part.trim() === '');
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of ['', '::before', '::after']) {
        const style = getComputedStyle(element, pseudo || null);
        if (pseudo && style.content === 'none') continue;
        if (!zero(style.transitionDuration)) offenders.push({ element: describe(element), pseudo, property: 'transition-duration', value: style.transitionDuration });
        if (!zero(style.animationDuration) && style.animationName !== 'none') offenders.push({ element: describe(element), pseudo, property: 'animation-duration', value: style.animationDuration });
      }
    }
    return offenders;
  });
}
