import { AUDIO_SILENCE_DB, AUDIO_SILENCE_WARNING_MS } from './audio';
import { SilenceTracker, type SilenceReading } from './audio-silence';

const MIC = 'dev_aaaaaaaaaaaaaaaa/mic';
const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';

function reading(overrides: Partial<SilenceReading> = {}): SilenceReading {
  return { sourceId: MIC, audible: true, hasSound: true, levelDb: -90, ...overrides };
}

describe('SilenceTracker', () => {
  it('warns when an audible channel has been silent for 10 seconds, not before', () => {
    const tracker = new SilenceTracker();
    expect(tracker.update(0, [reading()]).size).toBe(0);
    expect(tracker.update(AUDIO_SILENCE_WARNING_MS - 1, [reading()]).size).toBe(0);
    expect([...tracker.update(AUDIO_SILENCE_WARNING_MS, [reading()])]).toEqual([MIC]);
    expect([...tracker.update(AUDIO_SILENCE_WARNING_MS * 3, [reading()])]).toEqual([MIC]);
  });

  it('starts over with every sound above the threshold', () => {
    const tracker = new SilenceTracker();
    tracker.update(0, [reading()]);
    tracker.update(8000, [reading({ levelDb: -30 })]);
    expect(tracker.update(12_000, [reading()]).size).toBe(0);
    expect(tracker.update(22_000, [reading()]).has(MIC)).toBe(true);
  });

  it('treats a level exactly at the threshold as sound', () => {
    const tracker = new SilenceTracker();
    tracker.update(0, [reading({ levelDb: AUDIO_SILENCE_DB })]);
    expect(tracker.update(60_000, [reading({ levelDb: AUDIO_SILENCE_DB })]).size).toBe(0);
  });

  it('never warns for channels that are not audible or have no sound to measure', () => {
    const tracker = new SilenceTracker();
    const readings = [reading({ audible: false }), reading({ sourceId: SCREEN, hasSound: false })];
    tracker.update(0, readings);
    expect(tracker.update(60_000, readings).size).toBe(0);
  });

  it('starts counting again when a channel becomes audible, and forgets channels that are gone', () => {
    const tracker = new SilenceTracker();
    tracker.update(0, [reading({ audible: false })]);
    expect(tracker.update(30_000, [reading()]).size).toBe(0);
    expect(tracker.update(40_000, [reading()]).size).toBe(1);

    tracker.update(41_000, []);
    expect(tracker.update(45_000, [reading()]).size).toBe(0);
  });

  it('tracks channels independently', () => {
    const tracker = new SilenceTracker();
    tracker.update(0, [reading(), reading({ sourceId: SCREEN, levelDb: -20 })]);
    const silent = tracker.update(10_000, [reading(), reading({ sourceId: SCREEN, levelDb: -20 })]);
    expect([...silent]).toEqual([MIC]);
  });

  it('takes its limits from the options and can be reset', () => {
    const tracker = new SilenceTracker({ thresholdDb: -40, afterMs: 1000 });
    tracker.update(0, [reading({ levelDb: -50 })]);
    expect(tracker.update(1000, [reading({ levelDb: -50 })]).size).toBe(1);
    tracker.reset();
    expect(tracker.update(1500, [reading({ levelDb: -50 })]).size).toBe(0);
  });
});
