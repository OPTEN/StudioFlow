import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { appliedStatusFixture, configuredSettingsFixture } from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { BackupSectionComponent } from './backup-section.component';

const AGE_KEY = `age1${'q'.repeat(58)}`;

describe('BackupSectionComponent', () => {
  let fixture: ComponentFixture<BackupSectionComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let saved: Mock<() => void>;

  async function setup(
    backup: Parameters<typeof configuredSettingsFixture>[0] = {},
  ): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const loading = TestBed.inject(ServerSettingsService).load();
    http.expectOne('/api/settings').flush(configuredSettingsFixture(backup));
    await loading;
    fixture = TestBed.createComponent(BackupSectionComponent);
    saved = vi.fn<() => void>();
    fixture.componentInstance.saved.subscribe(saved);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function field(id: string): HTMLInputElement & HTMLTextAreaElement {
    return element.querySelector<HTMLInputElement & HTMLTextAreaElement>(`#${id}`)!;
  }

  function type(id: string, value: string): void {
    field(id).value = value;
    field(id).dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  function errorOf(id: string): string {
    return element.querySelector(`#${id}-error`)?.textContent?.trim() ?? '';
  }

  const NO_OFFSITE = {
    schedule: null,
    timezone: null,
    keepDaily: 7,
    keepWeekly: 4,
    rcloneRemote: null,
    rcloneConfig: null,
    ageRecipients: [''],
    offsiteUnencrypted: false,
  };

  async function accept(expectedBody: object, status = appliedStatusFixture()): Promise<void> {
    const request = http.expectOne('/api/settings/backup');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(expectedBody);
    request.flush(configuredSettingsFixture());
    await flushMicrotasks();
    http.expectOne('/api/settings/status').flush(status);
    await render();
  }

  afterEach(() => http.verify());

  it('shows the saved schedule, retention and off-site target without any secret', async () => {
    await setup({
      backup: {
        schedule: '0 3 * * *',
        timezone: 'Europe/Zurich',
        keepDaily: 10,
        keepWeekly: 6,
        rcloneRemote: 'offsite:studioflow',
        rcloneConfigured: true,
        ageRecipients: [AGE_KEY],
      },
    });
    expect(field('backup-schedule').value).toBe('0 3 * * *');
    expect(field('backup-timezone').value).toBe('Europe/Zurich');
    expect(field('backup-keep-daily').value).toBe('10');
    expect(field('backup-keep-weekly').value).toBe('6');
    expect(field('backup-remote').value).toBe('offsite:studioflow');
    expect(field('backup-config').value).toBe('');
    expect(field('backup-config').placeholder).toBe('••••••••');
    expect(element.textContent).toContain('A configuration is stored');
    expect(field('backup-age').value).toBe(AGE_KEY);
  });

  it('saves the schedule and switches automatic backups off with an empty one', async () => {
    await setup();
    type('backup-schedule', ' 0 3 * * * ');
    type('backup-timezone', 'Europe/Zurich');
    await submit();
    await accept({ ...NO_OFFSITE, schedule: '0 3 * * *', timezone: 'Europe/Zurich' });
    expect(saved).toHaveBeenCalledOnce();
  });

  it('sends the off-site target with the configuration it was given', async () => {
    await setup();
    type('backup-remote', 'offsite:studioflow');
    type('backup-config', '[offsite]\ntype = s3\n');
    type('backup-age', `${AGE_KEY}\n`);
    await submit();
    await accept({
      ...NO_OFFSITE,
      rcloneRemote: 'offsite:studioflow',
      rcloneConfig: '[offsite]\ntype = s3\n',
      ageRecipients: [AGE_KEY, ''],
    });
    expect(field('backup-config').value).toBe('');
  });

  it('asks for a public age key, or the statement that the remote encrypts itself', async () => {
    await setup();
    type('backup-remote', 'offsite:studioflow');
    await submit();
    expect(errorOf('backup-age')).toContain('Enter at least one public age key');
    http.expectNone('/api/settings/backup');
    field('backup-age').dispatchEvent(new Event('input'));
    const box = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await submit();
    await accept({ ...NO_OFFSITE, rcloneRemote: 'offsite:studioflow', offsiteUnencrypted: true });
  });

  it('names the line that is no age key', async () => {
    await setup();
    type('backup-age', `${AGE_KEY}\nnot a key`);
    await submit();
    expect(errorOf('backup-age')).toBe('Line 2 is not a public age key (it starts with age1).');
    expect(document.activeElement).toBe(field('backup-age'));
  });

  it.each([
    ['backup-keep-daily', '0', 'from 1 to 365'],
    ['backup-keep-daily', '366', 'from 1 to 365'],
    ['backup-keep-weekly', '105', 'from 1 to 104'],
    ['backup-keep-weekly', '', 'from 1 to 104'],
  ])('refuses %s = "%s"', async (id, value, message) => {
    await setup();
    type(id, value);
    await submit();
    expect(errorOf(id)).toContain(message);
    http.expectNone('/api/settings/backup');
  });

  it('shows what the server found wrong, field by field', async () => {
    await setup();
    type('backup-schedule', '61 * * * *');
    type('backup-timezone', 'Mars Base');
    type('backup-remote', 'offsite:x');
    type('backup-config', '[other]\n');
    type('backup-age', AGE_KEY);
    await submit();
    http.expectOne('/api/settings/backup').flush(
      {
        code: 'validation_failed',
        errors: {
          schedule: ['schedule_invalid'],
          timezone: ['timezone_invalid'],
          rcloneRemote: ['remote_not_in_config'],
          rcloneConfig: ['rclone_config_invalid'],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await render();
    expect(errorOf('backup-schedule')).toContain('schedule of five fields');
    expect(errorOf('backup-timezone')).toContain('Europe/Zurich');
    expect(errorOf('backup-remote')).toContain('does not define a remote');
    expect(errorOf('backup-config')).toContain('not an rclone configuration');
  });

  it('keeps the form when the backup service is slow to read the settings', async () => {
    vi.useFakeTimers();
    try {
      await setup();
      type('backup-schedule', '0 3 * * *');
      await submit();
      http.expectOne('/api/settings/backup').flush(configuredSettingsFixture());
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < 20; attempt++) {
        for (const request of http.match('/api/settings/status')) {
          request.flush(appliedStatusFixture({ backup: { applied: false, error: null } }));
        }
        await vi.advanceTimersByTimeAsync(1000);
      }
      fixture.detectChanges();
      expect(element.querySelector('.c-srv__warning')?.textContent).toContain(
        'docker compose ps backup',
      );
      expect(saved).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
