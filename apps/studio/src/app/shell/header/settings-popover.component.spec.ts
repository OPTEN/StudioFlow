import { TestBed } from '@angular/core/testing';
import { getLocale, tFor } from '@studioflow/i18n';
import { PopoverService } from '../../core/ui/popover.directive';
import { SETTINGS_POPOVER, SettingsPopoverComponent } from './settings-popover.component';

describe('SettingsPopoverComponent', () => {
  it('holds the language row and switches the language', async () => {
    const fixture = TestBed.createComponent(SettingsPopoverComponent);
    TestBed.inject(PopoverService).open(SETTINGS_POPOVER);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const dialog = element.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Settings');
    expect(dialog?.id).toBe('sf-pop-settings');
    expect(element.querySelector('.c-pop-h')?.textContent).toBe('Settings');

    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(getLocale()).toBe('de-CH');
    expect(element.querySelector('.c-pop-h')?.textContent).toBe(
      tFor('de-CH')('regie.settings.title'),
    );
  });
});
