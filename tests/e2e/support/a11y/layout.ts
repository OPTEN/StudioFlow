import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { OUTPUT_DIR } from '../env';

/**
 * Layout assertions of the responsive tests (docs/testing.md 2.8, helpers `expectNoOverflow` / `expectInViewport`) and
 * the bounding-box checks for overlapping controls.
 */

export const SCREENS_DIR = path.join(OUTPUT_DIR, 'screens');

/** Viewports of the responsive tests (the task list; 1366 x 768 is the common laptop screen). */
export const VIEWPORTS = {
  w1280: { width: 1280, height: 720 },
  w1366: { width: 1366, height: 768 },
  w1440: { width: 1440, height: 900 },
  w1920: { width: 1920, height: 1080 },
  w1180: { width: 1180, height: 800 },
  w900: { width: 900, height: 700 },
  w390: { width: 390, height: 844 },
} as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Saves a screenshot for the report under `.output/<project>/screens/<name>.png` and attaches it to the test. */
export async function saveScreen(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<string> {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  const file = path.join(SCREENS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? false, animations: 'disabled' });
  await test.info().attach(`screen-${name}.png`, { path: file, contentType: 'image/png' });
  return file;
}

export interface OverflowReport {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  /** Elements that stick out of the viewport horizontally and are not clipped by a scroll container or hidden on purpose. */
  offenders: string[];
}

/**
 * Horizontal scroll and elements beyond the viewport edge. `scrollWidth <= clientWidth` is the hard rule; the element
 * scan finds what causes an overflow that a `overflow-x: hidden` ancestor hides (a control cut off at the edge).
 */
export async function overflowReport(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders: string[] = [];
    const clipped = (element: Element): boolean => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          const box = parent.getBoundingClientRect();
          if (box.left >= -0.5 && box.right <= width + 0.5) return true;
        }
      }
      return false;
    };
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.closest('.u-sr-only, [aria-hidden=true], svg, .c-dock-ghost, .c-drop-line, .c-drop-zone')) continue;
      if (style.position === 'fixed' && element.getBoundingClientRect().left < -500) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.left < -0.5 || box.right > width + 0.5) {
        if (clipped(element)) continue;
        offenders.push(`${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''} x ${Math.round(box.left)}..${Math.round(box.right)} (viewport ${width})`);
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: width, scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight, offenders: offenders.slice(0, 20) };
  });
}

/** No horizontal scroll and nothing beyond the viewport edge; with `vertical: false` also no vertical page scroll. */
export async function expectNoOverflow(page: Page, options: { vertical?: boolean; label?: string } = {}): Promise<OverflowReport> {
  const report = await overflowReport(page);
  const label = options.label ?? 'page';
  expect(report.scrollWidth, `${label}: no horizontal scroll (scrollWidth ${report.scrollWidth} <= clientWidth ${report.clientWidth}); wider than the viewport: ${report.offenders.slice(0, 6).join(' | ') || 'none found (clipped)'}`).toBeLessThanOrEqual(report.clientWidth);
  expect(report.offenders, `${label}: no element extends beyond the viewport edge`).toEqual([]);
  if (options.vertical === false)
    expect(report.scrollHeight, `${label}: no vertical page scroll (scrollHeight ${report.scrollHeight} <= clientHeight ${report.clientHeight})`).toBeLessThanOrEqual(report.clientHeight);
  return report;
}

/**
 * The element lies inside the viewport without scrolling and nothing else covers its centre
 * (`elementFromPoint` returns the element or one of its descendants).
 */
export async function expectInViewport(locator: Locator, what: string): Promise<void> {
  const result = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inside = box.width > 0 && box.height > 0 && box.left >= -0.5 && box.top >= -0.5 && box.right <= window.innerWidth + 0.5 && box.bottom <= window.innerHeight + 0.5;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const covered = !(hit && (hit === element || element.contains(hit) || hit.contains(element)));
    return { inside, covered, box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }, hit: hit ? `${hit.tagName.toLowerCase()}.${typeof hit.className === 'string' ? hit.className : ''}` : null, viewport: { w: window.innerWidth, h: window.innerHeight } };
  });
  expect(result.inside, `${what} lies inside the viewport without scrolling: ${JSON.stringify(result.box)} in ${JSON.stringify(result.viewport)}`).toBe(true);
  expect(result.covered, `${what} is not covered by another element (hit: ${result.hit})`).toBe(false);
}

/** Bounding box of the first match in page coordinates (null when absent or not rendered). */
export async function boxOf(locator: Locator): Promise<Box | null> {
  if ((await locator.count()) === 0) return null;
  const box = await locator.first().evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  });
  return box.w === 0 && box.h === 0 ? null : box;
}

export interface Overlap {
  a: string;
  b: string;
  area: number;
}

/**
 * Pairs of interactive controls whose boxes intersect (more than `tolerance` px² of overlap) inside the scope. A
 * control inside another one (descendant) and the by-design pairs are skipped: the scene-row “Actions for scene” button sits on
 * the row, a splitter's widened hit area overlaps its neighbours, labels wrap their inputs.
 */
export async function findOverlaps(page: Page, scope: string, options: { tolerance?: number } = {}): Promise<Overlap[]> {
  return page.evaluate(
    ({ scope, tolerance }) => {
      const root = document.querySelector(scope);
      if (!root) return [{ a: `scope ${scope} not found`, b: '', area: 0 }];
      const selector = 'button, a[href], input, select, textarea, [role=switch], [role=tab], [role=menuitem], [role=checkbox], summary';
      const describe = (element: Element) => {
        const name = element.getAttribute('aria-label') || (element as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || element.getAttribute('title') || element.className;
        return `${element.tagName.toLowerCase()} “${String(name).slice(0, 40)}”`;
      };
      const visible = Array.from(root.querySelectorAll(selector)).filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || (element as HTMLElement).closest('[inert]')) return false;
        if (element.closest('.u-sr-only')) return false;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        // a visually hidden native input (custom switch / radio) is not a visible control of its own
        if (style.opacity === '0' || (style.clipPath && style.clipPath !== 'none' && box.width <= 1)) return false;
        return true;
      });
      // clipped by a scroll container: the visible part of the box is what counts
      const effective = (element: Element) => {
        let box = element.getBoundingClientRect();
        let left = box.left;
        let top = box.top;
        let right = box.right;
        let bottom = box.bottom;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
            const p = parent.getBoundingClientRect();
            left = Math.max(left, p.left);
            top = Math.max(top, p.top);
            right = Math.min(right, p.right);
            bottom = Math.min(bottom, p.bottom);
          }
        }
        return { left, top, right, bottom };
      };
      const overlaps: Array<{ a: string; b: string; area: number }> = [];
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i]!;
          const b = visible[j]!;
          if (a.contains(b) || b.contains(a)) continue;
          if (a.closest('label') && a.closest('label') === b.closest('label')) continue;
          const names = `${a.className} ${b.className}`;
          if (/c-scene__more/.test(names) && /\bc-scene\b/.test(names)) continue;
          const ra = effective(a);
          const rb = effective(b);
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 0 && h > 0 && w * h > tolerance) overlaps.push({ a: describe(a), b: describe(b), area: Math.round(w * h) });
        }
      }
      return overlaps;
    },
    { scope, tolerance: options.tolerance ?? 4 },
  );
}

/** Aspect ratio of a box (width / height). */
export function ratioOf(box: Box): number {
  return box.w / box.h;
}
