/**
 * The sound of the output page (spec 9.3 and 9.1, issue #7): the Web Audio mix of the program. It follows the production
 * state – which channels are audible in the program, with which gain and delay – and plays the sounds the media side
 * delivers: microphones and screens from LiveKit, video assets from the stage's own `<video>` elements. The page only
 * reports what it hears (state, program level); everything else is decided in the Regie and by the rules of scene-model.
 *
 * The AudioContext is created at start. A browser that allows no sound without a gesture keeps it suspended: the state
 * is then `blocked`, the Regie shows “Audio blocked” and a small “Sound on” button (and any click, key or touch on the
 * page) starts it. In OBS with “Control audio via OBS” and in an embedding frame with `allow="autoplay"` it runs at once.
 */
import {
  AUDIO_RAMP_MS,
  audioExpected,
  audioTargets,
  type OutputAudioDto,
  type ProductionState,
  type TransitionDto,
} from '@studioflow/scene-model';
import {
  AssetAudioTap,
  AudioGraph,
  SILENCE_DB,
  type ApplyOptions,
  type AudioGraphState,
  type GraphLevels,
} from '@studioflow/media-client/device';
import type { SyncCause } from '@studioflow/realtime-client';

/** The part of {@link AudioGraph} the page uses; a test double stands in for it. */
export type OutputMix = Pick<
  AudioGraph,
  | 'state'
  | 'onStateChange'
  | 'resume'
  | 'setInput'
  | 'apply'
  | 'levels'
  | 'programLevel'
  | 'dispose'
>;

/** What the page needs of the media side for the sound (the LiveKit provider). */
export interface AudioInputs {
  audioStream(sourceId: string): MediaStream | null;
  audioSourceIds(): string[];
  onAudioChange(listener: (sourceId: string) => void): () => void;
}

/** Options of {@link OutputAudio}. */
export interface OutputAudioOptions {
  /** False for `?audio=off`: no audio context, state `off`. */
  readonly enabled: boolean;
  /** Creates the mix (default: an {@link AudioGraph} that plays its master). */
  readonly createMix?: () => OutputMix;
  /** Captures the sound of a video element (default `captureStream()`). */
  readonly captureVideo?: (video: HTMLVideoElement) => MediaStream | null;
  /** How often the program level is measured for the report (default 100 ms). */
  readonly sampleMs?: number;
}

/** Ramp of a change of the broadcast state (going live or ending): gentle, nobody asked for it to be exact. */
export const BROADCAST_RAMP_MS = 300;
/** A fade longer than this is capped: a gain that creeps for minutes is a mistake, not a transition. */
const MAX_FADE_MS = 10_000;
/** Program levels below this are reported as no signal. */
const REPORT_FLOOR_DB = -90;
const DEFAULT_SAMPLE_MS = 100;

/** The ramp of a change of the state: the fade of a program switch, a gentle one for the broadcast, 20 ms otherwise. */
export function rampFor(
  previousBroadcast: ProductionState['production']['broadcast'] | null,
  state: ProductionState,
  cause: SyncCause | null,
): ApplyOptions {
  if (previousBroadcast !== null && previousBroadcast !== state.production.broadcast) {
    return { rampMs: BROADCAST_RAMP_MS };
  }
  if (cause?.kind === 'event' && cause.event.type === 'programSwitched') {
    return fadeRamp(cause.event.transition);
  }
  return { rampMs: AUDIO_RAMP_MS };
}

function fadeRamp(transition: TransitionDto): ApplyOptions {
  return transition.kind === 'fade' && transition.durationMs > AUDIO_RAMP_MS
    ? { rampMs: Math.min(transition.durationMs, MAX_FADE_MS) }
    : { rampMs: AUDIO_RAMP_MS };
}

/** One channel for the `?debug=1` panel. */
export interface AudioDebugChannel {
  readonly sourceId: string;
  readonly audible: boolean;
  readonly hasSound: boolean;
  readonly levelDb: number | null;
}

/** The audio mix of the page. */
export class OutputAudio {
  readonly #mix: OutputMix | null;
  readonly #tap: AssetAudioTap | null;
  readonly #listeners = new Set<(state: OutputAudioDto['state']) => void>();
  readonly #gestureListeners = new Set<(needed: boolean) => void>();
  readonly #sampleTimer: ReturnType<typeof setInterval> | null;
  readonly #unsubscribe: (() => void)[] = [];
  #state: ProductionState | null = null;
  #broadcast: ProductionState['production']['broadcast'] | null = null;
  #allowed = true;
  #expected = false;
  #peakDb = SILENCE_DB;
  #reported: OutputAudioDto['state'];
  #needsGesture = false;
  #inputs: AudioInputs | null = null;
  #unbindInputs: (() => void) | null = null;
  #disposed = false;

