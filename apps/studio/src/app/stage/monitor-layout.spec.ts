import { monitorWidths, type MonitorLayoutInput } from './monitor-layout';

const DESKTOP: MonitorLayoutInput = {
  width: 1408,
  height: 431,
  studio: false,
  split: 0.5,
  heightBound: true,
  fullWidth: false,
};

describe('monitorWidths', () => {
  it('without Studio-Modus: one Program monitor limited by width or height', () => {
    // 1440 × 900: the height limits ((431 − 56) × 16/9 = 666).
    expect(monitorWidths(DESKTOP)).toEqual({ preview: 0, program: 666 });
    // A tall stage: the width limits (1408 − 192).
    expect(monitorWidths({ ...DESKTOP, height: 2000 })).toEqual({ preview: 0, program: 1216 });
  });

  it('with Studio-Modus: the split shares the width, the height still limits', () => {
    // (1408 − 212) / 2 = 598 each, below the height limit.
    expect(monitorWidths({ ...DESKTOP, studio: true })).toEqual({ preview: 598, program: 598 });
    expect(monitorWidths({ ...DESKTOP, studio: true, split: 0.3 })).toEqual({
      preview: 358,
      program: 666,
    });
    // Out-of-range splits are clamped to 0.3–0.7.
    expect(monitorWidths({ ...DESKTOP, studio: true, split: 0.95 })).toEqual(
      monitorWidths({ ...DESKTOP, studio: true, split: 0.7 }),
    );
  });

  it('never returns a size that overflows the stage', () => {
    for (const width of [300, 800, 1248, 1888]) {
      for (const height of [160, 400, 700, 1000]) {
        for (const studio of [false, true]) {
          const result = monitorWidths({ ...DESKTOP, width, height, studio, split: 0.6 });
          const total = result.preview + result.program + 192 + (studio ? 20 : 0);
          expect(total).toBeLessThanOrEqual(Math.max(width, 192 + (studio ? 20 : 0)));
          expect((Math.max(result.preview, result.program) * 9) / 16 + 56).toBeLessThanOrEqual(
            Math.max(height, 56),
          );
        }
      }
    }
  });

  it('ignores the height when stacked (≤ 1180 px)', () => {
    expect(monitorWidths({ ...DESKTOP, width: 1068, height: 0, heightBound: false })).toEqual({
      preview: 0,
      program: 876,
    });
  });

  it('uses the full width when narrow (≤ 900 px)', () => {
    expect(monitorWidths({ ...DESKTOP, width: 358, fullWidth: true, studio: true })).toEqual({
      preview: 358,
      program: 358,
    });
  });

  it('handles unmeasured and malformed sizes', () => {
    expect(monitorWidths({ ...DESKTOP, width: 0, height: 0 })).toEqual({ preview: 0, program: 0 });
    expect(monitorWidths({ ...DESKTOP, width: Number.NaN })).toEqual({ preview: 0, program: 0 });
    expect(monitorWidths({ ...DESKTOP, studio: true, split: Number.NaN })).toEqual({
      preview: 598,
      program: 598,
    });
  });
});
