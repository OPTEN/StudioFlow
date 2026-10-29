import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ContextMenuService } from '../../core/ui/context-menu';
import { PopoverService } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { PRODUCTION_POPOVER, ProductionMenuComponent } from './production-menu.component';

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

describe('ProductionMenuComponent: the production switcher', () => {
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
    await render();
  }

  async function open(): Promise<void> {
    TestBed.inject(PopoverService).open(PRODUCTION_POPOVER);
    await render();
    harness.http.match('/api/productions').forEach((request) => request.flush(LIST));
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function items(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-menu-item'));
  }

  function item(label: string): HTMLElement {
    const found = items().find((entry) => text(entry).startsWith(label));
    if (!found) {
      throw new Error(`no menu item "${label}"`);
    }
    return found;
  }

  afterEach(() => harness?.http.verify());

  it('is a title button named after the production that opens a dialog', async () => {
    await setup();
    const trigger = element.querySelector<HTMLButtonElement>('.c-prod__trigger')!;
    expect(trigger.getAttribute('aria-label')).toBe('Production Webinar, menu');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(text(element.querySelector('.c-prod__name'))).toBe('Webinar');
  });

  it('lists the productions with the active one checked, then new, import and the settings', async () => {
    await setup();
    await open();

    const dialog = element.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Production');
    expect(
      items().map((entry) => entry.querySelector('.c-prod__item-name')?.textContent ?? text(entry)),
    ).toEqual(['Webinar', 'Town hall', 'New production…', 'Import…', 'Production settings…']);
    expect(item('Webinar').getAttribute('aria-current')).toBe('true');
    expect(item('Webinar').querySelector('svg')).not.toBeNull();
    expect(item('Town hall').getAttribute('aria-current')).toBeNull();
    // Account and installation entries live in the settings window now.
    for (const gone of ['Change password', 'Sign out', 'Server settings', 'Audit log', 'Rename']) {
      expect(text(dialog)).not.toContain(gone);
    }
  });

  it('leads to the settings window: the forms of "All productions" and the production settings', async () => {
    await setup();
    await open();

    expect(item('New production…').getAttribute('href')).toBe('/settings/productions?form=new');
    expect(item('Import…').getAttribute('href')).toBe('/settings/productions?form=import');
    expect(item('Production settings…').getAttribute('href')).toBe('/settings/production');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    item('Production settings…').click();
    expect(String(navigate.mock.calls[0]?.[0])).toBe('/settings/production');
    await render();
    expect(TestBed.inject(PopoverService).isOpen(PRODUCTION_POPOVER)).toBe(false);
  });

  it('switches to another production in one click while the broadcast is not live', async () => {
    await setup();
    await open();

    item('Town hall').click();
    await render();
    harness.http.expectOne(`/api/productions/${OTHER_ID}/activate`).flush(productionFixture());
    await render();
    harness.http.match(() => true).forEach((request) => request.flush(null));

    expect(TestBed.inject(ToastService).current()?.message).toBe('Switched to “Town hall”');
    expect(TestBed.inject(PopoverService).isOpen(PRODUCTION_POPOVER)).toBe(false);
  });

  it('asks first while the broadcast is live and names what keeps running', async () => {
    await setup('live');
    await open();

    expect(text(item('Webinar'))).toContain('On air');
    item('Town hall').click();
    await render();

    const box = element.querySelector('[role="group"][aria-label="Switch production"]');
    expect(text(box)).toContain('“Webinar” is on air. Its output keeps running');
    harness.http.expectNone(`/api/productions/${OTHER_ID}/activate`);

    const cancel = Array.from(box!.querySelectorAll('button')).find((b) => text(b) === 'Cancel')!;
    cancel.click();
    await render();
    expect(element.querySelector('sf-confirm-box')).toBeNull();
    expect(items().length).toBe(5);

    item('Town hall').click();
    await render();
    Array.from(element.querySelectorAll<HTMLButtonElement>('sf-confirm-box button'))
      .find((b) => text(b) === 'Switch production')!
      .click();
    await render();
    harness.http.expectOne(`/api/productions/${OTHER_ID}/activate`).flush(productionFixture());
    await render();
    harness.http.match(() => true).forEach((request) => request.flush(null));
  });

  it('only closes when the active production is chosen', async () => {
    await setup();
    await open();

    item('Webinar').click();
    await render();

    harness.http.expectNone(`/api/productions/${PRODUCTION_ID}/activate`);
    expect(TestBed.inject(PopoverService).isOpen(PRODUCTION_POPOVER)).toBe(false);
  });

  it('says why switching is off while the control room is offline', async () => {
    await setup();
    await open();
    harness.hub.drop();
    await render();

    expect(text(element)).toContain('No connection to the server.');
    expect((item('Town hall') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads the list again at every opening and says when it cannot', async () => {
    await setup();
    const popovers = TestBed.inject(PopoverService);
    popovers.open(PRODUCTION_POPOVER);
    await render();
    harness.http
      .expectOne('/api/productions')
      .flush({ code: 'internal_error' }, { status: 500, statusText: 'x' });
    await render();
    expect(text(element)).toContain('The productions could not be loaded.');

    popovers.close(PRODUCTION_POPOVER);
    await render();
    await open();
    expect(item('Town hall')).toBeTruthy();
  });

  describe('right-click menu of a production', () => {
    function labels(): string[] {
      return (TestBed.inject(ContextMenuService).current()?.entries ?? []).map((entry) =>
        entry === 'separator' ? '—' : entry.label,
      );
    }

    async function rightClick(label: string): Promise<void> {
      item(label).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await render();
    }

    function run(label: string): void {
      const menus = TestBed.inject(ContextMenuService);
      const entry = menus.current()?.entries.find((e) => e !== 'separator' && e.label === label);
      if (!entry || entry === 'separator') {
        throw new Error(`no entry ${label}`);
      }
      menus.run(entry);
    }

    it('offers "Switch to" and the production settings for the active one', async () => {
      await setup();
      await open();
      await rightClick('Webinar');
      expect(labels()).toEqual(['Switch to', '—', 'Production settings…']);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      run('Production settings…');
      expect(navigate).toHaveBeenCalledWith('/settings/production');
      expect(TestBed.inject(PopoverService).isOpen(PRODUCTION_POPOVER)).toBe(false);
    });

    it('switches to another one, or leads to all productions', async () => {
      await setup();
      await open();
      await rightClick('Town hall');
      expect(labels()).toEqual(['Switch to', '—', 'All productions…']);
      run('Switch to');
      await render();
      harness.http.expectOne(`/api/productions/${OTHER_ID}/activate`).flush(productionFixture());
      await render();
      harness.http.match(() => true).forEach((request) => request.flush(null));
    });

    it('asks first while live, in the switcher it opens again', async () => {
      await setup('live');
      await open();
      await rightClick('Town hall');
      TestBed.inject(PopoverService).close(PRODUCTION_POPOVER);
      await render();
      run('Switch to');
      await render();
      harness.http.match('/api/productions').forEach((request) => request.flush(LIST));
      await render();
      expect(TestBed.inject(PopoverService).isOpen(PRODUCTION_POPOVER)).toBe(true);
      expect(
        element.querySelector('[role="group"][aria-label="Switch production"]'),
      ).not.toBeNull();
      harness.http.expectNone(`/api/productions/${OTHER_ID}/activate`);
    });
  });
});
