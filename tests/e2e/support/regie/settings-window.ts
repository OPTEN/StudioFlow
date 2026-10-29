import type { Page } from '@playwright/test';

/** The pages of the settings window that a test opens through the sidebar (settings/settings-nav.ts). */
export type SettingsPath =
  | '/settings/media'
  | '/settings/network'
  | '/settings/embedding'
  | '/settings/backups'
  | '/settings/account'
  | '/settings/about'
  | '/settings/appearance'
  | '/monitoring'
  | '/audit';

/**
 * Opens a page of the settings window the way an operator does, from the control room: the gear of the toolbar opens the
 * settings window, then the page in the sidebar (client-side navigation, no reload).
 */
export async function openSettingsPage(page: Page, path: SettingsPath): Promise<void> {
  await page.locator('a.c-header__settings').click();
  await page.waitForURL((url) => url.pathname.startsWith('/settings'));
  await page.locator(`nav a[href="${path}"]`).first().click();
  await page.waitForURL((url) => url.pathname === path);
}

/** One step of the setup progress (Account → Media server → Address → Embedding → Done) is the current one. */
export const currentSetupStep = (page: Page) => page.locator('.c-steps__item[aria-current="step"]');
