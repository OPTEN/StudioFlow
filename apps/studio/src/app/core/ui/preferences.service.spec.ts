import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../../testing/store-harness';
import { BROWSER_STORAGE, PREFERENCE_KEYS, PreferencesService } from './preferences.service';

function setup(storage: () => Storage | null): PreferencesService {
  TestBed.configureTestingModule({ providers: [{ provide: BROWSER_STORAGE, useValue: storage }] });
  return TestBed.inject(PreferencesService);
}

/** Storage whose every method throws (Safari private mode, blocked site data). */
class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException('denied', 'SecurityError');
  }

  override setItem(): void {
    throw new DOMException('full', 'QuotaExceededError');
  }

  override removeItem(): void {
    throw new DOMException('denied', 'SecurityError');
  }
}

describe('PreferencesService', () => {
  it('stores and reads Studio-Modus, transition and layout', () => {
    const storage = new MemoryStorage();
    const preferences = setup(() => storage);
    expect(preferences.readStudioMode()).toBe(false);
    preferences.writeStudioMode(true);
    expect(storage.getItem(PREFERENCE_KEYS.studioMode)).toBe('1');
    expect(preferences.readStudioMode()).toBe(true);

    expect(preferences.readTransition()).toEqual({ kind: 'fade', durationMs: 300 });
    preferences.writeTransition({ kind: 'cut', durationMs: 800 });
    expect(preferences.readTransition()).toEqual({ kind: 'cut', durationMs: 800 });

    preferences.writeLayout({ v: 1 });
    expect(preferences.readLayout()).toEqual({ v: 1 });
    preferences.clearLayout();
    expect(preferences.readLayout()).toBeNull();
  });

  it('stores and reads the theme, which defaults to dark and survives a layout reset', () => {
    const storage = new MemoryStorage();
    const preferences = setup(() => storage);
    expect(preferences.readTheme()).toBe('dark');
    for (const theme of ['light', 'system', 'dark'] as const) {
      preferences.writeTheme(theme);
      expect(storage.getItem(PREFERENCE_KEYS.theme)).toBe(theme);
      expect(preferences.readTheme()).toBe(theme);
    }
    preferences.writeTheme('light');
    preferences.writeLayout({ v: 1 });
    preferences.clearLayout();
    expect(preferences.readTheme()).toBe('light');
  });

  it('falls back to dark for an unknown theme', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCE_KEYS.theme, 'Light');
    expect(setup(() => storage).readTheme()).toBe('dark');
  });

  it('falls back to defaults for corrupt values', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCE_KEYS.transition, '{"kind":"wipe","durationMs":123}');
    storage.setItem(PREFERENCE_KEYS.layout, '{not json');
    const preferences = setup(() => storage);
    expect(preferences.readTransition()).toEqual({ kind: 'fade', durationMs: 300 });
    expect(preferences.readLayout()).toBeNull();
  });

  it('never throws when the storage throws', () => {
    const preferences = setup(() => new ThrowingStorage());
    expect(preferences.readStudioMode()).toBe(false);
    expect(() => preferences.writeStudioMode(true)).not.toThrow();
    expect(() => preferences.writeLayout({ v: 1 })).not.toThrow();
    expect(() => preferences.clearLayout()).not.toThrow();
    expect(preferences.readTheme()).toBe('dark');
    expect(() => preferences.writeTheme('light')).not.toThrow();
    expect(preferences.readTransition()).toEqual({ kind: 'fade', durationMs: 300 });
  });

  it('never throws when even the storage accessor throws or is missing', () => {
    const throwing = setup(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(throwing.readStudioMode()).toBe(false);
    expect(() => throwing.writeTransition({ kind: 'fade', durationMs: 500 })).not.toThrow();

    TestBed.resetTestingModule();
    const missing = setup(() => null);
    expect(missing.readLayout()).toBeNull();
    expect(() => missing.writeStudioMode(false)).not.toThrow();
  });
});
