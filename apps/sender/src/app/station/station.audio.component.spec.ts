import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import type { DeviceSelfDto } from '@studioflow/scene-model';
import { NEVER } from 'rxjs';
import {
  FakeHub,
  FakeWakeLock,
  LIVEKIT_TOKEN,
  MemoryStorage,
  TECH_CHECK_OK,
  audioStationSelf,
  fakeEnvironment,
  fakeMedia,
  laptopSelf,
  micSlot,
  phoneSelf,
  settle,
} from '../../testing/sender-fakes';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { INPUT_METER_FACTORY, type InputMeter } from './input-level.component';
import { StationComponent } from './station.component';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
} from './station-ports';

describe('StationComponent: sound', () => {
  let hub: FakeHub;
  let media: ReturnType<typeof fakeMedia>;
  let api: { allocateSlot: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<StationComponent>;
  let level = -12;

  async function render(
    deviceSelf: DeviceSelfDto,
    settings: Record<string, unknown> = {},
    canShareScreen = false,
  ): Promise<HTMLElement> {
    const storage = new MemoryStorage();
    storage.writeJson(STORAGE_KEYS.credentials, {
      deviceId: deviceSelf.id,
      secret: 'c2VjcmV0',
      productionId: 'prd_webinar01',
    });
    storage.writeJson(STORAGE_KEYS.settings, {
      techCheck: { deviceId: deviceSelf.id, result: TECH_CHECK_OK },
      cameraOn: false,
      ...settings,
    });
    hub = new FakeHub();
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: deviceSelf, tally: { overall: 'off', slots: {} } })
        : Promise.resolve(undefined);
    media = fakeMedia();
    api = { allocateSlot: vi.fn() };
    const meter: InputMeter = {
      context: { state: 'running', resume: () => Promise.resolve() },
      read: () => level,
      dispose: () => undefined,
    };
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
            getSelfTimed: () => Promise.resolve({ self: deviceSelf, rttMs: 10 }),
            getLiveKitToken: () => Promise.resolve(LIVEKIT_TOKEN),
            allocateSlot: api.allocateSlot,
            releaseSlot: vi.fn(() => Promise.resolve()),
            bandwidthTest: vi.fn(),
          },
        },
        {
          provide: DEVICE_ENVIRONMENT,
          useValue: fakeEnvironment({
            canShareScreen: () => canShareScreen,
            isPhone: () => deviceSelf.kind === 'phone',
          }),
        },
        { provide: INPUT_METER_FACTORY, useValue: () => meter },
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

  afterEach(() => {
    level = -12;
    TestBed.resetTestingModule();
  });

  describe('audio station', () => {
    it('shows the desk feed, starts it by itself and says what it sends', async () => {
      const element = await render(audioStationSelf());

      expect(query(element, 'h1')?.textContent?.trim()).toBe('Mixing desk');
      expect(query(element, '#mic-title')?.textContent?.trim()).toBe('Sound from the mixing desk');
      expect(query(element, '[data-testid=slot-mic] .c-code')?.textContent?.trim()).toBe('A1');
      expect(media.audio.calls).toEqual(['publishMic:station:default']);
      expect(query(element, '[data-testid=mic-state]')?.textContent?.trim()).toBe('Starting…');
      expect(element.textContent).toContain('Stereo, sent as it comes');
      expect(query(element, '.c-phone')).toBeNull();
    });

    it('lists the inputs of the computer and switches the input in place', async () => {
      const element = await render(audioStationSelf());
      media.audio.inputs = [
        { id: 'usb-interface', label: 'USB interface' },
        { id: 'builtin', label: '' },
      ];
      media.audio.emit('live');
      await settle();
      fixture.detectChanges();

      const select = query(element, '[data-testid=mic-input]') as HTMLSelectElement;
      expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
        'Default input',
        'USB interface',
        'Input 2',
      ]);

      select.value = 'usb-interface';
      select.dispatchEvent(new Event('change'));
      await settle();
      fixture.detectChanges();

      expect(media.audio.calls).toEqual([
        'publishMic:station:default',
        'publishMic:station:usb-interface',
      ]);
      expect(select.value).toBe('usb-interface');
    });

    it('shows the level of the running feed in dB', async () => {
      const element = await render(audioStationSelf());
      media.audio.stream = {} as MediaStream;
      media.audio.emit('live');
      fixture.detectChanges();

      await new Promise((resolve) => setTimeout(resolve, 150));
      fixture.detectChanges();

      expect(query(element, '[data-testid=input-level-db]')?.textContent?.trim()).toBe('-12 dB');
    });

    it('the tally frame and the “Mic live” tag follow the microphone, not the picture', async () => {
      const element = await render(audioStationSelf());
      media.audio.emit('live');
      expect(query(element, '[data-testid=mic-live]')).toBeNull();

      hub.emit('tally', { overall: 'off', slots: { mic: 'program' } });
      fixture.detectChanges();

      expect(query(element, '[data-testid=tally]')?.dataset['tally']).toBe('program');
      expect(query(element, '[data-testid=mic-live]')?.textContent?.trim()).toBe('Mic live');
      expect(element.textContent).toContain('The microphone is live in the program.');
    });

    it('“Stop sending sound” stops the desk and “Start sending sound” starts it again', async () => {
      const element = await render(audioStationSelf());
      media.audio.emit('live');
      fixture.detectChanges();
      expect(query(element, '[data-testid=mic-toggle]')?.textContent).toContain(
        'Stop sending sound',
      );

      (query(element, '[data-testid=mic-toggle]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(media.audio.calls).toContain('unpublish');
      expect(query(element, '[data-testid=mic-toggle]')?.textContent).toContain(
        'Start sending sound',
      );

      (query(element, '[data-testid=mic-toggle]') as HTMLButtonElement).click();
      await settle();
      expect(media.audio.calls.filter((call) => call.startsWith('publishMic'))).toHaveLength(2);
    });

    it('asks before it stops the sound while the broadcast uses it', async () => {
      const element = await render(audioStationSelf());
      media.audio.emit('live');
      hub.emit('tally', { overall: 'off', slots: { mic: 'program' } });
      fixture.detectChanges();

      (query(element, '[data-testid=mic-toggle]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(media.audio.calls).not.toContain('unpublish');
      const confirm = query(element, '[data-testid=slot-mic] .c-confirm');
      expect(confirm?.textContent).toContain('Stopping it silences the broadcast.');

      (confirm?.querySelector('.c-btn--danger-fill') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(media.audio.calls).toContain('unpublish');
    });

    it('explains a microphone that does not work', async () => {
      const element = await render(audioStationSelf());

      media.audio.emit('failed', 'media.slot.mic.not-found', 'not-found');
      fixture.detectChanges();

      expect(query(element, '[data-testid=mic-state]')?.textContent?.trim()).toBe('Not working');
      expect(query(element, '[data-testid=mic-message]')?.textContent?.trim()).toBe(
        'No microphone found.',
      );
    });
  });

  describe('laptop', () => {
    it('offers to add a microphone, allocates it and shows the panel', async () => {
      const element = await render(laptopSelf(), {}, true);
      expect(query(element, '[data-testid=slot-mic]')).toBeNull();
      api.allocateSlot.mockResolvedValue({ slot: 'mic', code: 'A1', kind: 'audio' });

      (query(element, '[data-testid=mic-add]') as HTMLButtonElement).click();
      await settle();
      fixture.detectChanges();

      expect(api.allocateSlot).toHaveBeenCalledWith('audio');
      expect(media.audio.calls).toEqual(['publishMic:voice:default']);
      expect(query(element, '#mic-title')?.textContent?.trim()).toBe('Microphone');
      expect(query(element, '[data-testid=mic-add]')).toBeNull();
      expect(element.textContent).toContain('The browser reduces echo and background noise.');
    });

    it('a laptop with a microphone slot shows the panel with the microphone off', async () => {
      const element = await render(laptopSelf({ slots: [...laptopSelf().slots, micSlot()] }));

      expect(query(element, '[data-testid=mic-state]')?.textContent?.trim()).toBe('Off');
      expect(media.audio.calls).toEqual([]);
    });

    it('“Share audio” is off by default, explains the browser limits and shares the screen with sound when ticked', async () => {
      const element = await render(laptopSelf(), {}, true);
      const checkbox = query(element, '[data-testid=share-audio]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(element.textContent).toContain('Chrome and Edge on Windows can share the sound');
      expect(element.textContent).toContain('Firefox and Safari share no sound.');

      checkbox.click();
      fixture.detectChanges();
      const share = [...element.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('Share screen'),
      ) as HTMLButtonElement;
      share.click();

      expect(media.publisher.calls).toContain('publishScreen:screen-1:audio');
    });

    it('says “with sound” for a share that carries sound and warns when the sound did not come along', async () => {
      const element = await render(laptopSelf(), { shareScreenAudio: true }, true);
      media.publisher.emitSlot('screen-1', 'live');
      fixture.detectChanges();

      expect(query(element, '[data-testid=screen-sound]')).toBeNull();
      expect(query(element, '[data-testid=screen-no-sound]')?.textContent).toContain(
        'No sound is shared with this screen.',
      );

      media.publisher.screensWithSound.add('screen-1');
      media.publisher.emitSlot('screen-1', 'live');
      fixture.detectChanges();

      expect(query(element, '[data-testid=screen-sound]')?.textContent?.trim()).toBe('with sound');
      expect(query(element, '[data-testid=screen-no-sound]')).toBeNull();
    });

    it('does not offer “Share audio” where the browser cannot share a screen', async () => {
      const element = await render(laptopSelf(), {}, false);

      expect(query(element, '[data-testid=share-audio]')).toBeNull();
    });
  });

  describe('phone', () => {
    it('has a microphone button that is off until pressed', async () => {
      const element = await render(phoneSelf(), { cameraOn: true });
      const toggle = query(element, '[data-testid=slot-mic]') as HTMLButtonElement;
      expect(toggle.textContent?.trim()).toBe('Microphone');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      api.allocateSlot.mockResolvedValue({ slot: 'mic', code: 'A1', kind: 'audio' });

      toggle.click();
      await settle();
      fixture.detectChanges();

      expect(media.audio.calls).toEqual(['publishMic:voice:default']);
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      toggle.click();
      fixture.detectChanges();
      expect(media.audio.calls).toContain('unpublish');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows “Mic live” next to the name while the microphone is in the program', async () => {
      const element = await render(phoneSelf({ slots: [...phoneSelf().slots, micSlot()] }));

      hub.emit('tally', { overall: 'off', slots: { mic: 'program' } });
      fixture.detectChanges();

      expect(query(element, '[data-testid=mic-live]')?.textContent?.trim()).toBe('Mic live');
    });
  });
});
