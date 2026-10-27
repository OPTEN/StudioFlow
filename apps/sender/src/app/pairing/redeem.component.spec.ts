import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MemoryStorage, fakeEnvironment, settle } from '../../testing/sender-fakes';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../core/browser-storage';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT, type DeviceEnvironment } from '../core/device-environment';
import { RedeemComponent } from './redeem.component';
import { RedeemService } from './redeem.service';

describe('RedeemComponent', () => {
  let redeem: ReturnType<typeof vi.fn>;

  async function render(environment: Partial<DeviceEnvironment>, station?: string): Promise<void> {
    redeem = vi.fn(() => Promise.resolve({ kind: 'paired' }));
    TestBed.configureTestingModule({
      imports: [RedeemComponent],
      providers: [
        provideRouter([]),
        { provide: LOCAL_STORAGE, useValue: new MemoryStorage() },
        { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
        { provide: DEVICE_ENVIRONMENT, useValue: fakeEnvironment(environment) },
        { provide: RedeemService, useValue: { redeem } },
        { provide: DeviceApiService, useValue: { unpair: vi.fn() } },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RedeemComponent);
    fixture.componentRef.setInput('token', 'tok_abc');
    if (station !== undefined) {
      fixture.componentRef.setInput('station', station);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pairs a laptop link as a laptop', async () => {
    await render({ isPhone: () => false, canShareScreen: () => true });

    expect(redeem).toHaveBeenCalledWith('tok_abc', 'laptop', 'Android · Chrome');
  });

  it('pairs a laptop link with ?station=audio as the audio station', async () => {
    await render({ isPhone: () => false, canShareScreen: () => true }, 'audio');

    expect(redeem).toHaveBeenCalledWith('tok_abc', 'audioStation', 'Android · Chrome');
  });

  it('ignores ?station=audio on a phone: a QR code pairs a phone', async () => {
    await render({ isPhone: () => true, canShareScreen: () => false }, 'audio');

    expect(redeem).toHaveBeenCalledWith('tok_abc', 'phone', 'Android · Chrome');
  });

  it('ignores other values of ?station', async () => {
    await render({ isPhone: () => false, canShareScreen: () => true }, 'video');

    expect(redeem).toHaveBeenCalledWith('tok_abc', 'laptop', 'Android · Chrome');
  });
});
