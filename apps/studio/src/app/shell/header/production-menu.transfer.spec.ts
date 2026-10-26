import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { PopoverService } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { PRODUCTION_POPOVER, ProductionMenuComponent } from './production-menu.component';

const LIST = [
  { id: PRODUCTION_ID, name: 'Webinar', slug: 'webinar', isActive: true },
  { id: 'prd_bbbbbbbbbbbbbbbb', name: 'Town hall', slug: 'town-hall', isActive: false },
];

describe('ProductionMenuComponent: duplicate, export and import', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ProductionMenuComponent>;
  let element: HTMLElement;

  async function setup(broadcast: 'standby' | 'live' = 'standby'): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({ production: productionFixture({ name: 'Webinar', broadcast }) }),
    );
    fixture = TestBed.createComponent(ProductionMenuComponent);
    element = fixture.nativeElement as HTMLElement;
    TestBed.inject(PopoverService).open(PRODUCTION_POPOVER);
    await render();
    flushList();
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function flushList(): void {
    harness.http.match('/api/productions').forEach((request) => request.flush(LIST));
  }

  function item(label: string): HTMLElement {
    const found = Array.from(element.querySelectorAll<HTMLElement>('.c-menu-item')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no menu item "${label}"`);
    }
    return found;
  }

  afterEach(() => harness?.http.verify());

  it('offers "Duplicate production…" and "Export" for this production and "Import…" next to the production switcher', async () => {
    await setup();
    const labels = Array.from(element.querySelectorAll('.c-menu-item')).map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Rename',
      'Edit slates',
      'Text colours…',
      'Format and resolution…',
      'Duplicate production…',
      'Export',
      'Webinar',
      'Town hall',
      'New production…',
      'Import…',
      'Audit log',
      'Change password',
      'Sign out',
    ]);
  });

  it('exports with a plain download link to the current production', async () => {
    await setup();
    const link = item('Export') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(`/api/productions/${PRODUCTION_ID}/export`);
    expect(link.hasAttribute('download')).toBe(true);
    // The click must not navigate in the test window.
    link.addEventListener('click', (event) => event.preventDefault());
    link.click();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Export of “Webinar” started. Your browser saves the file.',
    );
    harness.http.expectNone(() => true);
  });

  it('duplicates, goes back to the menu and lists the copy without switching to it', async () => {
    await setup();
    item('Duplicate production…').click();
    await render();
    expect(element.querySelector('sf-duplicate-production-form')).not.toBeNull();
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushMicrotasks();
    const request = harness.http.expectOne(`/api/productions/${PRODUCTION_ID}/duplicate`);
    expect(request.request.body).toEqual({ name: 'Webinar (copy)' });
    request.flush(
      { id: 'prd_cccccccccccccccc', name: 'Webinar (copy)', isActive: false },
      { status: 201, statusText: 'Created' },
    );
    await render();
    // Back in the menu, whose list is read again; the copy is not the active production.
    harness.http.match('/api/productions').forEach((list) =>
      list.flush([
        ...LIST,
        {
          id: 'prd_cccccccccccccccc',
          name: 'Webinar (copy)',
          slug: 'webinar-copy',
          isActive: false,
        },
      ]),
    );
    await render();
    expect(element.querySelector('sf-duplicate-production-form')).toBeNull();
    expect(item('Webinar (copy)').getAttribute('aria-current')).toBeNull();
    expect(item('Webinar').getAttribute('aria-current')).toBe('true');
    harness.http.expectNone('/api/productions/active');
  });

  it('is allowed while the broadcast is live; the production switch stays locked', async () => {
    await setup('live');
    expect((item('Duplicate production…') as HTMLButtonElement).disabled).toBe(false);
    expect(item('Export').getAttribute('href')).toContain('/export');
    expect((item('Town hall') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the import in the menu and goes back on Cancel', async () => {
    await setup();
    item('Import…').click();
    await render();
    expect(element.querySelector('sf-import-production-form')).not.toBeNull();
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel')!
      .click();
    await render();
    expect(element.querySelector('sf-import-production-form')).toBeNull();
    expect(item('Import…')).toBeTruthy();
  });

  it('disables duplicate and import while the Regie is offline', async () => {
    await setup();
    harness.hub.drop();
    await render();
    expect((item('Duplicate production…') as HTMLButtonElement).disabled).toBe(true);
    expect((item('Import…') as HTMLButtonElement).disabled).toBe(true);
  });
});
