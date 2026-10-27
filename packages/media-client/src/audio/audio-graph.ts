/**
 * The Web Audio mix of StudioFlow (spec 9.3 and 9.1, issue #7): one strip per audio channel (an input, a pre-fader meter,
 * a `DelayNode` for the sync offset and a `GainNode` for the fader, mute and mode) into a master. The output page plays
 * the master; the Regie builds the same graph for its meters and listens to a single channel (PFL) or to the program
 * through a monitor bus, which is only ever connected to the speakers while the operator chose to monitor.
 *
 * The graph does not decide anything: it is given the targets of the channels (`audioTargets` of scene-model) and the
 * sources of the sounds, and it moves the gains with ramps (see `ramp.ts`).
 */
import type { ChannelTarget } from '@studioflow/scene-model';
import { Listeners } from '../listeners';
import { consoleLogger, errorContext, type MediaLogger } from '../logger';
import { ANALYSER_FFT_SIZE, SILENCE_DB, analyserPeakDb, levelBuffer } from './level';
import { rampParam, type RampCurve } from './ramp';

/**
 * State of the graph as the output page reports it:
 * - `running`: the audio context runs;
 * - `blocked`: the browser keeps the audio context suspended until someone interacts with the page (autoplay policy);
 * - `unavailable`: no Web Audio in this browser, or the context could not be created;
 * - `closed`: the graph was disposed.
 */
export type AudioGraphState = 'running' | 'blocked' | 'unavailable' | 'closed';

/** What the monitor bus plays: nothing, the program mix, or one channel before its fader and mute (PFL). */
export type MonitorSelection =
  | { readonly kind: 'off' }
  | { readonly kind: 'program' }
  | { readonly kind: 'channel'; readonly sourceId: string };

/** How a change of the targets is applied. */
export interface ApplyOptions {
  /** Ramp duration in milliseconds: 20 for a cut, a mute or a fader move, the duration of the fade for a crossfade. */
  readonly rampMs: number;
  /** Shape of the ramp; default: equal-power from 100 ms on, linear below. */
  readonly curve?: RampCurve;
}

/** Peak levels in dBFS read from the meters. */
export interface GraphLevels {
  /** Per channel, before the fader and mute. */
  readonly channels: ReadonlyMap<string, number>;
  /** The program mix (the master). */
  readonly program: number;
}

/** Construction options of {@link AudioGraph}. */
export interface AudioGraphOptions {
  /** `program`: the master is played (output page). `monitor`: the master only feeds the meters (Regie). */
  readonly output: 'program' | 'monitor';
  /** Creates the audio context; default: the browser's `AudioContext` (interactive latency hint). */
  readonly createContext?: () => AudioContext;
  /**
   * Keeps a remote stream pulling: Chromium delivers the audio of a WebRTC stream to a Web Audio source only while the
   * stream is also attached to a media element. Returns the function that releases it. Default: a muted `<audio>`.
   */
  readonly keepAlive?: (stream: MediaStream) => () => void;
  readonly logger?: MediaLogger;
}

/** The longest delay of a strip: the sync offset limit (500 ms) with a little room. */
const MAX_DELAY_SECONDS = 0.6;
/** Smoothing of a sync offset change in seconds (a `setTargetAtTime` time constant). */
const DELAY_SMOOTHING_SECONDS = 0.03;
/** From this ramp duration on a crossfade follows an equal-power curve. */
const EQUAL_POWER_FROM_MS = 100;

interface Strip {
  readonly sourceId: string;
  /** Unity point every tap hangs on (meter, delay, PFL). */
  readonly input: GainNode;
  readonly meter: AnalyserNode;
  readonly delay: DelayNode;
  /** Fader, mute and mode: the one gain the targets move. */
  readonly fader: GainNode;
  /** The sound of the channel, if any. */
  feed: Feed | null;
  /** The target applied last (kept after the channel left the targets, with a gain of zero). */
  last: ChannelTarget | null;
  /** True while the channel is part of the targets of the last {@link AudioGraph.apply}. */
  targeted: boolean;
}

interface Feed {
  readonly stream: MediaStream;
  readonly source: MediaStreamAudioSourceNode;
  readonly release: () => void;
}

