/*
 * Audio probe (issue #7), injected with context.addInitScript. It listens to what a page sends to its speakers: every
 * node that is connected to the destination of an AudioContext is also connected to an analyser, and
 * window.__sfAudioProbe.measure() reads peak, RMS and the spectrum of that. The page does not know about it. None of this
 * ships in the product.
 *
 * measure(index?) -> { state, sampleRate, peakDb, rmsDb, frequency, peaks } | null
 *   peakDb / rmsDb   level of the last 1024 samples (21 ms) in dBFS (-100 for silence)
 *   frequency        dominant frequency in Hz, null below -60 dBFS
 *   peaks            [{frequency, db}] local maxima of the spectrum of the last 8192 samples within 30 dB of the strongest one
 * The context is the one with the given index, by default the last one that has a node connected to its destination.
 */
(function () {
  if (window.__sfAudioProbe) return;
  const records = [];
  const probe = (window.__sfAudioProbe = {
    records,
    /** Number of contexts that play something. */
    count() {
      return records.length;
    },
    measure(index) {
      const record = index === undefined ? records[records.length - 1] : records[index];
      if (!record) return null;
      const analyser = record.analyser;
      // Level from the short window (1024 samples, 21 ms), spectrum from the long one (8192 samples, 170 ms).
      const time = new Float32Array(record.level.fftSize);
      record.level.getFloatTimeDomainData(time);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < time.length; i += 1) {
        const value = Math.abs(time[i]);
        if (value > peak) peak = value;
        sum += value * value;
      }
      const toDb = (value) => (value <= 0 ? -100 : Math.max(-100, 20 * Math.log10(value)));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const sampleRate = record.context.sampleRate;
      const hz = (bin) => (bin * sampleRate) / analyser.fftSize;
      let best = 1;
      for (let i = 2; i < bins.length - 1; i += 1) if (bins[i] > bins[best]) best = i;
      const peaks = [];
      for (let i = 2; i < bins.length - 1; i += 1) {
        if (bins[i] > bins[i - 1] && bins[i] >= bins[i + 1] && bins[i] > bins[best] - 30) {
          // Parabolic interpolation between the bins for a frequency finer than the bin width.
          const a = bins[i - 1];
          const b = bins[i];
          const c = bins[i + 1];
          const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1);
          peaks.push({ frequency: Math.round(hz(i + shift) * 10) / 10, db: Math.round(b * 10) / 10 });
        }
      }
      peaks.sort((x, y) => y.db - x.db);
      const peakDb = toDb(peak);
      return {
        state: record.context.state,
        sampleRate,
        peakDb,
        rmsDb: toDb(Math.sqrt(sum / time.length)),
        frequency: peakDb > -60 && peaks.length ? peaks[0].frequency : null,
        peaks: peakDb > -60 ? peaks : [],
      };
    },
    /**
     * Polls every 10 ms and resolves with `Date.now()` at the first moment `test(measurement)` is true (rejects after
     * timeoutMs). `test` is the source of a function.
     */
    waitFor(testSource, timeoutMs) {
      const test = new Function('m', 'return (' + testSource + ')(m);');
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const timer = setInterval(() => {
          const measurement = probe.measure();
          if (test(measurement)) {
            clearInterval(timer);
            resolve(Date.now());
          } else if (performance.now() - started > (timeoutMs || 10000)) {
            clearInterval(timer);
            reject(new Error('audio probe: condition not met within ' + (timeoutMs || 10000) + ' ms'));
          }
        }, 10);
      });
    },
    /**
     * Strength of one frequency in dB (spectrum of the last 8192 samples = 170 ms, the strongest bin within spanHz of it).
     * The scale is the analyser's, not dBFS: only compare values of the same frequency. -120 when nothing plays.
     */
    toneDb(frequency, spanHz) {
      const record = records[records.length - 1];
      if (!record) return -120;
      const analyser = record.analyser;
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const span = spanHz || 20;
      const rate = record.context.sampleRate;
      const low = Math.max(1, Math.floor(((frequency - span) * analyser.fftSize) / rate));
      const high = Math.min(bins.length - 1, Math.ceil(((frequency + span) * analyser.fftSize) / rate));
      let best = -120;
      for (let i = low; i <= high; i += 1) if (bins[i] > best) best = bins[i];
      return Math.max(-120, best);
    },
    /** `n` readings of {@link toneDb} `everyMs` apart for each of the given frequencies. */
    toneSeries(frequencies, n, everyMs) {
      return new Promise((resolve) => {
        const out = [];
        const timer = setInterval(() => {
          out.push({ at: Date.now(), db: frequencies.map((f) => probe.toneDb(f)) });
          if (out.length >= n) {
            clearInterval(timer);
            resolve(out);
          }
        }, everyMs);
      });
    },
    /** `n` measurements `everyMs` apart (peak level over time, e.g. for a fade). */
    series(n, everyMs) {
      return new Promise((resolve) => {
        const out = [];
        const timer = setInterval(() => {
          const m = probe.measure();
          out.push({ at: Date.now(), peakDb: m ? m.peakDb : null, rmsDb: m ? m.rmsDb : null });
          if (out.length >= n) {
            clearInterval(timer);
            resolve(out);
          }
        }, everyMs);
      });
    },
  });

  /*
   * Autoplay gate (window.__sfAudioProbe.gate = true, set before the page starts): every AudioContext made before the first
   * trusted click, key press or touch of the page stays suspended and its resume() waits for that gesture, as in a browser
   * window that a person opened. Playwright's own evaluations and navigations count as user activation in Chromium, so
   * without the gate a page of these tests would never stay blocked.
   */
  probe.gate = false;
  let gestured = false;
  const waiting = [];
  const unlock = (event) => {
    if (!event.isTrusted || gestured) return;
    gestured = true;
    for (const open of waiting.splice(0)) open();
  };
  for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click']) {
    window.addEventListener(type, unlock, true);
  }
  const stateOf = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get;
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = new Proxy(NativeAudioContext, {
    construct(target, args, newTarget) {
      const context = Reflect.construct(target, args, newTarget);
      if (!probe.gate || gestured) return context;
      let open = false;
      const nativeResume = context.resume;
      Object.defineProperty(context, 'state', {
        configurable: true,
        get: () => (open ? stateOf.call(context) : 'suspended'),
      });
      context.suspend().catch(() => undefined);
      context.resume = function () {
        if (open) return nativeResume.call(context);
        return new Promise((resolve) => {
          waiting.push(() => {
            open = true;
            resolve(nativeResume.call(context));
          });
        });
      };
      return context;
    },
  });

  const recordOf = (context) => {
    let record = records.find((entry) => entry.context === context);
    if (!record) {
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      const level = context.createAnalyser();
      level.fftSize = 1024;
      level.smoothingTimeConstant = 0;
      record = { context, analyser, level };
      records.push(record);
    }
    return record;
  };

  const nativeConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination) {
    const result = nativeConnect.apply(this, arguments);
    try {
      if (typeof AudioDestinationNode === 'function' && destination instanceof AudioDestinationNode) {
        const record = recordOf(this.context);
        nativeConnect.call(this, record.analyser);
        nativeConnect.call(this, record.level);
      }
    } catch (e) {
      // the probe must never break the page
    }
    return result;
  };
})();
