import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { stackConfig } from '../env';
import { installInitScript } from '../net';
import { uniqueIp } from '../production';

/**
 * Browser context set-up for the UI tests (docs/testing.md 1.3, 1.7): the test hooks flag, the init script (WebSocket /
 * RTCPeerConnection registries, media call counters), the fake camera and screen sources with known content, and
 * the device profiles of the sender (Pixel 7 / iPhone 15 on Chromium, Desktop).
 */

const FAKE_SOURCES = fs.readFileSync(
  path.join(__dirname, '..', 'browser', 'fake-sources.js'),
  'utf8',
);

/** localStorage key that switches the read-only state views `window.__sfStudio` / `window.__sfSender` on (the output page has none, spec 12). */
export const TEST_HOOKS_KEY = 'studioflow.testHooks';

/** Fake origin of a page that embeds the output in an iframe (the embedding origins the harness saves in the wizard allow it). */
export const EMBED_ORIGIN = 'https://embed.test';
/** An origin the stack does NOT allow to frame the output. */
export const FOREIGN_ORIGIN = 'https://foreign.test';

const FAKE_AUDIO = fs.readFileSync(path.join(__dirname, '..', 'browser', 'fake-audio.js'), 'utf8');
const AUDIO_PROBE = fs.readFileSync(path.join(__dirname, '..', 'browser', 'audio-probe.js'), 'utf8');

/** The five colours the fake screens cycle through: S1 red, S2 green, S3 blue, S4 yellow, S5 violet. */
export const SCREEN_COLORS = ['#e5484d', '#30a46c', '#3e63dd', '#f5d90a', '#8e4ec6'] as const;

export interface FakeSourceOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Draw the latency stamp bar (default true). */
  stamp?: boolean;
}

export interface FakeScreenOptions extends FakeSourceOptions {
  /** Flat colour per screen: the n-th getDisplayMedia() call uses colors[n % colors.length]. */
  colors?: readonly string[];
}

/** A sine tone of a fake microphone or a fake screen sound (support/browser/fake-audio.js). */
export interface FakeToneOptions {
  /** Hz (default 440). */
  frequency?: number;
  /** Peak amplitude, 0 to 1 (default 0.5, which is -6 dBFS). */
  level?: number;
  /** 1 or 2 (default 2). */
  channels?: 1 | 2;
}

export interface UiInitOptions {
  /** Set `localStorage['studioflow.testHooks'] = '1'` before any app script runs (default true). */
  testHooks?: boolean;
  /**
   * getDisplayMedia():
   * - `canvas` (default): a canvas stream with a flat colour and the stamp bar (deterministic; ends via `endScreen`);
   * - `native`: Chromium's own capture (`--auto-select-tab-capture-source-by-title`, see {@link openTimecodeTab}).
   */
  screen?: 'canvas' | 'native' | FakeScreenOptions;
  /**
   * getUserMedia({video}): `native` (default) is Chromium's fake device (`--use-fake-device-for-media-stream`);
   * `stamp` is a canvas camera that carries the latency stamp (the "latency stamp publisher").
   */
  camera?: 'native' | 'stamp' | FakeSourceOptions;
  /** Make every camera request fail with NotReadableError (`window.__sfMedia.failCamera`). */
  failCamera?: boolean;
  /**
   * getUserMedia({audio}) without video: `native` (default) is Chromium's fake device; a tone makes every microphone of
   * this context deliver that sine tone (needs no user gesture, can be changed and unplugged: `window.__sfAudioFake`).
   */
  mic?: 'native' | FakeToneOptions;
  /**
   * The sound of getDisplayMedia({audio: true}): a tone, or null (default) for a browser that cannot share sound (the
   * request is answered with a picture only).
   */
  screenAudio?: FakeToneOptions | null;
  /**
   * Install the audio probe (`window.__sfAudioProbe`, support/browser/audio-probe.js) that measures what the pages of
   * this context send to their speakers. Off by default: it wraps `AudioNode.connect`.
   */
  audioProbe?: boolean;
  /**
   * With the probe: every audio context of the pages stays suspended until the first trusted click, key or touch (the
   * autoplay rule of a browser window that a person opened; Playwright's own evaluations would unlock it otherwise).
   */
  audioGate?: boolean;
  /**
   * The client address the stack sees for the anonymous, rate-limited calls of this context (`POST /api/pairing/requests`
   * 10 per 10 min, `POST /api/pairing/invites/{token}/redeem` 20 per 10 min, failed `POST /api/auth/login` lockouts):
   * - `unique` (default): one made-up address per context. These calls are sent to the direct API port with that
   *   `X-Forwarded-For`, so no UI test uses up the allowance of another and a lockout test cannot lock the machine out;
   * - `real`: nothing is rerouted, the stack sees the address of the machine (rate limits and lockouts are shared);
   * - an address: that one (two contexts with the same address share one allowance, like two phones on one Wi-Fi).
   * Everything else (pages, hubs, the rest of the API) still goes through Caddy.
   */
  clientIp?: 'unique' | 'real' | string;
}

