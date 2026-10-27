import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ApplyOptions,
  AudioGraphState,
  GraphLevels,
  MonitorSelection,
} from '@studioflow/media-client/device';
import { type ChannelTarget } from '@studioflow/scene-model';
import { FakeStudioHub } from '../../../testing/fake-studio-hub';
import {
  audioChannelFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { StudioMediaService, type StudioSourceProvider } from '../media/studio-media.service';
import {
  METER_INTERVAL_MS,
  STUDIO_MIX_FACTORY,
  StudioAudioService,
  type StudioMix,
} from './studio-audio.service';

const DESK = 'dev_cccccccccccccccc/mic';
const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const CAMERA = 'dev_aaaaaaaaaaaaaaaa/camera';

class FakeMix implements StudioMix {
  state: AudioGraphState;
  readonly applied: { targets: ReadonlyMap<string, ChannelTarget>; options: ApplyOptions }[] = [];
  readonly inputs = new Map<string, MediaStream | null>();
  readonly inputOptions: ({ readonly keepAlive?: boolean } | undefined)[] = [];
  channelLevels = new Map<string, number>();
  program = -100;
  monitors: MonitorSelection[] = [];
  sinkIds: string[] = [];
  canChooseOutputDevice = true;
  sinkResult = true;
  disposed = false;
  readonly resume = vi.fn(async (): Promise<AudioGraphState> => {
    if (this.allowSound && this.state === 'blocked') {
      this.setState('running');
    }
    return this.state;
  });
  allowSound = false;
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

  setInput(
    sourceId: string,
    stream: MediaStream | null,
    options?: { readonly keepAlive?: boolean },
  ): void {
    this.inputs.set(sourceId, stream);
    this.inputOptions.push(options);
  }

  hasInput(sourceId: string): boolean {
    return (this.inputs.get(sourceId) ?? null) !== null;
  }

  apply(targets: ReadonlyMap<string, ChannelTarget>, options: ApplyOptions): void {
    this.applied.push({ targets, options });
  }

  levels(): GraphLevels {
    const channels = new Map<string, number>();
    for (const sourceId of this.inputs.keys()) {
      channels.set(sourceId, this.channelLevels.get(sourceId) ?? -100);
    }
    return { channels, program: this.program };
  }

  setMonitor(selection: MonitorSelection): void {
    this.monitors.push(selection);
  }

  setSinkId(deviceId: string): Promise<boolean> {
    this.sinkIds.push(deviceId);
    return Promise.resolve(this.sinkResult);
  }

  dispose(): void {
    this.disposed = true;
  }

  get last(): { targets: ReadonlyMap<string, ChannelTarget>; options: ApplyOptions } {
    return this.applied[this.applied.length - 1];
  }
}

class FakeProvider {
  readonly sounds = new Map<string, MediaStream>();
  readonly listeners = new Set<(sourceId: string) => void>();
  audioStream(sourceId: string): MediaStream | null {
    return this.sounds.get(sourceId) ?? null;
  }
  audioSourceIds(): string[] {
    return [...this.sounds.keys()];
  }
  onAudioChange(listener: (sourceId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  give(sourceId: string, stream: MediaStream | null): void {
    if (stream === null) {
      this.sounds.delete(sourceId);
    } else {
      this.sounds.set(sourceId, stream);
    }
    for (const listener of [...this.listeners]) {
      listener(sourceId);
    }
  }
}

function sound(): MediaStream {
  return {
    getAudioTracks: () => [{ stop: () => undefined }],
    getVideoTracks: () => [],
    removeTrack: () => undefined,
  } as unknown as MediaStream;
}

/** A live production: the desk feed is always on, the screen sound follows the picture of scene B. */
function liveSnapshot() {
  return snapshotFixture({
    production: productionFixture({ broadcast: 'live', programSceneId: 'scn_a' }),
    scenes: [
      sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', CAMERA)]),
      sceneFixture('scn_b', 'Slides', 1, [itemFixture('itm_b1', SCREEN)]),
    ],
    sources: [
      sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1'),
      sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1'),
      sourceFixture('dev_cccccccccccccccc', 'mic', 'A1', { label: 'Mixing desk' }),
    ],
    audioChannels: [
      audioChannelFixture(DESK, { mode: 'always' }),
      audioChannelFixture(SCREEN, { mode: 'follow' }),
    ],
  });
}

describe('StudioAudioService', () => {
  let hub: FakeStudioHub;
  let mix: FakeMix;
  let created: number;
  let provider: FakeProvider;
  let harness: StoreHarness;

  async function start(
    snapshot = liveSnapshot(),
    state: AudioGraphState = 'running',
  ): Promise<StudioAudioService> {
    hub = new FakeStudioHub();
    mix = new FakeMix(state);
    created = 0;
    provider = new FakeProvider();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        {
          provide: STUDIO_MIX_FACTORY,
          useValue: () => {
            created += 1;
            return mix;
          },
        },
        {
          provide: StudioMediaService,
          useValue: { provider: signal(provider as unknown as StudioSourceProvider) },
        },
      ],
    });
    const service = TestBed.inject(StudioAudioService);
    harness = await startStore(hub, snapshot);
    await harness.settle();
    return service;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('the mix', () => {
    it('is not created for a production without audio channels', async () => {
      const service = await start(snapshotFixture());
      expect(created).toBe(0);
      expect(service.state()).toBe('idle');
      expect(service.canChooseOutputDevice).toBe(false);
    });

    it('is created with the first channel and moves to the targets of the state', async () => {
      const service = await start();
      expect(created).toBe(1);
      expect(service.state()).toBe('running');
      expect(mix.applied.length).toBeGreaterThan(0);
      expect(mix.last.targets.get(DESK)?.gain).toBe(1);
      expect(mix.last.targets.get(SCREEN)?.gain).toBe(0);
      expect(mix.last.options.rampMs).toBe(20);
    });

    it('follows a mute with a short ramp and a fade of the program with the length of the fade', async () => {
      await start();
      harness.emitEvent({
        type: 'audioChannelsChanged',
        channels: [audioChannelFixture(DESK, { mode: 'always', muted: true })],
      });
      await harness.settle();
      expect(mix.last.targets.get(DESK)?.gain).toBe(0);
      expect(mix.last.options.rampMs).toBe(20);

      harness.emitEvent({
        type: 'programSwitched',
        programSceneId: 'scn_b',
        previewSceneId: null,
        previousProgramSceneId: 'scn_a',
        transition: { kind: 'fade', durationMs: 800 },
        at: new Date().toISOString(),
      });
      await harness.settle();
      expect(mix.last.targets.get(SCREEN)?.gain).toBe(1);
      expect(mix.last.options.rampMs).toBe(800);
    });

    it('takes the end of the broadcast gently', async () => {
      await start();
      harness.emitEvent({
        type: 'productionChanged',
        production: productionFixture({ broadcast: 'ended', programSceneId: 'scn_a' }),
      });
      await harness.settle();
      expect(mix.last.options.rampMs).toBe(300);
      expect([...mix.last.targets.values()].every((target) => target.gain === 0)).toBe(true);
    });

    it('takes the sounds of the LiveKit provider into the mix and follows them', async () => {
      const early = sound();
      await start();
      provider.give(DESK, early);
      expect(mix.inputs.get(DESK)).toBe(early);
      const late = sound();
      provider.give(SCREEN, late);
      expect(mix.inputs.get(SCREEN)).toBe(late);
      provider.give(DESK, null);
      expect(mix.inputs.get(DESK)).toBeNull();
    });
  });

  describe('autoplay', () => {
    it('waits for a click or key press while the browser blocks the context, then lets go', async () => {
      const service = await start(liveSnapshot(), 'blocked');
      expect(service.state()).toBe('blocked');

      mix.allowSound = true;
      document.dispatchEvent(new Event('pointerdown'));
      await vi.advanceTimersByTimeAsync(0);
      expect(mix.resume).toHaveBeenCalledTimes(1);
      expect(service.state()).toBe('running');

      document.dispatchEvent(new Event('keydown'));
      expect(mix.resume).toHaveBeenCalledTimes(1);
    });
  });

  describe('meters', () => {
    it('shows the level of the channels that have a sound, falling back by about 30 dB per second', async () => {
      const service = await start();
      provider.give(DESK, sound());
      mix.channelLevels.set(DESK, -12.3);
      mix.program = -18.2;
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS);

      expect(service.levels().get(DESK)).toBe(-12.5);
      expect(service.programLevel()).toBe(-18);
      expect(service.sounding().has(DESK)).toBe(true);
      expect(service.levels().has(SCREEN)).toBe(false);

      mix.channelLevels.set(DESK, -100);
      mix.program = -100;
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 4);
      expect(service.levels().get(DESK)).toBe(-18.5);
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 80);
      expect(service.levels().get(DESK)).toBe(-100);
      expect(service.programLevel()).toBe(-100);
    });

    it('does not publish a new map while nothing changes', async () => {
      const service = await start();
      provider.give(DESK, sound());
      mix.channelLevels.set(DESK, -20);
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS);
      const levels = service.levels();
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 3);
      expect(service.levels()).toBe(levels);
    });

    it('measures nothing while the context does not run', async () => {
      const service = await start(liveSnapshot(), 'blocked');
      provider.give(DESK, sound());
      mix.channelLevels.set(DESK, -10);
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 3);
      expect(service.levels().size).toBe(0);
      expect(service.programLevel()).toBe(-100);
    });
  });

  describe('silence', () => {
    it('warns about an audible channel that is silent for 10 seconds', async () => {
      const service = await start();
      provider.give(DESK, sound());
      mix.channelLevels.set(DESK, -80);
      await vi.advanceTimersByTimeAsync(9000);
      expect(service.silent().size).toBe(0);
      await vi.advanceTimersByTimeAsync(1500);
      expect([...service.silent()]).toEqual([DESK]);

      mix.channelLevels.set(DESK, -20);
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 2);
      expect(service.silent().size).toBe(0);
    });

    it('does not warn about channels that are not audible, without a sound, or while not live', async () => {
      const service = await start();
      provider.give(SCREEN, sound());
      mix.channelLevels.set(SCREEN, -80);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(service.silent().size).toBe(0);

      provider.give(DESK, sound());
      mix.channelLevels.set(DESK, -80);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(service.silent().size).toBe(1);

      harness.emitEvent({
        type: 'productionChanged',
        production: productionFixture({ broadcast: 'standby', programSceneId: 'scn_a' }),
      });
      await harness.settle();
      await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 2);
      expect(service.silent().size).toBe(0);
    });
  });

  describe('monitoring', () => {
    it('is off at the start and listens to one channel before its fader (PFL), then stops', async () => {
      const service = await start();
      expect(service.monitor()).toEqual({ kind: 'off' });

      service.togglePfl(DESK);
      expect(service.monitor()).toEqual({ kind: 'channel', sourceId: DESK });
      expect(mix.monitors.at(-1)).toEqual({ kind: 'channel', sourceId: DESK });
      expect(mix.resume).toHaveBeenCalled();

      service.togglePfl(SCREEN);
      expect(service.monitor()).toEqual({ kind: 'channel', sourceId: SCREEN });
      service.togglePfl(SCREEN);
      expect(service.monitor()).toEqual({ kind: 'off' });
    });

    it('listens to the program and sends the sound to headphones', async () => {
      const service = await start();
      service.setMonitor({ kind: 'program' });
      expect(mix.monitors.at(-1)).toEqual({ kind: 'program' });
      await expect(service.setOutputDevice('headphones')).resolves.toBe(true);
      expect(mix.sinkIds).toEqual(['headphones']);
      mix.sinkResult = false;
      await expect(service.setOutputDevice('gone')).resolves.toBe(false);
      expect(service.canChooseOutputDevice).toBe(true);
    });

    it('does nothing without a mix', async () => {
      const service = await start(snapshotFixture());
      service.setMonitor({ kind: 'program' });
      service.togglePfl(DESK);
      expect(service.monitor()).toEqual({ kind: 'off' });
      await expect(service.setOutputDevice('x')).resolves.toBe(false);
    });
  });

  describe('videos on the Program monitor', () => {
    it('takes the sound of a video from the element that plays it', async () => {
      const service = await start();
      const captured = sound();
      const video = document.createElement('video');
      Object.defineProperty(video, 'readyState', { value: 4 });
      Object.defineProperty(video, 'captureStream', { value: () => captured });
      service.assetVideo('ast_aaaaaaaaaaaaaaaa', video, true);
      expect(mix.inputs.get('ast_aaaaaaaaaaaaaaaa')).toBe(captured);
      expect(mix.inputOptions.at(-1)).toEqual({ keepAlive: false });
      service.assetVideo('ast_aaaaaaaaaaaaaaaa', video, false);
      expect(mix.inputs.get('ast_aaaaaaaaaaaaaaaa')).toBeNull();
    });
  });

  describe('release', () => {
    it('stops the meters and closes the mix when the service goes away', async () => {
      await start();
      TestBed.resetTestingModule();
      expect(mix.disposed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
