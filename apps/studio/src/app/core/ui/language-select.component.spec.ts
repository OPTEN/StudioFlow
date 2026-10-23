import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  LOCALE_STORAGE_KEY,
  getLocale,
  initLocale,
  t,
  tFor,
  type LocaleStorage,
} from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';
import { LanguageSelectComponent } from './language-select.component';

/** An OnPush component that reads texts through a template call and through a computed value. */
@Component({
  selector: 'sf-probe',
  template: `
    <p class="direct">{{ t('common.cancel') }}</p>
    <p class="derived">{{ derived() }}</p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeComponent {
  protected readonly t = t;
  protected readonly derived = computed(() => t('model.status.incidents', { count: 2 }));
}

function memoryStorage(): LocaleStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('language switching', () => {
  it('re-renders OnPush templates and computed values without a reload', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);
    const i18n = TestBed.runInInjectionContext(() => injectI18n());
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.direct')?.textContent).toBe('Cancel');
    expect(element.querySelector('.derived')?.textContent).toBe('2 incidents');

    i18n.setSetting('de-CH');
    await fixture.whenStable();
    expect(element.querySelector('.direct')?.textContent).toBe(tFor('de-CH')('common.cancel'));
    expect(element.querySelector('.derived')?.textContent).toBe(
      tFor('de-CH')('model.status.incidents', { count: 2 }),
    );

    i18n.setSetting('en');
    await fixture.whenStable();
    expect(element.querySelector('.direct')?.textContent).toBe('Cancel');
  });
});

describe('LanguageSelectComponent', () => {
  function render(): {
    element: HTMLElement;
    select: HTMLSelectElement;
    settle: () => Promise<void>;
  } {
    const fixture = TestBed.createComponent(LanguageSelectComponent);
    const element = fixture.nativeElement as HTMLElement;
    return {
      element,
      select: element.querySelector('select') as HTMLSelectElement,
      settle: () => fixture.whenStable(),
    };
  }

  it('offers automatic, English and Deutsch (Schweiz), with the language names untranslated', async () => {
    const { element, select, settle } = render();
    await settle();
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'auto',
      'en',
      'de-CH',
    ]);
    expect(Array.from(select.options).map((option) => option.textContent?.trim())).toEqual([
      'Automatic (browser language)',
      'English',
      'Deutsch (Schweiz)',
    ]);
    expect(element.querySelector('label')?.textContent).toContain('Language');
    expect(select.getAttribute('aria-label')).toBe('Interface language');
  });

  it('applies a choice at once, keeps the select in step and translates its own labels', async () => {
    const { select, settle } = render();
    await settle();
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(getLocale()).toBe('de-CH');
    expect(select.selectedOptions[0]?.value).toBe('de-CH');
    expect(select.options[0]?.textContent?.trim()).toBe(tFor('de-CH')('locale.auto'));
    expect(select.getAttribute('aria-label')).toBe(tFor('de-CH')('locale.label'));
  });

  it('stores the choice, and the key is removed again for automatic', async () => {
    const storage = memoryStorage();
    initLocale({ storage, languages: ['en-US'], document: null });
    const { select, settle } = render();
    await settle();
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe('de-CH');
    select.value = 'auto';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(storage.values.has(LOCALE_STORAGE_KEY)).toBe(false);
    expect(getLocale()).toBe('en');
  });

  it('ignores a value it does not know', async () => {
    const { select, settle } = render();
    await settle();
    const other = document.createElement('option');
    other.value = 'xx';
    select.add(other);
    select.value = 'xx';
    select.dispatchEvent(new Event('change'));
    expect(getLocale()).toBe('en');
  });
});
