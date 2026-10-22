import { expect, type Page } from '@playwright/test';

/**
 * Layout facts of a sender page (docs/testing.md 2.8, DEV-07 ... DEV-11): horizontal overflow, the size and spacing of every
 * interactive element, text sizes. One DOM read per state; the specs assert on the result and attach it.
 */

export interface Overflow {
  /** scrollWidth - clientWidth of the document (0: no horizontal scroll). */
  document: number;
  /** Elements whose box leaves the viewport horizontally (selector and extent), the first few. */
  outside: string[];
  viewport: { width: number; height: number };
  scroll: { width: number; height: number };
}

export async function readOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const outside: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue;
      if (element.closest('.u-sr-only')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        const name = `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.split(/\s+/).slice(0, 2).join('.') : ''}`;
        outside.push(`${name} [${Math.round(box.left)}..${Math.round(box.right)}]`);
        if (outside.length >= 6) break;
      }
    }
    return {
      document: root.scrollWidth - root.clientWidth,
      outside,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { width: root.scrollWidth, height: root.scrollHeight },
    };
  });
}

/** No horizontal scroll: the document does not scroll sideways and nothing in the flow leaves the viewport. */
export async function expectNoOverflow(page: Page, label: string): Promise<Overflow> {
  const overflow = await readOverflow(page);
  expect(overflow.document, `${label}: horizontal scroll (scrollWidth - clientWidth), outside: ${overflow.outside.join(' | ')}`).toBeLessThanOrEqual(0);
  expect(overflow.outside, `${label}: elements outside the viewport`).toEqual([]);
  return overflow;
}

export interface Target {
  /** Accessible-ish name for the report. */
  label: string;
  tag: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** A text link inside a paragraph (exempt from the size rule). */
  inline: boolean;
  touchAction: string;
  /** The element is a radio/checkbox whose label is the target. */
  viaLabel: boolean;
  /** Fully inside the viewport horizontally. */
  inViewport: boolean;
  /** Index of the enclosing fieldset (a segmented control), -1 outside one. */
  group: number;
  /** Another element is on top of its centre (a sheet over the page): a finger cannot hit it. */
  covered: boolean;
}

/** Every visible interactive element of the page with the box a finger has to hit. */
export async function readTargets(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const seen = new Set<Element>();
    const result: Target[] = [];
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], summary';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      let target: HTMLElement = element;
      let viaLabel = false;
      if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
        const label = element.closest('label');
        if (label) {
          target = label as HTMLElement;
          viaLabel = true;
        }
      }
      if (seen.has(target)) continue;
      seen.add(target);
      const style = getComputedStyle(target);
      if (style.display === 'none' || style.visibility === 'hidden' || target.closest('[inert], [hidden], [aria-hidden=true]')) continue;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const name = (element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('placeholder') ?? element.id ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      result.push({
        label: name || element.tagName.toLowerCase(),
        tag: element.tagName.toLowerCase() + (element instanceof HTMLInputElement ? `[${element.type}]` : ''),
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        x: Math.round(box.x),
        y: Math.round(box.y),
        inline: element.tagName === 'A' && Boolean(element.closest('p')) && style.display === 'inline',
        touchAction: style.touchAction,
        viaLabel,
        inViewport: box.left >= -1 && box.right <= window.innerWidth + 1,
        covered: (() => {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
          const hit = document.elementFromPoint(cx, cy);
          return Boolean(hit && hit !== target && !target.contains(hit) && !hit.contains(target));
        })(),
        group: [...document.querySelectorAll('fieldset')].indexOf(element.closest('fieldset') as HTMLFieldSetElement),
      });
    }
    return result;
  });
}

/** Targets smaller than `min` css px in their smaller dimension (inline text links excepted). */
export function smallTargets(targets: Target[], min = 44): Target[] {
  return targets.filter((target) => !target.inline && !target.covered && Math.min(target.width, target.height) < min - 0.5);
}

/** Pairs of targets with less than `gap` px between them (overlapping or nested pairs are not adjacent). */
export function crowdedTargets(targets: Target[], gap = 8): Array<[Target, Target, number]> {
  const pairs: Array<[Target, Target, number]> = [];
  const hittable = targets.filter((target) => !target.covered);
  for (let first = 0; first < hittable.length; first++) {
    for (let second = first + 1; second < hittable.length; second++) {
      const a = hittable[first]!;
      const b = hittable[second]!;
      const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
      const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
      const overlapping = Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width) - 0.5 && Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height) - 0.5;
      const distance = Math.hypot(dx, dy);
      // Options of one segmented control (a fieldset) are joined by design; the rule is about separate controls.
      const sameGroup = a.group >= 0 && a.group === b.group;
      if (!overlapping && !sameGroup && distance < gap) pairs.push([a, b, Math.round(distance * 10) / 10]);
    }
  }
  return pairs;
}

export interface TextFacts {
  /** Smallest computed font size of visible text (px). */
  minFontPx: number;
  /** The element with that size. */
  smallest: string;
  viewportMeta: string;
}

/** Smallest visible text and the viewport meta. */
export async function readTextFacts(page: Page): Promise<TextFacts> {
  return page.evaluate(() => {
    let min = Infinity;
    let smallest = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('.u-sr-only, script, style, noscript')) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = parent.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const size = parseFloat(style.fontSize);
      if (size < min) {
        min = size;
        smallest = `${text.slice(0, 30)} (${parent.tagName.toLowerCase()}.${(parent.className?.toString() ?? '').split(/\s+/)[0] ?? ''})`;
      }
    }
    return { minFontPx: min, smallest, viewportMeta: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '' };
  });
}
