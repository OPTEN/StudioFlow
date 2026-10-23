import { LOCALE_STORAGE_KEY } from './locales';
import {
  getLocale,
  getLocaleSetting,
  initLocale,
  installLocaleReader,
  onLocaleChange,
  resetLocaleForTests,
  setLocaleSetting,
  type LocaleStorage,
} from './store';

class MemoryStorage implements LocaleStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const brokenStorage: LocaleStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

function fakeDocument(): Document {
  return { documentElement: { lang: '' } } as unknown as Document;
}

function sendStorageEvent(key: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

describe('initLocale', () => {
  it('follows the browser language when nothing is stored', () => {
    expect(
      initLocale({ storage: new MemoryStorage(), languages: ['de-AT', 'en'], document: null }),
    ).toBe('de-CH');
    expect(getLocaleSetting()).toBe('auto');
  });

  it('prefers the stored setting over the browser language', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(initLocale({ storage, languages: ['de-CH'], document: null })).toBe('en');
    expect(getLocaleSetting()).toBe('en');
  });

  it('ignores a stored value it does not know', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(initLocale({ storage, languages: ['de'], document: null })).toBe('de-CH');
    expect(getLocaleSetting()).toBe('auto');
  });

  it('uses a fixed setting without reading or writing the storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(initLocale({ setting: 'de-CH', storage, document: null })).toBe('de-CH');
    expect(setLocaleSetting('de-CH')).toBe('de-CH');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    sendStorageEvent(LOCALE_STORAGE_KEY);
    expect(getLocale()).toBe('de-CH');
  });

  it('survives storage that throws', () => {
    expect(initLocale({ storage: brokenStorage, languages: ['de'], document: null })).toBe('de-CH');
    expect(setLocaleSetting('en')).toBe('en');
    expect(getLocale()).toBe('en');
  });

  it('keeps the state when called again without options', () => {
    initLocale({ storage: new MemoryStorage(), languages: ['de'], document: null });
    setLocaleSetting('en');
    expect(initLocale()).toBe('en');
    expect(getLocaleSetting()).toBe('en');
  });

  it('starts over when called with options', () => {
    initLocale({ storage: new MemoryStorage(), languages: ['de'], document: null });
    expect(initLocale({ storage: new MemoryStorage(), languages: ['en'], document: null })).toBe(
      'en',
    );
  });

  it('sets <html lang> on init and on every change', () => {
    const document = fakeDocument();
    initLocale({ storage: new MemoryStorage(), languages: ['de'], document });
    expect(document.documentElement.lang).toBe('de-CH');
    setLocaleSetting('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('setLocaleSetting', () => {
  it('writes the choice and removes the key for auto', () => {
    const storage = new MemoryStorage();
    initLocale({ storage, languages: ['en'], document: null });
    expect(setLocaleSetting('de-CH')).toBe('de-CH');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('de-CH');
    expect(setLocaleSetting('auto')).toBe('en');
    expect(storage.values.has(LOCALE_STORAGE_KEY)).toBe(false);
  });

  it('notifies listeners when the setting or the locale changes, and not otherwise', () => {
    initLocale({ storage: new MemoryStorage(), languages: ['en'], document: null });
    const seen: string[] = [];
    const stop = onLocaleChange((locale) => seen.push(locale));
    setLocaleSetting('de-CH');
    setLocaleSetting('de-CH');
    setLocaleSetting('auto');
    setLocaleSetting('en');
    expect(seen).toEqual(['de-CH', 'en', 'en']);
    stop();
    setLocaleSetting('de-CH');
    expect(seen).toHaveLength(3);
  });

  it('initialises the store on first use', () => {
    resetLocaleForTests('en');
    expect(setLocaleSetting('de-CH')).toBe('de-CH');
  });
});

describe('storage event', () => {
  it('switches the locale when another tab changes the key', () => {
    const storage = new MemoryStorage();
    initLocale({ storage, languages: ['en'], document: null });
    const seen: string[] = [];
    onLocaleChange((locale) => seen.push(locale));
    storage.setItem(LOCALE_STORAGE_KEY, 'de-CH');
    sendStorageEvent(LOCALE_STORAGE_KEY);
    expect(getLocale()).toBe('de-CH');
    storage.removeItem(LOCALE_STORAGE_KEY);
    sendStorageEvent(LOCALE_STORAGE_KEY);
    expect(getLocale()).toBe('en');
    expect(seen).toEqual(['de-CH', 'en']);
  });

  it('follows a cleared storage and ignores other keys', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCALE_STORAGE_KEY, 'de-CH');
    initLocale({ storage, languages: ['en'], document: null });
    sendStorageEvent('something-else');
    expect(getLocale()).toBe('de-CH');
    storage.removeItem(LOCALE_STORAGE_KEY);
    sendStorageEvent(null);
    expect(getLocale()).toBe('en');
  });

  it('adds the listener once however often the store starts', () => {
    const storage = new MemoryStorage();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    initLocale({ storage, languages: ['en'], document: null });
    initLocale({ storage, languages: ['en'], document: null });
    const added = add.mock.calls.filter(([type]) => type === 'storage').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'storage').length;
    expect(added - removed).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('locale reader', () => {
  it('overrides the stored locale while installed', () => {
    resetLocaleForTests('en');
    installLocaleReader(() => 'de-CH');
    expect(getLocale()).toBe('de-CH');
    installLocaleReader(null);
    expect(getLocale()).toBe('en');
  });
});

describe('resetLocaleForTests', () => {
  it('runs in the given setting without storage, languages or document', () => {
    const storage = new MemoryStorage();
    initLocale({ storage, languages: ['de'], document: null });
    resetLocaleForTests('de-CH');
    expect(getLocale()).toBe('de-CH');
    setLocaleSetting('en');
    expect(storage.values.size).toBe(0);
  });

  it('defaults to English and drops listeners and the reader', () => {
    const listener = vi.fn();
    onLocaleChange(listener);
    installLocaleReader(() => 'de-CH');
    resetLocaleForTests();
    expect(getLocale()).toBe('en');
    setLocaleSetting('de-CH');
    expect(listener).not.toHaveBeenCalled();
  });

  it('accepts auto, which resolves to English without browser languages', () => {
    resetLocaleForTests('auto');
    expect(getLocale()).toBe('en');
    expect(getLocaleSetting()).toBe('auto');
  });
});
