import type { Page } from '@playwright/test';

/**
 * German text audit (docs/testing.md E2E-DEV-17): the visible text and the `aria-label`, `title`, `placeholder`, `alt`
 * of a page, and the rules for Swiss German UI text: no «ß», names quoted with « », decimal comma in durations and
 * rates, 24 h clock, no English UI words except the agreed ones.
 */

export interface TextItem {
  kind: 'text' | 'aria-label' | 'title' | 'placeholder' | 'alt' | 'aria-description';
  text: string;
  /** Tag and classes of the element holding the text. */
  where: string;
}

/** English words that must not appear as a whole UI word (the plan's list; «Station» is a German noun and allowed). */
const ENGLISH = /\b(Loading|Error|Save|Cancel|Delete|Connect|Settings|Scene|Source|Stations)\b/;
/** Agreed English terms of the product (they are not in {@link ENGLISH}, listed for the report). */
export const AGREED_ENGLISH = ['Take', 'Program', 'Preview', 'Studio-Modus', 'Stationen', 'Output', 'Dock', 'Slate', 'Tally', 'Auto-Grid', 'Blende'] as const;

/**
 * Text that looks like a rule violation but is a technical value, with the reason (an accepted finding is written
 * down, never hidden): the CSP keyword of the embedding list in the output popover.
 */
export const ACCEPTED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /'self'/, reason: "CSP source expression 'self' in the list of origins that may embed the output (technical value, not a quoted name)" },
];

export interface Violation {
  rule: string;
  text: string;
  where: string;
  kind: string;
}

/** Collects every text of the page (runs in the page). */
export async function collectTexts(page: Page): Promise<TextItem[]> {
  return page.evaluate(() => {
    const items: TextItem[] = [];
    const seen = new Set<string>();
    const describe = (element: Element | null) => {
      if (!element) return 'unknown';
      const cls = typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return element.tagName.toLowerCase() + cls;
    };
    const add = (kind: TextItem['kind'], text: string | null | undefined, element: Element | null) => {
      const value = (text ?? '').replace(/\s+/g, ' ').trim();
      if (!value) return;
      const key = `${kind}|${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ kind, text: value, where: describe(element) });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName)) continue;
      add('text', node.textContent, parent);
    }
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      add('aria-label', element.getAttribute('aria-label'), element);
      add('title', element.getAttribute('title'), element);
      add('placeholder', element.getAttribute('placeholder'), element);
      add('alt', element.getAttribute('alt'), element);
      add('aria-description', element.getAttribute('aria-description'), element);
    }
    return items;
  });
}

/** The rules of the audit applied to texts. */
export function auditTexts(items: TextItem[]): Violation[] {
  const violations: Violation[] = [];
  const flag = (rule: string, item: TextItem) => violations.push({ rule, text: item.text.slice(0, 160), where: item.where, kind: item.kind });
  for (const item of items) {
    const accepted = ACCEPTED.some((entry) => entry.pattern.test(item.text));
    if (/ß/.test(item.text)) flag('no «ß» (Swiss spelling uses «ss»)', item);
    if (/"[^"\n]{1,80}"/.test(item.text)) flag('names are quoted with « », not with straight double quotes', item);
    if (!accepted && /(^|[\s(])'[A-Za-zÄÖÜäöü][^'\n]{0,40}'([\s).,;:!?]|$)/.test(item.text)) flag('names are quoted with « », not with straight single quotes', item);
    for (const word of new Set(Array.from(item.text.matchAll(new RegExp(ENGLISH.source, 'g')), (match) => match[1]))) flag(`English UI word «${word}»`, item);
    if (/\b\d+\.\d+\s?(s|ms|Mbit\/s|kbit\/s|Kbit\/s|%|fps)(?![\w/])/.test(item.text)) flag('decimal comma, not a decimal point, in durations and rates («0,3 s», «2,8 Mbit/s»)', item);
    if (/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)\b/.test(item.text)) flag('24 h clock, no AM/PM', item);
    if (/\bundefined\b|\bNaN\b|\[object |{{|}}|\bnull\b/.test(item.text)) flag('no template or script leftovers', item);
  }
  return violations;
}
