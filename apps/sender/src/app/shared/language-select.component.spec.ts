import { TestBed } from '@angular/core/testing';
import { getLocale, getLocaleSetting, tFor } from '@studioflow/i18n';
import { LanguageSelectComponent } from './language-select.component';

describe('LanguageSelectComponent (sender)', () => {
  it('offers the three settings and applies a choice without a reload', async () => {
    const fixture = TestBed.createComponent(LanguageSelectComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'auto',
      'en',
      'de-CH',
    ]);
    expect(element.querySelector('label')?.textContent).toContain('Language');

    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(getLocale()).toBe('de-CH');
    expect(getLocaleSetting()).toBe('de-CH');
    expect(element.querySelector('label')?.textContent).toContain(tFor('de-CH')('common.language'));
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Deutsch (Schweiz)');
  });
});
