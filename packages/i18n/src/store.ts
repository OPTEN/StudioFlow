import {
  LOCALE_STORAGE_KEY,
  parseLocaleSetting,
  resolveLocale,
  type Locale,
  type LocaleSetting,
} from './locales';
import { resetDiagnostics } from './diagnostics';

/** The parts of `Storage` the store needs. */
export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What the store reads from and writes to; every field has a browser default. */
export interface InitOptions {
  /** Where the setting is persisted. `null` disables persistence. Default: `localStorage` (guarded). */
  storage?: LocaleStorage | null;
  /** Browser language preferences used by `auto`. Default: `navigator.languages`. */
  languages?: readonly string[];
  /** Fixed setting that is neither read from nor written to the storage (the output page's `?lang=`). */
  setting?: LocaleSetting;
  /** Document whose `<html lang>` follows the locale. `null` disables it. Default: `globalThis.document`. */
  document?: Document | null;
}

/** Called after the setting or the locale changed. */
export type LocaleListener = (locale: Locale) => void;

interface StoreState {
  initialised: boolean;
  setting: LocaleSetting;
  locale: Locale;
  fixedSetting: boolean;
  storage: LocaleStorage | null;
  languages: readonly string[];
  document: Document | null;
  reader: (() => Locale) | null;
  removeStorageListener: (() => void) | null;
}

const state: StoreState = {
  initialised: false,
  setting: 'auto',
  locale: 'en',
  fixedSetting: false,
  storage: null,
  languages: [],
  document: null,
  reader: null,
  removeStorageListener: null,
};
const listeners = new Set<LocaleListener>();

function defaultStorage(): LocaleStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked site data, private windows and sandboxed frames throw on access.
    return null;
  }
}

function defaultLanguages(): readonly string[] {
  try {
    const languages = globalThis.navigator?.languages;
    return languages?.length ? languages : [globalThis.navigator?.language ?? ''];
  } catch {
    return [];
  }
}

function readStoredSetting(storage: LocaleStorage | null): LocaleSetting {
  try {
    return parseLocaleSetting(storage?.getItem(LOCALE_STORAGE_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}

function writeStoredSetting(storage: LocaleStorage | null, setting: LocaleSetting): void {
  try {
    if (setting === 'auto') {
      storage?.removeItem(LOCALE_STORAGE_KEY);
    } else {
      storage?.setItem(LOCALE_STORAGE_KEY, setting);
    }
  } catch {
    // The choice then only lasts until the page is closed.
  }
}

function syncDocumentLanguage(): void {
  const root = state.document?.documentElement;
  if (root && root.lang !== state.locale) {
    root.lang = state.locale;
  }
}

function notify(): void {
  for (const listener of [...listeners]) {
    listener(state.locale);
  }
}

/** Applies a setting; true when the setting or the resulting locale changed. */
function apply(setting: LocaleSetting): boolean {
  const locale = resolveLocale(setting, state.languages);
  const changed = setting !== state.setting || locale !== state.locale;
  state.setting = setting;
  state.locale = locale;
  syncDocumentLanguage();
  return changed;
}

/** Another tab changed the setting: follow it live. */
function listenToStorage(): (() => void) | null {
  const target = globalThis as Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
  if (
    typeof target.addEventListener !== 'function' ||
    typeof target.removeEventListener !== 'function'
  ) {
    return null;
  }
  const handler = (event: Event): void => {
    const { key } = event as StorageEvent;
    if (state.fixedSetting || (key !== null && key !== LOCALE_STORAGE_KEY)) {
      return;
    }
    if (apply(readStoredSetting(state.storage))) {
      notify();
    }
  };
  target.addEventListener('storage', handler);
  return () => target.removeEventListener?.('storage', handler);
}

/**
 * Reads the setting (`options.setting`, else the storage, else `auto`), resolves the locale and starts following the
 * `storage` event of other tabs. Calling it without options after the store was initialised changes nothing, so an
 * app and a test setup can both call it; calling it with options starts over.
 */
export function initLocale(options?: InitOptions): Locale {
  if (state.initialised && options === undefined) {
    return state.locale;
  }
  state.removeStorageListener?.();
  state.initialised = true;
  state.fixedSetting = options?.setting !== undefined;
  state.storage = options?.storage === undefined ? defaultStorage() : options.storage;
  state.languages = options?.languages ?? defaultLanguages();
  state.document =
    options?.document === undefined ? (globalThis.document ?? null) : options.document;
  state.setting = 'auto';
  apply(options?.setting ?? readStoredSetting(state.storage));
  state.removeStorageListener = state.fixedSetting || !state.storage ? null : listenToStorage();
  return state.locale;
}

/**
 * The active locale. With an installed reader (the Angular glue) it comes from a signal, so every `t()` call made in a
 * `computed()` or a template re-evaluates when the locale changes.
 */
export function getLocale(): Locale {
  return state.reader?.() ?? state.locale;
}

/** What the user chose, which may be `auto`. */
export function getLocaleSetting(): LocaleSetting {
  return state.setting;
}

/**
 * Chooses a language: `auto` removes the stored key, anything else writes it. Listeners run when the setting or the
 * locale changed. Returns the resulting locale.
 */
export function setLocaleSetting(setting: LocaleSetting): Locale {
  initLocale();
  if (!state.fixedSetting) {
    writeStoredSetting(state.storage, setting);
  }
  if (apply(setting)) {
    notify();
  }
  return state.locale;
}

/** Subscribes to changes of the setting or the locale; returns the unsubscribe function. */
export function onLocaleChange(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lets a reactive framework supply the locale (see `@studioflow/i18n/angular`); `null` uninstalls it. */
export function installLocaleReader(reader: (() => Locale) | null): void {
  state.reader = reader;
}

/**
 * Test helper: forget everything and run in `setting` (default English) without storage, browser languages or
 * document, so a test never depends on or leaks the environment. Listeners and the reader are dropped too.
 */
export function resetLocaleForTests(setting: LocaleSetting = 'en'): void {
  state.removeStorageListener?.();
  state.removeStorageListener = null;
  listeners.clear();
  resetDiagnostics();
  state.reader = null;
  state.initialised = true;
  state.fixedSetting = true;
  state.storage = null;
  state.languages = [];
  state.document = null;
  state.setting = 'auto';
  apply(setting);
}
