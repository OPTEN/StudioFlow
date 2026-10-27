import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AssetAudioTap,
  AudioGraph,
  SILENCE_DB,
  type AudioGraphState,
  type MonitorSelection,
} from '@studioflow/media-client/device';
import type { SyncCause } from '@studioflow/realtime-client';
import {
  SilenceTracker,
  audibleChannelIds,
  audioRampMs,
  audioTargets,
  type ProductionState,
} from '@studioflow/scene-model';
import { AuthService } from '../auth/auth.service';
import { StudioMediaService, type StudioSourceProvider } from '../media/studio-media.service';
import { ProductionStoreService } from '../state/production-store.service';

/** The part of the Web Audio mix the Regie uses; a test double stands in for it. */
export type StudioMix = Pick<
  AudioGraph,
  | 'state'
  | 'onStateChange'
  | 'resume'
  | 'setInput'
  | 'hasInput'
  | 'apply'
  | 'levels'
  | 'setMonitor'
  | 'setSinkId'
  | 'canChooseOutputDevice'
  | 'dispose'
>;

/** Creates the Regie's copy of the mix: it measures the channels and plays only what the operator chose to monitor. */
export const STUDIO_MIX_FACTORY = new InjectionToken<() => StudioMix>('STUDIO_MIX_FACTORY', {
  providedIn: 'root',
  factory: () => () => new AudioGraph({ output: 'monitor' }),
});

/** Measurement interval of the meters: 20 readings per second. */
export const METER_INTERVAL_MS = 50;
/** How fast a meter falls back: about 30 dB per second, like the ballistics of a PPM. */
const METER_FALL_DB_PER_TICK = 1.5;
/** Levels are published in steps of this size, so a steady tone does not redraw the meters 20 times a second. */
const LEVEL_STEP_DB = 0.5;

const NO_LEVELS: ReadonlyMap<string, number> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();

function quantize(db: number): number {
  return Math.round(db / LEVEL_STEP_DB) * LEVEL_STEP_DB;
}

