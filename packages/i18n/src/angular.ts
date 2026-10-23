import {
  DestroyRef,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import {
  LOCALES,
  SUPPORTED_LOCALES,
  type Locale,
  type LocaleInfo,
  type LocaleSetting,
} from './locales';
import {
  getLocaleSetting,
  initLocale,
  installLocaleReader,
  onLocaleChange,
  setLocaleSetting,
  type InitOptions,
} from './store';

/** The language of the running app as signals, plus the one way to change it. */
export interface I18n {
  /** The active locale. */
  readonly locale: Signal<Locale>;
  /** What the user chose, which may be `auto`. */
  readonly setting: Signal<LocaleSetting>;
  /** All locales with their native names, for the language select. */
  readonly locales: readonly LocaleInfo[];
  /** Changes the language everywhere without a reload. */
  setSetting(setting: LocaleSetting): void;
}

/**
 * Starts the store, mirrors it into signals and installs them as the locale reader of `t()`, so every `t()` call in a
 * `computed()` or a template depends on the locale. Torn down with the injector that owns it.
 */
export function createI18n(options?: InitOptions): I18n {
  const locale = signal<Locale>(initLocale(options));
  const setting = signal<LocaleSetting>(getLocaleSetting());
  installLocaleReader(() => locale());
  const unsubscribe = onLocaleChange((next) => {
    locale.set(next);
    setting.set(getLocaleSetting());
  });
  inject(DestroyRef).onDestroy(() => {
    unsubscribe();
    installLocaleReader(null);
  });
  return {
    locale: locale.asReadonly(),
    setting: setting.asReadonly(),
    locales: SUPPORTED_LOCALES.map((tag) => LOCALES[tag]),
    setSetting: (next) => {
      setLocaleSetting(next);
    },
  };
}

export const I18N = new InjectionToken<I18n>('I18N', {
  providedIn: 'root',
  factory: () => createI18n(),
});

/** The {@link I18n} of the app. */
export function injectI18n(): I18n {
  return inject(I18N);
}

/** Starts the locale before the first render. Add it to `ApplicationConfig.providers`. */
export function provideI18n(options?: InitOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: I18N, useFactory: () => createI18n(options) },
    provideAppInitializer(() => {
      inject(I18N);
    }),
  ]);
}
