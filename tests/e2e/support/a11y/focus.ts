import type { Page } from '@playwright/test';

/**
 * Keyboard focus helpers (docs/testing.md E2E-DEV-13): what has the focus, is it visible, and the sequence of
 * `Tab` stops of a page.
 */

export interface FocusRing {
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  outlineOffset: number;
  boxShadow: string;
  backgroundColor: string;
  borderColor: string;
  /**
   * Which indicator the element shows: the 2 px blue outline, the blue hairline of a splitter, a blue border (fields),
   * the 2 px blue outline on the row it stretches over (`container`, drawn with `:has(:focus-visible)`), the accent fill
   * of a system-style menu row (`highlight`) or none.
   */
  kind: 'outline' | 'hairline' | 'border' | 'container' | 'highlight' | 'none';
  /** kind !== none */
  visible: boolean;
}

export interface FocusInfo {
  tag: string;
  role: string;
  /** Accessible name (aria-label, aria-labelledby, label, text, title). */
  name: string;
  testid: string | null;
  className: string;
  rect: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
  ring: FocusRing;
  /** The element lives in a dock zone (`left`, `bottom`, `right`) or null. */
  zone: string | null;
  /** The section it belongs to: `banner`, `region:<name>`, ... (nearest landmark). */
  area: string;
  /** The labelled region (dock, monitor, activity bar) around it, also when a labelled group sits in between. */
  region: string | null;
  tabindex: string | null;
}

/** Reads what the page's active element is and how it looks (runs in the page). */
export function describeActive(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body || element === document.documentElement) return null;
    const attr = (target: Element, name: string) => target.getAttribute(name);
    const textOf = (target: Element) => (target as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '';
    const nameOf = (target: HTMLElement): string => {
      const label = attr(target, 'aria-label');
      if (label) return label;
      const labelledby = attr(target, 'aria-labelledby');
      if (labelledby) {
        const text = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }
      const labels = (target as HTMLInputElement).labels;
      if (labels && labels.length > 0) return Array.from(labels).map((entry) => entry.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' ').trim();
      return textOf(target) || attr(target, 'title') || attr(target, 'alt') || '';
    };
    const roleOf = (target: HTMLElement): string => {
      const explicit = attr(target, 'role');
      if (explicit) return explicit;
      const tag = target.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = (target as HTMLInputElement).type;
        return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'range' ? 'slider' : type === 'button' || type === 'submit' ? 'button' : 'textbox';
      }
      return tag;
    };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    // A focus indicator may sit on the element itself, or on a pseudo-element/sibling the stylesheet drives with
    // :focus-visible (hairline splitters turn blue through their background and a box-shadow): compare with the
    // unfocused look is not possible here, so the outline, the box-shadow and a blue/background change are read.
    const outlineWidth = parseFloat(style.outlineWidth) || 0;
    // The accent of the current theme (`--blue`), resolved through a probe so a token change follows here.
    const probe = document.createElement('span');
    probe.style.color = 'var(--blue, rgb(121, 192, 255))';
    document.body.appendChild(probe);
    const BLUE = getComputedStyle(probe).color;
    probe.style.color = 'var(--blue-fill, rgb(0, 113, 227))';
    const BLUE_FILL = getComputedStyle(probe).color;
    probe.remove();
    const outlined = (target: Element) => {
      const look = getComputedStyle(target);
      return look.outlineStyle !== 'none' && (parseFloat(look.outlineWidth) || 0) >= 2 && look.outlineColor === BLUE;
    };
    const outlineVisible = outlined(element);
    const after = getComputedStyle(element, '::after');
    const hairline = element.getAttribute('role') === 'separator' && ((style.backgroundColor === BLUE && style.boxShadow.includes(BLUE)) || after.backgroundColor === BLUE);
    const border = ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && style.borderTopColor === BLUE;
    let container = false;
    for (let parent = element.parentElement, depth = 0; parent && depth < 3 && !container; parent = parent.parentElement, depth++) container = outlined(parent);
    const menuRow = ['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option'].includes(roleOf(element)) || element.classList.contains('c-menu-item');
    const highlight = menuRow && style.backgroundColor === BLUE_FILL;
    const kind = outlineVisible ? 'outline' : hairline ? 'hairline' : border ? 'border' : container ? 'container' : highlight ? 'highlight' : 'none';
    const zoneElement = element.closest('[data-zone]');
    const landmark = element.closest('header, [role=region], [role=group][aria-label], section[aria-label], main, nav, form, [role=dialog], [role=menu]');
    // the name of the landmark: its aria-label, else the text it is labelled by (the monitors name themselves by their head)
    const landmarkLabel = landmark ? (attr(landmark, 'aria-label') ?? (attr(landmark, 'aria-labelledby') ? nameOf(landmark as HTMLElement) : null)) : null;
    const landmarkName = landmark ? `${landmark.getAttribute('role') ?? landmark.tagName.toLowerCase()}${landmarkLabel ? `:${landmarkLabel}` : ''}` : 'page';
    return {
      tag: element.tagName.toLowerCase(),
      role: roleOf(element),
      name: nameOf(element),
      testid: attr(element, 'data-testid'),
      className: typeof element.className === 'string' ? element.className : '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth,
      ring: {
        outlineStyle: style.outlineStyle,
        outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: parseFloat(style.outlineOffset) || 0,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        kind: kind as FocusRing['kind'],
        visible: kind !== 'none',
      },
      zone: zoneElement?.getAttribute('data-zone') ?? null,
      area: element.closest('[role=status]') ? 'status' : landmarkName,
      region: element.closest('[role=region][aria-label]')?.getAttribute('aria-label') ?? null,
      tabindex: attr(element, 'tabindex'),
    };
  });
}

/**
 * Like {@link describeActive}, but waits (at most `timeoutMs`) for the focus indicator to appear: the hairlines of the
 * splitters turn blue through a transition with a delay (DESIGN.md), so the first read after Tab can be too early.
 */
export async function describeActiveSettled(page: Page, timeoutMs = 700): Promise<FocusInfo | null> {
  const deadline = Date.now() + timeoutMs;
  let info = await describeActive(page);
  while (info && !info.ring.visible && Date.now() < deadline) {
    await page.waitForTimeout(60);
    info = await describeActive(page);
  }
  return info;
}

/** One line for a failure message or a report. */
export function labelOf(info: FocusInfo | null): string {
  return info ? `${info.role} “${info.name.slice(0, 60)}” (${info.area})` : 'nothing (document)';
}

export interface TabStop {
  index: number;
  info: FocusInfo;
}

/**
 * Presses Tab from the top of the page (focus starts on the document) and records every stop until the focus
 * leaves the page or returns to the first stop, at most `limit` presses.
 */
export async function tabThrough(page: Page, options: { limit?: number; start?: () => Promise<void> } = {}): Promise<TabStop[]> {
  const limit = options.limit ?? 200;
  await (options.start ?? resetFocusToTop)(page);
  const stops: TabStop[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < limit; index++) {
    await page.keyboard.press('Tab');
    const info = await describeActiveSettled(page);
    if (!info) break;
    const key = `${info.role}|${info.name}|${Math.round(info.rect.x)}|${Math.round(info.rect.y)}`;
    if (seen.has(key)) break;
    seen.add(key);
    stops.push({ index, info });
  }
  return stops;
}

/** Puts the focus on the document so that the next Tab reaches the first stop of the page. */
export async function resetFocusToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
    // Tab starts at the sequential-navigation starting point: put it at the top of the document.
    const marker = document.createElement('span');
    marker.tabIndex = -1;
    document.body.prepend(marker);
    marker.focus();
    marker.remove();
  });
}
