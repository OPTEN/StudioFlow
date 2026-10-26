import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { AuthService } from '../../core/auth/auth.service';
import { PopoverService } from '../../core/ui/popover.directive';
import { PRODUCTION_POPOVER, ProductionMenuComponent } from './production-menu.component';

describe('ProductionMenuComponent: change password', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ProductionMenuComponent>;
  let element: HTMLElement;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture());
    TestBed.inject(AuthService).session.set({ username: 'regie' });
    fixture = TestBed.createComponent(ProductionMenuComponent);
    element = fixture.nativeElement as HTMLElement;
    TestBed.inject(PopoverService).open(PRODUCTION_POPOVER);
    await render();
    harness.http.match('/api/productions').forEach((request) => request.flush([]));
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function item(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  afterEach(() => harness?.http.verify());

  it('offers "Change password" between the production entries and "Sign out"', async () => {
    await setup();
    const labels = Array.from(element.querySelectorAll('.c-menu-item')).map((button) =>
      button.textContent?.trim(),
    );
    expect(labels.slice(-2)).toEqual(['Change password', 'Sign out']);
  });

  it('links to the audit log page', async () => {
    await setup();

    const link = element.querySelector<HTMLAnchorElement>('a.c-menu-item');

    expect(link?.textContent?.trim()).toBe('Audit log');
    expect(link?.getAttribute('href')).toBe('/audit');
  });

  it('opens the form in the menu and goes back to the menu on cancel', async () => {
    await setup();
    item('Change password').click();
    await render();
    expect(element.querySelector('sf-change-password-form')).not.toBeNull();
    expect(element.querySelector('#change-current')).not.toBeNull();
    item('Cancel').click();
    await render();
    expect(element.querySelector('sf-change-password-form')).toBeNull();
    expect(element.querySelector('.c-menu-item')).not.toBeNull();
  });

  it('changes the password and returns to the menu', async () => {
    await setup();
    item('Change password').click();
    await render();
    for (const [id, value] of [
      ['change-current', 'old-passphrase-1'],
      ['change-password', 'new-passphrase-2'],
      ['change-repeat', 'new-passphrase-2'],
    ]) {
      const field = element.querySelector<HTMLInputElement>(`#${id}`)!;
      field.value = value;
      field.dispatchEvent(new Event('input'));
    }
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushMicrotasks();
    harness.http
      .expectOne('/api/auth/password')
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
    expect(element.querySelector('sf-change-password-form')).toBeNull();
    expect(element.querySelector('.c-menu-item')).not.toBeNull();
  });

  it('starts at the menu again when the popover is opened anew', async () => {
    await setup();
    item('Change password').click();
    await render();
    const popovers = TestBed.inject(PopoverService);
    popovers.close(PRODUCTION_POPOVER);
    await render();
    popovers.open(PRODUCTION_POPOVER);
    await render();
    harness.http.match('/api/productions').forEach((request) => request.flush([]));
    await render();
    expect(element.querySelector('sf-change-password-form')).toBeNull();
  });
});
