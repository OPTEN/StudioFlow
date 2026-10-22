import { expect, type Page } from '@playwright/test';
import { describeActive, describeActiveSettled, labelOf, type FocusInfo } from './focus';

/** Keyboard navigation helpers of the a11y specs. */

/** Presses Tab (or Shift+Tab with `back`) until the active element satisfies `matches`; fails after `limit` presses. */
export async function tabTo(page: Page, matches: (info: FocusInfo) => boolean, options: { limit?: number; back?: boolean; what?: string } = {}): Promise<FocusInfo> {
  const limit = options.limit ?? 120;
  const visited: string[] = [];
  for (let index = 0; index < limit; index++) {
    await page.keyboard.press(options.back ? 'Shift+Tab' : 'Tab');
    const info = await describeActiveSettled(page, 250);
    if (!info) continue;
    if (matches(info)) return info;
    visited.push(labelOf(info));
  }
  throw new Error(`${options.what ?? 'the target'} was not reached by ${options.back ? 'Shift+' : ''}Tab within ${limit} presses; visited: ${visited.slice(-8).join(' > ')}`);
}

export const byName = (name: string | RegExp, role?: string) => (info: FocusInfo): boolean =>
  (role === undefined || info.role === role) && (typeof name === 'string' ? info.name === name : name.test(info.name));

/** The accessible name and role of what has the focus right now (for assertions). */
export async function focused(page: Page): Promise<FocusInfo> {
  const info = await describeActive(page);
  expect(info, 'something has the focus').not.toBeNull();
  return info!;
}

/** Moves the sequential focus starting point to the top of the document (the next Tab reaches the first stop). */
export async function focusTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
    const marker = document.createElement('span');
    marker.tabIndex = -1;
    document.body.prepend(marker);
    marker.focus();
    marker.remove();
  });
}
