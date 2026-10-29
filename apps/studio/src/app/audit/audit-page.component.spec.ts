import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { formatDateTime } from '@studioflow/i18n';
import type { AuditEntryDto, ProductionSummaryDto } from '@studioflow/scene-model';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { auditEntryFixture } from '../../testing/fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ClipboardService } from '../core/ui/clipboard.service';
import { ContextMenuService } from '../core/ui/context-menu';
import { ToastService } from '../core/ui/toast.service';
import { AUDIT_PAGE_SIZE } from './audit-log.store';
import { AUDIT_REFRESH_MS, AuditPageComponent, SEARCH_DEBOUNCE_MS } from './audit-page.component';
import { FILE_SAVER } from './save-file';

const PRODUCTIONS: ProductionSummaryDto[] = [
  {
    id: 'prd_a',
    name: 'Webinar',
    slug: 'webinar',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prd_b',
    name: 'Podcast',
    slug: 'podcast',
    isActive: false,
    createdAt: '2026-01-02T00:00:00Z',
  },
] as ProductionSummaryDto[];

describe('AuditPageComponent', () => {
  let fixture: ComponentFixture<AuditPageComponent>;
  let element: HTMLElement;
  let http: HttpTestingController;
  const saveTextFile = vi.fn();

  const page = (entries: AuditEntryDto[], nextCursor: string | null = null) => ({
    entries,
    nextCursor,
  });

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  /** The request the filters started (a change of a filter reaches the list with the next change detection). */
  function audit(): TestRequest {
    fixture.detectChanges();
    return http.expectOne((request) => request.url === '/api/audit');
  }

  function params(request: TestRequest): Record<string, string[]> {
    return Object.fromEntries(
      request.request.params.keys().map((key) => [key, request.request.params.getAll(key) ?? []]),
    );
  }

  /** Creates the page and answers the two requests it starts with. */
  async function open(
    entries: AuditEntryDto[] = [],
    nextCursor: string | null = null,
  ): Promise<void> {
    fixture = TestBed.createComponent(AuditPageComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await flushMicrotasks();
    http.expectOne('/api/productions').flush(PRODUCTIONS);
    audit().flush(page(entries, nextCursor));
    await render();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function rows(): HTMLTableRowElement[] {
    return Array.from(
      element.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.c-audit-table__details)'),
    );
  }

  function control<T extends HTMLElement>(selector: string): T {
    const found = element.querySelector<T>(selector);
    if (!found) {
      throw new Error(`no ${selector}`);
    }
    return found;
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (candidate) => text(candidate) === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('starts with the newest page of every production and shows what happened', async () => {
    const entries = [
      auditEntryFixture(3, {
        actor: 'system',
        text: 'K2 reconnecting',
        code: 'sourceReconnecting',
        params: { code: 'K2' },
      }),
      auditEntryFixture(2, { productionId: null, productionName: null }),
      auditEntryFixture(1),
    ];
    await open(entries, 'next');

    const cells = rows().map((row) => Array.from(row.querySelectorAll('td')).slice(0, 4).map(text));
    expect(cells).toEqual([
      [
        formatDateTime(new Date(entries[0].at), { seconds: true }),
        'System',
        'K2 reconnecting',
        'Webinar',
      ],
      [
        formatDateTime(new Date(entries[1].at), { seconds: true }),
        'Admin',
        'Scene “Break” is live',
        '–',
      ],
      [
        formatDateTime(new Date(entries[2].at), { seconds: true }),
        'Admin',
        'Scene “Break” is live',
        'Webinar',
      ],
    ]);
    expect(text(control('.c-audit__count'))).toBe('Showing 3 entries');
    expect(control('time').getAttribute('datetime')).toBe(entries[0].at);
  });

  it('writes the text of an entry from its code, and falls back to the English text without one', async () => {
    await open([
      auditEntryFixture(2, {
        code: null,
        text: 'from.a.newer.version',
        action: 'from.a.newer.version',
      }),
      auditEntryFixture(1, { code: 'loginFailed', params: { username: 'root' }, text: 'x' }),
    ]);

    expect(rows().map((row) => text(row.querySelector('.c-audit-table__event')))).toEqual([
      'from.a.newer.version',
      'Sign-in failed for “root”',
    ]);
  });

  it('shows the details of an entry on demand: a summary first, the recorded values in a second tab', async () => {
    const entry = auditEntryFixture(7, {
      action: 'login.succeeded',
      details: { username: 'regie', ip: '203.0.113.5' },
    });
    await open([entry]);
    const toggle = control<HTMLButtonElement>('.c-audit-table__toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('.c-audit-details')).toBeNull();

    toggle.click();
    await render();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const pairs = (): string[][] =>
      Array.from(control('.c-audit-details').querySelectorAll('dt')).map((term) => [
        text(term),
        text(term.nextElementSibling),
      ]);
    expect(pairs()).toContainEqual(['Who', 'Admin']);
    expect(pairs()).toContainEqual(['Production', 'Webinar']);
    const tabs = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map(text)).toEqual(['Summary', 'Recorded values']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(control('[role="tabpanel"]').getAttribute('aria-labelledby')).toBe(tabs[0].id);

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await render();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
    expect(text(control('.c-audit-details'))).toContain('login.succeeded');
    expect(pairs()).toContainEqual(['ip', '203.0.113.5']);
    expect(pairs()).toContainEqual(['username', 'regie']);
    expect(toggle.getAttribute('aria-controls')).toBe(control('tr.c-audit-table__details').id);

    toggle.click();
    await render();
    expect(element.querySelector('.c-audit-details')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('names the toggle of each entry by its time', async () => {
    const entry = auditEntryFixture(1);
    await open([entry]);

    expect(control('.c-audit-table__toggle').getAttribute('aria-label')).toBe(
      `Show the details of the entry from ${formatDateTime(new Date(entry.at), { seconds: true })}`,
    );
  });

  it('says so when nothing matches, and when loading failed it offers to try again', async () => {
    await open([]);
    expect(text(control('.c-empty'))).toContain('No entries match.');

    choose(control('#audit-production'), 'none');
    await flushMicrotasks();
    fixture.detectChanges();
    audit().flush(null, { status: 503, statusText: 'Service Unavailable' });
    await render();
    expect(text(control('.c-audit__error'))).toContain('Try again');
    expect(control('.c-audit__error').getAttribute('role')).toBe('alert');

    button('Try again').click();
    await flushMicrotasks();
    audit().flush(page([auditEntryFixture(1)]));
    await render();
    expect(rows()).toHaveLength(1);
  });

  it('shows the loading state until the first page arrives', async () => {
    fixture = TestBed.createComponent(AuditPageComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(text(control('.c-empty'))).toContain('Loading the activity log…');
    http.expectOne('/api/productions').flush([]);
    audit().flush(page([]));
    await render();
  });

  it('loads the next page with the button and removes it at the end of the log', async () => {
    await open([auditEntryFixture(3), auditEntryFixture(2)], 'cursor-1');

    button('Load more').click();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(button('Loading…').disabled).toBe(true);
    const request = audit();
    expect(params(request)['cursor']).toEqual(['cursor-1']);
    expect(params(request)['limit']).toEqual([String(AUDIT_PAGE_SIZE)]);
    request.flush(page([auditEntryFixture(1)]));
    await render();

    expect(rows()).toHaveLength(3);
    expect(element.querySelector('.c-audit__more')).toBeNull();
  });

  it('loads the next page by itself when the end of the list scrolls into view', async () => {
    const observed: { callback: IntersectionObserverCallback; element: Element }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(element: Element): void {
          observed.push({ callback: this.callback, element });
        }
        disconnect(): void {}
      },
    );
    try {
      await open([auditEntryFixture(2)], 'cursor-1');
      const anchor = control('.c-audit__more');
      const watcher = observed.find((entry) => entry.element === anchor);
      expect(watcher).toBeDefined();

      watcher?.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await flushMicrotasks();
      http.expectNone((request) => request.url === '/api/audit');

      watcher?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await flushMicrotasks();
      expect(params(audit())['cursor']).toEqual(['cursor-1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says so when a page could not be loaded and keeps the entries', async () => {
    await open([auditEntryFixture(2)], 'cursor-1');

    button('Load more').click();
    await flushMicrotasks();
    audit().flush(null, { status: 500, statusText: 'Server Error' });
    await render();

    expect(text(control('.c-audit__more'))).toContain('More entries could not be loaded.');
    expect(rows()).toHaveLength(1);
    expect(button('Load more').disabled).toBe(false);
  });

  it('filters by category and shows which categories are on', async () => {
    await open([auditEntryFixture(1)]);

    button('Devices').click();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(params(audit())['category']).toEqual(['devices']);
    await render();
    expect(button('Devices').getAttribute('aria-pressed')).toBe('true');
    expect(button('Media').getAttribute('aria-pressed')).toBe('false');

    button('Media').click();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(params(audit())['category']).toEqual(['devices', 'media']);
    await render();

    button('Devices').click();
    await flushMicrotasks();
    expect(params(audit())['category']).toEqual(['media']);
    await render();
  });

  it('filters by production, with the active one marked and the sign-ins as an option', async () => {
    await open([]);
    const options = Array.from(control<HTMLSelectElement>('#audit-production').options).map(
      (option) => [option.value, text(option)],
    );
    expect(options).toEqual([
      ['', 'All productions'],
      ['prd_a', 'Webinar (active)'],
      ['prd_b', 'Podcast'],
      ['none', 'Without production (sign-ins, account)'],
    ]);

    choose(control('#audit-production'), 'prd_b');
    await flushMicrotasks();
    expect(params(audit())['production']).toEqual(['prd_b']);
    await render();
  });

  describe('search', () => {
    it('applies the text once after a pause, not for every key', async () => {
      await open([]);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const input = control<HTMLInputElement>('#audit-search');

      for (const value of ['l', 'le', 'len']) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
      }
      http.expectNone((request) => request.url === '/api/audit');

      await vi.advanceTimersByTimeAsync(60);
      await flushMicrotasks();
      fixture.detectChanges();
      await flushMicrotasks();
      expect(params(audit())['q']).toEqual(['len']);
      vi.useRealTimers();
    });

    it('limits the length of the text and leaves the typed text in the box', async () => {
      await open([]);
      const input = control<HTMLInputElement>('#audit-search');
      expect(input.maxLength).toBe(100);
      expect(input.type).toBe('search');
    });
  });

  describe('time range', () => {
    it('limits "today" to the local day', async () => {
      await open([]);

      choose(control('#audit-range'), 'today');
      await flushMicrotasks();

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      expect(params(audit())['from']).toEqual([start.toISOString()]);
      await render();
    });

    it('asks for a custom range with its own inputs and refuses an end before the start', async () => {
      await open([]);
      expect(element.querySelector('#audit-from')).toBeNull();

      choose(control('#audit-range'), 'custom');
      await flushMicrotasks();
      audit().flush(page([]));
      await render();
      const from = control<HTMLInputElement>('#audit-from');
      const to = control<HTMLInputElement>('#audit-to');
      expect(from.type).toBe('datetime-local');

      from.value = '2026-10-26T10:00';
      from.dispatchEvent(new Event('change'));
      await flushMicrotasks();
      expect(params(audit())['from']).toEqual([new Date('2026-10-26T10:00').toISOString()]);
      await render();

      to.value = '2026-10-26T09:00';
      to.dispatchEvent(new Event('change'));
      await render();
      http.expectNone((request) => request.url === '/api/audit');
      expect(text(control('#audit-range-error'))).toBe('The end must be after the start.');
      expect(to.getAttribute('aria-describedby')).toBe('audit-range-error');

      to.value = '2026-10-26T11:00';
      to.dispatchEvent(new Event('change'));
      await flushMicrotasks();
      expect(params(audit())['to']).toEqual([new Date('2026-10-26T11:00').toISOString()]);
      await render();
      expect(element.querySelector('#audit-range-error')).toBeNull();
    });

    it('finds the last broadcast of the active production and shows exactly its entries', async () => {
      await open([auditEntryFixture(1)]);

      choose(control('#audit-range'), 'lastBroadcast');
      await flushMicrotasks();
      fixture.detectChanges();
      // "All productions" becomes the active one, which applies the filters again.
      const lookup = audit();
      expect(params(lookup)['production']).toEqual(['prd_a']);
      expect(params(lookup)['action']).toEqual(['broadcast.started', 'broadcast.ended']);
      lookup.flush(
        page([
          auditEntryFixture(9, {
            action: 'broadcast.ended',
            at: '2026-10-26T12:00:00.500000+00:00',
          }),
          auditEntryFixture(5, {
            action: 'broadcast.started',
            at: '2026-10-26T11:00:00.250000+00:00',
          }),
        ]),
      );
      await render();
      const list = audit();
      expect(params(list)['production']).toEqual(['prd_a']);
      expect(params(list)['from']).toEqual(['2026-10-26T11:00:00.250000+00:00']);
      expect(params(list)['to']).toEqual(['2026-10-26T12:00:00.501Z']);
      list.flush(page([auditEntryFixture(9), auditEntryFixture(5)]));
      await render();

      expect(rows()).toHaveLength(2);
      expect(control<HTMLSelectElement>('#audit-production').value).toBe('prd_a');
    });

    it('waits for the list of productions when "Last broadcast" is chosen before it arrived (issue 32)', async () => {
      fixture = TestBed.createComponent(AuditPageComponent);
      element = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await flushMicrotasks();
      const productions = http.expectOne('/api/productions');
      audit().flush(page([auditEntryFixture(1)]));
      await render();

      // The operator is quicker than the list: there is no active production to choose yet, and that is no answer.
      choose(control('#audit-range'), 'lastBroadcast');
      await flushMicrotasks();
      fixture.detectChanges();
      http.expectNone((request) => request.url === '/api/audit');
      expect(element.querySelector('.c-hint[role=status]')).toBeNull();

      productions.flush(PRODUCTIONS);
      await flushMicrotasks();
      fixture.detectChanges();
      const lookup = audit();
      expect(params(lookup)['production']).toEqual(['prd_a']);
      expect(params(lookup)['action']).toEqual(['broadcast.started', 'broadcast.ended']);
      lookup.flush(
        page([
          auditEntryFixture(9, {
            action: 'broadcast.ended',
            at: '2026-10-26T12:00:00.500000+00:00',
          }),
          auditEntryFixture(5, {
            action: 'broadcast.started',
            at: '2026-10-26T11:00:00.250000+00:00',
          }),
        ]),
      );
      await render();
      audit().flush(page([auditEntryFixture(9), auditEntryFixture(5)]));
      await render();

      expect(rows()).toHaveLength(2);
      expect(control<HTMLSelectElement>('#audit-production').value).toBe('prd_a');
      expect(element.querySelector('.c-hint[role=status]')).toBeNull();
    });

    it('says so when the production had no broadcast yet and shows no entries', async () => {
      await open([auditEntryFixture(1)]);
      choose(control('#audit-production'), 'prd_b');
      await flushMicrotasks();
      audit().flush(page([auditEntryFixture(1)]));
      await render();

      choose(control('#audit-range'), 'lastBroadcast');
      await flushMicrotasks();
      audit().flush(page([]));
      await render();

      expect(text(control('.c-hint[role=status]'))).toBe('This production has no broadcast yet.');
      expect(rows()).toHaveLength(0);
      http.expectNone((request) => request.url === '/api/audit');
    });

    it('asks for a production when the sign-ins are chosen', async () => {
      await open([]);
      choose(control('#audit-production'), 'none');
      await flushMicrotasks();
      audit().flush(page([]));
      await render();

      choose(control('#audit-range'), 'lastBroadcast');
      await render();

      expect(text(control('.c-hint[role=status]'))).toBe('Choose a production first.');
      http.expectNone((request) => request.url === '/api/audit');
    });
  });

  it('clears every filter at once', async () => {
    await open([]);
    button('Media').click();
    await flushMicrotasks();
    audit().flush(page([]));
    await render();

    button('Clear filters').click();
    await flushMicrotasks();

    expect(params(audit())['category']).toBeUndefined();
    await render();
    expect(element.querySelector('.c-audit__chip[aria-pressed=true]')).toBeNull();
    expect(
      Array.from(element.querySelectorAll('button')).some((b) => text(b) === 'Clear filters'),
    ).toBe(false);
  });

  describe('export', () => {
    /** Opens the Export menu and chooses an item. */
    async function exportAs(item: 'Export as CSV' | 'Export as JSON'): Promise<void> {
      button('Export').click();
      await render();
      const menu = control('[role="menu"]');
      expect(menu.getAttribute('aria-label')).toBe('Export the filtered entries');
      const choice = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
        (candidate) => text(candidate).startsWith(item),
      );
      choice?.click();
      await flushMicrotasks();
    }

    it('exports the filtered entries as CSV and saves the file', async () => {
      await open([auditEntryFixture(1)]);
      button('Devices').click();
      await flushMicrotasks();
      audit().flush(page([auditEntryFixture(1)], 'cursor-1'));
      await render();

      await exportAs('Export as CSV');
      const request = http.expectOne((r) => r.url === '/api/audit/export.csv');
      expect(params(request)).toEqual({ category: ['devices'] });
      request.flush('time,actor\r\n', {
        headers: {
          'Content-Disposition': 'attachment; filename="studioflow-audit-2026-10-26.csv"',
        },
      });
      await render();

      expect(saveTextFile).toHaveBeenCalledWith(
        'time,actor\r\n',
        'studioflow-audit-2026-10-26.csv',
      );
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'studioflow-audit-2026-10-26.csv exported',
      );
    });

    it('exports JSON with the same filters', async () => {
      await open([auditEntryFixture(1)]);
      choose(control('#audit-production'), 'prd_b');
      await flushMicrotasks();
      audit().flush(page([auditEntryFixture(1)]));
      await render();

      await exportAs('Export as JSON');
      const request = http.expectOne((r) => r.url === '/api/audit/export.json');
      expect(params(request)).toEqual({ production: ['prd_b'] });
      request.flush('[]', {
        headers: {
          'Content-Disposition': 'attachment; filename="studioflow-audit-2026-10-26.json"',
        },
      });
      await render();
      expect(saveTextFile).toHaveBeenCalledWith('[]', 'studioflow-audit-2026-10-26.json');
    });

    it('is off while the list loads or after it failed', async () => {
      fixture = TestBed.createComponent(AuditPageComponent);
      element = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();
      expect(button('Export').disabled).toBe(true);
      http.expectOne('/api/productions').flush([]);
      audit().flush(null, { status: 500, statusText: 'Server Error' });
      await render();
      expect(button('Export').disabled).toBe(true);
    });

    it('tells that an export is too large and saves nothing', async () => {
      await open([auditEntryFixture(1)]);

      await exportAs('Export as CSV');
      http
        .expectOne((r) => r.url === '/api/audit/export.csv')
        .flush(JSON.stringify({ status: 409, code: 'limit_reached' }), {
          status: 409,
          statusText: 'Conflict',
        });
      await render();

      expect(saveTextFile).not.toHaveBeenCalled();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'The export would be too large. Narrow the time range or the filters.',
      );
      expect(button('Export').disabled).toBe(false);
    });

    it('does not start a second export while one runs', async () => {
      await open([auditEntryFixture(1)]);

      await exportAs('Export as CSV');
      fixture.detectChanges();
      expect(button('Exporting…').disabled).toBe(true);
      button('Exporting…').click();
      await flushMicrotasks();
      http
        .expectOne((r) => r.url === '/api/audit/export.csv')
        .flush('x', { status: 200, statusText: 'OK' });
      await render();
    });
  });

  it('adds new entries at the top while the page is open', async () => {
    await open([auditEntryFixture(10)]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fixture.destroy();
    fixture = TestBed.createComponent(AuditPageComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await flushMicrotasks();
    http.expectOne('/api/productions').flush(PRODUCTIONS);
    audit().flush(page([auditEntryFixture(10)]));
    await render();

    await vi.advanceTimersByTimeAsync(AUDIT_REFRESH_MS);
    audit().flush(page([auditEntryFixture(11), auditEntryFixture(10)]));
    await render();

    expect(rows()).toHaveLength(2);
    expect(rows()[0].classList.contains('is-fresh')).toBe(true);
    expect(rows()[1].classList.contains('is-fresh')).toBe(false);
    vi.useRealTimers();
  });

  it('stops asking for new entries when the page is left', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await open([auditEntryFixture(10)]);

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(AUDIT_REFRESH_MS * 2);

    http.expectNone((request) => request.url === '/api/audit');
    vi.useRealTimers();
  });

  it('can be used with the keyboard: every control is a native button, select or input', async () => {
    await open([auditEntryFixture(1)]);

    const controls = element.querySelectorAll('button, select, input, a');
    expect(controls.length).toBeGreaterThan(10);
    expect(
      Array.from(element.querySelectorAll('[tabindex], [role=button]')).filter(
        (node) => !(node instanceof HTMLButtonElement),
      ),
    ).toEqual([]);
    for (const label of ['#audit-range', '#audit-production', '#audit-search']) {
      expect(element.querySelector(`label[for="${label.slice(1)}"]`)).not.toBeNull();
    }
    expect(control('.c-audit-table').querySelector('caption')).not.toBeNull();
    expect(
      Array.from(element.querySelectorAll('thead th')).every(
        (th) => th.getAttribute('scope') === 'col',
      ),
    ).toBe(true);
  });

  describe('menu of an entry', () => {
    /** The labels of the open context menu, with "—" for a separator. */
    function menuLabels(): string[] {
      return (TestBed.inject(ContextMenuService).current()?.entries ?? []).map((entry) =>
        entry === 'separator' ? '—' : entry.label,
      );
    }

    function run(label: string): void {
      const item = TestBed.inject(ContextMenuService)
        .current()
        ?.entries.find((entry) => entry !== 'separator' && entry.label === label);
      if (!item || item === 'separator') {
        throw new Error(`no menu item "${label}"`);
      }
      TestBed.inject(ContextMenuService).run(item);
    }

    it('opens on a right click with the details, copy and the two filters', async () => {
      await open([auditEntryFixture(1, { productionId: 'prd_b', productionName: 'Podcast' })]);

      rows()[0].dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 50,
        }),
      );

      expect(menuLabels()).toEqual([
        'Show details',
        'Copy entry',
        '—',
        'Show only “Podcast”',
        'Show only “Production”',
      ]);
      expect(TestBed.inject(ContextMenuService).current()?.label).toBe(
        `Actions for the entry from ${formatDateTime(new Date(auditEntryFixture(1).at), { seconds: true })}`,
      );

      run('Show only “Podcast”');
      await flushMicrotasks();
      const byProduction = audit();
      expect(params(byProduction)['production']).toEqual(['prd_b']);
      byProduction.flush(
        page([auditEntryFixture(1, { productionId: 'prd_b', productionName: 'Podcast' })]),
      );
      await render();

      rows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(menuLabels()[3]).toBe('Show only “Podcast”');
      run('Show only “Production”');
      await flushMicrotasks();
      const byCategory = audit();
      expect(params(byCategory)['category']).toEqual(['production']);
      byCategory.flush(page([]));
      await render();
    });

    it('opens the same menu under the ⋯ button and shows the details from it', async () => {
      await open([auditEntryFixture(1)]);
      const more = control<HTMLButtonElement>('.c-audit-table__menu');
      expect(more.getAttribute('aria-haspopup')).toBe('menu');

      more.click();
      expect(menuLabels()[0]).toBe('Show details');
      run('Show details');
      await render();
      expect(control('.c-audit-table__toggle').getAttribute('aria-expanded')).toBe('true');

      more.click();
      expect(menuLabels()[0]).toBe('Hide details');
    });

    it('cannot filter by the production of a sign-in, which has none', async () => {
      await open([auditEntryFixture(1, { productionId: null, productionName: null })]);
      rows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const item = TestBed.inject(ContextMenuService)
        .current()
        ?.entries.find(
          (entry) => entry !== 'separator' && entry.label === 'No production to filter by',
        );
      expect(item !== 'separator' && item?.disabled).toBe(true);
    });

    it('copies the entry as one line', async () => {
      const copy = vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(true);
      const entry = auditEntryFixture(1);
      await open([entry]);

      rows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      run('Copy entry');

      expect(copy).toHaveBeenCalledWith(
        `${formatDateTime(new Date(entry.at), { seconds: true })} · Admin · Scene “Break” is live · Webinar (scene.live)`,
        { label: 'Scene “Break” is live' },
      );
    });
  });

  it('puts the focus in the search box on Ctrl+F or ⌘F', async () => {
    await open([]);
    const input = control<HTMLInputElement>('#audit-search');
    expect(input.title).toMatch(/^Search the activity log \((Ctrl\+|⌘)F\)$/);

    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      (document.activeElement as HTMLElement | null)?.blur();
      const event = new KeyboardEvent('keydown', { key: 'f', cancelable: true, ...init });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
    }

    (document.activeElement as HTMLElement | null)?.blur();
    const plain = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    document.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });
});
