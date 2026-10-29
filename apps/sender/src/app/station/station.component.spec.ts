import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import type { DeviceSelfDto } from '@studioflow/scene-model';
import { NEVER } from 'rxjs';
import {
  FakeHub,
  FakeWakeLock,
  LIVEKIT_TOKEN,
  MemoryStorage,
  TECH_CHECK_OK,
  fakeEnvironment,
  fakeMedia,
  laptopSelf,
  phoneSelf,
  settle,
} from '../../testing/sender-fakes';
import { ApiError } from '../core/api-error';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { NoticeService } from '../core/notice.service';
import { DeviceSessionService } from './device-session.service';
import { StationComponent } from './station.component';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
} from './station-ports';

describe('StationComponent', () => {
  let hub: FakeHub;
  let media: ReturnType<typeof fakeMedia>;
  let self: DeviceSelfDto;
  let getSelfTimed: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<StationComponent>;

  async function render(
    deviceSelf: DeviceSelfDto,
    settings: Record<string, unknown> = {
      techCheck: { deviceId: deviceSelf.id, result: TECH_CHECK_OK },
    },
    canShareScreen = false,
  ): Promise<HTMLElement> {
    self = deviceSelf;
    const storage = new MemoryStorage();
    storage.writeJson(STORAGE_KEYS.credentials, {
      deviceId: deviceSelf.id,
      secret: 'c2VjcmV0',
      productionId: 'prd_webinar01',
    });
    storage.writeJson(STORAGE_KEYS.settings, settings);
    hub = new FakeHub();
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : Promise.resolve(undefined);
    media = fakeMedia();
    getSelfTimed = vi.fn(() => Promise.resolve({ self, rttMs: 10 }));
    TestBed.configureTestingModule({
      imports: [StationComponent],
      providers: [
        provideRouter([]),
        {
          provide: SwUpdate,
          useValue: { isEnabled: false, versionUpdates: NEVER, unrecoverable: NEVER },
        },
        { provide: LOCAL_STORAGE, useValue: storage },
        { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
        {
          provide: DeviceApiService,
          useValue: {
            getSelfTimed,
            getLiveKitToken: () => Promise.resolve(LIVEKIT_TOKEN),
            allocateSlot: vi.fn(),
            releaseSlot: vi.fn(() => Promise.resolve()),
            bandwidthTest: vi.fn(),
          },
        },
        {
          provide: DEVICE_ENVIRONMENT,
          useValue: fakeEnvironment({ canShareScreen: () => canShareScreen }),
        },
        { provide: DEVICE_HUB_FACTORY, useValue: () => hub },
        { provide: SENDER_MEDIA_FACTORY, useValue: () => media },
        { provide: WAKE_LOCK_FACTORY, useValue: () => new FakeWakeLock() },
        { provide: TECH_CHECK_RUNNER, useValue: () => Promise.resolve(TECH_CHECK_OK) },
      ],
    });
    fixture = TestBed.createComponent(StationComponent);
    await settle();
    hub.connect();
    media.session.setState('connected');
    await settle();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function query(element: HTMLElement, selector: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(selector);
  }

  function button(element: HTMLElement, text: string): HTMLButtonElement {
    const match = [...element.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.trim().includes(text),
    );
    if (match === undefined) {
      throw new Error(`no button “${text}”`);
    }
    return match;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('phone: name, slot code and “Connected”', async () => {
    const element = await render(phoneSelf());

    expect(query(element, '.c-phone__name')?.textContent?.trim()).toBe('Phone stage left');
    expect(query(element, '.c-phone__top .c-code')?.textContent?.trim()).toBe('K3');
    const connection = query(element, '[data-testid=connection-state]');
    expect(connection?.dataset['state']).toBe('connected');
    expect(connection?.textContent).toContain('Connected');
    expect(query(element, '[data-testid=tally]')?.dataset['tally']).toBe('off');
  });

  it('renders the tally: a red frame and “Live”, a green frame and “Preview”, nothing off air', async () => {
    const element = await render(phoneSelf());
    const tag = () => query(element, '[data-testid=tally-tag]');

    hub.emit('tally', { overall: 'program', slots: { camera: 'program' } });
    fixture.detectChanges();
    let tally = query(element, '[data-testid=tally]');
    expect(tally?.dataset['tally']).toBe('program');
    expect(tally?.classList).toContain('is-program');
    expect(tag()?.textContent?.trim()).toBe('Live');
    expect(tag()?.classList).toContain('c-tag--pgm');
    expect(element.textContent).toContain('Live: this device is now on Program.');

    hub.emit('tally', { overall: 'preview', slots: { camera: 'preview' } });
    fixture.detectChanges();
    tally = query(element, '[data-testid=tally]');
    expect(tally?.dataset['tally']).toBe('preview');
    expect(tag()?.textContent?.trim()).toBe('Preview');

    hub.emit('tally', { overall: 'off', slots: { camera: 'off' } });
    fixture.detectChanges();
    expect(tag()).toBeNull();
  });

  it('shows a Regie message as a banner that stays until “Dismiss”', async () => {
    const element = await render(phoneSelf());

    hub.emit('command', {
      id: 'cmd_1',
      kind: 'message',
      slot: null,
      text: 'In 10 s live',
      at: new Date().toISOString(),
    });
    fixture.detectChanges();

    const banner = query(element, '[data-testid=message-banner]');
    expect(banner?.textContent).toContain('In 10 s live');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(document.title).toContain('Message');

    button(element, 'Dismiss').click();
    fixture.detectChanges();
    expect(query(element, '[data-testid=message-banner]')).toBeNull();
  });

  it('blocked: “This device is blocked”', async () => {
    const element = await render(phoneSelf());
    getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'blocked'));

    hub.emit('self', { ...self, state: 'blocked' });
    fixture.detectChanges();

    expect(query(element, 'h1')?.textContent).toContain('This device is blocked');
    expect(query(element, '[data-testid=connection-state]')?.dataset['state']).toBe('blocked');
    expect(media.session.calls).toContain('stop');
  });

  it('replaced: “Opened in another tab” and “Continue here” takes over', async () => {
    const element = await render(phoneSelf());

    hub.emit('sessionReplaced');
    fixture.detectChanges();
    expect(query(element, 'h1')?.textContent).toContain('Opened in another tab');
    expect(query(element, '[data-testid=connection-state]')?.dataset['state']).toBe('replaced');

    button(element, 'Continue here').click();
    expect(hub.calls).toContain('restart');
    hub.connect();
    await settle();
    fixture.detectChanges();
    expect(query(element, '.c-phone')).not.toBeNull();
  });

  it('phone: camera stop and start buttons drive the publisher', async () => {
    const element = await render(phoneSelf());
    media.publisher.emitSlot('camera', 'live');
    fixture.detectChanges();
    expect(query(element, '[data-testid=slot-camera]')?.dataset['state']).toBe('live');

    button(element, 'Stop camera').click();
    fixture.detectChanges();
    expect(media.publisher.calls).toContain('unpublish:camera');
    expect(query(element, '[data-testid=slot-camera]')?.dataset['state']).toBe('idle');

    button(element, 'Start camera').click();
    expect(media.publisher.calls.filter((call) => call.startsWith('publishCamera'))).toHaveLength(
      2,
    );
  });

  it('phone: a denied camera shows the steps and “Try again”', async () => {
    const element = await render(phoneSelf());

    media.publisher.emitSlot(
      'camera',
      'failed',
      'media.slot.failure.permission-denied',
      'permission-denied',
    );
    fixture.detectChanges();

    expect(element.textContent).toContain('No access to the camera');
    expect(element.querySelectorAll('.c-phone__steps li').length).toBeGreaterThan(1);
    button(element, 'Try again').click();
    expect(media.publisher.calls.filter((call) => call.startsWith('publishCamera'))).toHaveLength(
      2,
    );
  });

  it('phone: “Screen off” blacks out the picture, keeps the thin tally frame and wakes on a tap', async () => {
    const element = await render(phoneSelf());

    button(element, 'Screen off').click();
    fixture.detectChanges();

    expect(query(element, '.c-phone')?.classList).toContain('is-screen-off');
    const overlay = query(element, '.c-phone__screen-off');
    expect(overlay?.textContent).toContain('K3');
    expect(overlay?.textContent).toContain('Connected');
    expect(overlay?.getAttribute('aria-label')).toBe('Tap to show the controls');
    expect(query(element, '[data-testid=tally]')?.classList).toContain('c-tally--thin');

    overlay?.click();
    fixture.detectChanges();
    expect(query(element, '.c-phone__screen-off')).toBeNull();
    expect(
      element.querySelector('.c-phone__control--screen-off')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('phone: switching or stopping the camera while it is live asks first', async () => {
    const element = await render(phoneSelf());
    media.publisher.emitSlot('camera', 'live');
    hub.emit('tally', { overall: 'program', slots: { camera: 'program' } });
    fixture.detectChanges();

    button(element, 'Switch camera').click();
    fixture.detectChanges();
    await settle();
    let sheet = query(element, '[data-testid=confirm-sheet]');
    expect(sheet?.textContent).toContain('Switch the camera while live?');
    expect(media.publisher.calls).not.toContain('switchCamera');

    (sheet?.querySelector('[data-testid=confirm-sheet-ok]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(media.publisher.calls).toContain('switchCamera');
    expect(query(element, '[data-testid=confirm-sheet]')).toBeNull();

    button(element, 'Stop camera').click();
    fixture.detectChanges();
    await settle();
    sheet = query(element, '[data-testid=confirm-sheet]');
    expect(sheet?.textContent).toContain('Stop the camera while live?');
    expect(media.publisher.calls).not.toContain('unpublish:camera');
    (sheet?.querySelector('[data-testid=confirm-sheet-ok]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(media.publisher.calls).toContain('unpublish:camera');
  });

  it('phone: the quality sheet offers Standard and High and changes the running camera', async () => {
    const element = await render(phoneSelf());
    media.publisher.emitSlot('camera', 'live');
    fixture.detectChanges();
    const quality = query(element, '.c-phone__control--quality');
    expect(quality?.getAttribute('aria-label')).toBe('Picture quality: Standard');

    quality?.click();
    fixture.detectChanges();
    await settle();
    const sheet = query(element, '[data-testid=quality-sheet]');
    expect(sheet?.textContent).toContain('Picture quality');
    sheet?.querySelector<HTMLInputElement>('input[value="1080"]')?.click();
    fixture.detectChanges();

    expect(media.publisher.calls).toContain('setCameraResolution:1080');
    expect(quality?.getAttribute('aria-label')).toBe('Picture quality: High');
  });

  it('laptop: “Share screen” calls the publisher synchronously in the click', async () => {
    const element = await render(laptopSelf(), undefined, true);
    const row = query(element, '[data-testid=slot-screen-1]');
    expect(row?.dataset['state']).toBe('idle');
    expect(row?.textContent).toContain('S2');

    button(element, 'Share screen').click();

    expect(media.publisher.calls).toContain('publishScreen:screen-1');
  });

  it('laptop: a reshare request highlights the ended screen and offers one large “Share again”', async () => {
    const element = await render(laptopSelf(), undefined, true);
    media.publisher.emitSlot('screen-1', 'ended', 'media.slot.shareEnded');
    hub.emit('command', { id: 'cmd_9', kind: 'reshare', slot: 'screen-1', text: null, at: '' });
    fixture.detectChanges();

    const card = query(element, '[data-testid=slot-screen-1]');
    expect(card?.dataset['state']).toBe('ended');
    expect(card?.classList).toContain('is-requested');
    expect(card?.textContent).toContain('The control room asks you to share this screen again');
    const again = button(card!, 'Share again');
    expect(again.classList).toContain('c-btn--lg');
    expect(
      [...element.querySelectorAll('button')].filter((candidate) =>
        candidate.textContent?.includes('Share again'),
      ),
    ).toHaveLength(1);

    again.click();
    expect(media.publisher.calls).toContain('publishScreen:screen-1');
  });

  it('laptop: “Smooth motion” in the ⋯ menu switches a screen to 30 fps and says what it costs', async () => {
    const element = await render(laptopSelf(), undefined, true);
    const openMenu = (): HTMLElement => {
      (query(element, '[aria-label="More for Screen 1"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      return query(element, '[data-testid=slot-screen-1] [data-testid=video-screen]')!;
    };
    expect(query(element, '[data-testid=video-screen-hint]')).toBeNull();

    let item = openMenu();
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('false');
    item.click();
    fixture.detectChanges();

    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:30');
    expect(query(element, '[data-testid=video-screen-hint]')?.textContent).toContain(
      '30 frames per second',
    );

    item = openMenu();
    expect(item.getAttribute('aria-checked')).toBe('true');
    item.click();
    fixture.detectChanges();
    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:15');
  });

  it('laptop: “Remove from the control room…” asks in the card before the source is removed', async () => {
    const element = await render(laptopSelf(), undefined, true);
    (query(element, '[aria-label="More for Screen 1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    button(element, 'Remove from the control room').click();
    fixture.detectChanges();

    const card = query(element, '[data-testid=slot-screen-1]');
    expect(card?.textContent).toContain(
      'Screen 1 disappears from the control room and from every scene that shows it.',
    );
    button(card!, 'Cancel').click();
    fixture.detectChanges();
    expect(card?.textContent).not.toContain('disappears from the control room');
  });

  it('laptop: greets with “Paired” right after pairing and keeps the device name as the title', async () => {
    const notices = new NoticeService();
    notices.justPaired.set(true);
    const element = await renderWithNotices(notices);

    expect(query(element, 'h1')?.textContent?.trim()).toBe(laptopSelf().name);
    expect(element.textContent).toContain(
      'Paired. Next time StudioFlow recognises this computer by itself.',
    );
  });

  it('removed by the Regie: back to the pairing form', async () => {
    const element = await render(phoneSelf());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    getSelfTimed.mockRejectedValue(new ApiError(401, 'unauthorized', 'weg'));

    hub.setState('unauthorized');
    await settle();
    fixture.detectChanges();

    expect(fixture.debugElement.injector.get(DeviceSessionService).phase()).toBe('removed');
    expect(navigate).toHaveBeenCalledWith(['/'], { replaceUrl: true });
    expect(element).toBeTruthy();
  });

  async function renderWithNotices(notices: NoticeService): Promise<HTMLElement> {
    TestBed.configureTestingModule({ providers: [{ provide: NoticeService, useValue: notices }] });
    return render(laptopSelf(), undefined, true);
  }
});
