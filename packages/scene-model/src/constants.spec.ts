import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_FADE_MS,
  DEFAULT_HOLD_MS,
  FADE_DURATIONS_MS,
  HOLD_OPTIONS,
  ITEM_BOUNDS,
  LIMITS,
  NEW_ITEM_RECT,
  ROTATIONS,
} from './constants';

describe('constants', () => {
  it('describes a 16:9 canvas', () => {
    expect(CANVAS_WIDTH / CANVAS_HEIGHT).toBeCloseTo(16 / 9, 10);
  });

  it('offers the fade durations of the spec with 300 ms as default', () => {
    expect(FADE_DURATIONS_MS).toEqual([200, 300, 500, 800, 1000, 1500, 2000]);
    expect(FADE_DURATIONS_MS).toContain(DEFAULT_FADE_MS);
  });

  it('offers the three "On failure" options, the default first', () => {
    expect(HOLD_OPTIONS.map((option) => option.holdMs)).toEqual([3000, 10000, null]);
    expect(HOLD_OPTIONS[0].holdMs).toBe(DEFAULT_HOLD_MS);
    for (const option of HOLD_OPTIONS) {
      expect(option.holdMs === null || option.holdMs <= ITEM_BOUNDS.maxHoldMs).toBe(true);
    }
  });

  it('places a new item inside the bounds and on the canvas', () => {
    expect(NEW_ITEM_RECT.x + NEW_ITEM_RECT.w).toBeLessThanOrEqual(CANVAS_WIDTH);
    expect(NEW_ITEM_RECT.y + NEW_ITEM_RECT.h).toBeLessThanOrEqual(CANVAS_HEIGHT);
    expect(NEW_ITEM_RECT.w).toBeGreaterThanOrEqual(ITEM_BOUNDS.minW);
    expect(NEW_ITEM_RECT.h).toBeGreaterThanOrEqual(ITEM_BOUNDS.minH);
  });

  it('mirrors the server limits', () => {
    expect(LIMITS.itemsPerScene).toBe(32);
    expect(LIMITS.scenesPerProduction).toBe(99);
    expect(LIMITS.recentLogEntries).toBe(20);
    expect(LIMITS.usernameLength).toBe(64);
    expect([LIMITS.passwordMinLength, LIMITS.passwordMaxLength]).toEqual([12, 256]);
    expect(ROTATIONS).toEqual([0, 90, 180, 270]);
    expect(ITEM_BOUNDS.maxCropPerSide * 2).toBe(ITEM_BOUNDS.maxCropPerAxis);
  });
});