function sameLevels(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/**
 * The Regie's copy of the audio mix (spec 9.1, issue #7): the sounds of the production (microphones and screens from
 * LiveKit, the video on the Program monitor) go through the same gains as on the output page, so the meters of the Audio
 * dock and the program level next to Take show what the audience hears – without any sound leaving the Regie unless
 * the operator chooses to monitor (PFL of one channel, or the program, on the speakers or on headphones).
 *
 * - The mix exists as soon as the production has audio channels. A browser keeps its audio context suspended until the
 *   page has been clicked; the first click or key press starts it (the meters show nothing before).
 * - {@link levels} are the peaks before the fader of every channel that has a sound, {@link programLevel} the peak of
 *   the mix, both in dBFS with a fall-back of about 30 dB per second.
 * - {@link silent} lists the audible channels that delivered no signal for 10 seconds (a warning, not an incident).
 * - Nothing is measured, and nothing is warned, while the context does not run.
 */
@Injectable({ providedIn: 'root' })
export class StudioAudioService {
  private readonly store = inject(ProductionStoreService);
  private readonly media = inject(StudioMediaService);
  private readonly auth = inject(AuthService);
  private readonly factory = inject(STUDIO_MIX_FACTORY);
  private readonly document = inject(DOCUMENT);

  private mix: StudioMix | null = null;
  private tap: AssetAudioTap | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unbindProvider: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private broadcast: string | null = null;
  private smoothed = new Map<string, number>();
  private smoothedProgram = SILENCE_DB;
  private readonly tracker = new SilenceTracker();
  private readonly stateSignal = signal<AudioGraphState | 'idle'>('idle');
  private readonly levelsSignal = signal<ReadonlyMap<string, number>>(NO_LEVELS);
  private readonly programSignal = signal(SILENCE_DB);
  private readonly silentSignal = signal<ReadonlySet<string>>(NO_IDS);
  private readonly soundingSignal = signal<ReadonlySet<string>>(NO_IDS);
  private readonly monitorSignal = signal<MonitorSelection>({ kind: 'off' });
  private readonly gestureEvents = ['pointerdown', 'keydown'] as const;
  private readonly onGesture = (): void => {
    void this.mix?.resume();
  };

  /** `idle` without audio channels, else the state of the audio context (`blocked` until the page was clicked). */
  readonly state = this.stateSignal.asReadonly();
  /** Peak before the fader of every channel with a sound, in dBFS. */
  readonly levels = this.levelsSignal.asReadonly();
  /** Peak of the program mix in dBFS. */
  readonly programLevel = this.programSignal.asReadonly();
  /** Audible channels without signal for 10 seconds. */
  readonly silent = this.silentSignal.asReadonly();
  /** Channels that have a sound (a live track, a playing video). */
  readonly sounding = this.soundingSignal.asReadonly();
  /** What the operator listens to; off by default and after every reload. */
  readonly monitor = this.monitorSignal.asReadonly();

  constructor() {
    effect(() => {
      const has = this.store.audioChannels().size > 0;
      if (has) {
        untracked(() => this.ensureMix());
      }
    });
    effect(() => {
      const provider = this.media.provider();
      untracked(() => this.bindInputs(provider));
    });
    this.unsubscribeStore = this.store.onChange((state, cause) => this.follow(state, cause));
    const unregister = this.auth.onSignedOut(() => this.release());
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.unsubscribeStore?.();
      this.release();
    });
  }

  /** True where the browser can send the monitor to another output device (Chromium). */
  get canChooseOutputDevice(): boolean {
    return this.mix?.canChooseOutputDevice ?? false;
  }

  /** Starts the audio context; call it from a click or key press. */
  async resume(): Promise<void> {
    await this.mix?.resume();
  }

  /** Chooses what the operator listens to; starts the audio context (the click that chose it is the gesture). */
  setMonitor(selection: MonitorSelection): void {
    const mix = this.mix;
    if (mix === null) {
      return;
    }
    void mix.resume();
    mix.setMonitor(selection);
    this.monitorSignal.set(selection);
  }

  /** Listens to one channel before its fader and mute (PFL), or stops when it is the one already heard. */
  togglePfl(sourceId: string): void {
    const current = this.monitorSignal();
    this.setMonitor(
      current.kind === 'channel' && current.sourceId === sourceId
        ? { kind: 'off' }
        : { kind: 'channel', sourceId },
    );
  }

  /** Sends the monitor to another output device (headphones). False where the browser has none or refuses. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    return (await this.mix?.setSinkId(deviceId)) ?? false;
  }

  /** The Program monitor shows or no longer shows a video asset in this element: its sound is the channel's sound. */
  assetVideo(sourceId: string, video: HTMLVideoElement, attached: boolean): void {
    this.ensureMix();
    if (attached) {
      this.tap?.attach(sourceId, video);
    } else {
      this.tap?.detach(sourceId, video);
    }
  }

  private ensureMix(): void {
    if (this.mix !== null) {
      return;
    }
    let mix: StudioMix;
    try {
      mix = this.factory();
    } catch (error) {
      console.warn('[StudioFlow] the audio mix could not be created', error);
      return;
    }
    this.mix = mix;
    this.tap = new AssetAudioTap({
      onChange: (sourceId, stream) => mix.setInput(sourceId, stream, { keepAlive: false }),
    });
    this.stateSignal.set(mix.state);
    this.unsubscribeState = mix.onStateChange((state) => {
      this.stateSignal.set(state);
      if (state === 'running') {
        this.stopWaitingForGesture();
      }
    });
    if (mix.state === 'blocked') {
      for (const event of this.gestureEvents) {
        this.document.addEventListener(event, this.onGesture, { capture: true, passive: true });
      }
    }
    const state = this.store.state();
    if (state) {
      this.broadcast = state.production.broadcast;
      mix.apply(audioTargets(state), { rampMs: audioRampMs(false, null) });
    }
    this.bindInputs(this.media.provider());
    this.timer = setInterval(() => this.tick(), METER_INTERVAL_MS);
  }

  /** The production state changed: the mix follows with the ramp the output page uses. */
  private follow(state: ProductionState, cause: SyncCause): void {
    const mix = this.mix;
    if (mix === null) {
      this.broadcast = state.production.broadcast;
      return;
    }
    const broadcastChanged =
      this.broadcast !== null && this.broadcast !== state.production.broadcast;
    this.broadcast = state.production.broadcast;
    const transition =
      cause.kind === 'event' && cause.event.type === 'programSwitched'
        ? cause.event.transition
        : null;
    mix.apply(audioTargets(state), { rampMs: audioRampMs(broadcastChanged, transition) });
  }

  private bindInputs(provider: StudioSourceProvider | null): void {
    this.unbindProvider?.();
    this.unbindProvider = null;
    const mix = this.mix;
    if (mix === null || provider === null) {
      return;
    }
    for (const sourceId of provider.audioSourceIds()) {
      mix.setInput(sourceId, provider.audioStream(sourceId));
    }
    this.unbindProvider = provider.onAudioChange((sourceId) =>
      mix.setInput(sourceId, provider.audioStream(sourceId)),
    );
  }

  private tick(): void {
    const mix = this.mix;
    if (mix === null) {
      return;
    }
    const running = mix.state === 'running';
    const levels = running ? mix.levels() : null;
    // A sound is a sound whether or not the context runs: the dock shows a screen's row as soon as it has one.
    const sounding = new Set<string>();
    for (const sourceId of this.store.audioChannels().keys()) {
      if (mix.hasInput(sourceId)) {
        sounding.add(sourceId);
      }
    }
    const channels = new Map<string, number>();
    for (const [sourceId, db] of levels?.channels ?? NO_LEVELS) {
      if (sounding.has(sourceId)) {
        channels.set(sourceId, db);
      }
    }
    this.publishLevels(channels, levels?.program ?? SILENCE_DB);
    if (!sameSet(sounding, this.soundingSignal())) {
      this.soundingSignal.set(sounding);
    }
    this.checkSilence(running, channels, sounding);
  }

  private publishLevels(raw: ReadonlyMap<string, number>, program: number): void {
    const shown = new Map<string, number>();
    for (const [sourceId, db] of raw) {
      const fallen = (this.smoothed.get(sourceId) ?? SILENCE_DB) - METER_FALL_DB_PER_TICK;
      const level = Math.max(db, fallen);
      this.smoothed.set(sourceId, level);
      shown.set(sourceId, quantize(level));
    }
    for (const sourceId of [...this.smoothed.keys()]) {
      if (!raw.has(sourceId)) {
        this.smoothed.delete(sourceId);
      }
    }
    this.smoothedProgram = Math.max(program, this.smoothedProgram - METER_FALL_DB_PER_TICK);
    if (!sameLevels(shown, this.levelsSignal())) {
      this.levelsSignal.set(shown);
    }
    const programShown = quantize(this.smoothedProgram);
    if (programShown !== this.programSignal()) {
      this.programSignal.set(programShown);
    }
  }

  private checkSilence(
    running: boolean,
    channels: ReadonlyMap<string, number>,
    sounding: ReadonlySet<string>,
  ): void {
    const state = this.store.state();
    let silent: ReadonlySet<string> = NO_IDS;
    if (running && state && state.production.broadcast === 'live') {
      const audible = audibleChannelIds(state);
      silent = this.tracker.update(
        Date.now(),
        [...state.audioChannels.keys()].map((sourceId) => ({
          sourceId,
          audible: audible.has(sourceId),
          hasSound: sounding.has(sourceId),
          levelDb: channels.get(sourceId) ?? SILENCE_DB,
        })),
      );
    } else {
      this.tracker.reset();
    }
    if (!sameSet(silent, this.silentSignal())) {
      this.silentSignal.set(silent);
    }
  }

  private stopWaitingForGesture(): void {
    for (const event of this.gestureEvents) {
      this.document.removeEventListener(event, this.onGesture, { capture: true });
    }
  }

  private release(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopWaitingForGesture();
    this.unbindProvider?.();
    this.unbindProvider = null;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.tap?.dispose();
    this.tap = null;
    this.mix?.dispose();
    this.mix = null;
    this.smoothed.clear();
    this.smoothedProgram = SILENCE_DB;
    this.tracker.reset();
    this.broadcast = null;
    this.stateSignal.set('idle');
    this.levelsSignal.set(NO_LEVELS);
    this.programSignal.set(SILENCE_DB);
    this.silentSignal.set(NO_IDS);
    this.soundingSignal.set(NO_IDS);
    this.monitorSignal.set({ kind: 'off' });
  }
}
