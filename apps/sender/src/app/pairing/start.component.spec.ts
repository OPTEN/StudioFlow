import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MemoryStorage, fakeEnvironment, settle } from '../../testing/sender-fakes';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../core/browser-storage';
import { DeviceApiService } from '../core/device-api.service';
import {
  DEVICE_ENVIRONMENT,
  defaultDeviceName,
  detectDeviceKind,
  type DeviceEnvironment,
} from '../core/device-environment';
import { NoticeService } from '../core/notice.service';
import { StartComponent } from './start.component';

describe('StartComponent (pairing form)', () => {
  let createPairingRequest: ReturnType<typeof vi.fn>;

  async function render(
    environment: Partial<DeviceEnvironment>,
    notices: NoticeService = new NoticeService(),
  ): Promise<HTMLElement> {
    createPairingRequest = vi.fn(() =>
      Promise.resolve({
        requestId: 'prq_1',
        pollToken: 't',
        checkCode: '4712',
        expiresAt: '2026-10-22T12:00:00Z',
      }),
    );
    TestBed.configureTestingModule({
      imports: [StartComponent],
      providers: [
        provideRouter([]),
        { provide: LOCAL_STORAGE, useValue: new MemoryStorage() },
        { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
        { provide: DEVICE_ENVIRONMENT, useValue: fakeEnvironment(environment) },
        { provide: NoticeService, useValue: notices },
        {
          provide: DeviceApiService,
          useValue: {
            createPairingRequest,
            getPairingRequestStatus: () => new Promise(() => undefined),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StartComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function nameInput(element: HTMLElement): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('#device-name')!;
  }

  function checkedKind(element: HTMLElement): string | undefined {
    return element.querySelector<HTMLInputElement>(
      'input[name="kind"]:checked, input[type=radio]:checked',
    )?.value;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('defaults a desktop browser to laptop with a name from the platform', async () => {
    const element = await render({
      isPhone: () => false,
      canShareScreen: () => true,
      platform: () => 'Windows · Edge',
    });

    expect(checkedKind(element)).toBe('laptop');
    expect(nameInput(element).value).toBe('Laptop Windows');
    expect(nameInput(element).maxLength).toBe(60);
    expect(element.textContent).not.toContain('Scan the QR code');
  });

  it('defaults a phone (or a browser without getDisplayMedia) to phone and leads with the QR code', async () => {
    const element = await render({ isPhone: () => true, platform: () => 'Android · Chrome' });

    expect(checkedKind(element)).toBe('phone');
    expect(nameInput(element).value).toBe('Phone Android');
    const qr = element.querySelector('.c-qr');
    expect(qr?.textContent).toContain('Scan the QR code shown in the control room');
    expect(
      qr!.compareDocumentPosition(element.querySelector('form')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(element.textContent).toContain('No QR code? Pair with a check code');
  });

  it('names each kind with a title and a one-line description', async () => {
    const element = await render({ isPhone: () => false, canShareScreen: () => true });
    const names = [...element.querySelectorAll<HTMLInputElement>('input[type=radio]')].map(
      (radio) =>
        element.querySelector(`#${radio.getAttribute('aria-labelledby')}`)?.textContent?.trim(),
    );

    expect(names).toEqual(['Phone camera', 'Laptop screen', 'Audio station']);
    expect(element.querySelector('#kind-laptop-hint')?.textContent).toContain('Shares screens');
  });

  it('explains a page that is not on a secure connection', async () => {
    const element = await render({ secure: () => false });

    expect(element.textContent).toContain('not opened over a secure connection');
  });

  it('knocks and opens the waiting screen', async () => {
    const element = await render({
      isPhone: () => false,
      canShareScreen: () => true,
      platform: () => 'Windows · Edge',
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const input = nameInput(element);
    input.value = '  Laptop Anna ';
    input.dispatchEvent(new Event('input'));

    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle(10);

    expect(createPairingRequest).toHaveBeenCalledWith({
      name: 'Laptop Anna',
      kind: 'laptop',
      platform: 'Windows · Edge',
    });
    expect(navigate).toHaveBeenCalledWith(['/waiting']);
  });

  it('offers the audio station and knocks with that kind and a name for it', async () => {
    const element = await render({
      isPhone: () => false,
      canShareScreen: () => true,
      platform: () => 'Windows · Edge',
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const option = element.querySelector<HTMLInputElement>('input[value="audioStation"]')!;
    expect(option.closest('label')?.textContent).toContain('Audio station');
    expect(option.closest('label')?.textContent).toContain('Sends the sound of the mixing desk.');

    option.click();
    await settle();
    expect(nameInput(element).value).toBe('Audio station');

    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle(10);

    expect(createPairingRequest).toHaveBeenCalledWith({
      name: 'Audio station',
      kind: 'audioStation',
      platform: 'Windows · Edge',
    });
    expect(navigate).toHaveBeenCalledWith(['/waiting']);
  });

  it('requires a name', async () => {
    const element = await render({ isPhone: () => false, canShareScreen: () => true });
    const input = nameInput(element);
    input.value = '   ';
    input.dispatchEvent(new Event('input'));

    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
    TestBed.tick();

    expect(createPairingRequest).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Please enter a name.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the notice of a removed device', async () => {
    const notices = new NoticeService();
    notices.pairingNotice.set('sender.notices.deviceRemoved');
    const element = await render({}, notices);

    expect(element.textContent).toContain('The control room has removed this device.');
  });
});

describe('device kind and default name', () => {
  it.each([
    [{ isPhone: () => true, canShareScreen: () => false }, 'phone'],
    [{ isPhone: () => false, canShareScreen: () => false }, 'phone'],
    [{ isPhone: () => false, canShareScreen: () => true }, 'laptop'],
  ])('detects the kind', (environment, kind) => {
    expect(detectDeviceKind(fakeEnvironment(environment))).toBe(kind);
  });

  it.each([
    ['phone', 'iPhone · Safari', 'iPhone'],
    ['phone', 'Android · Chrome', 'Phone Android'],
    ['laptop', 'macOS · Chrome', 'Laptop macOS'],
    ['laptop', 'Unknown platform', 'Laptop'],
    ['audioStation', 'Windows · Edge', 'Audio station'],
  ] as const)('suggests a name for %s on %s', (kind, platform, name) => {
    expect(defaultDeviceName(kind, platform)).toBe(name);
  });
});
