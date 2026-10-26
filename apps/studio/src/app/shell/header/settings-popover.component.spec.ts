import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { getLocale, tFor } from '@studioflow/i18n';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { csrfInterceptor } from '../../core/api/csrf.interceptor';
import { PopoverService } from '../../core/ui/popover.directive';
import { SETTINGS_POPOVER, SettingsPopoverComponent } from './settings-popover.component';

describe('SettingsPopoverComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('holds the appearance row below the language', async () => {
    const fixture = TestBed.createComponent(SettingsPopoverComponent);
    TestBed.inject(PopoverService).open(SETTINGS_POPOVER);
    await fixture.whenStable();
    // The server has not answered yet: language and appearance only.
    http.expectOne('/api/system/info');
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.c-pop > *'),
    ).map((row) => row.tagName.toLowerCase());
    expect(rows).toEqual(['div', 'sf-language-select', 'sf-theme-select']);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.c-seg button')).toHaveLength(
      3,
    );
  });

  it('holds the language row and switches the language', async () => {
    const fixture = TestBed.createComponent(SettingsPopoverComponent);
    TestBed.inject(PopoverService).open(SETTINGS_POPOVER);
    await fixture.whenStable();
    http.expectOne('/api/system/info');
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

  it('shows the version the server runs below the settings, in both languages', async () => {
    const fixture = TestBed.createComponent(SettingsPopoverComponent);
    TestBed.inject(PopoverService).open(SETTINGS_POPOVER);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.c-version'), 'nothing before the server answered').toBeNull();

    http
      .expectOne('/api/system/info')
      .flush({ version: '0.1.0+1a2b3c4', publicBaseUrl: 'https://regie.example.ch' });
    await flushMicrotasks();
    await fixture.whenStable();
    const rows = Array.from(element.querySelectorAll('.c-pop > *')).map((row) =>
      row.tagName.toLowerCase(),
    );
    expect(rows).toEqual(['div', 'sf-language-select', 'sf-theme-select', 'div']);
    const row = element.querySelector('.c-version');
    expect(row?.querySelector('.c-version__label')?.textContent).toBe('Version');
    expect(row?.querySelector('.c-version__value')?.textContent).toBe('0.1.0+1a2b3c4');

    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(row?.querySelector('.c-version__label')?.textContent).toBe(
      tFor('de-CH')('regie.settings.version.label'),
    );
    expect(row?.querySelector('.c-version__value')?.textContent).toBe('0.1.0+1a2b3c4');
  });

  it('stays without a version row when the server does not answer', async () => {
    const fixture = TestBed.createComponent(SettingsPopoverComponent);
    TestBed.inject(PopoverService).open(SETTINGS_POPOVER);
    await fixture.whenStable();
    http
      .expectOne('/api/system/info')
      .flush({ title: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await flushMicrotasks();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.c-version')).toBeNull();
  });
});
