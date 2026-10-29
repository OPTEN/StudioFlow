import { TestBed } from '@angular/core/testing';
import type { ResilientHubOptions } from '@studioflow/realtime-client';
import type {
  CameraStateDto,
  DeviceReportDto,
  DeviceSelfDto,
  LiveKitTokenDto,
} from '@studioflow/scene-model';
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
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, toApiError } from '../core/api-error';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT, type DeviceEnvironment } from '../core/device-environment';
import { LiveStateService } from '../core/live-state.service';
import { NoticeService } from '../core/notice.service';
import { TEST_HOOKS_FLAG } from '../core/test-hooks';
import { actionErrorText } from './slot-errors';
import {
  BLOCKED_RETRY_MS,
  DeviceSessionService,
  OUTAGE_PROBE_MS,
  REMOTE_NOTICE_MS,
  REPORT_INTERVAL_MS,
  REPORT_STALE_MS,
} from './device-session.service';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
} from './station-ports';

/** The check as the report carries it: the problems stay on the device. */
const { problems: _problems, ...TECH_CHECK_WIRE } = TECH_CHECK_OK;

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
    window.localStorage.removeItem(TEST_HOOKS_FLAG);
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
      techCheck: TECH_CHECK_WIRE,
      camera: null,
    });

    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(hub.reports()).toHaveLength(2);
  });

  it('reports a camera stopped on purpose as ended (“camera stopped”), not paused', async () => {
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
    api.getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'blocked'));

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
    api.getSelfTimed.mockRejectedValue(new ApiError(403, 'device_blocked', 'blocked'));

    hub.emit('self', { ...self, state: 'blocked' });

    expect(service.phase()).toBe('blocked');
    expect(hub.calls).toContain('markTerminal:unauthorized');
    expect(media.session.calls).toContain('stop');
  });

  it('a Hello refused with device_blocked blocks the station', async () => {
    const service = setup();
    hub.responder = () => Promise.reject(new Error('device_blocked: The device is blocked.'));
    await online(service);

    expect(service.phase()).toBe('blocked');
  });

  it('sessionReplaced shows “Opened in another tab” and never reconnects by itself', async () => {
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

  it('“Continue here” says Hello again with a new session id and takes over (GAP-21)', async () => {
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
    expect(TestBed.inject(NoticeService).pairingNotice()).toBe('sender.notices.deviceRemoved');
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

  it('a Regie message shows text and time, vibrates on phones and stays until it is dismissed', async () => {
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
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(service.message()).toMatchObject({ id: 'cmd_1' });
  });

  it('“Dismiss” hides a Regie message', async () => {
    const service = setup();
    await online(service);
    hub.emit('command', {
      id: 'cmd_2',
      kind: 'message',
      slot: null,
      text: 'Please smile',
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

  it('a reshare request marks an ended screen; “Share again” shares it again', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'ended', 'media.slot.shareEnded');

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

  it('“Stop sharing” keeps the slot and reports it ended', async () => {
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

  it('“Video in screen” switches a screen to 30 fps, remembers it per slot and applies it to the running share', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    expect(service.videoScreen('screen-1')).toBe(false);

    service.setVideoScreen('screen-1', true);

    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:30');
    expect(service.videoScreen('screen-1')).toBe(true);
    expect(storage.readJson(STORAGE_KEYS.settings)).toMatchObject({ videoScreens: ['screen-1'] });

    service.setVideoScreen('screen-1', false);

    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:15');
    expect(storage.readJson(STORAGE_KEYS.settings)).toMatchObject({ videoScreens: [] });
  });

  it('“Video in screen” ignores unchanged values and the camera', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);

    service.setVideoScreen('screen-1', false);
    service.setVideoScreen('camera', true);

    expect(media.publisher.calls.filter((call) => call.startsWith('setScreenFrameRate'))).toEqual(
      [],
    );
    expect(service.videoScreen('camera')).toBe(false);
  });

  it('a reloaded laptop shares a “Video in screen” slot at 30 fps again, and “Remove” forgets it', async () => {
    const service = setup({
      self: laptopSelf(),
      settings: { cameraOn: false, videoScreens: ['screen-1'] },
    });
    await online(service);

    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:30');
    expect(service.videoScreen('screen-1')).toBe(true);

    await service.removeSlot('screen-1');

    expect(service.videoScreen('screen-1')).toBe(false);
    expect(media.publisher.calls).toContain('setScreenFrameRate:screen-1:15');
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

  it('“+ Another screen” opens the share dialog synchronously and allocates the predicted slot', async () => {
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

  it('two quick clicks on “+ Another screen” allocate one after the other and keep both screens', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    const answers: Array<(slot: unknown) => void> = [];
    api.allocateSlot.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    service.addScreen();
    service.addScreen();

    // Both share dialogs opened inside the clicks; the second request waits for the answer to the first, so the server
    // cannot hand out the slots in the opposite order.
    expect(media.publisher.calls).toEqual(
      expect.arrayContaining(['publishScreen:screen-2', 'publishScreen:screen-3']),
    );
    expect(api.allocateSlot).toHaveBeenCalledTimes(1);

    answers[0]!({ slot: 'screen-2', code: 'S5', kind: 'screen' });
    await settle();
    expect(api.allocateSlot).toHaveBeenCalledTimes(2);
    answers[1]!({ slot: 'screen-3', code: 'S6', kind: 'screen' });
    await settle();

    expect(service.screens().map((slot) => [slot.slot, slot.code])).toEqual([
      ['screen-1', 'S2'],
      ['screen-2', 'S5'],
      ['screen-3', 'S6'],
    ]);
    expect(media.publisher.calls.filter((call) => call.startsWith('unpublish:'))).toEqual([]);
    expect(service.actionError()).toBeNull();
  });

  it('a refused screen allocation does not stop the one queued behind it', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    api.allocateSlot
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockResolvedValueOnce({ slot: 'screen-3', code: 'S6', kind: 'screen' });

    service.addScreen();
    service.addScreen();
    await settle();

    expect(api.allocateSlot).toHaveBeenCalledTimes(2);
    expect(media.publisher.calls).toContain('unpublish:screen-2');
    expect(media.publisher.calls).not.toContain('unpublish:screen-3');
    expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1', 'screen-3']);
  });

  it('a cancelled picker of a freshly added screen releases the extra slot', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    media.publisher.emitSlot('screen-1', 'live');
    api.allocateSlot.mockResolvedValue({ slot: 'screen-2', code: 'S5', kind: 'screen' });

    service.addScreen();
    await settle();
    media.publisher.emitSlot('screen-2', 'idle', 'media.slot.failure.cancelled', 'cancelled');
    await settle();

    expect(api.releaseSlot).toHaveBeenCalledWith('screen-2');
    expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1']);
  });

  it('“Remove” unpublishes and removes the slot on the server', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);

    await service.removeSlot('screen-1');

    expect(media.publisher.calls).toContain('unpublish:screen-1');
    expect(api.releaseSlot).toHaveBeenCalledWith('screen-1');
    expect(service.screens()).toEqual([]);
  });

  it('“Remove” of a slot that is already gone on the server (404) still removes it', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    api.releaseSlot.mockRejectedValue(new ApiError(404, 'not_found', 'The slot was not found.'));

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
    expect(lastReport().techCheck).toEqual(TECH_CHECK_WIRE);
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

  it('shows “Reconnecting” with the outage start while the hub reconnects', async () => {
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

  it('exposes the read-only test hook window.__sfSender with the opt-in flag', async () => {
    window.localStorage.setItem(TEST_HOOKS_FLAG, '1');
    const service = setup();
    await online(service);
    media.publisher.emitSlot('camera', 'live');

    const view = window as unknown as {
      __sfSender: { slots(): unknown; rtc(): string; sessionId: string };
    };
    const hook = view.__sfSender;
    expect(hook.slots()).toEqual({ camera: 'live' });
    expect(hook.rtc()).toBe('connected');
    expect(hook.sessionId).toBe(service.sessionId);
    expect(Object.isFrozen(hook)).toBe(true);
    expect(Object.keys(window)).not.toContain('__sfSender');
    expect(() => {
      (view as { __sfSender: unknown }).__sfSender = {};
    }).toThrow(TypeError);
    expect(view.__sfSender).toBe(hook);

    hub.emit('sessionReplaced');
    service.takeOver();
    expect(hook.sessionId).toBe(service.sessionId);

    TestBed.resetTestingModule();
    expect('__sfSender' in window).toBe(false);
  });

  it.each([null, '0', 'true', ' 1'])(
    'has no window.__sfSender without the opt-in flag (%s)',
    async (flag) => {
      if (flag !== null) {
        window.localStorage.setItem(TEST_HOOKS_FLAG, flag);
      }
      const service = setup();
      await online(service);

      expect('__sfSender' in window).toBe(false);
    },
  );

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
            "An unexpected error occurred invoking 'Hello' on the server. HubException: service_unavailable: The database is not reachable right now.",
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
      new ApiError(503, 'service_unavailable', 'The server is not reachable right now.'),
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
    [400, 'validation_failed', 'A phone cannot share a screen. Please pair a laptop for that.'],
    [409, 'limit_reached', 'At most 9 screens are possible per device.'],
    [
      503,
      'service_unavailable',
      'The server is not reachable right now. Please try again in a moment.',
    ],
  ] as const)(
    'a refused screen allocation (%s %s) shows a clear message',
    async (status, code, message) => {
      const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
      await online(service);
      media.publisher.emitSlot('screen-1', 'live');
      api.allocateSlot.mockRejectedValue(
        toApiError(new HttpErrorResponse({ status, error: { code, detail: 'Detail' } })),
      );

      service.addScreen();
      await settle();

      expect(actionErrorText(service.actionError()!)).toBe(message);
      expect(media.publisher.calls).toContain('unpublish:screen-2');
      expect(service.screens().map((slot) => slot.slot)).toEqual(['screen-1']);
    },
  );

  it('a second laptop camera (409 limit_reached) is explained', async () => {
    const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
    await online(service);
    api.allocateSlot.mockRejectedValue(new ApiError(409, 'limit_reached', 'x'));

    await service.addCamera();

    expect(actionErrorText(service.actionError()!)).toBe('This device already has a camera.');
  });

  it('releasing a phone camera (409 conflict) keeps the slot and explains why', async () => {
    const service = setup();
    await online(service);
    api.releaseSlot.mockRejectedValue(new ApiError(409, 'conflict', 'x'));

    await service.removeSlot('camera');

    expect(actionErrorText(service.actionError()!)).toBe(
      'The camera of a phone cannot be removed. The control room can remove the whole device.',
    );
    expect(service.camera()).not.toBeNull();
  });

  it('keeps the failure code of a failed camera for the explanation', async () => {
    const service = setup();
    await online(service);

    media.publisher.emitSlot(
      'camera',
      'failed',
      'media.slot.failure.permission-denied',
      'permission-denied',
    );

    expect(service.camera()).toMatchObject({
      state: 'failed',
      messageKey: 'media.slot.failure.permission-denied',
      failure: 'permission-denied',
    });
  });

  describe('remote camera control (issue #11)', () => {
    const CAMERA_STATE: CameraStateDto = {
      v: 1,
      capabilities: {
        lenses: [],
        zoom: { min: 1, max: 8, step: 0.1 },
        focusModes: ['auto'],
        focusDistance: null,
        exposureCompensation: null,
        torch: false,
      },
      settings: {
        lensId: 'back-main',
        zoom: 2,
        focusMode: 'auto',
        focusDistance: null,
        exposureCompensation: null,
        torch: null,
      },
      problem: null,
    };

    function cameraCommand(camera: Record<string, unknown>): Record<string, unknown> {
      return { id: 'cmd_9', kind: 'cameraControl', slot: 'camera', text: null, at: '', camera };
    }

    it('applies the command, reports the actual settings at once and shows a short note', async () => {
      const service = setup();
      await online(service);
      media.publisher.cameraState = CAMERA_STATE;
      await settle();
      hub.invoked.length = 0;

      hub.emit('command', cameraCommand({ v: 1, zoom: 2 }));
      await settle(10);

      expect(media.publisher.controls).toEqual([expect.objectContaining({ v: 1, zoom: 2 })]);
      expect(hub.reports()).toHaveLength(1);
      expect(lastReport().camera).toEqual(CAMERA_STATE);
      expect(service.remoteNotice()).toEqual({ kind: 'zoom', zoom: 2 });

      await vi.advanceTimersByTimeAsync(REMOTE_NOTICE_MS);
      expect(service.remoteNotice()).toBeNull();
    });

    it('says so when the camera refused the change', async () => {
      const service = setup();
      await online(service);
      media.publisher.cameraState = { ...CAMERA_STATE, problem: 'overconstrained' };

      hub.emit('command', cameraCommand({ v: 1, zoom: 9 }));
      await settle(10);

      expect(service.remoteNotice()).toEqual({ kind: 'refused' });
    });

    it.each([
      ['another version', { v: 2, zoom: 2 }],
      ['a zoom that is no number', { v: 1, zoom: 'max' }],
      ['an empty lens', { v: 1, lensId: '' }],
    ])('ignores a command with %s', async (_case, camera) => {
      const service = setup();
      await online(service);

      hub.emit('command', cameraCommand(camera));
      await settle(10);

      expect(media.publisher.controls).toEqual([]);
      expect(service.remoteNotice()).toBeNull();
    });

    it('leaves a laptop camera alone and reports no camera for it', async () => {
      const service = setup({ self: laptopSelf() });
      await online(service);
      media.publisher.cameraState = CAMERA_STATE;

      hub.emit('command', cameraCommand({ v: 1, zoom: 2 }));
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(media.publisher.controls).toEqual([]);
      expect(lastReport().camera).toBeNull();
    });

    it('keeps what the control room set and restores it after a reload', async () => {
      const service = setup();
      await online(service);

      media.publisher.emitCameraSettings({
        facingMode: 'environment',
        resolution: 720,
        deviceId: 'back-wide',
        image: { exposureCompensation: 1, torch: true },
      });

      expect(storage.readJson(STORAGE_KEYS.settings)).toEqual(
        expect.objectContaining({
          lens: 'back-wide',
          image: { exposureCompensation: 1, torch: true },
        }),
      );
      TestBed.resetTestingModule();
      const settings = storage.readJson(STORAGE_KEYS.settings) as Record<string, unknown>;
      const reloaded = setup({ settings });
      await online(reloaded);
      reloaded.startCamera();

      expect(media.publisher.lastCamera).toEqual({
        facingMode: 'environment',
        resolution: 720,
        deviceId: 'back-wide',
        image: { exposureCompensation: 1, torch: true },
      });
    });

    it('gives up the chosen lens and its zoom when the person at the phone switches front/back', async () => {
      const service = setup({ settings: { lens: 'back-wide', image: { zoom: 3, torch: true } } });
      await online(service);

      service.setFacing('user');

      expect(service.settings()).toEqual(
        expect.objectContaining({ facing: 'user', lens: null, image: { torch: true } }),
      );
    });
  });

  describe('microphone (issue #7)', () => {
    it('a phone has no microphone until the person switches it on, then it is allocated and published', async () => {
      const service = setup();
      await online(service);

      expect(service.mic()).toBeNull();
      expect(media.audio.calls).toEqual([]);

      api.allocateSlot.mockResolvedValue({ slot: 'mic', code: 'A1', kind: 'audio' });
      await service.startMic();

      expect(api.allocateSlot).toHaveBeenCalledWith('audio');
      expect(media.audio.calls).toEqual(['publishMic:voice:default']);
      expect(service.mic()).toMatchObject({ slot: 'mic', code: 'A1', kind: 'audio' });
      expect(service.settings().micOn).toBe(true);
    });

    it('does not allocate a second microphone slot', async () => {
      const service = setup({ self: phoneSelf({ slots: [...phoneSelf().slots, micSlot()] }) });
      await online(service);

      await service.startMic();

      expect(api.allocateSlot).not.toHaveBeenCalled();
      expect(media.audio.calls).toEqual(['publishMic:voice:default']);
    });

    it('a device that already has a microphone slot does not start it by itself (muted by default)', async () => {
      const service = setup({ self: phoneSelf({ slots: [...phoneSelf().slots, micSlot()] }) });
      await online(service);
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(media.audio.calls).toEqual([]);
      expect(lastReport().slots).toContainEqual(
        expect.objectContaining({ slot: 'mic', state: 'ended' }),
      );
    });

    it('says when the microphone is already taken (409 limit_reached)', async () => {
      const service = setup();
      await online(service);
      api.allocateSlot.mockRejectedValue(new ApiError(409, 'limit_reached', 'x'));

      await service.startMic();

      expect(media.audio.calls).toEqual([]);
      const error = service.actionError();
      expect(error === null ? null : actionErrorText(error)).toBe(
        'This device already has a microphone.',
      );
    });

    it('the audio station starts the desk feed by itself, as a station with the chosen input', async () => {
      const service = setup({
        self: audioStationSelf(),
        settings: { micInput: 'usb-interface' },
      });
      await online(service);

      expect(media.audio.calls).toEqual(['publishMic:station:usb-interface']);
      expect(service.mic()?.state).toBe('starting');
    });

    it('the audio station stays off after the person switched the microphone off', async () => {
      const service = setup({ self: audioStationSelf(), settings: { micOn: false } });
      await online(service);

      expect(media.audio.calls).toEqual([]);
      expect(service.mic()?.state).toBe('idle');
    });

    it('“Switch off” stops the microphone on purpose and a reload keeps it off', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);
      media.audio.emit('live');

      service.stopMic();
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(media.audio.calls).toContain('unpublish');
      expect(service.mic()?.state).toBe('idle');
      expect(service.settings().micOn).toBe(false);
      expect(lastReport().slots).toEqual([
        expect.objectContaining({ slot: 'mic', state: 'ended' }),
      ]);
      TestBed.resetTestingModule();
      const reloaded = setup({
        self: audioStationSelf(),
        settings: storage.readJson(STORAGE_KEYS.settings) as Record<string, unknown>,
      });
      await online(reloaded);

      expect(media.audio.calls).toEqual([]);
    });

    it('switching the input of a running microphone publishes it again with the new input', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);
      media.audio.emit('live');

      service.setMicInput('line-in');

      expect(media.audio.calls).toEqual([
        'publishMic:station:default',
        'publishMic:station:line-in',
      ]);
      expect(service.settings().micInput).toBe('line-in');
    });

    it('remembers an input chosen while the microphone is off without starting it', async () => {
      const service = setup({ self: phoneSelf({ slots: [...phoneSelf().slots, micSlot()] }) });
      await online(service);

      service.setMicInput('headset');
      service.setMicInput(null);

      expect(media.audio.calls).toEqual([]);
      expect(service.settings().micInput).toBeNull();
    });

    it('lists the audio inputs of the device and refreshes them with the state of the microphone', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);
      media.audio.inputs = [{ id: 'usb-interface', label: 'USB interface' }];

      await service.refreshMicInputs();

      expect(service.micInputs()).toEqual([{ id: 'usb-interface', label: 'USB interface' }]);
    });

    it('reports the microphone with the telemetry of the video slots, and a problem as failed', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);
      media.audio.telemetry = {
        slot: 'mic',
        state: 'live',
        width: null,
        height: null,
        fps: null,
        bitrateKbps: 128,
        packetLossPct: 0,
        codec: 'opus',
      };
      media.audio.emit('live');

      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(lastReport().slots).toEqual([
        expect.objectContaining({ slot: 'mic', state: 'live', bitrateKbps: 128, codec: 'opus' }),
      ]);

      media.audio.telemetry = null;
      media.audio.emit('failed', 'media.slot.mic.not-found', 'not-found');
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(service.mic()).toMatchObject({
        state: 'failed',
        messageKey: 'media.slot.mic.not-found',
      });
    });

    it('the microphone is live while the tally of the mic slot is program, and the overall tally stays off', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);

      hub.emit('tally', { overall: 'off', slots: { mic: 'program' } });

      expect(service.micLive()).toBe(true);
      expect(service.slots()[0].tally).toBe('program');

      hub.emit('tally', { overall: 'off', slots: {} });

      expect(service.micLive()).toBe(false);
    });

    it('a live microphone counts as on air: an update must not reload the page', async () => {
      const service = setup({ self: audioStationSelf() });
      const liveState = TestBed.inject(LiveStateService);
      await online(service);

      hub.emit('tally', { overall: 'off', slots: { mic: 'program' } });

      expect(liveState.busy()).toBe(true);
    });

    it('removing the microphone slot stops its publisher and removes the slot', async () => {
      const service = setup({ self: phoneSelf({ slots: [...phoneSelf().slots, micSlot()] }) });
      await online(service);

      await service.removeSlot('mic');

      expect(media.audio.calls).toContain('unpublish');
      expect(media.publisher.calls).not.toContain('unpublish:mic');
      expect(api.releaseSlot).toHaveBeenCalledWith('mic');
    });

    it('leaving the page disposes the microphone publisher', async () => {
      const service = setup({ self: audioStationSelf() });
      await online(service);

      TestBed.resetTestingModule();

      expect(media.audio.disposed).toBe(true);
      expect(service.mic()).not.toBeNull();
    });

    it('shares the sound of a screen only when “Share audio” is ticked, and remembers it', async () => {
      const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
      await online(service);

      service.shareScreen('screen-1');
      service.setShareScreenAudio(true);
      service.shareScreen('screen-1');

      expect(media.publisher.calls.filter((call) => call.startsWith('publishScreen'))).toEqual([
        'publishScreen:screen-1',
        'publishScreen:screen-1:audio',
      ]);
      expect(service.settings().shareScreenAudio).toBe(true);
    });

    it('a screen added with “Share audio” ticked asks for its sound at once', async () => {
      const service = setup({
        self: laptopSelf(),
        settings: { cameraOn: false, shareScreenAudio: true },
      });
      await online(service);
      media.publisher.emitSlot('screen-1', 'live');
      api.allocateSlot.mockResolvedValue({ slot: 'screen-2', code: 'S5', kind: 'screen' });

      service.addScreen();

      expect(media.publisher.calls).toContain('publishScreen:screen-2:audio');
    });

    it('knows whether a share carries sound', async () => {
      const service = setup({ self: laptopSelf(), settings: { cameraOn: false } });
      await online(service);
      media.publisher.screensWithSound.add('screen-1');

      expect(service.screenHasAudio('screen-1')).toBe(true);
      expect(service.screenHasAudio('screen-2')).toBe(false);
    });
  });
});
