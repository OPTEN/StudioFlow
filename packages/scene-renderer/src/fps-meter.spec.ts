import { FpsMeter } from './fps-meter';

/** A video with the playback counters of a browser. */
function video(): { element: HTMLVideoElement; counters: { total: number; dropped: number } } {
  const element = document.createElement('video');
  const counters = { total: 0, dropped: 0 };
  Object.defineProperty(element, 'getVideoPlaybackQuality', {
    value: () => ({ totalVideoFrames: counters.total, droppedVideoFrames: counters.dropped }),
    configurable: true,
  });
  return { element, counters };
}

describe('FpsMeter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads nothing on the first call, then the frames presented per second', async () => {
    const meter = new FpsMeter();
    const { element, counters } = video();
    expect(meter.read([element])).toEqual({ fps: 0, presented: 0, dropped: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    counters.total = 60;
    counters.dropped = 2;
    expect(meter.read([element])).toEqual({ fps: 30, presented: 60, dropped: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    counters.total = 90;
    expect(meter.read([element])).toEqual({ fps: 15, presented: 90, dropped: 2 });
  });

  it('gives several readers the same rate and cumulative counts', async () => {
    const meter = new FpsMeter();
    const { element, counters } = video();
    meter.read([element]);
    await vi.advanceTimersByTimeAsync(1000);
    counters.total = 30;
    const report = meter.read([element]);
    await vi.advanceTimersByTimeAsync(1000);
    counters.total = 60;
    const debug = meter.read([element]);
    // The debug panel reading in between does not take frames away from the report: the counts only grow.
    expect(report.presented).toBe(30);
    expect(debug.presented).toBe(60);
    expect(debug.fps).toBe(30);
  });

  it('takes the busiest video for the rate and adds up the frames', async () => {
    const meter = new FpsMeter();
    const a = video();
    const b = video();
    meter.read([a.element, b.element]);
    await vi.advanceTimersByTimeAsync(1000);
    a.counters.total = 15;
    b.counters.total = 30;
    expect(meter.read([a.element, b.element])).toEqual({ fps: 30, presented: 45, dropped: 0 });
  });

  it('measures a video that appeared later only from its second reading', async () => {
    const meter = new FpsMeter();
    const first = video();
    meter.read([first.element]);
    await vi.advanceTimersByTimeAsync(1000);
    const late = video();
    late.counters.total = 500;
    first.counters.total = 10;
    expect(meter.read([first.element, late.element])).toEqual({
      fps: 10,
      presented: 10,
      dropped: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    late.counters.total = 530;
    const reading = meter.read([late.element]);
    expect(reading.fps).toBe(30);
    expect(reading.presented).toBe(40);
  });

  it('starts over with a counter that went back (the element started again) and skips videos without the API', async () => {
    const meter = new FpsMeter();
    const { element, counters } = video();
    counters.total = 100;
    meter.read([element]);
    await vi.advanceTimersByTimeAsync(1000);
    counters.total = 5;
    expect(meter.read([element])).toEqual({ fps: 0, presented: 0, dropped: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    counters.total = 35;
    expect(meter.read([element])).toEqual({ fps: 30, presented: 30, dropped: 0 });
    const plain = document.createElement('video');
    Object.defineProperty(plain, 'getVideoPlaybackQuality', {
      value: undefined,
      configurable: true,
    });
    const broken = document.createElement('video');
    Object.defineProperty(broken, 'getVideoPlaybackQuality', {
      value: () => {
        throw new Error('detached');
      },
      configurable: true,
    });
    expect(meter.read([plain, broken])).toMatchObject({ fps: 0 });
  });

  it('reports 0 without video and never starts a timer or an animation frame loop', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const meter = new FpsMeter();
    expect(meter.read([])).toEqual({ fps: 0, presented: 0, dropped: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(meter.read([])).toEqual({ fps: 0, presented: 0, dropped: 0 });
    expect(vi.getTimerCount()).toBe(0);
    expect(raf).not.toHaveBeenCalled();
  });
});
