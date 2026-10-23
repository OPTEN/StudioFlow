import { HUB, type OutputChangesDto, type OutputReport } from '@studioflow/scene-model';
import type { ResilientHubOptions } from '@studioflow/realtime-client';
import type { SceneRendererOptions } from '@studioflow/scene-renderer';
import { ACCESS_RETRY_MS } from './access-guard';
import type { OutputConfig, OutputFlags } from './config';
import { noAccessSlate } from './slates';
import {
  REMOVAL_RESTART_MS,
  startInvalidLinkPage,
  startOutputApp,
  type OutputApp,
} from './output-app';
import { REPORT_INTERVAL_MS, REST_REPORT_INTERVAL_MS } from './status-reporter';
import { FakeHub, FakeRenderer, fakeApi, fakeMedia } from './testing/fakes';
import {
  CAMERA,
  FADE,
  IMAGE,
  item,
  KEY,
  productionChanged,
  programSwitched,
  scene,
  sceneUpserted,
  snapshotChanges,
  deltaChanges,
} from './testing/fixtures';
import { resetLocaleForTests } from '@studioflow/i18n';

// Not converted yet: asserts German texts, so it runs in de-CH. Remove with the conversion of this file.
beforeEach(() => resetLocaleForTests('de-CH'));
// Loaded once up front, so the page's lazy `import()` of them resolves within the fake-timer steps.
import './debug-overlay';
import './latency-probe';

const NEW_ENTRY = '/o/assets/index-NEW00000.js';

interface Setup {
  readonly app: OutputApp;
  readonly hub: FakeHub;
  readonly renderer: FakeRenderer;
  readonly media: ReturnType<typeof fakeMedia>;
  readonly api: ReturnType<typeof fakeApi>;
  readonly root: HTMLElement;
  readonly loadMedia: ReturnType<typeof vi.fn>;
  readonly hubOptions: () => ResilientHubOptions;
  readonly reload: ReturnType<typeof vi.fn>;
  readonly fetchIndex: ReturnType<typeof vi.fn>;
}

let current: Setup | null = null;

function setup(
  flags: Partial<OutputFlags> = {},
  answers?: (since: unknown) => OutputChangesDto,
): Setup {
  const root = document.createElement('main');
  document.body.append(root);
  const hub = new FakeHub();
  hub.onInvoke = (method, since) => {
    expect(method).toBe(HUB.subscribeOutput);
    return Promise.resolve(answers ? answers(since) : snapshotChanges());
  };
  let renderer: FakeRenderer | null = null;
  let hubOptions: ResilientHubOptions | null = null;
  const media = fakeMedia();
  const api = fakeApi();
  const loadMedia = vi.fn(() => Promise.resolve(media));
  const reload = vi.fn();
  const fetchIndex = vi.fn(() =>
    Promise.resolve(`<script type="module" src="${NEW_ENTRY}"></script>`),
  );
  const storage = new Map<string, string>();
  const config: OutputConfig = {
    kind: 'output',
    slug: 'webinar',
    key: KEY,
    keyFromUrl: true,
    flags: { background: 'black', debug: false, latency: false, ...flags },
  };
  const app = startOutputApp(config, root, {
    createRenderer: (container: HTMLElement, options: SceneRendererOptions) =>
      (renderer = new FakeRenderer(container, options)),
    createHub: (options) => {
      hubOptions = options;
      return hub;
    },
    loadMedia,
    api,
    log: { warn: () => undefined },
    waitForFonts: () => Promise.resolve(),
    currentEntry: '/o/assets/index-OLD00000.js',
    fetchIndex,
    reload,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
  });
  if (!renderer || !hubOptions) {
    throw new Error('not created');
  }
  const capturedOptions: ResilientHubOptions = hubOptions;
  current = {
    app,
    hub,
    renderer,
    media,
    api,
    root,
    loadMedia,
    hubOptions: () => capturedOptions,
    reload,
    fetchIndex,
  };
  return current;
}

