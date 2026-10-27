import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  appliedStatusFixture,
  backupsFixture,
  configuredSettingsFixture,
} from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { MediaTestService } from '../core/media/media-test.service';
import { ToastService } from '../core/ui/toast.service';
import { MediaSectionComponent } from './media-section.component';
import { ServerSettingsPageComponent } from './server-settings-page.component';

describe('ServerSettingsPageComponent', () => {
  let fixture: ComponentFixture<ServerSettingsPageComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;

  async function setup(settingsStatus = 200, status = appliedStatusFixture()): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: MediaTestService,
          useValue: {
            isOpen: false,
            run: vi.fn(),
            markSaved: vi.fn(),
            end: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ServerSettingsPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    answerSettings(settingsStatus);
    await render();
    if (settingsStatus === 200) {
      answerRest(status);
      await render();
    }
  }

  function answerSettings(code: number): void {
    const request = http.expectOne('/api/settings');
    if (code === 200) {
      request.flush(
        configuredSettingsFixture({
          address: { domain: 'studioflow.example.com' },
          backup: { schedule: '0 3 * * *' },
        }),
      );
    } else {
      request.flush({}, { status: code, statusText: 'Error' });
    }
  }

  /** The services status, the suggestions of the media section and the list of backups. */
  function answerRest(status = appliedStatusFixture()): void {
    http.expectOne('/api/settings/status').flush(status);
    http
      .match('/api/settings/media/suggestions')
      .forEach((request) => request.flush({ fromHost: null, interfaces: [] }));
    http.match('/api/settings/backups').forEach((request) => request.flush(backupsFixture()));
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('shows the header bar with a way back and the sections in order', async () => {
    await setup();
    expect(element.querySelector('h1')?.textContent).toBe('Server settings');
    expect(element.querySelector('.c-set__back')?.getAttribute('href')).toBe('/');
    const headings = Array.from(element.querySelectorAll('.c-set__heading')).map((heading) =>
      heading.textContent?.trim(),
    );
    expect(headings).toEqual([
      'Services',
      'Media address',
      'Address and certificate',
      'Embedding the output',
      'Backups',
      'Latest backups',
    ]);
  });

  it('shows the saved values in the sections', async () => {
    await setup();
    expect((element.querySelector('#media-address') as HTMLInputElement).value).toBe(
      '192.168.1.50',
    );
    expect((element.querySelector('#address-domain') as HTMLInputElement).value).toBe(
      'studioflow.example.com',
    );
    expect((element.querySelector('#backup-schedule') as HTMLInputElement).value).toBe('0 3 * * *');
  });

  it('shows whether each service runs the saved settings', async () => {
    await setup(
      200,
      appliedStatusFixture({
        liveKit: { applied: false, error: null },
        backup: { applied: false, error: 'not reachable' },
      }),
    );
    const rows = Array.from(element.querySelectorAll('.c-set__service')).map((row) =>
      Array.from(row.querySelectorAll('span:not(.c-lamp)'))
        .map((cell) => cell.textContent?.trim())
        .join(' '),
    );
    expect(rows).toEqual([
      'Web server runs the saved settings',
      'Media server is taking over the settings …',
      'Backup service refused the settings',
    ]);
    const lamps = Array.from(element.querySelectorAll('.c-set__service .c-lamp'));
    expect(lamps[1].classList).toContain('is-warn');
    expect(lamps[2].classList).toContain('is-bad');
  });

  it('confirms a saved section with a toast and looks at the services again', async () => {
    await setup();
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    fixture.debugElement.query(By.directive(MediaSectionComponent)).componentInstance.saved.emit();
    await render();
    expect(toast).toHaveBeenCalledWith('Saved.');
    http.expectOne('/api/settings/status').flush(appliedStatusFixture());
  });

  it('says that the settings could not be loaded and tries again', async () => {
    await setup(500);
    expect(element.querySelector('.c-empty')?.textContent).toContain('could not be loaded');
    (element.querySelector('.c-empty button') as HTMLButtonElement).click();
    await render();
    answerSettings(200);
    await render();
    answerRest();
    await render();
    expect(element.querySelector('#media-address')).not.toBeNull();
  });
});
