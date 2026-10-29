import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../../testing/store-harness';
import { BROWSER_STORAGE, PREFERENCE_KEYS } from './preferences.service';
import { SYSTEM_LIGHT_QUERY, ThemeService } from './theme.service';

/** A `MediaQueryList` whose result the test flips. */
class FakeMediaQueryList extends EventTarget {
  constructor(public matches: boolean) {
    super();
  }

  flip(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(Object.assign(new Event('change'), { matches }));
  }
}

describe('ThemeService', () => {
  let storage: MemoryStorage;
  let system: FakeMediaQueryList;
  const matchMedia = window.matchMedia;

  beforeEach(() => {
    storage = new MemoryStorage();
    system = new FakeMediaQueryList(false);
    window.matchMedia = ((query: string) => {
      expect(query).toBe(SYSTEM_LIGHT_QUERY);
      return system;
    }) as unknown as typeof window.matchMedia;
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: () => storage }],
    });
  });

  afterEach(() => {
    window.matchMedia = matchMedia;
    document.documentElement.removeAttribute('data-theme');
  });

  function start(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  const attribute = (): string | undefined => document.documentElement.dataset['theme'];

  it('is dark when nothing is stored, even if the system prefers light', () => {
    system.matches = true;
    const service = start();
    expect(service.setting()).toBe('dark');
    expect(service.resolved()).toBe('dark');
    expect(attribute()).toBe('dark');
  });

  it('is dark for a stored value it does not know', () => {
    storage.setItem(PREFERENCE_KEYS.theme, 'sepia');
    const service = start();
    expect(service.setting()).toBe('dark');
    expect(attribute()).toBe('dark');
  });

  it('reads a stored choice at start', () => {
    storage.setItem(PREFERENCE_KEYS.theme, 'light');
    const service = start();
    expect(service.setting()).toBe('light');
    expect(attribute()).toBe('light');
  });

  it('applies a choice at once and stores it', () => {
    const service = start();
    service.choose('light');
    TestBed.tick();
    expect(attribute()).toBe('light');
    expect(storage.getItem(PREFERENCE_KEYS.theme)).toBe('light');
    service.choose('dark');
    TestBed.tick();
    expect(attribute()).toBe('dark');
    expect(storage.getItem(PREFERENCE_KEYS.theme)).toBe('dark');
  });

  it('follows the system setting live while System is chosen', () => {
    const service = start();
    service.choose('system');
    TestBed.tick();
    expect(service.resolved()).toBe('dark');
    system.flip(true);
    TestBed.tick();
    expect(service.resolved()).toBe('light');
    expect(attribute()).toBe('light');
    system.flip(false);
    TestBed.tick();
    expect(attribute()).toBe('dark');
    expect(service.setting()).toBe('system');
  });

  it('starts in light when System is stored and the system prefers light', () => {
    storage.setItem(PREFERENCE_KEYS.theme, 'system');
    system.matches = true;
    start();
    expect(attribute()).toBe('light');
  });

  it('ignores the system setting while Dark or Light is chosen', () => {
    const service = start();
    service.choose('light');
    system.flip(false);
    TestBed.tick();
    expect(attribute()).toBe('light');
    service.choose('dark');
    system.flip(true);
    TestBed.tick();
    expect(attribute()).toBe('dark');
  });

  it('follows a change made in another tab', () => {
    const service = start();
    storage.setItem(PREFERENCE_KEYS.theme, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCE_KEYS.theme }));
    TestBed.tick();
    expect(service.setting()).toBe('light');
    expect(attribute()).toBe('light');
  });

  it('follows another tab clearing the storage, and ignores other keys', () => {
    storage.setItem(PREFERENCE_KEYS.theme, 'light');
    const service = start();
    storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCE_KEYS.studioMode }));
    expect(service.setting()).toBe('light');
    storage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    TestBed.tick();
    expect(service.setting()).toBe('dark');
    expect(attribute()).toBe('dark');
  });

  it('stops listening when the injector is destroyed', () => {
    const service = start();
    TestBed.resetTestingModule();
    storage.setItem(PREFERENCE_KEYS.theme, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCE_KEYS.theme }));
    system.flip(true);
    expect(service.setting()).toBe('dark');
  });

  describe('browser chrome colour', () => {
    let meta: HTMLMetaElement;

    beforeEach(() => {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#0d1117';
      document.head.append(meta);
    });

    afterEach(() => meta.remove());

    it('is the Panel colour of the dark theme', () => {
      start();
      expect(meta.content).toBe('#1e1e21');
    });

    it('is the Panel colour of the light theme, at start and after a choice', () => {
      storage.setItem(PREFERENCE_KEYS.theme, 'light');
      const service = start();
      expect(meta.content).toBe('#f7f7f9');
      service.choose('dark');
      TestBed.tick();
      expect(meta.content).toBe('#1e1e21');
      service.choose('light');
      TestBed.tick();
      expect(meta.content).toBe('#f7f7f9');
    });

    it('follows the system setting live while System is chosen', () => {
      storage.setItem(PREFERENCE_KEYS.theme, 'system');
      start();
      expect(meta.content).toBe('#1e1e21');
      system.flip(true);
      TestBed.tick();
      expect(meta.content).toBe('#f7f7f9');
      system.flip(false);
      TestBed.tick();
      expect(meta.content).toBe('#1e1e21');
    });

    it('follows a change made in another tab', () => {
      start();
      storage.setItem(PREFERENCE_KEYS.theme, 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCE_KEYS.theme }));
      TestBed.tick();
      expect(meta.content).toBe('#f7f7f9');
    });

    it('is not created when the page has no theme-color meta', () => {
      meta.remove();
      start();
      expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    });
  });

  it('works without matchMedia', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    storage.setItem(PREFERENCE_KEYS.theme, 'system');
    const service = start();
    expect(service.resolved()).toBe('dark');
  });
});
