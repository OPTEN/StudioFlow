/**
 * Level measurement for the meters (Regie, sender) and the program level report of the output page: the peak of the last
 * few milliseconds in dBFS, read from an `AnalyserNode`.
 */

/** The level of silence in dBFS: everything quieter reads as this. */
export const SILENCE_DB = -100;

/** Samples the analysers read: about 85 ms at 48 kHz, so a poll every 60 ms never misses a peak. */
export const ANALYSER_FFT_SIZE = 4096;

/** Peak level in dBFS of the samples (0 dBFS is full scale, silence is {@link SILENCE_DB}). */
export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) {
      peak = value;
    }
  }
  return peak <= 0 ? SILENCE_DB : Math.max(SILENCE_DB, 20 * Math.log10(peak));
}

/** Reads the peak level of an analyser; reuses `buffer`, which must be as long as the analyser's `fftSize`. */
export function analyserPeakDb(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  return peakDb(buffer);
}

/** A buffer for {@link analyserPeakDb}. */
export function levelBuffer(size = ANALYSER_FFT_SIZE): Float32Array<ArrayBuffer> {
  return new Float32Array(size);
}

/**
 * A meter on a media stream: its own analyser on an audio context. Used where the stream is not part of a mix, for
 * example the microphone level of the sender. {@link read} is cheap enough for every animation frame.
 */
export class StreamLevelMeter {
  readonly #analyser: AnalyserNode;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #buffer: Float32Array<ArrayBuffer>;
  readonly #owned: boolean;

  /** The context is created here unless one is given; a context given by the caller is not closed by {@link dispose}. */
  constructor(stream: MediaStream, context?: AudioContext) {
    this.#owned = context === undefined;
    const audio = context ?? new AudioContext();
    this.context = audio;
    this.#analyser = audio.createAnalyser();
    this.#analyser.fftSize = ANALYSER_FFT_SIZE;
    this.#buffer = levelBuffer(this.#analyser.fftSize);
    this.#source = audio.createMediaStreamSource(stream);
    this.#source.connect(this.#analyser);
  }

  /** The audio context of the meter. */
  readonly context: AudioContext;

  /** Peak level of the last ~85 ms in dBFS. */
  read(): number {
    return analyserPeakDb(this.#analyser, this.#buffer);
  }

  /** Disconnects the meter and closes its context. */
  dispose(): void {
    this.#source.disconnect();
    this.#analyser.disconnect();
    if (this.#owned) {
      void this.context.close().catch(() => undefined);
    }
  }
}
