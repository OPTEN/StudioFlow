/**
 * Test doubles for Web Audio (the audio mix of the output page and the Regie). `FakeAudioParam` keeps the automation
 * events and evaluates them at the context's clock, so specs can read the gain halfway through a ramp; the nodes record
 * their connections. Test-only module: not exported from the package entry point.
 */

type ParamEvent =
  | { readonly kind: 'set'; readonly time: number; readonly value: number }
  | { readonly kind: 'linear'; readonly time: number; readonly value: number }
  | {
      readonly kind: 'curve';
      readonly time: number;
      readonly duration: number;
      readonly values: Float32Array;
    }
  | {
      readonly kind: 'target';
      readonly time: number;
      readonly value: number;
      readonly tau: number;
    };

/** An `AudioParam` that evaluates its automation at the clock of the fake context. */
export class FakeAudioParam {
  readonly events: ParamEvent[] = [];
  #base: number;

  constructor(
    private readonly clock: () => number,
    initial = 1,
  ) {
    this.#base = initial;
  }

  get value(): number {
    return this.valueAt(this.clock());
  }

  set value(value: number) {
    this.#base = value;
    this.events.length = 0;
  }

  setValueAtTime(value: number, time: number): this {
    this.#insert({ kind: 'set', time, value });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.#insert({ kind: 'linear', time, value });
    return this;
  }

  setValueCurveAtTime(values: Float32Array | number[], time: number, duration: number): this {
    const end = time + duration;
    for (const event of this.events) {
      // The rules of the spec that Chromium enforces: a curve may not overlap other events.
      if (event.time > time && event.time < end) {
        throw new DOMException('overlaps another event', 'NotSupportedError');
      }
    }
    this.#insert({ kind: 'curve', time, duration, values: Float32Array.from(values) });
    return this;
  }

  setTargetAtTime(value: number, time: number, tau: number): this {
    this.#insert({ kind: 'target', time, value, tau });
    return this;
  }

  /** Removes the events from `time` on; an automation in progress is dropped and the value before it returns. */
  cancelScheduledValues(time: number): this {
    const kept = this.events.filter((event) => event.time < time);
    // A curve that started before `time` and is still running is cancelled as well (spec: restores the earlier value).
    const running = kept.filter(
      (event) => event.kind === 'curve' && event.time + event.duration > time,
    );
    this.events.length = 0;
    this.events.push(...kept.filter((event) => !running.includes(event)));
    return this;
  }

  /** Number of automation events that are scheduled (a spec for "does nothing" counts them). */
  get scheduled(): number {
    return this.events.length;
  }

  valueAt(time: number): number {
    let value = this.#base;
    let valueTime = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.events.length; i += 1) {
      const event = this.events[i];
      switch (event.kind) {
        case 'set':
          if (event.time <= time) {
            value = event.value;
            valueTime = event.time;
          }
          break;
        case 'linear': {
          if (event.time <= time) {
            value = event.value;
            valueTime = event.time;
          } else if (valueTime < event.time) {
            const start = Number.isFinite(valueTime) ? valueTime : 0;
            const progress = (time - start) / (event.time - start);
            return value + (event.value - value) * Math.min(1, Math.max(0, progress));
          }
          break;
        }
        case 'curve': {
          if (time >= event.time + event.duration) {
            value = event.values[event.values.length - 1];
            valueTime = event.time + event.duration;
          } else if (time >= event.time) {
            const position = ((time - event.time) / event.duration) * (event.values.length - 1);
            const index = Math.floor(position);
            const fraction = position - index;
            const next = event.values[Math.min(index + 1, event.values.length - 1)];
            return event.values[index] + (next - event.values[index]) * fraction;
          }
          break;
        }
        case 'target':
          if (event.time <= time) {
            const decay = Math.exp(-(time - event.time) / event.tau);
            return event.value + (value - event.value) * decay;
          }
          break;
      }
    }
    return value;
  }

  #insert(event: ParamEvent): void {
    for (const existing of this.events) {
      if (
        existing.kind === 'curve' &&
        event.time >= existing.time &&
        event.time < existing.time + existing.duration
      ) {
        throw new DOMException('inside a value curve', 'NotSupportedError');
      }
    }
    const index = this.events.findIndex((other) => other.time > event.time);
    this.events.splice(index === -1 ? this.events.length : index, 0, event);
  }
}