/** Lets promises and zero-delay timers run. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Connects, delivers the first snapshot and lets the first frame pass (media starts). */
async function boot(flags: Partial<OutputFlags> = {}): Promise<Setup> {
  const ctx = setup(flags);
  ctx.hub.connect();
  await flush(300);
  return ctx;
}

function reports(hub: FakeHub): OutputReport[] {
  return hub.sent
    .filter((sent) => sent.method === HUB.report)
    .map((sent) => sent.args[0] as OutputReport);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.className = '';
});

afterEach(() => {
  current?.app.dispose();
  current?.root.remove();
  current = null;
  vi.useRealTimers();
});

describe('output app: boot', () => {
  it('connects the output hub with the key as access token and subscribes for a snapshot', async () => {
    const { hub, hubOptions } = setup();
    expect(hub.starts).toBe(1);
    expect(hubOptions().url).toBe('/hubs/output');
    expect(await hubOptions().accessTokenFactory?.()).toBe(KEY);
    hub.connect();
    await flush();
    expect(hub.invoked).toEqual([{ method: HUB.subscribeOutput, args: [null] }]);
  });

  it('renders standby slate, program and preloads from the first snapshot', async () => {
    const { renderer, app } = await boot();
    expect(renderer.summary()).toEqual([
      'show scn_a',
      "slate Gleich geht's los",
      'preload scn_b,scn_c',
    ]);
    expect(app.view.rendering).toBe(true);
  });

  it('creates the renderer in output mode with asset URLs that carry the key', async () => {
    const { renderer, app } = await boot();
    const options = renderer.options as SceneRendererOptions;
    expect(options).toMatchObject({ mode: 'output', background: 'black', reducedMotion: false });
    expect(options.assetKindOf?.(IMAGE)).toBe('image');
    expect(app.provider.assetUrl(IMAGE)).toBe(
      `/api/productions/prd_aaaaaaaaaaaaaaaa/assets/${IMAGE}/content?k=${KEY}`,
    );
    expect(app.provider.assetUrl('ast_unknown00000000')).toBeNull();
  });

  it('loads LiveKit only after the first frame and then binds and starts it', async () => {
    const ctx = setup();
    await flush(1000);
    expect(ctx.loadMedia).not.toHaveBeenCalled();
    ctx.hub.connect();
    await flush(300);
    expect(ctx.loadMedia).toHaveBeenCalledTimes(1);
    expect(ctx.app.provider.bound).toBe(true);
    expect(ctx.media.session.starts).toBe(1);
    const options = ctx.loadMedia.mock.calls[0][0] as { tokenProvider: () => Promise<unknown> };
    await options.tokenProvider();
    expect(ctx.api.liveKitToken).toHaveBeenCalledTimes(1);
  });

  it('starts LiveKit after 2 s even when the hub does not answer', async () => {
    const ctx = setup();
    await flush(1999);
    expect(ctx.loadMedia).not.toHaveBeenCalled();
    await flush(1);
    expect(ctx.loadMedia).toHaveBeenCalledTimes(1);
  });

  it('switches html, body and stage to transparent with ?bg=transparent', async () => {
    const { renderer } = await boot({ background: 'transparent' });
    expect(document.documentElement.classList.contains('is-transparent')).toBe(true);
    expect((renderer.options as SceneRendererOptions).background).toBe('transparent');
  });

  it('keeps html opaque by default', async () => {
    await boot();
    expect(document.documentElement.classList.contains('is-transparent')).toBe(false);
  });
});

