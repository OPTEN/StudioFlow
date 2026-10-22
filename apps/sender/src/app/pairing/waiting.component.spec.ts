import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MemoryStorage, settle } from '../../testing/sender-fakes';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { DeviceApiService } from '../core/device-api.service';
import { WaitingComponent } from './waiting.component';

describe('WaitingComponent', () => {
  let getPairingRequestStatus: ReturnType<typeof vi.fn>;

  async function render(): Promise<{ element: HTMLElement; detect: () => void }> {
    const session = new MemoryStorage();
    session.writeJson(STORAGE_KEYS.pairing, {
      requestId: 'prq_abcd1234',
      pollToken: 'poll',
      checkCode: '4712',
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
      name: 'Laptop Anna',
      kind: 'laptop',
    });
    TestBed.configureTestingModule({
      imports: [WaitingComponent],
      providers: [
        provideRouter([]),
        { provide: SESSION_STORAGE, useValue: session },
        { provide: LOCAL_STORAGE, useValue: new MemoryStorage() },
        {
          provide: DeviceApiService,
          useValue: {
            getPairingRequestStatus,
            cancelPairingRequest: vi.fn(() => Promise.resolve()),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WaitingComponent);
    fixture.detectChanges();
    return { element: fixture.nativeElement as HTMLElement, detect: () => fixture.detectChanges() };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    getPairingRequestStatus = vi.fn(() =>
      Promise.resolve({ status: 'pending', credentials: null }),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows the check code «47 12» with its caption and the name', async () => {
    const { element } = await render();

    expect(element.querySelector('[data-testid=check-code]')?.textContent?.trim()).toBe('47 12');
    expect(element.textContent).toContain('Prüfcode für die Regie');
    expect(element.textContent).toContain('«Laptop Anna»');
    expect(element.querySelector('h1')?.textContent).toContain('Wartet auf Freigabe');
  });

  it('shows the denial with «Neue Anfrage»', async () => {
    getPairingRequestStatus.mockResolvedValue({ status: 'denied', credentials: null });
    const { element, detect } = await render();

    await vi.advanceTimersByTimeAsync(0);
    detect();

    expect(element.querySelector('[data-testid=pairing-denied]')).not.toBeNull();
    expect(element.textContent).toContain('Neue Anfrage');
  });

  it('shows the expiry', async () => {
    getPairingRequestStatus.mockResolvedValue({ status: 'expired', credentials: null });
    const { element, detect } = await render();

    await vi.advanceTimersByTimeAsync(0);
    detect();

    expect(element.querySelector('[data-testid=pairing-expired]')).not.toBeNull();
  });

  it('opens the station once approved', async () => {
    getPairingRequestStatus.mockResolvedValue({
      status: 'approved',
      credentials: {
        deviceId: 'dev_laptop0001',
        deviceSecret: 'c2VjcmV0',
        productionId: 'prd_webinar01',
      },
    });
    const { detect } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await vi.advanceTimersByTimeAsync(0);
    detect();
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/station'], { replaceUrl: true });
  });
});