function defaultCreateContext(): AudioContext {
  const Context =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Context === undefined) {
    throw new Error('Web Audio is not available');
  }
  return new Context({ latencyHint: 'interactive' });
}

/** A muted `<audio>` element on the stream: enough for Chromium to keep the remote stream flowing into Web Audio. */
function defaultKeepAlive(stream: MediaStream): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const element = document.createElement('audio');
  element.muted = true;
  element.autoplay = true;
  element.srcObject = stream;
  try {
    void element.play()?.catch(() => undefined);
  } catch {
    // A refused play() does not matter: the element only has to hold the stream.
  }
  return () => {
    element.pause();
    element.srcObject = null;
  };
}

/** The Web Audio mix. */
export class AudioGraph {
  readonly #options: AudioGraphOptions;
  readonly #logger: MediaLogger;
  readonly #strips = new Map<string, Strip>();
  readonly #stateListeners: Listeners<[AudioGraphState]>;
  readonly #context: AudioContext | null;
  readonly #master: GainNode | null = null;
  readonly #masterMeter: AnalyserNode | null = null;
  readonly #monitorBus: GainNode | null = null;
  readonly #buffer = levelBuffer(ANALYSER_FFT_SIZE);
  #monitorTap: AudioNode | null = null;
  #monitor: MonitorSelection = { kind: 'off' };
  #state: AudioGraphState;
  #disposed = false;

  constructor(options: AudioGraphOptions) {
    this.#options = options;
    this.#logger = options.logger ?? consoleLogger;
    this.#stateListeners = new Listeners((error) =>
      this.#logger.warn('audio state listener failed', errorContext(error)),
    );
    let context: AudioContext | null = null;
    try {
      context = (options.createContext ?? defaultCreateContext)();
    } catch (error) {
      this.#logger.warn('audio context could not be created', errorContext(error));
    }
    this.#context = context;
    if (context === null) {
      this.#state = 'unavailable';
      return;
    }
    this.#master = context.createGain();
    this.#masterMeter = context.createAnalyser();
    this.#masterMeter.fftSize = ANALYSER_FFT_SIZE;
    this.#master.connect(this.#masterMeter);
    this.#monitorBus = context.createGain();
    if (options.output === 'program') {
      this.#master.connect(context.destination);
    } else {
      // The Regie hears nothing unless the operator chooses to monitor, and then only through this bus.
      this.#monitorBus.gain.value = 1;
      this.#monitorBus.connect(context.destination);
    }
    this.#state = stateOf(context);
    context.addEventListener('statechange', this.#onContextState);
  }

  /** Current state of the graph. */
  get state(): AudioGraphState {
    return this.#state;
  }

  /** Notifies about state changes (a blocked context that starts running, a context that is suspended again). */
  onStateChange(listener: (state: AudioGraphState) => void): () => void {
    return this.#stateListeners.add(listener);
  }

  /** The audio context's own clock in seconds (0 without a context). */
  get currentTime(): number {
    return this.#context?.currentTime ?? 0;
  }