describe('output app: state → picture', () => {
  it('plays the transition of a live program switch', async () => {
    const { hub, renderer } = await boot();
    renderer.reset();
    hub.emit(HUB.event, productionChanged(101, { broadcast: 'live' }));
    hub.emit(HUB.event, programSwitched(102, 'scn_b', FADE));
    expect(renderer.summary()).toEqual([
      'slate null',
      'transition scn_b fade 500',
      'preload scn_a,scn_c',
    ]);
  });

  it('updates the program scene in place and only preloads for other scenes', async () => {
    const { hub, renderer } = await boot();
    renderer.reset();
    hub.emit(
      HUB.event,
      sceneUpserted(101, scene('scn_a', 0, [item('itm_a1', CAMERA, { x: 40 })], { version: 2 })),
    );
    hub.emit(HUB.event, sceneUpserted(102, scene('scn_c', 2, [], { version: 2 })));
    expect(renderer.summary()).toEqual(['update scn_a', 'preload scn_b,scn_c']);
  });

  it('shows the end slate when the broadcast ends', async () => {
    const { hub, renderer } = await boot();
    hub.emit(HUB.event, productionChanged(101, { broadcast: 'live' }));
    renderer.reset();
    hub.emit(HUB.event, productionChanged(102, { broadcast: 'ended' }));
    expect(renderer.summary()).toEqual(['slate Danke fürs Zuschauen']);
  });

  it('keeps the last picture while the hub is down and catches up without transition', async () => {
    const ctx = setup({}, (since) =>
      since === null
        ? snapshotChanges()
        : deltaChanges(103, [
            programSwitched(101, 'scn_c', FADE),
            { type: 'revisionOnly', revision: 102 },
            { type: 'revisionOnly', revision: 103 },
          ]),
    );
    ctx.hub.connect();
    await flush(300);
    ctx.renderer.reset();
    ctx.hub.drop();
    await flush(60_000);
    expect(ctx.renderer.summary()).toEqual([]);
    ctx.hub.connect();
    await flush();
    expect(ctx.hub.invoked.at(-1)).toEqual({ method: HUB.subscribeOutput, args: [100] });
    expect(ctx.renderer.summary()).toEqual(['show scn_c', 'preload scn_a,scn_b']);
  });
});

describe('output app: short database outage', () => {
  it('keeps the picture while SubscribeOutput answers service_unavailable and catches up afterwards', async () => {
    const ctx = await boot();
    ctx.renderer.reset();
    let refusals = 3;
    ctx.hub.onInvoke = () =>
      refusals-- > 0
        ? Promise.reject(
            new Error(
              "An unexpected error occurred invoking 'SubscribeOutput' on the server. HubException: service_unavailable: Die Datenbank ist gerade nicht erreichbar.",
            ),
          )
        : Promise.resolve(deltaChanges(101, [programSwitched(101, 'scn_c', FADE)]));

    ctx.hub.drop();
    ctx.hub.connect();
    await flush(10_000);

    expect(ctx.hub.invoked.filter((call) => call.method === HUB.subscribeOutput)).toHaveLength(5);
    expect(ctx.renderer.currentSlate()).not.toEqual(noAccessSlate());
    expect(ctx.renderer.summary()).not.toContain('show null');
    expect(ctx.renderer.summary()).toContain('show scn_c');
    expect(ctx.media.session.stops).toBe(0);
  });
});

