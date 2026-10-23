import { TestBed } from '@angular/core/testing';
import { tFor } from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';
import { MemoryStorage } from '../../../testing/store-harness';
import { BROWSER_STORAGE, PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { ThemeSelectComponent } from './theme-select.component';

describe('ThemeSelectComponent', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: () => storage }],
    });
  });

  async function render(): Promise<{
    element: HTMLElement;
    buttons: HTMLButtonElement[];
    settle: () => Promise<void>;
  }> {
    const fixture = TestBed.createComponent(ThemeSelectComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      element,
      buttons: Array.from(element.querySelectorAll('button')),
      settle: () => fixture.whenStable(),
    };
  }

  const pressed = (buttons: HTMLButtonElement[]): (string | null)[] =>
    buttons.map((button) => button.getAttribute('aria-pressed'));

  it('offers Dark, Light and System in a labelled group, Dark pressed by default', async () => {
    const { element, buttons } = await render();
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Dark',
      'Light',
      'System',
    ]);
    expect(pressed(buttons)).toEqual(['true', 'false', 'false']);
    const group = element.querySelector('[role="group"]');
    const label = element.querySelector(`#${group?.getAttribute('aria-labelledby')}`);
    expect(label?.textContent).toBe('Appearance');
  });

  it('shows the stored choice', async () => {
    storage.setItem(PREFERENCE_KEYS.theme, 'system');
    const { buttons } = await render();
    expect(pressed(buttons)).toEqual(['false', 'false', 'true']);
  });

  it('applies a click at once, keeps the pressed button in step and stores the choice', async () => {
    const { buttons, settle } = await render();
    buttons[1]?.click();
    await settle();
    TestBed.tick();
    expect(pressed(buttons)).toEqual(['false', 'true', 'false']);
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(storage.getItem(PREFERENCE_KEYS.theme)).toBe('light');
    buttons[2]?.click();
    await settle();
    expect(pressed(buttons)).toEqual(['false', 'false', 'true']);
    expect(storage.getItem(PREFERENCE_KEYS.theme)).toBe('system');
  });

  it('is translated', async () => {
    const i18n = TestBed.runInInjectionContext(() => injectI18n());
    const { element, buttons, settle } = await render();
    i18n.setSetting('de-CH');
    await settle();
    const de = tFor('de-CH');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      de('regie.settings.theme.dark'),
      de('regie.settings.theme.light'),
      de('regie.settings.theme.system'),
    ]);
    expect(element.querySelector('.c-theme__label')?.textContent).toBe(
      de('regie.settings.theme.label'),
    );
  });
});
