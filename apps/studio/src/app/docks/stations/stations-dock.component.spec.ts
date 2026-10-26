import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HUB, type PairingRequestDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, deviceFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { StationFocusService } from '../../shell/station-focus.service';
import { DockLayoutService } from '../../shell/workspace/dock-layout.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { StationsDockComponent } from './stations-dock.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const PHONE = 'dev_aaaaaaaaaaaaaaaa';
const LAPTOP = 'dev_bbbbbbbbbbbbbbbb';

function knock(): PairingRequestDto {
  return {
    id: 'prq_aaaaaaaaaaaaaaaa',
    name: 'Laptop Mia',
    kind: 'laptop',
    platform: 'Windows · Chrome',
    checkCode: '4712',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

describe('StationsDockComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<StationsDockComponent>;
  let element: HTMLElement;

  async function setup(pairingRequests: PairingRequestDto[] = []): Promise<void> {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, dockSnapshot({ pairingRequests }));
    fixture = TestBed.createComponent(StationsDockComponent);
    element = fixture.nativeElement as HTMLElement;
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

  function rows(): HTMLButtonElement[] {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('.c-st__row'));
  }

  function station(deviceId: string): HTMLElement {
    return element.querySelector<HTMLElement>(`[data-device="${deviceId}"]`) as HTMLElement;
  }

  function button(scope: Element, label: string): HTMLButtonElement | undefined {
    return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
  }

  afterEach(() => harness.http.verify());

  it('lists the stations in station order with code, PGM tag and metrics', async () => {
    await setup();
    hub.emit(HUB.telemetry, {
      deviceId: PHONE,
      telemetry: {
        at: new Date().toISOString(),
        rtc: 'connected',
        batteryPct: 14,
        charging: false,
        network: 'wifi',
        rttMs: 31,
        slots: [
          {
            slot: 'camera',
            state: 'live',
            width: 1920,
            height: 1080,
            fps: 30,
            bitrateKbps: 2800,
            packetLossPct: 0,
            codec: 'h264',
          },
        ],
      },
    });
    await render();
    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(first.getAttribute('aria-label')).toBe('K1 Phone stage left, on Program');
    expect(text(first.querySelector('.c-tag--pgm'))).toBe('PGM');
    expect(text(first.querySelector('.c-st__l2'))).toBe('2.8Mbit/s31msBattery 14%');
    expect(second.getAttribute('aria-label')).toBe('S1 Laptop Lea');
    expect(text(element.querySelector('.c-dock-frame__count'))).toBe('2');
  });

  it('opens the details and blocks a device only after the confirmation, once', async () => {
    await setup();
    rows()[0].click();
    await render();
    expect(rows()[0].getAttribute('aria-expanded')).toBe('true');
    const row = station(PHONE);
    expect(row.className).toContain('is-open');
    expect(text(row.querySelector('.c-st__kv'))).toContain('iPhone · Safari');
    button(row, 'Block device')?.click();
    await render();
    expect(text(row.querySelector('.c-confirm span'))).toBe(
      'K1 will be disconnected immediately and cannot connect again until you unblock it.',
    );
    harness.http.expectNone(() => true);
    const confirm = row.querySelector<HTMLButtonElement>('.c-confirm .c-btn--danger-fill');
    confirm?.click();
    confirm?.click();
    const request = harness.http.expectOne(`${BASE}/devices/${PHONE}/block`);
    expect(request.request.method).toBe('POST');
    await render();
    expect(confirm?.disabled).toBe(true);
    request.flush(deviceFixture(PHONE, 'Phone stage left', { state: 'blocked' }));
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe('K1 blocked and disconnected');
    expect(row.querySelector('.c-confirm')).toBeNull();
  });

  it('sends a control room chat quick pick to the device', async () => {
    await setup();
    rows()[1].click();
    await render();
    const row = station(LAPTOP);
    button(row, 'Send message')?.click();
    await render();
    expect(row.querySelector('sf-message-composer')).not.toBeNull();
    button(row, 'Break')?.click();
    const request = harness.http.expectOne(`${BASE}/devices/${LAPTOP}/commands`);
    expect(request.request.body).toEqual({ kind: 'message', slot: null, text: 'Break' });
    request.flush(
      { id: 'cmd_1', kind: 'message', slot: null, text: 'Break', at: '' },
      { status: 202, statusText: 'Accepted' },
    );
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Message sent to Laptop Lea: “Break”',
    );
  });

  it('offers the camera panel for a phone only, and closes it with the details', async () => {
    await setup();
    rows()[1].click();
    await render();
    expect(button(station(LAPTOP), 'Camera')).toBeUndefined();
    rows()[0].click();
    await render();
    const open = button(station(PHONE), 'Camera') as HTMLButtonElement;
    expect(open.getAttribute('aria-expanded')).toBe('false');

    open.click();
    await render();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(station(PHONE).querySelector('sf-camera-panel')).not.toBeNull();
    expect(text(station(PHONE).querySelector('[data-testid="camera-status"]'))).toBe(
      'The phone has not reported its camera yet.',
    );

    rows()[0].click();
    await render();
    await render();
    expect(station(PHONE).querySelector('sf-camera-panel')).toBeNull();
  });

  it('shows knock cards and approves a request exactly once', async () => {
    await setup([knock()]);
    const card = element.querySelector('.c-knock') as HTMLElement;
    expect(text(card.querySelector('.c-knock__title'))).toBe('Laptop Mia wants to join');
    expect(text(card.querySelector('.c-knock__code'))).toBe('47 12');
    expect(card.querySelector('.c-knock__code')?.getAttribute('aria-label')).toBe(
      'Check code 4 7 1 2',
    );
    const approve = button(card, 'Allow');
    approve?.click();
    approve?.click();
    button(card, 'Deny')?.click();
    const request = harness.http.expectOne(`${BASE}/pairing/requests/prq_aaaaaaaaaaaaaaaa/approve`);
    harness.http.expectNone(`${BASE}/pairing/requests/prq_aaaaaaaaaaaaaaaa/deny`);
    await render();
    expect(approve?.disabled).toBe(true);
    request.flush(deviceFixture('dev_cccccccccccccccc', 'Laptop Mia', { kind: 'laptop' }));
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe('Laptop Mia is paired');
  });

  it('disables commands that need the server while offline', async () => {
    await setup([knock()]);
    hub.drop();
    await render();
    const card = element.querySelector('.c-knock') as HTMLElement;
    expect(button(card, 'Allow')?.disabled).toBe(true);
    expect(button(card, 'Deny')?.disabled).toBe(true);
    rows()[0].click();
    await render();
    expect(button(station(PHONE), 'Block device')?.disabled).toBe(true);
    hub.connect();
    await render();
    expect(button(card, 'Allow')?.disabled).toBe(false);
  });

  it('hides the knock cards while the pairing dock shows them', async () => {
    await setup([knock()]);
    const toggle = button(element, 'Pair device');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    toggle?.click();
    await render();
    expect(TestBed.inject(DockLayoutService).pairingOpen()).toBe(true);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('.c-knock')).toBeNull();
  });

  it('opens and flashes a station on a focus request', async () => {
    await setup();
    TestBed.inject(StationFocusService).showDevice(LAPTOP);
    await render();
    const row = station(LAPTOP);
    expect(row.className).toContain('is-open');
    expect(row.className).toContain('is-flash');
  });
});