describe('output app: «Kein Zugang»', () => {
  it('shows «Kein Zugang» on a refused hub and retries at most every 30 s', async () => {
    const { hub, renderer, media } = await boot();
    renderer.reset();
    hub.refuse();
    expect(renderer.summary()).toEqual(['slate Kein Zugang', 'show null', 'preload ']);
    expect(media.session.stops).toBe(1);

    await flush(ACCESS_RETRY_MS - 1);
    expect(hub.restarts).toBe(0);
    await flush(1);
    expect(hub.restarts).toBe(1);
    hub.refuse();
    await flush(ACCESS_RETRY_MS - 1);
    expect(hub.restarts).toBe(1);
    await flush(1);
    expect(hub.restarts).toBe(2);
    expect(renderer.currentSlate()).toEqual(noAccessSlate());
  });

  it('recovers by itself when the link works again (IP rule fixed)', async () => {
    const { hub, renderer, media } = await boot();
    hub.refuse();
    await flush(ACCESS_RETRY_MS);
    renderer.reset();
    hub.connect();
    await flush();
    expect(renderer.summary()).toEqual([
      'show scn_a',
      "slate Gleich geht's los",
      'preload scn_b,scn_c',
    ]);
    expect(media.session.restarts).toBe(1);
  });

  it('shows «Kein Zugang» when the token endpoint refuses the link and retries LiveKit every 30 s', async () => {
    const { renderer, media, hub } = await boot();
    renderer.reset();
    media.session.setState('unauthorized');
    expect(renderer.currentSlate()).toEqual(noAccessSlate());
    await flush(ACCESS_RETRY_MS - 1);
    expect(media.session.restarts).toBe(0);
    await flush(1);
    expect(media.session.restarts).toBe(1);
    expect(hub.restarts).toBe(0);
    media.session.setState('connected');
    await flush();
    expect(renderer.currentSlate()?.title).toBe("Gleich geht's los");
  });

  it('rejoins after a LiveKit removal without «Kein Zugang», slower when it repeats', async () => {
    const { renderer, media } = await boot();
    renderer.reset();
    media.session.setState('removed');
    expect(renderer.currentSlate()).toBeNull();
    await flush(REMOVAL_RESTART_MS - 1);
    expect(media.session.restarts).toBe(0);
    await flush(1);
    expect(media.session.restarts).toBe(1);
    media.session.setState('removed');
    await flush(REMOVAL_RESTART_MS);
    expect(media.session.restarts).toBe(1);
    await flush(ACCESS_RETRY_MS - REMOVAL_RESTART_MS);
    expect(media.session.restarts).toBe(2);
    expect(renderer.summary()).toEqual([]);
  });

  it('shows «Kein Zugang» when the rejoin after a removal is refused', async () => {
    const { renderer, media } = await boot();
    media.session.setState('removed');
    await flush(REMOVAL_RESTART_MS);
    media.session.setState('unauthorized');
    expect(renderer.currentSlate()).toEqual(noAccessSlate());
  });

  it('suspends status reports while access is refused', async () => {
    const { hub, api } = await boot();
    hub.refuse();
    await flush(REPORT_INTERVAL_MS * 10);
    expect(reports(hub)).toEqual([]);
    expect(api.report).not.toHaveBeenCalled();
  });

  it('does not start LiveKit while the first connect is refused', async () => {
    const ctx = setup();
    ctx.hub.refuse();
    await flush(5000);
    expect(ctx.loadMedia).not.toHaveBeenCalled();
    expect(ctx.renderer.currentSlate()).toEqual(noAccessSlate());
    await flush(ACCESS_RETRY_MS);
    ctx.hub.connect();
    await flush(300);
    expect(ctx.loadMedia).toHaveBeenCalledTimes(1);
  });
});

describe('output app: status reports', () => {
  it('reports every 2 s over the hub', async () => {
    const { hub, media, renderer } = await boot();
    renderer.fps = 59.94;
    hub.sent.length = 0;
    await flush(REPORT_INTERVAL_MS);
    expect(reports(hub)).toEqual([
      { rendering: true, latencyMs: 62, fps: 59.9, programSceneId: null },
    ]);
    hub.emit(HUB.event, productionChanged(101, { broadcast: 'live' }));
    media.provider.latency = null;
    await flush(REPORT_INTERVAL_MS);
    expect(reports(hub).at(-1)).toEqual({
      rendering: true,
      latencyMs: null,
      fps: 59.9,
      programSceneId: 'scn_a',
    });
    await flush(REPORT_INTERVAL_MS * 3);
    expect(reports(hub)).toHaveLength(5);
  });

  it('reports rendering false while connecting', async () => {
    const ctx = setup();
    await flush(REPORT_INTERVAL_MS);
    expect(ctx.api.report).toHaveBeenCalledTimes(1);
    expect(ctx.api.report.mock.calls[0][0]).toMatchObject({
      rendering: false,
      fps: null,
      programSceneId: null,
    });
  });

  it('falls back to REST every 10 s while the hub is not connected', async () => {
    const { hub, api } = await boot();
    hub.drop();
    await flush(REST_REPORT_INTERVAL_MS * 3);
    expect(api.report).toHaveBeenCalledTimes(3);
    expect(api.report.mock.calls[0][0]).toMatchObject({ rendering: true });
  });
});

