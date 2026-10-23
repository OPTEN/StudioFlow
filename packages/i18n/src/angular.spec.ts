import {
  Injector,
  computed,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type EnvironmentInjector,
  type Signal,
} from '@angular/core';
import { createI18n, type I18n } from './angular';
import { LOCALE_STORAGE_KEY } from './locales';
import {
  getLocale,
  initLocale,
  installLocaleReader,
  resetLocaleForTests,
  setLocaleSetting,
  type LocaleStorage,
} from './store';
import { t } from './translate';

function memoryStorage(): LocaleStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

/** An injection context whose end the test controls. */
function injectionContext(): { run: <T>(fn: () => T) => T; destroy: () => void } {
  const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
  const injector = createEnvironmentInjector([], parent);
  return {
    run: (fn) => runInInjectionContext(injector, fn),
    destroy: () => injector.destroy(),
  };
}

describe('t() inside a computed()', () => {
  it('recomputes after the locale reader reports another locale', () => {
    const locale = signal(getLocale());
    installLocaleReader(() => locale());
    const title: Signal<string> = computed(() => t('common.cancel'));
    expect(title()).toBe('Cancel');
    locale.set('de-CH');
    expect(title()).toBe('Abbrechen');
  });
});

describe('createI18n', () => {
  it('exposes the locale and the setting as signals that follow setSetting', () => {
    const context = injectionContext();
    initLocale({ storage: memoryStorage(), languages: ['en'], document: null });
    const i18n: I18n = context.run(() => createI18n());
    const title = computed(() => t('common.cancel'));
    expect(i18n.locale()).toBe('en');
    expect(i18n.setting()).toBe('auto');
    expect(title()).toBe('Cancel');

    i18n.setSetting('de-CH');
    expect(i18n.locale()).toBe('de-CH');
    expect(i18n.setting()).toBe('de-CH');
    expect(title()).toBe('Abbrechen');

    i18n.setSetting('auto');
    expect(i18n.locale()).toBe('en');
    expect(i18n.setting()).toBe('auto');
    expect(title()).toBe('Cancel');
  });

  it('lists the supported locales with their native names', () => {
    const i18n = injectionContext().run(() => createI18n());
    expect(i18n.locales.map((info) => info.tag)).toEqual(['en', 'de-CH']);
    expect(i18n.locales.map((info) => info.nativeName)).toEqual(['English', 'Deutsch (Schweiz)']);
  });

  it('follows a change made elsewhere, like another tab', () => {
    const context = injectionContext();
    const i18n = context.run(() => createI18n());
    setLocaleSetting('de-CH');
    expect(i18n.locale()).toBe('de-CH');
    expect(getLocale()).toBe('de-CH');
  });

  it('starts the store with the options it is given', () => {
    const storage = memoryStorage();
    storage.values.set(LOCALE_STORAGE_KEY, 'de-CH');
    const i18n = injectionContext().run(() =>
      createI18n({ storage, languages: ['en'], document: null }),
    );
    expect(i18n.locale()).toBe('de-CH');
    i18n.setSetting('en');
    expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('uninstalls its reader and stops listening when the injector is destroyed', () => {
    const context = injectionContext();
    const i18n = context.run(() => createI18n());
    context.destroy();
    setLocaleSetting('de-CH');
    expect(i18n.locale()).toBe('en');
    expect(getLocale()).toBe('de-CH');
    resetLocaleForTests('en');
  });
});