/** Common behaviour of the fake nodes: connections that can be inspected. */
export class FakeAudioNode {
  readonly connections = new Set<FakeAudioNode | FakeDestination>();
  disconnected = false;

  connect<T extends FakeAudioNode | FakeDestination>(destination: T): T {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: FakeAudioNode | FakeDestination): void {
    if (destination === undefined) {
      this.connections.clear();
      this.disconnected = true;
      return;
    }
    if (!this.connections.delete(destination)) {
      throw new DOMException('not connected', 'InvalidAccessError');
    }
  }

  connectsTo(destination: FakeAudioNode | FakeDestination): boolean {
    return this.connections.has(destination);
  }
}

export class FakeDestination {}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam;

  constructor(clock: () => number) {
    super();
    this.gain = new FakeAudioParam(clock, 1);
  }
}

export class FakeDelayNode extends FakeAudioNode {
  readonly delayTime: FakeAudioParam;

  constructor(
    clock: () => number,
    readonly maxDelayTime: number,
  ) {
    super();
    this.delayTime = new FakeAudioParam(clock, 0);
  }
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  /** The samples the next read returns (a spec sets a peak with {@link setPeak}). */
  signal: Float32Array = new Float32Array(0);

  /** The analyser reads a signal whose peak is `peak` (linear, 1 is full scale). */
  setPeak(peak: number): void {
    this.signal = new Float32Array(this.fftSize);
    this.signal[10] = peak;
  }

  getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.fill(0);
    buffer.set(this.signal.subarray(0, buffer.length));
  }
}

export class FakeStreamSource extends FakeAudioNode {
  constructor(readonly stream: MediaStream) {
    super();
  }
}

type StateListener = () => void;

/** An `AudioContext` whose clock and state the spec drives. */
export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly destination = new FakeDestination();
  readonly gains: FakeGainNode[] = [];
  readonly delays: FakeDelayNode[] = [];
  readonly analysers: FakeAnalyserNode[] = [];
  readonly sources: FakeStreamSource[] = [];
  readonly resume = vi.fn(async (): Promise<void> => {
    if (this.resumeError !== null) {
      throw this.resumeError;
    }
    if (!this.blocked) {
      this.setState('running');
    }
  });
  readonly close = vi.fn(async (): Promise<void> => {
    this.setState('closed');
  });
  /** The browser keeps the context suspended (autoplay policy) until `allowSound()`. */
  blocked = false;
  resumeError: Error | null = null;
  readonly #listeners = new Set<StateListener>();

  constructor(options: { blocked?: boolean } = {}) {
    if (options.blocked === true) {
      this.blocked = true;
      this.state = 'suspended';
    }
  }

  /** A user gesture happened: the browser lets the context run. */
  allowSound(): void {
    this.blocked = false;
  }

  /** Moves the audio clock. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  setState(state: AudioContextState): void {
    this.state = state;
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  addEventListener(type: string, listener: StateListener): void {
    if (type === 'statechange') {
      this.#listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: StateListener): void {
    if (type === 'statechange') {
      this.#listeners.delete(listener);
    }
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode(() => this.currentTime);
    this.gains.push(node);
    return node;
  }

  createDelay(maxDelayTime: number): FakeDelayNode {
    const node = new FakeDelayNode(() => this.currentTime, maxDelayTime);
    this.delays.push(node);
    return node;
  }

  createAnalyser(): FakeAnalyserNode {
    const node = new FakeAnalyserNode();
    this.analysers.push(node);
    return node;
  }

  createMediaStreamSource(stream: MediaStream): FakeStreamSource {
    const node = new FakeStreamSource(stream);
    this.sources.push(node);
    return node;
  }

  /** The graph's context type, for `createContext`. */
  get asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

/** A fake context that also has `setSinkId` (Chromium). */
export class FakeAudioContextWithSink extends FakeAudioContext {
  sinkId: string | null = null;
  sinkError: Error | null = null;
  setSinkId(id: string): Promise<void> {
    if (this.sinkError !== null) {
      return Promise.reject(this.sinkError);
    }
    this.sinkId = id;
    return Promise.resolve();
  }
}
