import {
  AUDIO_RAMP_MS,
  HUB,
  type OutputReport,
  type ProductionEvent,
} from '@studioflow/scene-model';
import type { SceneRendererOptions } from '@studioflow/scene-renderer';
import type { ChannelTarget } from '@studioflow/scene-model';
import type { ApplyOptions, AudioGraphState, GraphLevels } from '@studioflow/media-client/device';
import type { OutputConfig, OutputFlags } from './config';
import { startOutputApp, type OutputApp } from './output-app';
import type { OutputMix } from './output-audio';
import { REPORT_INTERVAL_MS } from './status-reporter';
import { FakeHub, FakeRenderer, fakeApi, fakeMedia } from './testing/fakes';
import {
  CAMERA,
  CLIP,
  FADE,
  KEY,
  MIC,
  SCREEN,
  asset,
  audioChannelsChanged,
  channel,
  deviceSource,
  item,
  micSource,
  productionChanged,
  programSwitched,
  scene,
  snapshot,
  snapshotChanges,
} from './testing/fixtures';

/** The audio of the output page, end to end with a fake mix: what the page asks of it and what it reports. */

class FakeMix implements OutputMix {
  state: AudioGraphState;
  readonly applied: { targets: ReadonlyMap<string, ChannelTarget>; options: ApplyOptions }[] = [];
  readonly inputs = new Map<string, MediaStream | null>();
  program = -100;
  disposed = false;
  /** The browser lets the context run only after a user gesture (a test sets it before it clicks). */
  gesture = false;
  readonly resume = vi.fn(async (): Promise<AudioGraphState> => {
    if (this.gesture && this.state === 'blocked') {
      this.setState('running');
    }
    return this.state;
  });
  readonly #listeners = new Set<(state: AudioGraphState) => void>();

  constructor(state: AudioGraphState = 'running') {
    this.state = state;
  }