  constructor(options: OutputAudioOptions) {
    const mix = options.enabled ? this.#createMix(options.createMix) : null;
    this.#mix = mix;
    this.#reported = this.state;
    if (mix === null) {
      this.#tap = null;
      this.#sampleTimer = null;
      return;
    }
    this.#tap = new AssetAudioTap({
      capture: options.captureVideo,
      onChange: (sourceId, stream) => mix.setInput(sourceId, stream, { keepAlive: false }),
    });
    this.#unsubscribe.push(
      mix.onStateChange(() => {
        const state = this.state;
        if (state !== this.#reported) {
          this.#reported = state;
          for (const listener of [...this.#listeners]) {
            listener(state);
          }
        }
        this.#refreshGesture();
      }),
    );
    this.#sampleTimer = setInterval(() => this.#sample(), options.sampleMs ?? DEFAULT_SAMPLE_MS);
  }

  /** `off` (on purpose), `running`, `blocked` (the browser waits for a click) or `unavailable` (no Web Audio). */
  get state(): OutputAudioDto['state'] {
    if (this.#mix === null) {
      return 'off';
    }
    switch (this.#mix.state) {
      case 'running':
        return 'running';
      case 'blocked':
        return 'blocked';
      default:
        return 'unavailable';
    }
  }

  /** True when the mix is expected to make sound for a listener: some channel could be heard once the broadcast is live. */
  get expected(): boolean {
    return this.#expected;
  }

  /** True while the sound waits for a click: the page shows the “Sound on” button then. */
  get needsGesture(): boolean {
    return this.state === 'blocked' && this.#expected;
  }

  /** Notifies when the state changes (blocked → running after a click, running → blocked when the browser suspends). */
  onStateChange(listener: (state: OutputAudioDto['state']) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Notifies when the page starts or stops needing a click to make sound (the “Sound on” button follows it). */
  onNeedsGestureChange(listener: (needed: boolean) => void): () => void {
    this.#gestureListeners.add(listener);
    return () => this.#gestureListeners.delete(listener);
  }

  /** Moves the mix to the production state. */
  update(state: ProductionState, cause: SyncCause | null = null): void {
    this.#expected = audioExpected(state);
    const ramp = rampFor(this.#broadcast, state, cause);
    this.#state = state;
    this.#broadcast = state.production.broadcast;
    this.#applyTargets(ramp);
    this.#refreshGesture();
  }

  /** The page may (not) be heard: while it shows “No access” the mix is silent. */
  setAllowed(allowed: boolean): void {
    if (this.#allowed === allowed) {
      return;
    }
    this.#allowed = allowed;
    this.#applyTargets({ rampMs: AUDIO_RAMP_MS });
  }

  /** Takes the sounds of the media side (LiveKit) into the mix and follows their changes. */
  bindInputs(inputs: AudioInputs): void {
    const mix = this.#mix;
    if (mix === null || this.#disposed) {
      return;
    }
    this.#unbindInputs?.();
    this.#inputs = inputs;
    for (const sourceId of inputs.audioSourceIds()) {
      mix.setInput(sourceId, inputs.audioStream(sourceId));
    }
    this.#unbindInputs = inputs.onAudioChange((sourceId) =>
      mix.setInput(sourceId, inputs.audioStream(sourceId)),
    );
  }

  /** An element started or stopped showing a video asset: its sound is the sound of the asset's channel. */
  assetVideo(sourceId: string, video: HTMLVideoElement, attached: boolean): void {
    if (attached) {
      this.#tap?.attach(sourceId, video);
    } else {
      this.#tap?.detach(sourceId, video);
    }
  }

  /** Starts the audio context; call it from a user gesture. */
  async resume(): Promise<OutputAudioDto['state']> {
    await this.#mix?.resume();
    return this.state;
  }

  /** The report housekeeping: a suspended context is asked to run again (it works where autoplay is allowed). */
  tryResume(): void {
    if (this.#mix?.state === 'blocked') {
      void this.#mix.resume();
    }
  }

  /** What the output report carries: the state and the peak of the program mix since the last report. */
  report(): OutputAudioDto {
    const peak = this.#peakDb;
    this.#peakDb = SILENCE_DB;
    const state = this.state;
    return {
      state,
      levelDb: state === 'running' && peak > REPORT_FLOOR_DB ? Math.round(peak * 10) / 10 : null,
    };
  }

  /** The meters of the `?debug=1` panel. */
  debug(): { readonly programDb: number | null; readonly channels: readonly AudioDebugChannel[] } {
    const mix = this.#mix;
    if (mix === null || this.state !== 'running') {
      return { programDb: null, channels: [] };
    }
    const levels: GraphLevels = mix.levels();
    const targets = this.#state === null ? new Map() : audioTargets(this.#state);
    const inputs = this.#inputs;
    return {
      programDb: levels.program > REPORT_FLOOR_DB ? Math.round(levels.program) : null,
      channels: [...levels.channels].map(([sourceId, levelDb]) => ({
        sourceId,
        audible: targets.get(sourceId)?.audible ?? false,
        hasSound:
          (inputs?.audioStream(sourceId) ?? null) !== null ||
          (this.#tap?.streamOf(sourceId) ?? null) !== null,
        levelDb: levelDb > REPORT_FLOOR_DB ? Math.round(levelDb) : null,
      })),
    };
  }

  /** Releases the mix, the captures and the timers. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#sampleTimer !== null) {
      clearInterval(this.#sampleTimer);
    }
    this.#unbindInputs?.();
    this.#unbindInputs = null;
    for (const unsubscribe of this.#unsubscribe.splice(0)) {
      unsubscribe();
    }
    this.#tap?.dispose();
    this.#mix?.dispose();
    this.#listeners.clear();
    this.#gestureListeners.clear();
  }

  #refreshGesture(): void {
    const needed = this.needsGesture;
    if (needed !== this.#needsGesture) {
      this.#needsGesture = needed;
      for (const listener of [...this.#gestureListeners]) {
        listener(needed);
      }
    }
  }

  #applyTargets(ramp: ApplyOptions): void {
    const mix = this.#mix;
    if (mix === null || this.#disposed) {
      return;
    }
    mix.apply(this.#allowed && this.#state !== null ? audioTargets(this.#state) : new Map(), ramp);
  }

  #sample(): void {
    const mix = this.#mix;
    if (mix === null || mix.state !== 'running') {
      return;
    }
    this.#peakDb = Math.max(this.#peakDb, mix.programLevel());
  }

  #createMix(create: (() => OutputMix) | undefined): OutputMix {
    return create ? create() : new AudioGraph({ output: 'program' });
  }
}
