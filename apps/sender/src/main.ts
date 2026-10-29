// TEMPORARY PREVIEW HARNESS – NOT TO BE COMMITTED.
import { bootstrapApplication } from '@angular/platform-browser';
import type { DeviceSelfDto } from '@studioflow/scene-model';
import {
  FakeHub,
  FakeWakeLock,
  LIVEKIT_TOKEN,
  TECH_CHECK_OK,
  audioStationSelf,
  fakeEnvironment,
  fakeMedia,
  laptopSelf,
  micSlot,
  phoneSelf,
} from './testing/sender-fakes';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { DeviceApiService } from './app/core/device-api.service';
import { DEVICE_ENVIRONMENT } from './app/core/device-environment';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
} from './app/station/station-ports';
import { INPUT_METER_FACTORY } from './app/station/input-level.component';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') ?? 'phone';
const tally = params.get('tally') ?? 'off';
let self: DeviceSelfDto =
  kind === 'laptop'
    ? laptopSelf({
        productionName: 'Demo webinar',
        slots: [
          { slot: 'screen-1', code: 'S1', kind: 'screen' },
          ...(params.has('camera') ? [{ slot: 'camera', code: 'K2', kind: 'camera' as const }] : []),
          ...(params.has('mic') ? [micSlot()] : []),
        ],
      })
    : kind === 'audio'
      ? audioStationSelf()
      : phoneSelf({ name: params.get('name') ?? 'Stage camera', slots: [{ slot: 'camera', code: 'K1', kind: 'camera' }] });

function picture(hue: number): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d')!;
  const draw = (): void => {
    const gradient = context.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, `hsl(${hue} 40% 30%)`);
    gradient.addColorStop(1, `hsl(${hue + 40} 40% 18%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = 'hsl(30 40% 70%)';
    context.beginPath();
    context.ellipse(640, 330, 110, 140, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'hsl(210 20% 25%)';
    context.beginPath();
    context.ellipse(640, 720, 300, 200, 0, Math.PI, 0);
    context.fill();
    requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(15);
}

const media = fakeMedia();
const streams = new Map<string, MediaStream>();
media.publisher.localPreview = (slot?: string): MediaStream | null => {
  const key = slot ?? 'camera';
  if (!streams.has(key)) streams.set(key, picture(key === 'camera' ? 210 : 260));
  return streams.get(key)!;
};
const originalPublishCamera = media.publisher.publishCamera.bind(media.publisher);
media.publisher.publishCamera = async (slot, settings) => {
  await originalPublishCamera(slot, settings);
  setTimeout(() => media.publisher.emitSlot(slot, params.get('camstate') === 'failed' ? 'failed' : 'live', params.get('camstate') === 'failed' ? 'media.slot.failure.permission-denied' : undefined, params.get('camstate') === 'failed' ? 'permission-denied' : undefined), 300);
};
const originalPublishScreen = media.publisher.publishScreen.bind(media.publisher);
media.publisher.publishScreen = async (slot, options) => {
  await originalPublishScreen(slot, options);
  setTimeout(() => media.publisher.emitSlot(slot, 'live'), 300);
};
const originalMic = media.audio.publishMic.bind(media.audio);
media.audio.publishMic = async (settings) => {
  await originalMic(settings);
  media.audio.stream = picture(10);
  setTimeout(() => media.audio.emit('live'), 300);
};

const hub = new FakeHub();
hub.responder = (method) =>
  method === 'Hello'
    ? Promise.resolve({ device: self, tally: { overall: tally, slots: { camera: tally, 'screen-1': tally, mic: tally } } })
    : Promise.resolve(undefined);

localStorage.setItem('studioflow.sender.v1', JSON.stringify({ deviceId: self.id, secret: 'c2VjcmV0', productionId: 'prd_webinar01' }));
if (!localStorage.getItem('studioflow.sender.settings')) {
  localStorage.setItem('studioflow.sender.settings', JSON.stringify({ techCheck: { deviceId: self.id, result: TECH_CHECK_OK } }));
}
(window as unknown as { __preview: unknown }).__preview = { hub, media, setSelf: (next: DeviceSelfDto) => (self = next) };

bootstrapApplication(AppComponent, {
  providers: [
    ...appConfig.providers,
    {
      provide: DeviceApiService,
      useValue: {
        getSelfTimed: () => Promise.resolve({ self, rttMs: 10 }),
        getLiveKitToken: () => Promise.resolve(LIVEKIT_TOKEN),
        allocateSlot: () => Promise.resolve({ slot: 'mic', code: 'A1', kind: 'audio' }),
        releaseSlot: () => Promise.resolve(),
        bandwidthTest: () => Promise.resolve({ kbps: 8000 }),
        unpair: () => Promise.resolve(),
        createPairingRequest: () => Promise.resolve({ requestId: 'prq_1', pollToken: 't', checkCode: '4712', expiresAt: new Date(Date.now() + 9 * 60_000).toISOString() }),
        getPairingRequestStatus: () => new Promise(() => undefined),
        cancelPairingRequest: () => Promise.resolve(),
      },
    },
    {
      provide: DEVICE_ENVIRONMENT,
      useValue: fakeEnvironment({
        isPhone: () => kind === 'phone',
        canShareScreen: () => kind !== 'phone',
        platform: () => (kind === 'phone' ? 'Android · Chrome' : 'Windows · Edge'),
      }),
    },
    { provide: DEVICE_HUB_FACTORY, useValue: () => hub },
    { provide: SENDER_MEDIA_FACTORY, useValue: () => media },
    { provide: WAKE_LOCK_FACTORY, useValue: () => new FakeWakeLock() },
    { provide: TECH_CHECK_RUNNER, useValue: () => Promise.resolve(TECH_CHECK_OK) },
    {
      provide: INPUT_METER_FACTORY,
      useValue: () => {
        let level = -18;
        return {
          context: { state: 'running', resume: () => Promise.resolve() },
          read: () => (level = -24 + Math.random() * 18),
          dispose: () => undefined,
        };
      },
    },
  ],
})
  .then(() => {
    setTimeout(() => {
      hub.connect();
      media.session.setState('connected');
    }, 50);
  })
  .catch((error: unknown) => console.error(error));