/** Normalised options. */
function resolve(options: UiInitOptions) {
  const screen = options.screen ?? 'canvas';
  const camera = options.camera ?? 'native';
  return {
    testHooks: options.testHooks ?? true,
    screen:
      screen === 'native'
        ? null
        : {
            width: 1280,
            height: 720,
            fps: 30,
            colors: [...SCREEN_COLORS],
            ...(screen === 'canvas' ? {} : screen),
          },
    camera:
      camera === 'native'
        ? null
        : { width: 1280, height: 720, fps: 30, ...(camera === 'stamp' ? {} : camera) },
    failCamera: options.failCamera ?? false,
    mic: options.mic === undefined || options.mic === 'native' ? null : { frequency: 440, level: 0.5, channels: 2, ...options.mic },
    screenAudio: options.screenAudio ? { frequency: 880, level: 0.5, channels: 2, ...options.screenAudio } : null,
    audioProbe: options.audioProbe ?? false,
    audioGate: options.audioGate ?? false,
    clientIp:
      options.clientIp === 'real'
        ? null
        : options.clientIp && options.clientIp !== 'unique'
          ? options.clientIp
          : uniqueIp(),
  };
}

/**
 * Installs everything on a context, before any page of it navigates. Safe to call once per context; the options of a
 * later call win (the init scripts run in order), which is how a test switches the fake sources on a running context
 * for the pages it opens afterwards.
 */
export async function installUiInit(
  context: BrowserContext,
  options: UiInitOptions = {},
): Promise<void> {
  const resolved = resolve(options);
  await installInitScript(context);
  await context.addInitScript({ content: FAKE_SOURCES });
  await context.addInitScript({ content: FAKE_AUDIO });
  if (resolved.audioProbe) await context.addInitScript({ content: AUDIO_PROBE });
  await context.addInitScript((settings) => {
    try {
      if (settings.testHooks) window.localStorage.setItem('studioflow.testHooks', '1');
      else window.localStorage.removeItem('studioflow.testHooks');
    } catch {
      // opaque origins (about:blank, data:) have no storage
    }
    const w = window as unknown as {
      __sfFake?: { config: { screen: unknown; camera: unknown } };
      __sfAudioFake?: { config: { mic: unknown; screen: unknown } };
      __sfAudioProbe?: { gate: boolean };
      __sfMedia?: { failCamera: boolean };
    };
    if (w.__sfFake) {
      w.__sfFake.config.screen = settings.screen;
      w.__sfFake.config.camera = settings.camera;
    }
    if (w.__sfAudioProbe) w.__sfAudioProbe.gate = settings.audioGate;
    if (w.__sfAudioFake) {
      w.__sfAudioFake.config.mic = settings.mic;
      w.__sfAudioFake.config.screen = settings.screenAudio;
    }
    if (w.__sfMedia) w.__sfMedia.failCamera = settings.failCamera;
  }, resolved);
  await routeClientIp(context, resolved.clientIp);
}

/** Per context: the address the rerouted calls carry (changed by a later `installUiInit`). */
const clientIps = new WeakMap<BrowserContext, { ip: string | null }>();

/** The anonymous calls that are rate limited or counted per client address (see {@link UiInitOptions.clientIp}). */
function isLimitedCall(url: URL, method: string): boolean {
  if (method !== 'POST') return false;
  return (
    url.pathname === '/api/pairing/requests' ||
    url.pathname === '/api/auth/login' ||
    /^\/api\/pairing\/invites\/[^/]+\/redeem$/.test(url.pathname)
  );
}

