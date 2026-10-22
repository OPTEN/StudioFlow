import { TestBed } from '@angular/core/testing';
import type { ResilientHubOptions } from '@flowstudio/realtime-client';
import type { DeviceReportDto, DeviceSelfDto, LiveKitTokenDto } from '@flowstudio/scene-model';
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
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, toApiError } from '../core/api-error';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT, type DeviceEnvironment } from '../core/device-environment';
import { LiveStateService } from '../core/live-state.service';
import { NoticeService } from '../core/notice.service';
import {
  BLOCKED_RETRY_MS,
  DeviceSessionService,
  MESSAGE_DISMISS_MS,
  OUTAGE_PROBE_MS,
  REPORT_INTERVAL_MS,
  REPORT_STALE_MS,
} from './device-session.service';
import { SLOT_ERROR_MESSAGES } from './slot-errors';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
} from './station-ports';

const CREDENTIALS = {
  deviceId: 'dev_phone0001',
  secret: 'c2VjcmV0LXZhbHVlLW9mLXRoZS1kZXZpY2U',
  productionId: 'prd_webinar01',
  clientId: 'cli_abcdefghijkl',
};

interface Setup {
  self?: DeviceSelfDto;
  settings?: Record<string, unknown>;
  environment?: Partial<DeviceEnvironment>;
}

