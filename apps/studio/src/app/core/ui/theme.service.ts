import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { PREFERENCE_KEYS, PreferencesService, type ThemeSetting } from './preferences.service';

/** The theme that is on screen. `system` is resolved to one of these. */
export type ResolvedTheme = 'dark' | 'light';

/** Media query that is true when the system asks for a light appearance. */
export const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * The appearance of the Regie, `/monitoring` and the login page (Dark, Light or System; default Dark). The choice is
 * kept per browser in `studioflow.theme`; a change in another tab is followed live, and System follows the system
 * setting live. The resolved theme is written to `<html data-theme>`, where the token sets in styles/_tokens.scss
 * pick it up. public/theme-init.js sets the same attribute before the first paint.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly preferences = inject(PreferencesService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly chosen = signal<ThemeSetting>(this.preferences.readTheme());
  private readonly systemLight = this.watchSystemLight();

  /** What the user chose. */
  readonly setting: Signal<ThemeSetting> = this.chosen.asReadonly();
  /** The theme on screen. */
  readonly resolved: Signal<ResolvedTheme> = computed(() => {
    const setting = this.chosen();
    return setting === 'system' ? (this.systemLight() ? 'light' : 'dark') : setting;
  });

  constructor() {
    effect(() => {
      this.document.documentElement.dataset['theme'] = this.resolved();
    });
    this.followOtherTabs();
  }

  /** Chooses the appearance; it applies at once and is stored for the next visit. */
  choose(setting: ThemeSetting): void {
    this.chosen.set(setting);
    this.preferences.writeTheme(setting);
  }

  private watchSystemLight(): Signal<boolean> {
    const list = this.document.defaultView?.matchMedia?.(SYSTEM_LIGHT_QUERY) ?? null;
    const state = signal(list?.matches ?? false);
    if (list) {
      const listener = (event: MediaQueryListEvent): void => state.set(event.matches);
      list.addEventListener('change', listener);
      this.destroyRef.onDestroy(() => list.removeEventListener('change', listener));
    }
    return state.asReadonly();
  }

  /** Another tab changed or cleared the setting: follow it. */
  private followOtherTabs(): void {
    const view = this.document.defaultView;
    const listener = (event: StorageEvent): void => {
      if (event.key === null || event.key === PREFERENCE_KEYS.theme) {
        this.chosen.set(this.preferences.readTheme());
      }
    };
    view?.addEventListener('storage', listener);
    this.destroyRef.onDestroy(() => view?.removeEventListener('storage', listener));
  }
}
