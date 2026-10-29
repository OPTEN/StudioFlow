import { DEFAULT_CANVAS, canvasSize } from '@studioflow/scene-model';
import {
  MAX_STACKED_MONITOR_HEIGHT_PX,
  monitorWidths,
  type MonitorLayoutInput,
} from './monitor-layout';

const DESKTOP: MonitorLayoutInput = {
  canvas: DEFAULT_CANVAS,
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
    // A tall stage: the width limits (1408 − 196).
    expect(monitorWidths({ ...DESKTOP, height: 2000 })).toEqual({ preview: 0, program: 1212 });
  });

  it('with Studio-Modus: the split shares the width, the height still limits', () => {
    // (1408 − 216) / 2 = 596 each, below the height limit.
    expect(monitorWidths({ ...DESKTOP, studio: true })).toEqual({ preview: 596, program: 596 });
    expect(monitorWidths({ ...DESKTOP, studio: true, split: 0.3 })).toEqual({
      preview: 357,
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
          const total = result.preview + result.program + 196 + (studio ? 20 : 0);
          expect(total).toBeLessThanOrEqual(Math.max(width, 196 + (studio ? 20 : 0)));
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
      program: 872,
    });
  });

  it('uses the full width when narrow (≤ 900 px)', () => {
    expect(monitorWidths({ ...DESKTOP, width: 358, fullWidth: true, studio: true })).toEqual({
      preview: 358,
      program: 358,
    });
  });

  describe('other shapes of the canvas', () => {
    const PORTRAIT = canvasSize('portrait', 'p1080');
    const SQUARE = canvasSize('square', 'p1080');
    const STANDARD = canvasSize('standard', 'p1080');

    it('sizes a portrait Program monitor from the height: narrow, however wide the stage is', () => {
      // (431 − 56) × 1080/1920 = 210.
      expect(monitorWidths({ ...DESKTOP, canvas: PORTRAIT })).toEqual({ preview: 0, program: 210 });
      expect(monitorWidths({ ...DESKTOP, canvas: PORTRAIT, width: 4000 })).toEqual({
        preview: 0,
        program: 210,
      });
    });

    it('lets a portrait monitor grow with a taller stage and stops at the width', () => {
      expect(monitorWidths({ ...DESKTOP, canvas: PORTRAIT, height: 800 })).toEqual({
        preview: 0,
        program: 418,
      });
      expect(monitorWidths({ ...DESKTOP, canvas: PORTRAIT, width: 300, height: 2000 })).toEqual({
        preview: 0,
        program: 104,
      });
    });

    it('sizes square and 4:3 monitors by the same rules', () => {
      expect(monitorWidths({ ...DESKTOP, canvas: SQUARE })).toEqual({ preview: 0, program: 375 });
      expect(monitorWidths({ ...DESKTOP, canvas: STANDARD })).toEqual({ preview: 0, program: 500 });
    });

    it('shares the width in Studio Mode and limits each monitor by the height', () => {
      expect(monitorWidths({ ...DESKTOP, canvas: PORTRAIT, studio: true })).toEqual({
        preview: 210,
        program: 210,
      });
    });

    it('never makes a monitor taller than the stage, whatever the shape', () => {
      for (const canvas of [DEFAULT_CANVAS, PORTRAIT, SQUARE, STANDARD]) {
        for (const height of [160, 400, 700, 1000]) {
          const { program } = monitorWidths({ ...DESKTOP, canvas, height, width: 1888 });
          expect((program * canvas.height) / canvas.width + 56).toBeLessThanOrEqual(
            Math.max(height, 56),
          );
        }
      }
    });

    it('limits a stacked portrait monitor to 720 px of height', () => {
      const stacked = { ...DESKTOP, heightBound: false, width: 1068 };

      expect(MAX_STACKED_MONITOR_HEIGHT_PX).toBe(720);
      expect(monitorWidths({ ...stacked, canvas: PORTRAIT })).toEqual({ preview: 0, program: 405 });
      expect(monitorWidths({ ...stacked, canvas: DEFAULT_CANVAS })).toEqual({
        preview: 0,
        program: 872,
      });
    });

    it('limits a narrow portrait monitor the same way and leaves 16:9 at the full width', () => {
      const narrow = { ...DESKTOP, heightBound: false, fullWidth: true, studio: true };

      expect(monitorWidths({ ...narrow, width: 358, canvas: PORTRAIT })).toEqual({
        preview: 358,
        program: 358,
      });
      expect(monitorWidths({ ...narrow, width: 800, canvas: PORTRAIT })).toEqual({
        preview: 405,
        program: 405,
      });
      expect(monitorWidths({ ...narrow, width: 800 })).toEqual({ preview: 800, program: 800 });
    });
  });

  it('handles unmeasured and malformed sizes', () => {
    expect(monitorWidths({ ...DESKTOP, width: 0, height: 0 })).toEqual({ preview: 0, program: 0 });
    expect(monitorWidths({ ...DESKTOP, width: Number.NaN })).toEqual({ preview: 0, program: 0 });
    expect(monitorWidths({ ...DESKTOP, studio: true, split: Number.NaN })).toEqual({
      preview: 596,
      program: 596,
    });
  });
});
