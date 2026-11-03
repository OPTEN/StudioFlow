import { TestBed } from '@angular/core/testing';
import { resetLocaleForTests } from '@studioflow/i18n';
import { I18N } from '@studioflow/i18n/angular';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { HeaderComponent } from './header.component';

describe('HeaderComponent when the language changes at runtime', () => {
  let harness: StoreHarness;

  afterEach(() => {
    harness?.http.verify();
    resetLocaleForTests();
  });

  it('re-words the tooltip of the gear', async () => {
    resetLocaleForTests('en');
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    const i18n = TestBed.inject(I18N);
    harness = await startStore(hub, snapshotFixture());
    const fixture = TestBed.createComponent(HeaderComponent);
    const element = fixture.nativeElement as HTMLElement;
    await flushMicrotasks();
    fixture.detectChanges();
    const gear = (): string | null =>
      element.querySelector('a.c-header__settings')?.getAttribute('title') ?? null;
    expect(gear()).toBe('Settings (Ctrl+,)');

    i18n.setSetting('de-CH');
    fixture.detectChanges();

    expect(gear()).toMatch(/^Einstellungen \(/);
    expect(gear()).not.toContain('Settings');
  });
});