describe('DeviceSessionService', () => {
  let hub: FakeHub;
  let media: ReturnType<typeof fakeMedia>;
  let wakeLock: FakeWakeLock;
  let storage: MemoryStorage;
  let hubOptions: ResilientHubOptions | null;
  let tokenProvider: (() => Promise<LiveKitTokenDto>) | null;
  let self: DeviceSelfDto;
  let environment: DeviceEnvironment;
  let api: {
    getSelfTimed: ReturnType<typeof vi.fn>;
    getLiveKitToken: ReturnType<typeof vi.fn>;
    allocateSlot: ReturnType<typeof vi.fn>;
    releaseSlot: ReturnType<typeof vi.fn>;
    bandwidthTest: ReturnType<typeof vi.fn>;
  };
  let techCheck: ReturnType<typeof vi.fn>;

  function setup(options: Setup = {}): DeviceSessionService {
    vi.useFakeTimers();
    storage = new MemoryStorage();
    storage.writeJson(STORAGE_KEYS.credentials, CREDENTIALS);
    if (options.settings !== undefined) {
      storage.writeJson(STORAGE_KEYS.settings, options.settings);
    }
    self = options.self ?? phoneSelf();
    hub = new FakeHub();
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : Promise.resolve(undefined);
    media = fakeMedia();
    wakeLock = new FakeWakeLock();
    hubOptions = null;
    tokenProvider = null;
    environment = fakeEnvironment({ vibrate: vi.fn(), ...options.environment });
    api = {
      getSelfTimed: vi.fn(() => Promise.resolve({ self, rttMs: 14 })),
      getLiveKitToken: vi.fn(() => Promise.resolve(LIVEKIT_TOKEN)),
      allocateSlot: vi.fn(),
      releaseSlot: vi.fn(() => Promise.resolve()),
      bandwidthTest: vi.fn(() => Promise.resolve({ bytes: 1_000_000, serverMs: 80 })),
    };
    techCheck = vi.fn(() => Promise.resolve(TECH_CHECK_OK));
    TestBed.configureTestingModule({
      providers: [
        DeviceSessionService,
        { provide: LOCAL_STORAGE, useValue: storage },
        { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
        { provide: DeviceApiService, useValue: api },
        { provide: DEVICE_ENVIRONMENT, useValue: environment },
        {
          provide: DEVICE_HUB_FACTORY,
          useValue: (hubConfig: ResilientHubOptions) => {
            hubOptions = hubConfig;
            return hub;
          },
        },
        {
          provide: SENDER_MEDIA_FACTORY,
          useValue: (provider: () => Promise<LiveKitTokenDto>) => {
            tokenProvider = provider;
            return media;
          },
        },
        { provide: WAKE_LOCK_FACTORY, useValue: () => wakeLock },
        { provide: TECH_CHECK_RUNNER, useValue: techCheck },
      ],
    });
    return TestBed.inject(DeviceSessionService);
  }

  /** Starts the service and brings hub and media online. */
  async function online(service: DeviceSessionService): Promise<void> {
    service.start();
    await settle();
    hub.connect();
    media.session.setState('connected');
    await settle();
  }

  function lastReport(): DeviceReportDto {
    return hub.reports().at(-1) as DeviceReportDto;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('connects the device hub with the bearer and says Hello with the tab session id', async () => {
    const service = setup();
    await online(service);

    expect(hubOptions?.url).toBe('/hubs/device');
    expect(hubOptions?.accessTokenFactory?.()).toBe(
      `${CREDENTIALS.deviceId}.${CREDENTIALS.secret}`,
    );
    expect(hub.invoked[0]).toEqual({
      method: 'Hello',
      args: [{ sessionId: service.sessionId, platform: 'Android · Chrome', appVersion: '0.1.0' }],
    });
    expect(service.sessionId).toMatch(/^ses_[a-z0-9]{20}$/);
    expect(service.phase()).toBe('online');
    expect(service.connection()).toBe('connected');
    expect(media.session.calls).toContain('start');
  });

  it('fetches a LiveKit token through the device API for every join', async () => {
    setup().start();
    await expect(tokenProvider?.()).resolves.toEqual(LIVEKIT_TOKEN);
    expect(api.getLiveKitToken).toHaveBeenCalled();
  });

  it('auto-starts the camera after a reload with the persisted facing and resolution', async () => {
    const service = setup({ settings: { facing: 'user', resolution: 1080, cameraOn: true } });
    service.start();
    await settle();

    expect(media.publisher.calls).toContain('publishCamera:camera:user:1080');
    expect(service.camera()?.state).toBe('starting');
  });

  it('phones default to the back camera at 720p', async () => {
    const service = setup();
    service.start();
    await settle();

    expect(media.publisher.calls).toContain('publishCamera:camera:environment:720');
  });

  it('does not auto-start a camera that was stopped on purpose', async () => {
    const service = setup({ settings: { cameraOn: false } });
    await online(service);

    expect(media.publisher.calls.filter((call) => call.startsWith('publishCamera'))).toEqual([]);
  });

  it('reports every 2 s: rtc state, slot telemetry, battery, network, RTT and the last tech check', async () => {
    const service = setup({
      settings: {
        cameraOn: false,
        techCheck: { deviceId: CREDENTIALS.deviceId, result: TECH_CHECK_OK },
      },
    });
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : new Promise((resolve) => setTimeout(resolve, 14));
    await online(service);
    await vi.advanceTimersByTimeAsync(20);
    media.publisher.telemetry = [
      {
        slot: 'camera',
        state: 'live',
        width: 1280,
        height: 720,
        fps: 30,
        bitrateKbps: 2800,
        packetLossPct: 0,
        codec: 'h264',
      },
    ];
    await settle();
    hub.invoked.length = 0;

    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

    expect(hub.reports()).toHaveLength(1);
    expect(lastReport()).toEqual({
      rtc: 'connected',
      slots: [media.publisher.telemetry[0]],
      batteryPct: 81,
      charging: true,
      network: 'wifi',
      rttMs: 14,
      techCheck: TECH_CHECK_OK,
    });

    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(hub.reports()).toHaveLength(2);
  });

  it('reports a camera stopped on purpose as ended («Kamera beendet»), not paused', async () => {
    const service = setup();
    await online(service);
    service.stopCamera();
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

    expect(lastReport().slots).toEqual([
      expect.objectContaining({ slot: 'camera', state: 'ended' }),
    ]);
    expect(service.camera()?.state).toBe('idle');
    expect(TestBed.inject(LOCAL_STORAGE).readJson(STORAGE_KEYS.settings)).toMatchObject({
      cameraOn: false,
    });
  });

  it('keeps reporting a camera stopped before a reload as ended (each report replaces the slot states)', async () => {
    const service = setup({ settings: { cameraOn: false } });
    await online(service);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

    expect(lastReport().slots).toEqual([
      expect.objectContaining({ slot: 'camera', state: 'ended' }),
    ]);
    expect(service.camera()?.state).toBe('idle');

    service.startCamera();
    media.publisher.telemetry = [];
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(lastReport().slots).toEqual([]);
  });

  it('blocked: hub refused → /me 403 → stops media, retries every 15 s and continues when unblocked', async () => {
    const service = setup();
    await online(service);
    api.getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'gesperrt'));

    hub.setState('unauthorized');
    await settle();

    expect(service.phase()).toBe('blocked');
    expect(service.connection()).toBe('blocked');
    expect(media.session.calls).toContain('stop');

    await vi.advanceTimersByTimeAsync(BLOCKED_RETRY_MS);
    expect(service.phase()).toBe('blocked');
    const checks = api.getSelfTimed.mock.calls.length;

    api.getSelfTimed.mockResolvedValue({ self, rttMs: 9 });
    await vi.advanceTimersByTimeAsync(BLOCKED_RETRY_MS);

    expect(api.getSelfTimed.mock.calls.length).toBeGreaterThan(checks);
    expect(service.phase()).toBe('connecting');
    expect(hub.calls).toContain('restart');
    expect(media.session.calls).toContain('restart');

    hub.connect();
    media.session.setState('connected');
    await settle();
    expect(service.phase()).toBe('online');
    expect(service.connection()).toBe('connected');
  });

  it('a final self with state blocked blocks at once and ends the hub', async () => {
    const service = setup();
    await online(service);
    api.getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'gesperrt'));

    hub.emit('self', { ...self, state: 'blocked' });

    expect(service.phase()).toBe('blocked');
    expect(hub.calls).toContain('markTerminal:unauthorized');
    expect(media.session.calls).toContain('stop');
  });

  it('a Hello refused with device_blocked blocks the station', async () => {
    const service = setup();
    hub.responder = () => Promise.reject(new Error('device_blocked: Das Gerät ist gesperrt.'));
    await online(service);

    expect(service.phase()).toBe('blocked');
  });

  it('sessionReplaced shows «In einem anderen Tab geöffnet» and never reconnects by itself', async () => {
    const service = setup();
    await online(service);

    hub.emit('sessionReplaced');

    expect(service.phase()).toBe('replaced');
    expect(service.connection()).toBe('replaced');
    expect(hub.calls).toContain('markTerminal:stopped');
    expect(media.session.calls).toContain('stop');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hub.calls.filter((call) => call === 'restart')).toEqual([]);
  });

  it('«Hier weitermachen» says Hello again with a new session id and takes over (GAP-21)', async () => {
    const service = setup();
    await online(service);
    const replacedSession = service.sessionId;
    hub.emit('sessionReplaced');

    service.takeOver();
    expect(hub.calls).toContain('restart');
    expect(media.session.calls).toContain('restart');
    hub.connect();
    media.session.setState('connected');
    await settle();

    const hellos = hub.invoked.filter((call) => call.method === 'Hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[0].args[0]).toMatchObject({ sessionId: replacedSession });
    expect(hellos[1].args[0]).toMatchObject({ sessionId: service.sessionId });
    expect(service.sessionId).not.toBe(replacedSession);
    expect(service.sessionId).toMatch(/^ses_[a-z0-9]{20}$/);
    expect(service.phase()).toBe('online');
  });

  it('a LiveKit DUPLICATE_IDENTITY (media replaced) also shows the replaced screen', async () => {
    const service = setup();
    await online(service);

    media.session.setState('replaced');

    expect(service.phase()).toBe('replaced');
    expect(hub.calls).toContain('markTerminal:stopped');
  });

  it('removed by the Regie: 401 clears the credentials and leaves a notice for the pairing form', async () => {
    const service = setup();
    api.getSelfTimed.mockRejectedValue(new ApiError(401, 'unauthorized', 'weg'));
    service.start();
    await settle();

    expect(service.phase()).toBe('removed');
    expect(TestBed.inject(CredentialsService).credentials()).toBeNull();
    expect(TestBed.inject(NoticeService).pairingNotice()).toContain('entfernt');
    expect(hub.calls).toContain('stop');
  });

  it('tally updates the frame state and the live state used by the update logic', async () => {
    const service = setup();
    await online(service);

    hub.emit('tally', { overall: 'program', slots: { camera: 'program' } });

    expect(service.tally().overall).toBe('program');
    expect(service.camera()?.tally).toBe('program');
    expect(TestBed.inject(LiveStateService).onAir()).toBe(true);

    hub.emit('tally', { overall: 'bogus' });
    expect(service.tally().overall).toBe('program');
  });

  it('a Regie message shows text and time, vibrates on phones and disappears after 15 s', async () => {
    const service = setup();
    await online(service);

    hub.emit('command', {
      id: 'cmd_1',
      kind: 'message',
      slot: null,
      text: 'In 10 s live',
      at: '2026-10-22T12:05:00Z',
    });

    expect(service.message()).toMatchObject({ id: 'cmd_1', text: 'In 10 s live' });
    expect(environment.vibrate).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MESSAGE_DISMISS_MS);
    expect(service.message()).toBeNull();
  });

  it('«OK» dismisses a Regie message', async () => {
    const service = setup();
    await online(service);
    hub.emit('command', {
      id: 'cmd_2',
      kind: 'message',
      slot: null,
      text: 'Bitte lächeln',
      at: '',
    });

    service.dismissMessage();

    expect(service.message()).toBeNull();
  });

  it('switchCamera from the Regie toggles front/back on the running camera', async () => {
    const service = setup();
    await online(service);
    media.publisher.emitSlot('camera', 'live');

    hub.emit('command', { id: 'cmd_3', kind: 'switchCamera', slot: 'camera', text: null, at: '' });

    expect(service.facing()).toBe('user');
    expect(media.publisher.calls).toContain('switchCamera');
  });

  it('a reshare request marks an ended screen; «Erneut teilen» shares it again', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'ended', 'Freigabe beendet');

    hub.emit('command', { id: 'cmd_4', kind: 'reshare', slot: 'screen-1', text: null, at: '' });

    expect(service.screens()[0]).toMatchObject({
      slot: 'screen-1',
      state: 'ended',
      reshareRequested: true,
    });

    service.shareScreen('screen-1');

    expect(media.publisher.calls).toContain('publishScreen:screen-1');
    expect(service.screens()[0].reshareRequested).toBe(false);
  });

  it('ignores a reshare request for a screen that is live', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');

    hub.emit('command', { id: 'cmd_5', kind: 'reshare', slot: 'screen-1', text: null, at: '' });

    expect(service.screens()[0].reshareRequested).toBe(false);
  });

  it('«Teilen beenden» keeps the slot and reports it ended', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');

    service.endShare('screen-1');
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

    expect(media.publisher.calls).toContain('unpublish:screen-1');
    expect(service.screens()[0].state).toBe('ended');
    expect(lastReport().slots).toEqual([
      expect.objectContaining({ slot: 'screen-1', state: 'ended' }),
    ]);
  });

  it('screens shared before a reload come back as ended (they need a click) and are reported so', async () => {
    const service = setup({
      self: laptopSelf(),
      settings: { cameraOn: false, sharedScreens: ['screen-1'] },
    });
    await online(service);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

    expect(service.screens()[0].state).toBe('ended');
    expect(lastReport().slots).toEqual([
      expect.objectContaining({ slot: 'screen-1', state: 'ended' }),
    ]);
  });

  it('«+ weiteren Bildschirm» opens the share dialog synchronously and allocates the predicted slot', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    let resolveAllocation: (slot: unknown) => void = () => undefined;
    api.allocateSlot.mockReturnValue(new Promise((resolve) => (resolveAllocation = resolve)));

    service.addScreen();

    // getDisplayMedia ran inside the click, before the allocation answered.
    expect(media.publisher.calls).toContain('publishScreen:screen-2');
    expect(api.allocateSlot).toHaveBeenCalledWith('screen');
    expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1', 'screen-2']);
    expect(service.screens()[1].code).toBeNull();

    resolveAllocation({ slot: 'screen-2', code: 'S5', kind: 'screen' });
    await settle();

    expect(service.screens()[1]).toMatchObject({ slot: 'screen-2', code: 'S5' });
  });

  it('a cancelled picker of a freshly added screen releases the extra slot', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    api.allocateSlot.mockResolvedValue({ slot: 'screen-2', code: 'S5', kind: 'screen' });

    service.addScreen();
    await settle();
    media.publisher.emitSlot('screen-2', 'idle', 'Freigabe abgebrochen', 'cancelled');
    await settle();

    expect(api.releaseSlot).toHaveBeenCalledWith('screen-2');
    expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1']);
  });

  it('«Entfernen» unpublishes and removes the slot on the server', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);

    await service.removeSlot('screen-1');

    expect(media.publisher.calls).toContain('unpublish:screen-1');
    expect(api.releaseSlot).toHaveBeenCalledWith('screen-1');
    expect(service.screens()).toEqual([]);
  });

  it('«Entfernen» of a slot that is already gone on the server (404) still removes it', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    api.releaseSlot.mockRejectedValue(
      new ApiError(404, 'not_found', 'Der Slot wurde nicht gefunden.'),
    );

    await service.removeSlot('screen-1');

    expect(service.screens()).toEqual([]);
    expect(service.actionError()).toBeNull();
  });

  it('holds the wake lock while the camera is wanted and releases it when removed', async () => {
    const service = setup();
    await online(service);
    expect(wakeLock.active).toBe(true);

    service.stopCamera();
    expect(wakeLock.active).toBe(false);
  });

  it('runs the first tech check once the camera is live, stores and reports it', async () => {
    const service = setup();
    await online(service);
    media.publisher.emitSlot('camera', 'live');
    await settle();

    expect(techCheck).toHaveBeenCalledTimes(1);
    expect(service.techCheck()).toEqual(TECH_CHECK_OK);
    expect(storage.readJson(STORAGE_KEYS.settings)).toMatchObject({
      techCheck: { deviceId: CREDENTIALS.deviceId, result: TECH_CHECK_OK },
    });
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(lastReport().techCheck).toEqual(TECH_CHECK_OK);
  });

  it('does not run the automatic tech check again when a result is stored', async () => {
    const service = setup({
      settings: { techCheck: { deviceId: CREDENTIALS.deviceId, result: TECH_CHECK_OK } },
    });
    await online(service);
    media.publisher.emitSlot('camera', 'live');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(techCheck).not.toHaveBeenCalled();
    expect(service.techCheck()).toEqual(TECH_CHECK_OK);
  });

  it('shows «Verbindet neu» with the outage start while the hub reconnects', async () => {
    const service = setup();
    await online(service);

    hub.setState('reconnecting');

    expect(service.connection()).toBe('reconnecting');
    expect(service.degradedSince()).not.toBeNull();
    hub.connect();
    await settle();
    expect(service.connection()).toBe('connected');
    expect(service.degradedSince()).toBeNull();
  });

  it('exposes the read-only test hook window.__fsSender', async () => {
    const service = setup();
    await online(service);
    media.publisher.emitSlot('camera', 'live');

    const hook = (
      window as unknown as { __fsSender: { slots(): unknown; rtc(): string; sessionId: string } }
    ).__fsSender;
    expect(hook.slots()).toEqual({ camera: 'live' });
    expect(hook.rtc()).toBe('connected');
    expect(hook.sessionId).toBe(service.sessionId);

    hub.emit('sessionReplaced');
    service.takeOver();
    expect(hook.sessionId).toBe(service.sessionId);
  });

  it('measures the RTT from the Report round trip and never polls /me while connected', async () => {
    const service = setup({ settings: { cameraOn: false } });
    let delayMs = 40;
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : new Promise((resolve) => setTimeout(resolve, delayMs));
    await online(service);
    await vi.advanceTimersByTimeAsync(50);
    expect(service.rttMs()).toBe(40);
    const probes = api.getSelfTimed.mock.calls.length;

    delayMs = 75;
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS + 100);
    expect(service.rttMs()).toBe(75);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(lastReport().rttMs).toBe(75);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getSelfTimed.mock.calls.length).toBe(probes);
  });

  it('sends one report at a time, unless the previous one hangs', async () => {
    const service = setup({ settings: { cameraOn: false } });
    hub.responder = (method) =>
      method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : new Promise(() => undefined);
    await online(service);
    const first = hub.reports().length;

    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 2);
    expect(hub.reports()).toHaveLength(first);

    await vi.advanceTimersByTimeAsync(REPORT_STALE_MS);
    expect(hub.reports().length).toBeGreaterThan(first);
  });

  it('reports at once when LiveKit leaves connected (rtc reconnecting)', async () => {
    const service = setup({ settings: { cameraOn: false } });
    await online(service);
    hub.invoked.length = 0;

    media.session.setState('reconnecting');
    await settle();

    expect(hub.reports()).toHaveLength(1);
    expect(lastReport().rtc).toBe('reconnecting');
    expect(service.connection()).toBe('reconnecting');
  });

  it('keeps reporting rtc connected only while the LiveKit room is connected', async () => {
    const service = setup({ settings: { cameraOn: false } });
    await online(service);
    media.session.setState('waiting');
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(lastReport().rtc).toBe('reconnecting');

    media.session.setState('connected');
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(lastReport().rtc).toBe('connected');
    expect(service.phase()).toBe('online');
  });

  it('asks /me after a hub reconnect and while the hub is down, not before', async () => {
    const service = setup({ settings: { cameraOn: false } });
    await online(service);
    const initial = api.getSelfTimed.mock.calls.length;
    expect(initial).toBe(1);

    hub.setState('reconnecting');
    await vi.advanceTimersByTimeAsync(OUTAGE_PROBE_MS);
    expect(api.getSelfTimed.mock.calls.length).toBe(initial + 1);

    hub.connect();
    await settle();
    expect(api.getSelfTimed.mock.calls.length).toBe(initial + 2);
    expect(service.connection()).toBe('connected');
  });

  it('a Hello refused with service_unavailable is retried calmly, without an error screen', async () => {
    const service = setup();
    let refusals = 2;
    hub.responder = (method) => {
      if (method === 'Hello' && refusals-- > 0) {
        return Promise.reject(
          new Error(
            "An unexpected error occurred invoking 'Hello' on the server. HubException: service_unavailable: Die Datenbank ist gerade nicht erreichbar.",
          ),
        );
      }
      return method === 'Hello'
        ? Promise.resolve({ device: self, tally: { overall: 'off', slots: {} } })
        : Promise.resolve(undefined);
    };
    await online(service);
    expect(service.phase()).toBe('connecting');
    expect(service.connection()).toBe('connecting');

    await vi.advanceTimersByTimeAsync(5000);

    expect(service.phase()).toBe('online');
    expect(hub.invoked.filter((call) => call.method === 'Hello')).toHaveLength(3);
  });

  it('a short database outage (503) on /me keeps the station calm', async () => {
    const service = setup();
    api.getSelfTimed.mockRejectedValue(
      new ApiError(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.'),
    );
    service.start();
    await settle();

    expect(service.phase()).toBe('connecting');
    expect(service.serverUnreachable()).toBe(false);
    hub.connect();
    media.session.setState('connected');
    await settle();
    expect(service.phase()).toBe('online');
  });

  it.each([
    [400, 'validation_failed', SLOT_ERROR_MESSAGES.phoneScreen],
    [409, 'limit_reached', SLOT_ERROR_MESSAGES.screenLimit],
    [
      503,
      'service_unavailable',
      'Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
    ],
  ] as const)(
    'a refused screen allocation (%s %s) shows a clear German message',
    async (status, code, message) => {
      const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
      await online(service);
      media.publisher.emitSlot('screen-1', 'live');
      api.allocateSlot.mockRejectedValue(
        toApiError(new HttpErrorResponse({ status, error: { code, detail: 'Detail' } })),
      );

      service.addScreen();
      await settle();

      expect(service.actionError()).toBe(message);
      expect(media.publisher.calls).toContain('unpublish:screen-2');
      expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1']);
    },
  );

  it('a second laptop camera (409 limit_reached) is explained', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    api.allocateSlot.mockRejectedValue(new ApiError(409, 'limit_reached', 'x'));

    await service.addCamera();

    expect(service.actionError()).toBe(SLOT_ERROR_MESSAGES.cameraLimit);
  });

  it('releasing a phone camera (409 conflict) keeps the slot and explains why', async () => {
    const service = setup();
    await online(service);
    api.releaseSlot.mockRejectedValue(new ApiError(409, 'conflict', 'x'));

    await service.removeSlot('camera');

    expect(service.actionError()).toBe(SLOT_ERROR_MESSAGES.phoneCamera);
    expect(service.camera()).not.toBeNull();
  });

  it('keeps the failure code of a failed camera for the explanation', async () => {
    const service = setup();
    await online(service);

    media.publisher.emitSlot('camera', 'failed', 'Kein Zugriff', 'permission-denied');

    expect(service.camera()).toMatchObject({
      state: 'failed',
      message: 'Kein Zugriff',
      failure: 'permission-denied',
    });
  });
});