  onStateChange(listener: (state: AudioGraphState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setState(state: AudioGraphState): void {
    this.state = state;
    for (const listener of [...this.#listeners]) {
      listener(state);
    }
  }

  setInput(sourceId: string, stream: MediaStream | null): void {
    this.inputs.set(sourceId, stream);
  }

  apply(targets: ReadonlyMap<string, ChannelTarget>, options: ApplyOptions): void {
    this.applied.push({ targets, options });
  }

  levels(): GraphLevels {
    return { channels: new Map(), program: this.program };
  }

  programLevel(): number {
    return this.program;
  }

  dispose(): void {
    this.disposed = true;
  }

  get last(): { targets: ReadonlyMap<string, ChannelTarget>; options: ApplyOptions } {
    return this.applied[this.applied.length - 1];
  }
}

interface Harness {
  readonly app: OutputApp;
  readonly hub: FakeHub;
  readonly media: ReturnType<typeof fakeMedia>;
  readonly mix: FakeMix;
  readonly root: HTMLElement;
  readonly createAudioMix: ReturnType<typeof vi.fn>;
  readonly sent: () => OutputReport[];
}

let current: Harness | null = null;

/** Scene A shows the camera, scene B the screen; the microphone is always on, the screen sound follows its picture. */
function liveSnapshot() {
  return snapshot(
    {
      scenes: [
        scene('scn_a', 0, [item('itm_a1', CAMERA)]),
        scene('scn_b', 1, [item('itm_b1', SCREEN), item('itm_b2', CLIP)]),
      ],
      sources: [
        deviceSource(CAMERA, 'K1', 'Handy Lea'),
        deviceSource(SCREEN, 'S1', 'Laptop Tom'),
        micSource(MIC, 'A1', 'Mixing desk'),
      ],
      audioChannels: [
        channel(MIC, { mode: 'always' }),
        channel(SCREEN, { mode: 'follow' }),
        channel(CLIP, { mode: 'follow' }),
      ],
      assets: [asset(CLIP, { kind: 'video', hasAudio: true })],
    },
    { broadcast: 'live' },
  );
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function boot(
  flags: Partial<OutputFlags> = {},
  options: {
    mix?: FakeMix;
    captureVideo?: (video: HTMLVideoElement) => MediaStream | null;
    /** How long the test lets the page run before it looks at it (default 300 ms: the first frame and the lazy work). */
    settleMs?: number;
  } = {},
): Promise<Harness> {
  const root = document.createElement('main');
  document.body.append(root);
  const hub = new FakeHub();
  hub.onInvoke = () => Promise.resolve(snapshotChanges(liveSnapshot()));
  const mix = options.mix ?? new FakeMix();
  const createAudioMix = vi.fn(() => mix);
  const media = fakeMedia();
  const config: OutputConfig = {
    kind: 'output',
    slug: 'webinar',
    key: KEY,
    keyFromUrl: true,
    flags: { background: 'black', audio: true, debug: false, latency: false, ...flags },
  };
  const app = startOutputApp(config, root, {
    createRenderer: (container: HTMLElement, rendererOptions: SceneRendererOptions) =>
      new FakeRenderer(container, rendererOptions),
    createHub: () => hub,
    loadMedia: () => Promise.resolve(media),
    api: fakeApi(),
    log: { warn: () => undefined },
    waitForFonts: () => Promise.resolve(),
    currentEntry: '/o/assets/index-OLD00000.js',
    fetchIndex: () => Promise.resolve(''),
    reload: () => undefined,
    storage: null,
    createAudioMix,
    ...(options.captureVideo ? { captureVideo: options.captureVideo } : {}),
  });
  hub.connect();
  await flush(options.settleMs ?? 300);
  current = {
    app,
    hub,
    media,
    mix,
    root,
    createAudioMix,
    sent: () =>
      hub.sent
        .filter((sent) => sent.method === HUB.report)
        .map((sent) => sent.args[0] as OutputReport),
  };
  return current;
}

function sound(): MediaStream {
  return { getAudioTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  current?.app.dispose();
  current?.root.remove();
  current = null;
  document.querySelectorAll('.c-sound-on').forEach((element) => element.remove());
  vi.useRealTimers();
});

describe('output app: audio', () => {
  it('starts the mix after the first frame, not before it: the first audio context costs about 100 ms', async () => {
    const { app, createAudioMix, sent } = await boot({}, { settleMs: 0 });
    expect(createAudioMix).not.toHaveBeenCalled();
    expect(app.audio.state).toBe('off');
    await flush(300);
    expect(createAudioMix).toHaveBeenCalledTimes(1);
    expect(app.audio.state).toBe('running');
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio).toEqual({ state: 'running', levelDb: null });
  });

  it('moves the mix to the audible channels of the first snapshot', async () => {
    const { mix, createAudioMix } = await boot();
    expect(createAudioMix).toHaveBeenCalledTimes(1);
    expect(mix.applied.length).toBeGreaterThan(0);
    expect(mix.last.targets.get(MIC)?.gain).toBe(1);
    expect(mix.last.targets.get(SCREEN)?.gain).toBe(0);
    expect(mix.last.options).toEqual({ rampMs: AUDIO_RAMP_MS });
  });

  it('makes no sound and creates no mix with ?audio=off', async () => {
    const { createAudioMix, app, sent } = await boot({ audio: false });
    expect(createAudioMix).not.toHaveBeenCalled();
    expect(app.audio.state).toBe('off');
    expect(document.querySelector('.c-sound-on')).toBeNull();
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio).toEqual({ state: 'off', levelDb: null });
  });

  it('crossfades with the duration of the fade when the program switches', async () => {
    const { hub, mix } = await boot();
    hub.emit(HUB.event, programSwitched(101, 'scn_b', FADE));
    await flush();
    expect(mix.last.options).toEqual({ rampMs: 500 });
    expect(mix.last.targets.get(SCREEN)?.gain).toBe(1);
    expect(mix.last.targets.get(CLIP)?.gain).toBe(1);
    expect(mix.last.targets.get(MIC)?.gain).toBe(1);

    hub.emit(HUB.event, programSwitched(102, 'scn_a', { kind: 'cut', durationMs: 0 }, 'scn_b'));
    await flush();
    expect(mix.last.options).toEqual({ rampMs: AUDIO_RAMP_MS });
    expect(mix.last.targets.get(SCREEN)?.gain).toBe(0);
  });

  it('follows a mute from the Regie within one render, and the end of the broadcast gently', async () => {
    const { hub, mix } = await boot();
    hub.emit(HUB.event, audioChannelsChanged(101, [channel(MIC, { mode: 'always', muted: true })]));
    await flush();
    expect(mix.last.targets.get(MIC)?.gain).toBe(0);
    expect(mix.last.options.rampMs).toBe(AUDIO_RAMP_MS);

    hub.emit(HUB.event, productionChanged(102, { broadcast: 'ended' }));
    await flush();
    expect([...mix.last.targets.values()].every((target) => target.gain === 0)).toBe(true);
    expect(mix.last.options.rampMs).toBe(300);
  });

  it('takes the sounds of LiveKit into the mix once the media side is loaded', async () => {
    const { media, mix } = await boot();
    const stream = sound();
    media.provider.giveSound(MIC, stream);
    expect(mix.inputs.get(MIC)).toBe(stream);
    media.provider.giveSound(MIC, null);
    expect(mix.inputs.get(MIC)).toBeNull();
  });

  it('takes the sound of a video asset from the element the stage plays it in', async () => {
    const captured = sound();
    const { app, mix } = await boot({}, { captureVideo: () => captured });
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4 });
    app.provider.attachAsset(CLIP, video);
    expect(mix.inputs.get(CLIP)).toBe(captured);
    app.provider.detachAsset(CLIP, video);
    expect(mix.inputs.get(CLIP)).toBeNull();
  });

  it('reports the state and the peak of the program mix every 2 s', async () => {
    const { mix, sent } = await boot();
    mix.program = -14.2;
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio).toEqual({ state: 'running', levelDb: -14.2 });

    // The peak of the report that just went out is gone: a quiet interval after it reads as silence.
    mix.program = -100;
    await flush(REPORT_INTERVAL_MS);
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio).toEqual({ state: 'running', levelDb: null });
  });

  it('goes silent while “No access” is shown and comes back with the access', async () => {
    const { hub, mix } = await boot();
    hub.refuse();
    await flush();
    expect(mix.last.targets.size).toBe(0);

    hub.connect();
    await flush(10);
    expect(mix.last.targets.get(MIC)?.gain).toBe(1);
  });

  it('shows “Sound on” while the browser blocks the sound, and a click starts it', async () => {
    const mix = new FakeMix('blocked');
    const { sent } = await boot({}, { mix });
    const button = document.querySelector<HTMLButtonElement>('.c-sound-on');
    expect(button?.hidden).toBe(false);
    expect(button?.textContent).toBe('Sound on');
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio?.state).toBe('blocked');

    mix.gesture = true;
    button?.click();
    await flush();
    expect(mix.resume).toHaveBeenCalled();
    expect(button?.hidden).toBe(true);
    await flush(REPORT_INTERVAL_MS);
    expect(sent().at(-1)?.audio?.state).toBe('running');
  });

  it('starts the sound with any click on the page, and shows no button when nothing is expected', async () => {
    const mix = new FakeMix('blocked');
    await boot({}, { mix });
    mix.gesture = true;
    document.body.click();
    await flush();
    expect(mix.state).toBe('running');
    expect(document.querySelector<HTMLButtonElement>('.c-sound-on')?.hidden).toBe(true);
    current?.app.dispose();

    const quiet = new FakeMix('blocked');
    const { hub } = await boot({}, { mix: quiet });
    expect(document.querySelector<HTMLButtonElement>('.c-sound-on')?.hidden).toBe(false);
    hub.emit(
      HUB.event,
      audioChannelsChanged(
        101,
        [MIC, SCREEN, CLIP].map((sourceId) => channel(sourceId, { muted: true })),
      ),
    );
    await flush();
    expect(document.querySelector<HTMLButtonElement>('.c-sound-on')?.hidden).toBe(true);
  });

  it('shows the mix in the debug panel data', async () => {
    const { app, media, mix } = await boot();
    media.provider.giveSound(MIC, sound());
    media.provider.audioStats.set(MIC, { codec: 'opus', packetLossPct: 0 });
    mix.program = -20;
    await flush(200);
    const info = await app.debugInfo();
    expect(info.audio).toMatchObject({ state: 'running' });
  });

  it('releases the mix on dispose', async () => {
    const { app, mix } = await boot();
    app.dispose();
    expect(mix.disposed).toBe(true);
    expect(document.querySelector('.c-sound-on')).toBeNull();
  });
});
