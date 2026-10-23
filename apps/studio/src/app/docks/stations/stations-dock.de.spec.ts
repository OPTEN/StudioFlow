import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { injectI18n } from '@studioflow/i18n/angular';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { startStore, studioTestProviders } from '../../../testing/store-harness';
import { dockSnapshot } from '../testing/dock-fixtures';
import { StationsDockComponent } from './stations-dock.component';

describe('StationsDockComponent language switch', () => {
  let fixture: ComponentFixture<StationsDockComponent>;

  it('rewords the rows without a reload (the cached row models follow the language)', async () => {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    await startStore(hub, dockSnapshot());
    fixture = TestBed.createComponent(StationsDockComponent);
    const i18n = TestBed.runInInjectionContext(() => injectI18n());
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const rowLabel = (): string | null =>
      element.querySelector('.c-st__row')?.getAttribute('aria-label') ?? null;
    expect(rowLabel()).toBe('K1 Phone stage left, on Program');
    expect(element.querySelector('.c-btn--primary')?.textContent).toContain('Pair device');

    i18n.setSetting('de-CH');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(rowLabel()).toBe('K1 Phone stage left, im Program');
    expect(element.querySelector('.c-btn--primary')?.textContent).toContain('Gerät koppeln');
  });
});