describe('output app: optional parts', () => {
  it('mounts the debug overlay with ?debug=1', async () => {
    const { media } = await boot({ debug: true });
    media.session.setState('connected');
    media.provider.stats.set(CAMERA, {
      width: 1280,
      height: 720,
      fps: 30,
      bitrateKbps: 1500,
      packetLossPct: 0,
      jitterBufferDelayMs: 40,
    });
    await flush(1000);
    const text = document.querySelector('.c-debug')?.textContent ?? '';
    expect(text).toContain('Webinar · Szene «Szene A»');
    expect(text).toContain('Revision 100');
    expect(text).toContain('Hub verbunden');
    expect(text).toContain('LiveKit verbunden');
    expect(text).toContain('K1 Handy Lea · 1280×720 · 30 fps · 1,5 Mbit/s');
  });

  it('shows no overlay without the flag', async () => {
    await boot();
    await flush(2000);
    expect(document.querySelector('.c-debug')).toBeNull();
  });

  it('exposes latency samples with ?latency=1', async () => {
    await boot({ latency: true });
    await flush(10);
    expect(window.__studioflowLatency).toEqual([]);
    delete window.__studioflowLatency;
  });

  it('reloads once after a reconnect to a new build, but not on air', async () => {
    const ctx = setup({}, (since) =>
      since === null ? snapshotChanges() : deltaChanges(Number(since), []),
    );
    ctx.hub.connect();
    await flush(300);
    const { hub, reload, fetchIndex } = ctx;
    hub.emit(HUB.event, productionChanged(101, { broadcast: 'live' }));
    hub.drop();
    hub.connect();
    await flush();
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    hub.emit(HUB.event, productionChanged(102, { broadcast: 'ended' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not check the build on the first connect', async () => {
    const { fetchIndex } = await boot();
    expect(fetchIndex).not.toHaveBeenCalled();
  });

  it('releases everything on dispose', async () => {
    const ctx = await boot();
    ctx.app.dispose();
    expect(ctx.renderer.destroyed).toBe(true);
    expect(ctx.hub.state).toBe('stopped');
    expect(ctx.media.session.stops).toBeGreaterThan(0);
    expect(ctx.media.provider.disposed).toBe(true);
    ctx.hub.sent.length = 0;
    await flush(REPORT_INTERVAL_MS * 5);
    expect(ctx.hub.sent).toEqual([]);
  });
});

describe('invalid link page', () => {
  it('shows «Kein Zugang» without any network access', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    let renderer: FakeRenderer | null = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const stop = startInvalidLinkPage(
      root,
      { background: 'transparent', debug: false, latency: false },
      {
        createRenderer: (container, options) => (renderer = new FakeRenderer(container, options)),
        waitForFonts: () => Promise.resolve(),
      },
    );
    await flush(60_000);
    expect((renderer as FakeRenderer | null)?.summary()).toEqual(['slate Kein Zugang']);
    expect(document.documentElement.classList.contains('is-transparent')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();
    fetchSpy.mockRestore();
    root.remove();
  });

  it('renders «Kein Zugang» with the real renderer', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const stop = startInvalidLinkPage(
      root,
      { background: 'black', debug: false, latency: false },
      {
        waitForFonts: () => Promise.resolve(),
      },
    );
    await flush(400);
    expect(root.textContent).toContain('Kein Zugang');
    expect(root.textContent).toContain('Der Output-Link ist ungültig oder abgelaufen.');
    stop();
    root.remove();
  });
});

describe('real renderer in transparent mode', () => {
  it('keeps the stage and the letterbox transparent', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const stop = startInvalidLinkPage(
      root,
      { background: 'transparent', debug: false, latency: false },
      {
        waitForFonts: () => Promise.resolve(),
      },
    );
    const viewport = root.firstElementChild as HTMLElement;
    const stage = viewport.firstElementChild as HTMLElement;
    expect(viewport.style.backgroundColor).toBe('transparent');
    expect(stage.style.backgroundColor).toBe('transparent');
    stop();
    root.remove();
  });
});
