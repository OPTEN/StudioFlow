import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { ProductionsPageComponent } from './productions-page.component';

const OTHER_ID = 'prd_bbbbbbbbbbbbbbbb';
const LIST = [
  {
    id: PRODUCTION_ID,
    name: 'Webinar',
    slug: 'webinar',
    isActive: true,
    createdAt: '2026-10-20T08:00:00Z',
  },
  {
    id: OTHER_ID,
    name: 'Town hall',
    slug: 'town-hall',
    isActive: false,
    createdAt: '2026-10-21T08:00:00Z',
  },
];

describe('ProductionsPageComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ProductionsPageComponent>;
  let element: HTMLElement;

  async function setup(
    broadcast: 'standby' | 'live' = 'standby',
    query: Record<string, string> = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({ production: productionFixture({ name: 'Webinar', broadcast }) }),
    );
    fixture = TestBed.createComponent(ProductionsPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    flushList();
    await render();
  }

  function flushList(list = LIST): void {
    harness.http.match('/api/productions').forEach((request) => {
      if (request.request.method === 'GET') {
        request.flush(list);
      }
    });
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined = element): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function button(label: string, scope: Element = element): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label || entry.getAttribute('aria-label') === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  async function click(label: string, scope?: Element): Promise<void> {
    button(label, scope).click();
    await render();
  }

  function rows(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('[data-testid="production-row"]'));
  }

  afterEach(() => harness?.http.verify());

  describe('list', () => {
    it('lists the productions with the active one marked and a switch for the others', async () => {
      await setup();
      expect(rows().map((row) => text(row.querySelector('.c-prods__name')))).toEqual([
        'Webinar',
        'Town hall',
      ]);
      expect(rows()[0]?.getAttribute('aria-current')).toBe('true');
      expect(text(rows()[0])).toContain('Active');
      expect(text(rows()[0])).toContain('Created');
      expect(button('Switch to “Town hall”')).toBeTruthy();
      expect(text(element.querySelector('.c-page__lead'))).toContain(
        'The active production is the one the control room shows',
      );
    });

    it('switches at once while the broadcast is not live', async () => {
      await setup();
      await click('Switch to “Town hall”');
      harness.http.expectOne(`/api/productions/${OTHER_ID}/activate`).flush(productionFixture());
      await render();
      flushList();
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe('Switched to “Town hall”');
    });

    it('asks first while the broadcast is live and marks the production on air', async () => {
      await setup('live');
      expect(text(rows()[0])).toContain('On air');
      await click('Switch to “Town hall”');
      harness.http.expectNone(`/api/productions/${OTHER_ID}/activate`);
      const box = element.querySelector('[role="group"][aria-label="Switch production"]');
      expect(text(box)).toContain('“Webinar” is on air. Its output keeps running');
      await click('Cancel', box!);
      expect(element.querySelector('sf-confirm-box')).toBeNull();

      await click('Switch to “Town hall”');
      await click('Switch production');
      harness.http.expectOne(`/api/productions/${OTHER_ID}/activate`).flush(productionFixture());
      await render();
      flushList();
      await render();
    });

    it('says why nothing can be switched or created while offline', async () => {
      await setup();
      harness.hub.drop();
      await render();
      expect(text()).toContain('No connection to the server.');
      expect(button('Switch to “Town hall”').disabled).toBe(true);
      expect(button('New production…').disabled).toBe(true);
    });
  });

  describe('new production', () => {
    function nameInput(): HTMLInputElement {
      return element.querySelector<HTMLInputElement>('#new-production-name')!;
    }

    function pressed(): string[] {
      return Array.from(element.querySelectorAll('.c-seg button[aria-pressed="true"]')).map(
        (node) => text(node),
      );
    }

    it('opens in place, starts at 16:9 · 1080p and creates the production, then switches to it', async () => {
      await setup();
      await click('New production…');
      expect(pressed()).toEqual(['16:9', '1080p']);
      nameInput().value = 'Reel';
      nameInput().dispatchEvent(new Event('input'));
      await click('9:16');
      await click('720p');
      await click('Create production');

      const request = harness.http.expectOne(
        (candidate) => candidate.url === '/api/productions' && candidate.method === 'POST',
      );
      expect(request.request.body).toEqual({ name: 'Reel', format: 'portrait', resolution: 'p720' });
      request.flush({ ...productionFixture({ id: 'prd_cccccccccccccccc', name: 'Reel' }) });
      await render();
      harness.http
        .expectOne('/api/productions/prd_cccccccccccccccc/activate')
        .flush(productionFixture());
      await render();
      flushList();
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Production “Reel” created and active',
      );
      expect(nameInput()).toBeNull();
    });

    it('creates without switching while the broadcast is live, and says so before', async () => {
      await setup('live');
      await click('New production…');
      expect(text()).toContain('the new production is created but not opened');
      nameInput().value = 'Later';
      nameInput().dispatchEvent(new Event('input'));
      await click('Create production');
      harness.http
        .expectOne((candidate) => candidate.url === '/api/productions' && candidate.method === 'POST')
        .flush(productionFixture({ id: 'prd_cccccccccccccccc', name: 'Later' }));
      await render();
      flushList();
      await render();
      harness.http.expectNone('/api/productions/prd_cccccccccccccccc/activate');
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Production “Later” created. You can switch after the broadcast.',
      );
    });

    it('explains an empty name and sends nothing', async () => {
      await setup();
      await click('New production…');
      await click('Create production');
      expect(text(element.querySelector('.c-field-error'))).toBe(
        'Enter a name of 1 to 80 characters.',
      );
      harness.http.expectNone(
        (candidate) => candidate.url === '/api/productions' && candidate.method === 'POST',
      );
    });

    it('starts at 16:9 · 1080p again after Cancel', async () => {
      await setup();
      await click('New production…');
      await click('1:1');
      await click('Cancel');
      await click('New production…');
      expect(pressed()).toEqual(['16:9', '1080p']);
    });

    it('opens from the switcher with ?form=new', async () => {
      await setup('standby', { form: 'new' });
      expect(nameInput()).not.toBeNull();
    });
  });

  describe('import, duplicate and export', () => {
    it('opens the import from the switcher with ?form=import and closes it on Cancel', async () => {
      await setup('standby', { form: 'import' });
      expect(element.querySelector('sf-import-production-form')).not.toBeNull();
      await click('Cancel', element.querySelector('sf-import-production-form')!);
      expect(element.querySelector('sf-import-production-form')).toBeNull();
    });

    it('duplicates the active production; the copy is listed, not active, and the toast offers to switch', async () => {
      await setup();
      await click('Duplicate…');
      const form = element.querySelector('sf-duplicate-production-form')!;
      expect(text(form)).toContain('Cameras and screens become placeholders');
      form.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      await flushMicrotasks();
      const request = harness.http.expectOne(`/api/productions/${PRODUCTION_ID}/duplicate`);
      expect(request.request.body).toEqual({ name: 'Webinar (copy)' });
      request.flush(
        { ...productionFixture({ id: 'prd_cccccccccccccccc', name: 'Webinar (copy)' }), isActive: false },
        { status: 201, statusText: 'Created' },
      );
      await render();
      flushList([
        ...LIST,
        {
          id: 'prd_cccccccccccccccc',
          name: 'Webinar (copy)',
          slug: 'webinar-copy',
          isActive: false,
          createdAt: '2026-10-22T08:00:00Z',
        },
      ]);
      await render();
      expect(element.querySelector('sf-duplicate-production-form')).toBeNull();
      expect(rows()[2]?.getAttribute('aria-current')).toBeNull();
      const toast = TestBed.inject(ToastService).current();
      expect(toast?.message).toBe(
        'Production “Webinar (copy)” created. It is not active; switch to it when you are ready.',
      );
      expect(toast?.action?.label).toBe('Switch now');
      harness.http.expectNone(`/api/productions/prd_cccccccccccccccc/activate`);

      TestBed.inject(ToastService).runAction();
      harness.http
        .expectOne('/api/productions/prd_cccccccccccccccc/activate')
        .flush(productionFixture());
      await render();
      flushList();
      await render();
    });

    it('allows duplicating while the broadcast is live', async () => {
      await setup('live');
      expect(button('Duplicate…').disabled).toBe(false);
    });

    it('exports with a plain download link to the active production', async () => {
      await setup();
      const link = element.querySelector<HTMLAnchorElement>('[data-testid="export-production"]')!;
      expect(link.getAttribute('href')).toBe(`/api/productions/${PRODUCTION_ID}/export`);
      expect(link.hasAttribute('download')).toBe(true);
      link.addEventListener('click', (event) => event.preventDefault());
      link.click();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Export of “Webinar” started. Your browser saves the file.',
      );
    });
  });
});
