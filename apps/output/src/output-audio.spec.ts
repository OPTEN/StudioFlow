import { AUDIO_RAMP_MS, audioTargets, type ChannelTarget } from '@studioflow/scene-model';
import type { ApplyOptions, AudioGraphState, GraphLevels } from '@studioflow/media-client/device';
import type { SyncCause } from '@studioflow/realtime-client';
import {
  BROADCAST_RAMP_MS,
  OutputAudio,
  rampFor,
  type AudioInputs,
  type OutputMix,
} from './output-audio';
import {
  CAMERA,
  CLIP,
  FADE,
  MIC,
  SCREEN,
  channel,
  deviceSource,
  item,
  micSource,
  programSwitched,
  scene,
  state as productionState,
} from './testing/fixtures';

/** A mix the test drives: records what the page asks of it. */
class FakeMix implements OutputMix {
  state: AudioGraphState;
  readonly applied: { targets: ReadonlyMap<string, ChannelTarget>; options: ApplyOptions }[] = [];
  readonly inputs = new Map<string, MediaStream | null>();
  readonly inputOptions: ({ readonly keepAlive?: boolean } | undefined)[] = [];
  program = -100;
  channelLevels = new Map<string, number>();
  disposed = false;
  /** The browser lets the context run after a gesture. */
  allowAfterResume = true;
  readonly resume = vi.fn(async (): Promise<AudioGraphState> => {
    if (this.allowAfterResume && this.state === 'blocked') {
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

  setInput(
    sourceId: string,
    stream: MediaStream | null,
    options?: { readonly keepAlive?: boolean },
  ): void {
    this.inputs.set(sourceId, stream);
    this.inputOptions.push(options);
  }

  apply(targets: ReadonlyMap<string, ChannelTarget>, options: ApplyOptions): void {
    this.applied.push({ targets, options });
  }

  levels(): GraphLevels {
    return { channels: this.channelLevels, program: this.program };
  }

  programLevel(): number {
    return this.program;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeInputs implements AudioInputs {
  readonly sounds = new Map<string, MediaStream>();
  readonly #listeners = new Set<(sourceId: string) => void>();

  audioStream(sourceId: string): MediaStream | null {
    return this.sounds.get(sourceId) ?? null;
  }

  audioSourceIds(): string[] {
    return [...this.sounds.keys()];
  }

  onAudioChange(listener: (sourceId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  give(sourceId: string, stream: MediaStream | null): void {
    if (stream === null) {
      this.sounds.delete(sourceId);
    } else {
      this.sounds.set(sourceId, stream);
    }
    for (const listener of [...this.#listeners]) {
      listener(sourceId);
    }
  }
}

function sound(): MediaStream {
  return { getAudioTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream;
}

/** A program with a microphone, a camera scene and a screen scene; the broadcast is live. */
function live(overrides: Parameters<typeof productionState>[1] = {}) {
  return productionState(
    {
      scenes: [
        scene('scn_a', 0, [item('itm_a1', CAMERA)]),
        scene('scn_b', 1, [item('itm_b1', SCREEN)]),
      ],
      sources: [
        deviceSource(CAMERA, 'K1', 'Camera'),
        deviceSource(SCREEN, 'S1', 'Screen'),
        micSource(MIC, 'A1', 'Mixing desk'),
      ],
      audioChannels: [channel(MIC, { mode: 'always' }), channel(SCREEN, { mode: 'follow' })],
    },
    { broadcast: 'live', ...overrides },
  );
}

function setup(mix = new FakeMix(), options: { sampleMs?: number } = {}) {
  const audio = new OutputAudio({ enabled: true, createMix: () => mix, ...options });
  return { audio, mix };
}

describe('OutputAudio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('switched off or without Web Audio', () => {
    it('is off with ?audio=off: no mix, no timers, nothing to report', () => {
      const audio = new OutputAudio({ enabled: false });
      expect(audio.state).toBe('off');
      audio.update(live());
      audio.bindInputs(new FakeInputs());
      audio.assetVideo(CLIP, document.createElement('video'), true);
      audio.tryResume();
      expect(audio.report()).toEqual({ state: 'off', levelDb: null });
      expect(audio.debug()).toEqual({ programDb: null, channels: [] });
      expect(vi.getTimerCount()).toBe(0);
      audio.dispose();
    });

    it('is unavailable where the browser has no Web Audio', () => {
      const audio = new OutputAudio({ enabled: true });
      expect(audio.state).toBe('unavailable');
      expect(audio.report()).toEqual({ state: 'unavailable', levelDb: null });
      audio.update(live());
      audio.dispose();
    });
  });

  describe('following the production', () => {
    it('gives the mix the targets of the state', () => {
      const { audio, mix } = setup();
      const state = live();
      audio.update(state);

      expect(mix.applied).toHaveLength(1);
      expect(mix.applied[0].targets).toEqual(audioTargets(state));
      expect(mix.applied[0].targets.get(MIC)?.gain).toBe(1);
      expect(mix.applied[0].targets.get(SCREEN)?.gain).toBe(0);
      expect(mix.applied[0].options).toEqual({ rampMs: AUDIO_RAMP_MS });
    });

    it('is silent while the broadcast is not live', () => {
      const { audio, mix } = setup();
      audio.update(live({ broadcast: 'standby' }));
      expect([...mix.applied[0].targets.values()].every((target) => target.gain === 0)).toBe(true);
    });

    it('expects sound only when a channel could be heard', () => {
      const { audio } = setup();
      audio.update(productionState({ audioChannels: [] }));
      expect(audio.expected).toBe(false);
      audio.update(live());
      expect(audio.expected).toBe(true);
      audio.update(
        productionState({
          sources: [micSource(MIC, 'A1', 'Mixing desk')],
          audioChannels: [channel(MIC, { muted: true })],
        }),
      );
      expect(audio.expected).toBe(false);
    });

    it('fades with the duration of the transition, a cut with 20 ms, the broadcast with 300 ms', () => {
      const { audio, mix } = setup();
      audio.update(live({ programSceneId: 'scn_a' }));
      const switched = (transition: typeof FADE): SyncCause => ({
        kind: 'event',
        event: programSwitched(101, 'scn_b', transition),
      });

      audio.update(live({ programSceneId: 'scn_b' }), switched(FADE));
      audio.update(live({ programSceneId: 'scn_a' }), switched({ kind: 'cut', durationMs: 0 }));
      audio.update(live({ programSceneId: 'scn_b', broadcast: 'ended' }), switched(FADE));
      audio.update(live({ programSceneId: 'scn_b', broadcast: 'ended' }), { kind: 'snapshot' });

      expect(mix.applied.map((call) => call.options.rampMs)).toEqual([
        AUDIO_RAMP_MS,
        500,
        AUDIO_RAMP_MS,
        BROADCAST_RAMP_MS,
        AUDIO_RAMP_MS,
      ]);
    });

    it('caps absurd fades and treats very short ones as cuts', () => {
      const state = live();
      const fade = (durationMs: number): SyncCause => ({
        kind: 'event',
        event: programSwitched(101, 'scn_b', { kind: 'fade', durationMs }),
      });
      expect(rampFor('live', state, fade(600_000)).rampMs).toBe(10_000);
      expect(rampFor('live', state, fade(10)).rampMs).toBe(AUDIO_RAMP_MS);
      expect(rampFor(null, state, null).rampMs).toBe(AUDIO_RAMP_MS);
      expect(rampFor('standby', state, fade(2000)).rampMs).toBe(BROADCAST_RAMP_MS);
    });

    it('goes silent while the page may not be heard and comes back with the last state', () => {
      const { audio, mix } = setup();
      audio.update(live());
      audio.setAllowed(false);
      expect(mix.applied.at(-1)?.targets.size).toBe(0);
      audio.setAllowed(false);
      expect(mix.applied).toHaveLength(2);

      audio.setAllowed(true);
      expect(mix.applied.at(-1)?.targets.get(MIC)?.gain).toBe(1);
      audio.update(live());
      audio.setAllowed(false);
      audio.update(live());
      expect(mix.applied.at(-1)?.targets.size).toBe(0);
    });
  });

  describe('sounds', () => {
    it('takes the sounds of the media side and follows their changes', () => {
      const { audio, mix } = setup();
      const inputs = new FakeInputs();
      const early = sound();
      inputs.give(MIC, early);
      audio.bindInputs(inputs);
      expect(mix.inputs.get(MIC)).toBe(early);

      const late = sound();
      inputs.give(SCREEN, late);
      inputs.give(MIC, null);
      expect(mix.inputs.get(SCREEN)).toBe(late);
      expect(mix.inputs.get(MIC)).toBeNull();
    });

    it('does not follow an older media side after it was replaced and lets go on dispose', () => {
      const { audio } = setup();
      const first = new FakeInputs();
      const second = new FakeInputs();
      audio.bindInputs(first);
      audio.bindInputs(second);
      expect(first.listenerCount).toBe(0);
      expect(second.listenerCount).toBe(1);
      audio.dispose();
      expect(second.listenerCount).toBe(0);
    });

    it('takes the sound of a video asset from its element, without a keep-alive', () => {
      const mix = new FakeMix();
      const stream = sound();
      const audio = new OutputAudio({
        enabled: true,
        createMix: () => mix,
        captureVideo: () => stream,
      });
      const element = document.createElement('video');
      Object.defineProperty(element, 'readyState', { value: 4 });

      audio.assetVideo(CLIP, element, true);
      expect(mix.inputs.get(CLIP)).toBe(stream);
      expect(mix.inputOptions.at(-1)).toEqual({ keepAlive: false });

      audio.assetVideo(CLIP, element, false);
      expect(mix.inputs.get(CLIP)).toBeNull();
    });
  });

  describe('autoplay', () => {
    it('is blocked until a gesture starts the context, then tells the listeners', async () => {
      const { audio, mix } = setup(new FakeMix('blocked'));
      const states: string[] = [];
      audio.onStateChange((state) => states.push(state));
      audio.update(live());

      expect(audio.state).toBe('blocked');
      expect(audio.needsGesture).toBe(true);

      await expect(audio.resume()).resolves.toBe('running');
      expect(mix.resume).toHaveBeenCalledTimes(1);
      expect(audio.needsGesture).toBe(false);
      expect(states).toEqual(['running']);

      mix.setState('blocked');
      expect(states).toEqual(['running', 'blocked']);
    });

    it('needs no button when no sound is expected', () => {
      const { audio } = setup(new FakeMix('blocked'));
      audio.update(productionState({ audioChannels: [] }));
      expect(audio.state).toBe('blocked');
      expect(audio.needsGesture).toBe(false);
    });

    it('stays blocked when the browser refuses, and tries again by itself on the report tick', async () => {
      const mix = new FakeMix('blocked');
      mix.allowAfterResume = false;
      const { audio } = setup(mix);
      await expect(audio.resume()).resolves.toBe('blocked');

      mix.allowAfterResume = true;
      audio.tryResume();
      await vi.advanceTimersByTimeAsync(0);
      expect(audio.state).toBe('running');

      audio.tryResume();
      expect(mix.resume).toHaveBeenCalledTimes(2);
    });

    it('reports unavailable when the context is gone', () => {
      const { audio, mix } = setup();
      mix.setState('closed');
      expect(audio.state).toBe('unavailable');
    });
  });

  describe('report and debug', () => {
    it('reports the peak of the program since the last report', async () => {
      const { audio, mix } = setup();
      mix.program = -30;
      await vi.advanceTimersByTimeAsync(100);
      mix.program = -12.34;
      await vi.advanceTimersByTimeAsync(100);
      mix.program = -40;
      await vi.advanceTimersByTimeAsync(100);

      expect(audio.report()).toEqual({ state: 'running', levelDb: -12.3 });
      await vi.advanceTimersByTimeAsync(100);
      expect(audio.report()).toEqual({ state: 'running', levelDb: -40 });
    });

    it('reports no level for silence or while the context does not run', async () => {
      const { audio, mix } = setup();
      mix.program = -95;
      await vi.advanceTimersByTimeAsync(300);
      expect(audio.report()).toEqual({ state: 'running', levelDb: null });

      mix.program = -10;
      mix.setState('blocked');
      await vi.advanceTimersByTimeAsync(300);
      expect(audio.report()).toEqual({ state: 'blocked', levelDb: null });
    });

    it('shows the channels of the mix with their levels for ?debug=1', () => {
      const { audio, mix } = setup();
      const inputs = new FakeInputs();
      inputs.give(MIC, sound());
      audio.bindInputs(inputs);
      audio.update(live());
      mix.program = -18.4;
      mix.channelLevels = new Map([
        [MIC, -20.2],
        [SCREEN, -100],
      ]);

      expect(audio.debug()).toEqual({
        programDb: -18,
        channels: [
          { sourceId: MIC, audible: true, hasSound: true, levelDb: -20 },
          { sourceId: SCREEN, audible: false, hasSound: false, levelDb: null },
        ],
      });
    });
  });

  describe('dispose', () => {
    it('releases the mix and the timers', () => {
      const { audio, mix } = setup();
      audio.bindInputs(new FakeInputs());
      audio.dispose();
      audio.dispose();
      expect(mix.disposed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      audio.update(live());
      expect(mix.applied).toHaveLength(0);
    });
  });
});
