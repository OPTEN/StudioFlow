import { Injectable, inject } from '@angular/core';
import { BROWSER_STORAGE } from '../core/ui/preferences.service';
import { SETTINGS_HOME, SETTINGS_NAV } from './settings-nav';

/** Storage key of the settings page this browser opened last. */
export const SETTINGS_PAGE_KEY = 'studioflow.settingsPage';

/** The pages under `/settings/…` (not the diagnostics, which the gear never opens by itself). */
const SETTINGS_PAGES: ReadonlySet<string> = new Set(
  SETTINGS_NAV.flatMap((group) => group.items)
    .map((item) => item.path)
    .filter((path) => path.startsWith('/settings/')),
);

/**
 * Remembers the settings page this browser looked at last, so `/settings` (the gear in the toolbar) opens it again, as
 * System Settings does. Only known pages are kept; storage that is missing or blocked falls back to the first page.
 */
@Injectable({ providedIn: 'root' })
export class SettingsMemoryService {
  private readonly storage = inject(BROWSER_STORAGE);

  /** Notes a visited page; anything that is not a settings page is ignored. */
  remember(url: string): void {
    const path = url.split(/[?#]/)[0] ?? '';
    if (!SETTINGS_PAGES.has(path)) {
      return;
    }
    try {
      this.storage()?.setItem(SETTINGS_PAGE_KEY, path);
    } catch {
      // Without storage the settings open on the first page.
    }
  }

  /** The page `/settings` leads to. */
  lastPage(): string {
    try {
      const stored = this.storage()?.getItem(SETTINGS_PAGE_KEY) ?? null;
      return stored !== null && SETTINGS_PAGES.has(stored) ? stored : SETTINGS_HOME;
    } catch {
      return SETTINGS_HOME;
    }
  }
}
