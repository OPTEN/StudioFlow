import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import type { DeviceSelfDto } from '@flowstudio/scene-model';
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
      throw new Error(`no button «${text}»`);
    }
    return match;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('phone: name, slot code and «Verbunden»', async () => {
    const element = await render(phoneSelf());

    expect(query(element, '.c-phone__name')?.textContent?.trim()).toBe('Handy Bühne');
    expect(query(element, '.c-phone__top .c-code')?.textContent?.trim()).toBe('K3');
    const connection = query(element, '[data-testid=connection-state]');
    expect(connection?.dataset['state']).toBe('connected');
    expect(connection?.textContent).toContain('Verbunden');
    expect(query(element, '[data-testid=tally]')?.dataset['tally']).toBe('off');
  });

  it('renders the tally: red «LIVE» in the program, green «Als Nächstes» in the preview', async () => {
    const element = await render(phoneSelf());

    hub.emit('tally', { overall: 'program', slots: { camera: 'program' } });
    fixture.detectChanges();
    let tally = query(element, '[data-testid=tally]');
    expect(tally?.dataset['tally']).toBe('program');
    expect(tally?.classList).toContain('is-program');
    expect(tally?.textContent?.trim()).toBe('LIVE');
    expect(element.textContent).toContain('Live: Dieses Gerät ist jetzt im Program.');

    hub.emit('tally', { overall: 'preview', slots: { camera: 'preview' } });
    fixture.detectChanges();
    tally = query(element, '[data-testid=tally]');
    expect(tally?.dataset['tally']).toBe('preview');
    expect(tally?.textContent?.trim()).toBe('Als Nächstes');

    hub.emit('tally', { overall: 'off', slots: { camera: 'off' } });
    fixture.detectChanges();
    expect(query(element, '[data-testid=tally]')?.textContent?.trim()).toBe('');
  });

  it('shows a Regie message as a banner with «OK»', async () => {
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

    button(element, 'OK').click();
    fixture.detectChanges();
    expect(query(element, '[data-testid=message-banner]')).toBeNull();
  });

  it('blocked: «Dieses Gerät ist gesperrt»', async () => {
    const element = await render(phoneSelf());
    getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'gesperrt'));

    hub.emit('self', { ...self, state: 'blocked' });
    fixture.detectChanges();

    expect(query(element, 'h1')?.textContent).toContain('Dieses Gerät ist gesperrt');
    expect(query(element, '[data-testid=connection-state]')?.dataset['state']).toBe('blocked');
    expect(media.session.calls).toContain('stop');
  });

  it('replaced: «In einem anderen Tab geöffnet» and «Hier weitermachen» takes over', async () => {
    const element = await render(phoneSelf());

    hub.emit('sessionReplaced');
    fixture.detectChanges();
    expect(query(element, 'h1')?.textContent).toContain('In einem anderen Tab geöffnet');
    expect(query(element, '[data-testid=connection-state]')?.dataset['state']).toBe('replaced');

    button(element, 'Hier weitermachen').click();
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

    button(element, 'Kamera stoppen').click();
    fixture.detectChanges();
    expect(media.publisher.calls).toContain('unpublish:camera');
    expect(query(element, '[data-testid=slot-camera]')?.dataset['state']).toBe('idle');

    button(element, 'Kamera starten').click();
    expect(media.publisher.calls.filter((call) => call.startsWith('publishCamera'))).toHaveLength(
      2,
    );
  });

  it('phone: a denied camera shows the steps and «Erneut versuchen»', async () => {
    const element = await render(phoneSelf());

    media.publisher.emitSlot(
      'camera',
      'failed',
      'Kein Zugriff auf die Kamera. Bitte den Zugriff im Browser erlauben.',
    );
    fixture.detectChanges();

    expect(element.textContent).toContain('Kein Zugriff auf die Kamera');
    expect(element.querySelectorAll('.c-phone__steps li').length).toBeGreaterThan(1);
    button(element, 'Erneut versuchen').click();
    expect(media.publisher.calls.filter((call) => call.startsWith('publishCamera'))).toHaveLength(
      2,
    );
  });

  it('phone: «Dunkel» blacks out the picture and keeps the thin tally frame', async () => {
    const element = await render(phoneSelf());

    button(element, 'Dunkel').click();
    fixture.detectChanges();

    expect(query(element, '.c-phone')?.classList).toContain('is-dark');
    expect(query(element, '.c-phone__dark')?.textContent).toContain('K3');
    expect(query(element, '[data-testid=tally]')?.classList).toContain('c-tally--thin');
  });

  it('laptop: «Bildschirm teilen» calls the publisher synchronously in the click', async () => {
    const element = await render(laptopSelf(), undefined, true);
    const row = query(element, '[data-testid=slot-screen-1]');
    expect(row?.dataset['state']).toBe('idle');
    expect(row?.textContent).toContain('S2');

    button(element, 'Bildschirm teilen').click();

    expect(media.publisher.calls).toContain('publishScreen:screen-1');
  });

  it('laptop: an ended share and a reshare request offer a large «Erneut teilen»', async () => {
    const element = await render(laptopSelf(), undefined, true);
    media.publisher.emitSlot('screen-1', 'ended', 'Freigabe beendet');
    hub.emit('command', { id: 'cmd_9', kind: 'reshare', slot: 'screen-1', text: null, at: '' });
    fixture.detectChanges();

    expect(element.textContent).toContain('Die Regie bittet dich, den Bildschirm erneut zu teilen');
    expect(query(element, '[data-testid=slot-screen-1]')?.dataset['state']).toBe('ended');

    button(element, 'Erneut teilen').click();
    expect(media.publisher.calls).toContain('publishScreen:screen-1');
  });

  it('laptop: greets with «Gekoppelt» right after pairing', async () => {
    const notices = new NoticeService();
    notices.justPaired.set(true);
    const element = await renderWithNotices(notices);

    expect(query(element, 'h1')?.textContent?.trim()).toBe('Gekoppelt');
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
