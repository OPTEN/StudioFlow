import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { formatDateTime, resetLocaleForTests, tFor } from '@studioflow/i18n';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { auditEntryFixture } from '../../testing/fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { AuditPageComponent } from './audit-page.component';
import { FILE_SAVER } from './save-file';

const de = tFor('de-CH');

describe('AuditPageComponent in German', () => {
  let fixture: ComponentFixture<AuditPageComponent>;
  let http: HttpTestingController;
  const saveTextFile = vi.fn();

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    resetLocaleForTests('de-CH');
    saveTextFile.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: FILE_SAVER, useValue: saveTextFile },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AuditPageComponent);
    fixture.detectChanges();
    await flushMicrotasks();
    http.expectOne('/api/productions').flush([]);
    http
      .expectOne((request) => request.url === '/api/audit')
      .flush({
        entries: [
          auditEntryFixture(2, {
            code: 'cameraLensSwitched',
            params: { subject: 'K1 Handy', lens: 'ultraWide' },
            text: 'English',
          }),
        ],
        nextCursor: null,
      });
    await render();
  });

  afterEach(() => http.verify());

  it('shows the texts of the entries, the headings and the time in the language', () => {
    const element = fixture.nativeElement as HTMLElement;
    const cells = Array.from(element.querySelectorAll('tbody td')).map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(element.querySelector('.c-audit-table__menu')?.getAttribute('aria-label')).toBe(
      de('regie.audit.row.menu', {
        time: formatDateTime(new Date(auditEntryFixture(2).at), { seconds: true }),
      }),
    );
    expect(cells.slice(0, 4)).toEqual([
      formatDateTime(new Date(auditEntryFixture(2).at), { seconds: true }),
      de('regie.audit.actor.admin'),
      de('regie.log.cameraLensSwitched', {
        subject: 'K1 Handy',
        lens: de('regie.camera.lens.ultraWide'),
      }),
      'Webinar',
    ]);
    expect(formatDateTime(new Date(auditEntryFixture(2).at), { seconds: true })).toMatch(
      /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/,
    );
    expect(element.querySelector('h1')?.textContent).toBe(de('regie.audit.title'));
  });

  it('asks the server for a CSV with the semicolon, which Excel expects in a German installation', async () => {
    const element = fixture.nativeElement as HTMLElement;
    const buttonNamed = (label: string): HTMLButtonElement | undefined =>
      Array.from(element.querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(label),
      );

    buttonNamed(de('regie.audit.export.menu'))?.click();
    await render();
    buttonNamed(de('regie.audit.export.csv'))?.click();
    await flushMicrotasks();
    const request = http.expectOne((r) => r.url === '/api/audit/export.csv');
    expect(request.request.params.get('separator')).toBe('semicolon');
    request.flush('zeit;akteur\r\n', {
      headers: { 'Content-Disposition': 'attachment; filename="studioflow-audit-2026-10-26.csv"' },
    });
    await render();

    expect(saveTextFile).toHaveBeenCalledWith('zeit;akteur\r\n', 'studioflow-audit-2026-10-26.csv');
  });
});