  /** The source ids that have a strip. */
  get channels(): readonly string[] {
    return [...this.#strips.keys()];
  }

  /**
   * Tries to start the audio context. Needs a user gesture in a browser that blocks autoplay; call it from event
   * handlers (click, key, touch). Resolves to the state afterwards.
   */
  async resume(): Promise<AudioGraphState> {
    const context = this.#context;
    if (context === null || this.#disposed) {
      return this.#state;
    }
    if (context.state !== 'running') {
      try {
        await context.resume();
      } catch (error) {
        this.#logger.debug('audio context could not be resumed', errorContext(error));
      }
    }
    this.#refreshState();
    return this.#state;
  }

  /**
   * Sets the sound of a channel: the remote audio stream of a microphone or a screen, or the captured audio of a video.
   * `null` or a stream without an audio track removes it; the strip stays, so the gain is already right when the sound
   * returns. A stream that does not come from WebRTC (a captured video) needs no keep-alive: `keepAlive: false`.
   */
  setInput(
    sourceId: string,
    stream: MediaStream | null,
    options: { readonly keepAlive?: boolean } = {},
  ): void {
    const context = this.#context;
    if (context === null || this.#disposed) {
      return;
    }
    const wanted = stream !== null && stream.getAudioTracks().length > 0 ? stream : null;
    const existing = this.#strips.get(sourceId);
    if (wanted === null && existing === undefined) {
      return;
    }
    const strip = existing ?? this.#strip(sourceId);
    if ((strip.feed?.stream ?? null) === wanted) {
      return;
    }
    this.#dropFeed(strip);
    if (wanted === null) {
      if (!strip.targeted) {
        // Neither a sound nor a target: nothing keeps the strip.
        this.#removeStrip(sourceId, strip, context.currentTime, 0);
      }
      return;
    }
    try {
      const source = context.createMediaStreamSource(wanted);
      source.connect(strip.input);
      const keepAlive = this.#options.keepAlive ?? defaultKeepAlive;
      strip.feed = {
        stream: wanted,
        source,
        release: options.keepAlive === false ? () => undefined : keepAlive(wanted),
      };
    } catch (error) {
      this.#logger.warn('audio input could not be connected', errorContext(error));
    }
  }

  /** True when the channel has a sound. */
  hasInput(sourceId: string): boolean {
    return (this.#strips.get(sourceId)?.feed ?? null) !== null;
  }

  /**
   * Moves the gain and the delay of every channel to its target. A channel that is not in `targets` any more fades to
   * silence; its strip is removed unless it still has a sound (the mixer state may arrive after the track). A change that
   * equals the last one does nothing (a scene switch leaves a channel that is always audible alone). The first target of
   * a channel is set at once, without a ramp.
   */
  apply(targets: ReadonlyMap<string, ChannelTarget>, options: ApplyOptions): void {
    const context = this.#context;
    if (context === null || this.#disposed) {
      return;
    }
    const now = context.currentTime;
    const curve =
      options.curve ?? (options.rampMs >= EQUAL_POWER_FROM_MS ? 'equal-power' : 'linear');
    for (const [sourceId, target] of targets) {
      const strip = this.#strip(sourceId);
      const last = strip.last;
      if (last === null) {
        strip.fader.gain.setValueAtTime(target.gain, now);
        strip.delay.delayTime.setValueAtTime(target.delayMs / 1000, now);
      } else {
        if (last.gain !== target.gain) {
          rampParam(strip.fader.gain, target.gain, now, options.rampMs / 1000, curve);
        }
        if (last.delayMs !== target.delayMs) {
          strip.delay.delayTime.cancelScheduledValues(now);
          strip.delay.delayTime.setTargetAtTime(
            target.delayMs / 1000,
            now,
            DELAY_SMOOTHING_SECONDS,
          );
        }
      }
      strip.last = target;
      strip.targeted = true;
    }
    for (const [sourceId, strip] of [...this.#strips]) {
      if (targets.has(sourceId)) {
        continue;
      }
      strip.targeted = false;
      if (strip.feed === null) {
        this.#removeStrip(sourceId, strip, now, options.rampMs / 1000);
      } else if (strip.last !== null && strip.last.gain !== 0) {
        rampParam(strip.fader.gain, 0, now, options.rampMs / 1000, 'linear');
        strip.last = { ...strip.last, gain: 0, audible: false };
      }
    }
  }

  /** Reads the peak levels of all meters. Cheap; meant for an interval or an animation frame. */
  levels(): GraphLevels {
    const channels = new Map<string, number>();
    for (const [sourceId, strip] of this.#strips) {
      channels.set(
        sourceId,
        strip.feed === null ? SILENCE_DB : analyserPeakDb(strip.meter, this.#buffer),
      );
    }
    return {
      channels,
      program:
        this.#masterMeter === null ? SILENCE_DB : analyserPeakDb(this.#masterMeter, this.#buffer),
    };
  }

  /** Peak level of the program mix alone (cheaper than {@link levels} when no channel meter is needed). */
  programLevel(): number {
    return this.#masterMeter === null
      ? SILENCE_DB
      : analyserPeakDb(this.#masterMeter, this.#buffer);
  }

  /**
   * Chooses what the monitor bus plays (Regie only): the program, one channel before its fader (PFL) or nothing. The
   * output page has no monitor.
   */
  setMonitor(selection: MonitorSelection): void {
    if (this.#options.output !== 'monitor' || this.#monitorBus === null || this.#disposed) {
      return;
    }
    this.#monitor = selection;
    this.#connectMonitor();
  }

  /** The current monitor selection. */
  get monitor(): MonitorSelection {
    return this.#monitor;
  }

  /**
   * Sends the sound the monitor plays to another output device (the operator's headphones). Needs
   * `AudioContext.setSinkId` (Chromium); resolves to false where the browser has none or refuses.
   */
  async setSinkId(deviceId: string): Promise<boolean> {
    const context = this.#context as
      (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (context?.setSinkId === undefined) {
      return false;
    }
    try {
      await context.setSinkId(deviceId);
      return true;
    } catch (error) {
      this.#logger.warn('audio output device could not be set', errorContext(error));
      return false;
    }
  }

  /** True when the browser can send the monitor to another output device. */
  get canChooseOutputDevice(): boolean {
    return this.#context !== null && 'setSinkId' in this.#context;
  }

  /** Releases every node and closes the context. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const strip of this.#strips.values()) {
      this.#dropFeed(strip);
    }
    this.#strips.clear();
    const context = this.#context;
    if (context !== null) {
      context.removeEventListener('statechange', this.#onContextState);
      void context.close().catch(() => undefined);
    }
    this.#state = 'closed';
    this.#stateListeners.clear();
  }

  readonly #onContextState = (): void => this.#refreshState();

  #refreshState(): void {
    const context = this.#context;
    if (context === null || this.#disposed) {
      return;
    }
    const next = stateOf(context);
    if (next !== this.#state) {
      this.#state = next;
      this.#stateListeners.emit(next);
    }
  }

  #strip(sourceId: string): Strip {
    let strip = this.#strips.get(sourceId);
    if (strip !== undefined) {
      return strip;
    }
    const context = this.#context!;
    const input = context.createGain();
    const meter = context.createAnalyser();
    meter.fftSize = ANALYSER_FFT_SIZE;
    const delay = context.createDelay(MAX_DELAY_SECONDS);
    const fader = context.createGain();
    fader.gain.value = 0;
    input.connect(meter);
    input.connect(delay);
    delay.connect(fader);
    fader.connect(this.#master!);
    strip = { sourceId, input, meter, delay, fader, feed: null, last: null, targeted: false };
    this.#strips.set(sourceId, strip);
    return strip;
  }

  #removeStrip(sourceId: string, strip: Strip, now: number, seconds: number): void {
    rampParam(strip.fader.gain, 0, now, seconds, 'linear');
    this.#strips.delete(sourceId);
    if (this.#monitor.kind === 'channel' && this.#monitor.sourceId === sourceId) {
      this.#monitor = { kind: 'off' };
      this.#connectMonitor();
    }
    // The nodes are released once the ramp has certainly ended (the timer is not what silences the channel).
    setTimeout(
      () => {
        this.#dropFeed(strip);
        strip.input.disconnect();
        strip.meter.disconnect();
        strip.delay.disconnect();
        strip.fader.disconnect();
      },
      seconds * 1000 + 200,
    );
  }

  #dropFeed(strip: Strip): void {
    const feed = strip.feed;
    if (feed === null) {
      return;
    }
    strip.feed = null;
    try {
      feed.source.disconnect();
    } catch {
      // Already disconnected.
    }
    feed.release();
  }

  /** Connects the node the monitor selection asks for to the monitor bus, and nothing else. */
  #connectMonitor(): void {
    const bus = this.#monitorBus;
    if (bus === null) {
      return;
    }
    try {
      this.#monitorTap?.disconnect(bus);
    } catch {
      // Not connected.
    }
    this.#monitorTap = null;
    const selection = this.#monitor;
    const tap =
      selection.kind === 'program'
        ? this.#master
        : selection.kind === 'channel'
          ? (this.#strips.get(selection.sourceId)?.input ?? null)
          : null;
    if (tap !== null) {
      tap.connect(bus);
      this.#monitorTap = tap;
    }
  }
}

function stateOf(context: AudioContext): AudioGraphState {
  switch (context.state) {
    case 'running':
      return 'running';
    case 'closed':
      return 'closed';
    default:
      // suspended, and Safari's interrupted: the page may not make sound (yet).
      return 'blocked';
  }
}