/** Sends the rate-limited anonymous calls of a context to the direct API port with its own client address. */
async function routeClientIp(context: BrowserContext, ip: string | null): Promise<void> {
  const existing = clientIps.get(context);
  if (existing) {
    existing.ip = ip;
    return;
  }
  const holder = { ip };
  clientIps.set(context, holder);
  const config = stackConfig();
  const origin = new URL(config.baseURL).origin;
  await context.route(
    (url) => url.origin === origin && url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!holder.ip || !isLimitedCall(url, request.method())) return route.fallback();
      const headers: Record<string, string> = {
        ...request.headers(),
        'x-forwarded-for': holder.ip,
      };
      delete headers['host'];
      delete headers['content-length'];
      const response = await route.fetch({
        url: `${config.apiDirect}${url.pathname}${url.search}`,
        headers,
      });
      await route.fulfill({ response });
    },
  );
}

/** Device profiles of the senders. All run on Chromium here (WebKit has no WebRTC on Windows, playwright.config.ts). */
export type DeviceProfile = 'pixel7' | 'iphone15' | 'desktop';

/** The `devices[...]` descriptor of a profile without `defaultBrowserType` (a context cannot change the browser). */
export function profileOptions(profile: DeviceProfile): BrowserContextOptions {
  const descriptor =
    profile === 'pixel7'
      ? devices['Pixel 7']
      : profile === 'iphone15'
        ? devices['iPhone 15']
        : devices['Desktop Chrome'];
  const { defaultBrowserType: _ignored, ...rest } = descriptor;
  void _ignored;
  return rest;
}

/** What a profile is expected to look like to the app (kind default, touch, user agent). */
export const PROFILE_FACTS: Record<
  DeviceProfile,
  { kind: 'phone' | 'laptop'; mobile: boolean; userAgent: RegExp; platform: RegExp }
> = {
  pixel7: { kind: 'phone', mobile: true, userAgent: /Android/, platform: /Pixel 7 · Chrome/ },
  iphone15: { kind: 'phone', mobile: true, userAgent: /iPhone/, platform: /^iPhone/ },
  desktop: {
    kind: 'laptop',
    mobile: false,
    userAgent: /Windows|Macintosh|Linux/,
    platform: /· (Chrome|Edge)/,
  },
};

export interface NewUiContextOptions extends UiInitOptions {
  profile?: DeviceProfile;
  /** Extra Playwright context options (viewport, storageState, ...). */
  context?: BrowserContextOptions;
}

/**
 * A fresh browser context for the stack under test: device profile, `en-US`, Zurich time, the camera and microphone
 * permissions of the fake devices, HTTPS errors ignored (Caddy's local CA) and {@link installUiInit}.
 */
export async function newUiContext(
  browser: Browser,
  options: NewUiContextOptions = {},
): Promise<BrowserContext> {
  const { profile = 'desktop', context: extra, ...init } = options;
  const context = await browser.newContext({
    ...profileOptions(profile),
    baseURL: stackConfig().baseURL,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    ...extra,
  });
  await installUiInit(context, init);
  return context;
}

/**
 * Serves a page of a fake origin (e.g. {@link EMBED_ORIGIN}) with `page.route`; nothing is fetched from the network.
 * `html` may be a function of the request URL.
 */
export async function serveFakeOrigin(
  context: BrowserContext | Page,
  origin: string,
  html: string | ((url: URL) => string),
): Promise<void> {
  await context.route(`${origin}/**`, (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: typeof html === 'function' ? html(url) : html,
    });
  });
}

/**
 * Opens the tab titled "StudioFlow Timecode" that Chromium's native screen capture picks without a picker
 * (`--auto-select-tab-capture-source-by-title`, fake-media.ts) when a context is used with `screen: 'native'`. The page
 * draws the latency stamp and a running clock, so what is shared is known content.
 */
export async function openTimecodeTab(context: BrowserContext): Promise<Page> {
  const base = stackConfig().baseURL;
  const page = await context.newPage();
  await page.route(`${base}/__e2e/timecode`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>StudioFlow Timecode</title><body style="margin:0;background:#202020"><canvas id="c" width="1280" height="720" style="width:100vw;height:56.25vw"></canvas></body>',
    }),
  );
  await page.goto(`${base}/__e2e/timecode`);
  await page.evaluate(() => {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const g = canvas.getContext('2d')!;
    const fake = (
      window as unknown as {
        __sfFake?: {
          drawStampBar(g: CanvasRenderingContext2D, width: number, height: number): void;
        };
      }
    ).__sfFake;
    setInterval(() => {
      g.fillStyle = '#202020';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#fff';
      g.font = 'bold 120px monospace';
      g.fillText(new Date().toISOString().slice(11, 23), 160, 400);
      fake?.drawStampBar(g, canvas.width, canvas.height);
    }, 33);
  });
  return page;
}
