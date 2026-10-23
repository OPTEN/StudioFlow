import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { resetLocaleForTests } from '@studioflow/i18n';
import type { LogEntryDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { logFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { StatusLineComponent } from './status-line.component';

describe('StatusLineComponent in German', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<StatusLineComponent>;

  async function setup(recentLog: LogEntryDto[]): Promise<HTMLElement> {
    resetLocaleForTests('de-CH');
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture({ recentLog }));
    fixture = TestBed.createComponent(StatusLineComponent);
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => harness?.http.verify());

  it('renders the log from the code and its parameters', async () => {
    const element = await setup([logFixture('Pause')]);
    expect(element.querySelector('.c-status__ok')?.textContent?.trim()).toBe(
      'Keine offenen Meldungen',
    );
    expect(element.querySelector('.c-status__label')?.textContent?.trim()).toBe(
      'Letzte Ereignisse',
    );
    expect(element.querySelector('.c-status__entry')?.textContent).toContain(
      'Szene «Pause» ist live',
    );
  });

  it('shows the English text of the API for a code this client does not know', async () => {
    const unknown = {
      at: '2026-10-22T09:30:00.000Z',
      code: 'somethingNew',
      params: {},
      text: 'Something new happened',
    } as unknown as LogEntryDto;
    const element = await setup([unknown]);
    expect(element.querySelector('.c-status__entry')?.textContent).toContain(
      'Something new happened',
    );
  });
});
