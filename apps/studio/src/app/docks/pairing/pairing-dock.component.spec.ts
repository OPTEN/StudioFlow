import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { InviteDto } from '@flowstudio/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { DockLayoutService } from '../../shell/workspace/dock-layout.service';
import { expiryText } from './link-tab.component';
import { PairingDockComponent, tabForKey } from './pairing-dock.component';
import { latestPhoneInvite } from './phone-tab.component';
import { displayUrl } from './public-url.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;

function invite(
  id: string,
  kind: InviteDto['kind'],
  minutes = 30,
  created = Date.now(),
): InviteDto {
  return {
    id,
    kind,
    url:
      kind === 'phoneQr'
        ? `https://flowstudio.opten.ch/join/i/${id}`
        : `https://flowstudio.opten.ch/j/${id}`,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  };
}

describe('pairing helpers', () => {
  it('walks the tabs with arrow keys, Home and End (wrapping)', () => {
    expect(tabForKey('laptop', 'ArrowRight')).toBe('link');
    expect(tabForKey('link', 'ArrowRight')).toBe('phone');
    expect(tabForKey('phone', 'ArrowLeft')).toBe('link');
    expect(tabForKey('link', 'Home')).toBe('phone');
    expect(tabForKey('phone', 'End')).toBe('link');
    expect(tabForKey('phone', 'Enter')).toBeNull();
  });

  it('formats URLs and remaining times', () => {
    expect(displayUrl('https://flowstudio.opten.ch/join/')).toBe('flowstudio.opten.ch/join');
    expect(expiryText(28 * 60_000)).toBe('läuft in 28 Minuten ab');
    expect(expiryText(50_000)).toBe('läuft in 1 Minute ab');
    expect(expiryText(10_000)).toBe('läuft gleich ab');
    expect(expiryText(0)).toBe('abgelaufen');
  });

  it('picks the newest phone invite', () => {
    const old = invite('inv_old', 'phoneQr', 30, Date.now() - 60_000);
    const fresh = invite('inv_new', 'phoneQr');
    expect(latestPhoneInvite([old, invite('inv_l', 'laptopLink'), fresh])?.id).toBe('inv_new');
    expect(latestPhoneInvite([invite('inv_l', 'laptopLink')])).toBeNull();
  });
});

describe('PairingDockComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<PairingDockComponent>;
  let element: HTMLElement;
  let layout: DockLayoutService;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture());
    layout = TestBed.inject(DockLayoutService);
    layout.openPairing('laptop');
    fixture = TestBed.createComponent(PairingDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    harness.http.expectOne('/api/system/info').flush({
      version: '1',
      publicBaseUrl: 'https://regie.example.ch/',
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
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

  function tabs(): HTMLButtonElement[] {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
  }

  afterEach(() => harness.http.verify());

  it('shows the Laptop tab with the short address and roving tabs', async () => {
    await setup();
    expect(tabs().map((tab) => text(tab))).toEqual(['Handy', 'Laptop', 'Link']);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(element.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      'fs-pair-tab-laptop',
    );
    expect(text(element.querySelector('.c-pair__url'))).toBe('regie.example.ch/join');
    expect(text(element.querySelector('fs-pairing-requests'))).toContain('Noch keine Anfrage.');
    tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await render();
    expect(layout.pairingTab()).toBe('link');
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('shows the QR code of the phone invite with its remaining time and renews it', async () => {
    await setup();
    tabs()[0].click();
    await render();
    harness.http
      .expectOne(`${BASE}/pairing/phone-invite`)
      .flush(invite('inv_aaaaaaaaaaaaaaaa', 'phoneQr'));
    await render();
    expect(element.querySelector('fs-qr-code svg path')?.getAttribute('d')).toBeTruthy();
    expect(text(element.querySelector('.c-pair__qr-side .c-hint'))).toMatch(
      /^Gilt einmal, noch (29:59|30:00) min\.$/,
    );
    expect(text(element.querySelector('.c-pair__side-title'))).toBe(
      'Tipps für fest montierte Handys',
    );
    button('Neuen Code erzeugen')?.click();
    harness.http
      .expectOne(`${BASE}/pairing/phone-invite/renew`)
      .flush(invite('inv_bbbbbbbbbbbbbbbb', 'phoneQr'));
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Neuer QR-Code, der alte gilt nicht mehr',
    );
  });

  it('creates and revokes an invite link', async () => {
    await setup();
    tabs()[2].click();
    await render();
    button('Link erstellen')?.click();
    const create = harness.http.expectOne(`${BASE}/pairing/invites`);
    expect(create.request.body).toEqual({ kind: 'laptopLink' });
    create.flush(invite('inv_cccccccccccccccc', 'laptopLink'), {
      status: 201,
      statusText: 'Created',
    });
    await render();
    expect(text(element.querySelector('.c-pair__url'))).toBe(
      'flowstudio.opten.ch/j/inv_cccccccccccccccc',
    );
    expect(text(element.querySelector('fs-link-tab .c-hint'))).toBe(
      'Gilt einmal und läuft in 30 Minuten ab. Wer ihn öffnet, ist direkt gekoppelt.',
    );
    button('Link widerrufen')?.click();
    harness.http
      .expectOne(`${BASE}/pairing/invites/inv_cccccccccccccccc`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
    expect(button('Link erstellen')).toBeDefined();
    expect(TestBed.inject(ToastService).current()?.message).toBe('Einladungslink widerrufen');
  });

  it('closes with the close button', async () => {
    await setup();
    element.querySelector<HTMLButtonElement>('[aria-label="Gerät koppeln schliessen"]')?.click();
    expect(layout.pairingOpen()).toBe(false);
  });
});
