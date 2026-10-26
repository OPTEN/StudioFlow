import { FakeAnalyserNode, FakeAudioContext, FakeStreamSource } from '../testing/fake-audio';
import { FakeMediaStream, FakeMediaStreamTrack } from '../testing/fake-livekit';
import { SILENCE_DB, StreamLevelMeter, analyserPeakDb, levelBuffer, peakDb } from './level';

describe('peakDb', () => {
  it('is the peak of the samples in dBFS', () => {
    expect(peakDb(Float32Array.of(0, 0.5, -0.25))).toBeCloseTo(-6.02, 1);
    expect(peakDb(Float32Array.of(-1, 0.2))).toBeCloseTo(0, 6);
    expect(peakDb(Float32Array.of(0.1))).toBeCloseTo(-20, 6);
  });

  it('reads silence for no signal and floors anything quieter', () => {
    expect(peakDb(new Float32Array(16))).toBe(SILENCE_DB);
    expect(peakDb(new Float32Array(0))).toBe(SILENCE_DB);
    expect(peakDb(Float32Array.of(1e-9))).toBe(SILENCE_DB);
  });

  it('reads an analyser into a reusable buffer', () => {
    const analyser = new FakeAnalyserNode();
    analyser.fftSize = 64;
    analyser.setPeak(0.1);
    const buffer = levelBuffer(64);
    expect(analyserPeakDb(analyser as unknown as AnalyserNode, buffer)).toBeCloseTo(-20, 6);
    analyser.signal = new Float32Array(0);
    expect(analyserPeakDb(analyser as unknown as AnalyserNode, buffer)).toBe(SILENCE_DB);
  });
});

describe('StreamLevelMeter', () => {
  function stream(): MediaStream {
    return new FakeMediaStream(new FakeMediaStreamTrack('audio').asTrack) as unknown as MediaStream;
  }

  it('measures a stream on a context it was given and leaves that context open', () => {
    const context = new FakeAudioContext();
    const meter = new StreamLevelMeter(stream(), context.asContext);
    const analyser = context.analysers[0];
    expect(context.sources[0]).toBeInstanceOf(FakeStreamSource);
    expect(context.sources[0].connectsTo(analyser)).toBe(true);

    analyser.setPeak(0.5);
    expect(meter.read()).toBeCloseTo(-6.02, 1);
    analyser.signal = new Float32Array(0);
    expect(meter.read()).toBe(SILENCE_DB);

    meter.dispose();
    expect(context.sources[0].disconnected).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('creates and closes its own context otherwise', () => {
    const context = new FakeAudioContext();
    vi.stubGlobal('AudioContext', function AudioContextStub() {
      return context;
    });
    try {
      const meter = new StreamLevelMeter(stream());
      meter.dispose();
      expect(context.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
