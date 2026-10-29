import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { backupsFixture } from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ClipboardService } from '../core/ui/clipboard.service';
import { ContextMenuService } from '../core/ui/context-menu';
import { ToastService } from '../core/ui/toast.service';
import { BACKUPS_REFRESH_MS, BackupsListComponent } from './backups-list.component';

const NEWEST = {
  name: '2026-10-27_0300_auto',
  at: '2026-10-27T03:00:12Z',
  bytes: 3_145_728,
  kind: 'auto',
};
const OLDER = {
  name: '2026-10-26_1415_manual',
  at: '2026-10-26T14:15:00Z',
  bytes: 2_097_152,
  kind: 'manual',
};

describe('BackupsListComponent', () => {
  let fixture: ComponentFixture<BackupsListComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;

  async function setup(first: object): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BackupsListComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    http.expectOne('/api/settings/backups').flush(first);
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function rows(): string[][] {
    return Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  function backUpNow(): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>('.c-backups__status button')!;
  }

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    http.verify();
  });

  it('lists the backups newest first with kind, size and time', async () => {
    await setup(backupsFixture({ backups: [NEWEST, OLDER] }));
    const list = rows();
    expect(list).toHaveLength(2);
    expect(list[0][0]).toBe('2026-10-27_0300_auto');
    expect(list[0][1]).toBe('Automatic');
    expect(list[0][2]).toBe('3 MB');
    expect(list[1][1]).toBe('Manual');
    expect(
      Array.from(element.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toEqual(['Backup', 'Kind', 'Size', 'Finished', 'Copy command']);
    expect(element.textContent).toContain('docker compose run --rm backup restore');
    expect(backUpNow().textContent?.trim()).toBe('Back up now');
  });

  it('copies the restore command of a row with its button and from its menu', async () => {
    await setup(backupsFixture({ backups: [NEWEST, OLDER] }));
    const copy = vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(true);
    const menus = TestBed.inject(ContextMenuService);
    const row = element.querySelectorAll('tbody tr')[1];

    row
      .querySelector<HTMLButtonElement>(
        '[aria-label="Copy the restore command for 2026-10-26_1415_manual"]',
      )
      ?.click();
    expect(copy).toHaveBeenLastCalledWith(
      'docker compose run --rm backup restore 2026-10-26_1415_manual',
    );

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const entries = menus.current()?.entries ?? [];
    expect(entries.map((entry) => (entry === 'separator' ? '—' : entry.label))).toEqual([
      'Copy restore command',
      'Copy folder name',
    ]);
    expect(menus.current()?.label).toBe('Actions for the backup 2026-10-26_1415_manual');
    const byName = entries[1];
    if (byName !== 'separator') {
      menus.run(byName);
    }
    expect(copy).toHaveBeenLastCalledWith('2026-10-26_1415_manual');

    row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click();
    expect(menus.current()?.label).toBe('Actions for the backup 2026-10-26_1415_manual');
  });

  it('says so when there is no backup yet', async () => {
    await setup(backupsFixture());
    expect(element.textContent).toContain('There is no backup yet.');
    expect(rows()).toHaveLength(0);
  });

  it('says that the backup service has not reported, and does not offer a backup', async () => {
    await setup(backupsFixture({ serviceSeen: false }));
    expect(element.textContent).toContain('docker compose ps backup');
    expect(backUpNow().disabled).toBe(true);
  });

  it('shows a running backup', async () => {
    await setup(backupsFixture({ running: true }));
    expect(element.textContent).toContain('A backup is running');
  });

  it('shows a backup that waits for the end of a broadcast', async () => {
    await setup(backupsFixture({ running: true, postponed: true }));
    expect(element.textContent).toContain('waits for the end of the broadcast');
  });

  it('shows that the last backup failed', async () => {
    await setup(backupsFixture({ lastError: 'pg_dump failed' }));
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'docker compose logs backup',
    );
  });

  it('asks for a backup and says that it was requested until the list changes', async () => {
    vi.useFakeTimers();
    await setup(backupsFixture({ backups: [OLDER] }));
    backUpNow().click();
    await render();
    const request = http.expectOne('/api/settings/backups');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    request.flush(null, { status: 202, statusText: 'Accepted' });
    await flushMicrotasks();
    http.expectOne('/api/settings/backups').flush(backupsFixture({ backups: [OLDER] }));
    await render();
    expect(element.textContent).toContain('The backup was requested');

    await vi.advanceTimersByTimeAsync(BACKUPS_REFRESH_MS);
    http.expectOne('/api/settings/backups').flush(backupsFixture({ backups: [NEWEST, OLDER] }));
    await render();
    expect(element.textContent).not.toContain('The backup was requested');
    expect(rows()).toHaveLength(2);
  });

  it('says so when the request is refused', async () => {
    await setup(backupsFixture());
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    backUpNow().click();
    await render();
    http
      .expectOne('/api/settings/backups')
      .flush({ code: 'service_unavailable' }, { status: 503, statusText: 'Unavailable' });
    await render();
    expect(toast).toHaveBeenCalled();
  });

  it('keeps looking for new backups while it is open', async () => {
    vi.useFakeTimers();
    await setup(backupsFixture());
    await vi.advanceTimersByTimeAsync(BACKUPS_REFRESH_MS);
    http.expectOne('/api/settings/backups').flush(backupsFixture({ backups: [NEWEST] }));
    await render();
    expect(rows()).toHaveLength(1);
  });
});
