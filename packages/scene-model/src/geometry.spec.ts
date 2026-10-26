import { DEFAULT_CANVAS as CANVAS } from './canvas';
import { ITEM_BOUNDS, NEW_ITEM_RECT } from './constants';
import {
  clampItem,
  clampRectToCanvas,
  createItemId,
  newItem,
  rectCenter,
  rectIntersects,
  rectOf,
  rectsEqual,
  snapRotation,
  validateItem,
} from './geometry';
import { itemFixture } from './testing/fixtures';

describe('clampItem', () => {
  it('keeps a valid item unchanged (but returns a copy)', () => {
    const item = itemFixture('itm_1', 'dev_k1aaaa/camera', {
      crop: { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
      border: { width: 4, color: '#ff0000' },
    });
    const clamped = clampItem(item);
    expect(clamped).toEqual(item);
    expect(clamped).not.toBe(item);
  });

  it('rounds and clamps the geometry to the item bounds', () => {
    const clamped = clampItem(itemFixture('i', 's', { x: -5000.4, y: 9999, w: 3.2, h: 2160.6 }));
    expect(clamped).toMatchObject({
      x: ITEM_BOUNDS.minX,
      y: ITEM_BOUNDS.maxY,
      w: ITEM_BOUNDS.minW,
      h: ITEM_BOUNDS.maxH,
    });
    expect(clampItem(itemFixture('i', 's', { x: 10.5, w: 600.4 }))).toMatchObject({
      x: 11,
      w: 600,
    });
  });

  it('clamps infinities to the bounds and replaces NaN by the new-item defaults', () => {
    const clamped = clampItem(
      itemFixture('i', 's', {
        x: Number.NaN,
        y: Number.NEGATIVE_INFINITY,
        w: Number.POSITIVE_INFINITY,
        h: Number.NaN,
      }),
    );
    expect(clamped).toMatchObject({
      x: NEW_ITEM_RECT.x,
      y: ITEM_BOUNDS.minY,
      w: ITEM_BOUNDS.maxW,
      h: NEW_ITEM_RECT.h,
    });
  });

  it('clamps each crop side to [0, 0.45]', () => {
    const clamped = clampItem(
      itemFixture('i', 's', { crop: { top: -0.2, right: 0.8, bottom: Number.NaN, left: 0.1 } }),
    );
    expect(clamped.crop).toEqual({ top: 0, right: 0.45, bottom: 0, left: 0.1 });
  });

  it('scales a full crop axis below 0.9, proportionally', () => {
    const clamped = clampItem(
      itemFixture('i', 's', { crop: { top: 0.45, right: 0.45, bottom: 0.45, left: 0.3 } }),
    );
    expect(clamped.crop.top + clamped.crop.bottom).toBeLessThan(0.9);
    expect(clamped.crop.top).toBeCloseTo(clamped.crop.bottom, 10);
    expect(clamped.crop.left + clamped.crop.right).toBeLessThan(0.9);
    expect(clamped.crop.right / clamped.crop.left).toBeCloseTo(0.45 / 0.3, 10);
    expect(validateItem(clamped)).toEqual([]);
  });

  it('keeps a crop axis just below the limit', () => {
    const clamped = clampItem(
      itemFixture('i', 's', { crop: { top: 0.45, right: 0, bottom: 0.44, left: 0 } }),
    );
    expect(clamped.crop).toMatchObject({ top: 0.45, bottom: 0.44 });
  });

  it('clamps and rounds the radius', () => {
    expect(clampItem(itemFixture('i', 's', { radius: 250 })).radius).toBe(200);
    expect(clampItem(itemFixture('i', 's', { radius: -3 })).radius).toBe(0);
    expect(clampItem(itemFixture('i', 's', { radius: 12.6 })).radius).toBe(13);
    expect(clampItem(itemFixture('i', 's', { radius: Number.NaN })).radius).toBe(0);
  });

  it('snaps the rotation', () => {
    expect(clampItem(itemFixture('i', 's', { rotation: 100 })).rotation).toBe(90);
    expect(clampItem(itemFixture('i', 's', { rotation: -90 })).rotation).toBe(270);
  });

  it('clamps the border width and keeps a null border', () => {
    expect(
      clampItem(itemFixture('i', 's', { border: { width: 0, color: '#000000' } })).border,
    ).toEqual({ width: 1, color: '#000000' });
    expect(
      clampItem(itemFixture('i', 's', { border: { width: 99.7, color: '#000000' } })).border?.width,
    ).toBe(40);
    expect(clampItem(itemFixture('i', 's', { border: null })).border).toBeNull();
  });

  it('clamps the hold time and keeps "hold forever"', () => {
    const hold = (holdMs: number | null): number | null =>
      clampItem(itemFixture('i', 's', { onLost: { holdMs, fallbackSource: null } })).onLost.holdMs;
    expect(hold(-1)).toBe(0);
    expect(hold(1_000_000)).toBe(ITEM_BOUNDS.maxHoldMs);
    expect(hold(2999.6)).toBe(3000);
    expect(hold(null)).toBeNull();
  });

  it('always produces an item that passes validation', () => {
    const wild = itemFixture('i', 's', {
      x: 1e9,
      y: -1e9,
      w: -10,
      h: 0,
      crop: { top: 9, right: 9, bottom: 9, left: 9 },
      radius: 1e6,
      rotation: 45.5,
      border: { width: -4, color: '#abcdef' },
      onLost: { holdMs: -100, fallbackSource: null },
    });
    expect(validateItem(clampItem(wild))).toEqual([]);
  });

  it('does not mutate its input', () => {
    const item = itemFixture('i', 's', {
      x: 99999,
      crop: { top: 1, right: 1, bottom: 1, left: 1 },
    });
    const copy = structuredClone(item);
    clampItem(item);
    expect(item).toEqual(copy);
  });
});

describe('snapRotation', () => {
  it.each([
    [0, 0],
    [44, 0],
    [45, 90],
    [90, 90],
    [180, 180],
    [269, 270],
    [315, 0],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-10, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('%s° → %s°', (input, expected) => {
    expect(snapRotation(input)).toBe(expected);
  });
});

describe('validateItem', () => {
  it('accepts a valid item', () => {
    expect(validateItem(itemFixture('itm_1', 'dev_k1aaaa/camera'))).toEqual([]);
  });

  it('reports every geometry violation', () => {
    const messages = validateItem(
      itemFixture('itm_1', 's', { x: 4000, y: -3000, w: 10, h: 2200, radius: 201 }),
    );
    expect(messages).toEqual([
      'X position must be a whole number between -3840 and 3840.',
      'Y position must be a whole number between -2160 and 2160.',
      'Width must be a whole number between 16 and 3840.',
      'Height must be a whole number between 16 and 2160.',
      'Corner radius must be a whole number between 0 and 200.',
    ]);
  });

  it('rejects fractional and non-finite geometry', () => {
    expect(validateItem(itemFixture('i', 's', { x: 1.5 }))).toHaveLength(1);
    expect(validateItem(itemFixture('i', 's', { w: Number.NaN }))).toHaveLength(1);
  });

  it('accepts the exact bounds', () => {
    expect(
      validateItem(itemFixture('i', 's', { x: -3840, y: 2160, w: 3840, h: 16, radius: 200 })),
    ).toEqual([]);
  });

  it('reports crop sides and axes', () => {
    expect(
      validateItem(itemFixture('i', 's', { crop: { top: 0.5, right: 0, bottom: 0, left: -0.1 } })),
    ).toEqual(['Crop top must be between 0 and 0.45.', 'Crop left must be between 0 and 0.45.']);
    expect(
      validateItem(
        itemFixture('i', 's', { crop: { top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 } }),
      ),
    ).toEqual([
      'Crop top and bottom together must be less than 0.9.',
      'Crop left and right together must be less than 0.9.',
    ]);
  });

  it('reports rotation, fit, border and hold time', () => {
    const item = itemFixture('i', 's', {
      rotation: 45,
      fit: 'stretch' as 'cover',
      border: { width: 41, color: 'red' },
      onLost: { holdMs: 600_001, fallbackSource: null },
    });
    expect(validateItem(item)).toEqual([
      'Fit must be “Fill” or “Show all”.',
      'Rotation must be 0, 90, 180 or 270 degrees.',
      'Border width must be a whole number between 1 and 40.',
      'The border colour must be a hex colour like #e3b341.',
      'The freeze frame duration must be between 0 and 600 s (whole milliseconds).',
    ]);
  });

  it('accepts "hold forever" and the hold time bounds', () => {
    expect(
      validateItem(itemFixture('i', 's', { onLost: { holdMs: null, fallbackSource: null } })),
    ).toEqual([]);
    expect(
      validateItem(itemFixture('i', 's', { onLost: { holdMs: 0, fallbackSource: null } })),
    ).toEqual([]);
    expect(
      validateItem(itemFixture('i', 's', { onLost: { holdMs: 600_000, fallbackSource: null } })),
    ).toEqual([]);
  });

  it('rejects the own source as fallback and unknown fallbacks when a lookup is given', () => {
    const own = itemFixture('i', 'dev_a/camera', {
      onLost: { holdMs: 3000, fallbackSource: 'dev_a/camera' },
    });
    expect(validateItem(own)).toEqual(['The fallback source cannot be the item’s own source.']);
    const other = itemFixture('i', 'dev_a/camera', {
      onLost: { holdMs: 3000, fallbackSource: 'ast_pause' },
    });
    expect(validateItem(other)).toEqual([]);
    expect(validateItem(other, (id) => id === 'ast_pause')).toEqual([]);
    expect(validateItem(other, () => false)).toEqual(['The fallback source does not exist.']);
  });

  it('reports a missing id and source', () => {
    expect(validateItem(itemFixture('', ''))).toEqual([
      'The item ID is missing.',
      'The item has no source.',
    ]);
  });
});

describe('newItem', () => {
  it('uses the server defaults with contain for screens', () => {
    expect(newItem('dev_l/screen-1', 'screen', 'itm_x', CANVAS)).toEqual({
      id: 'itm_x',
      source: 'dev_l/screen-1',
      x: 1240,
      y: 680,
      w: 600,
      h: 338,
      fit: 'contain',
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      radius: 12,
      mirror: false,
      rotation: 0,
      hidden: false,
      locked: false,
      border: null,
      onLost: { holdMs: 3000, fallbackSource: null },
    });
  });

  it.each([
    ['lowerThird', { x: 80, y: 820, w: 960, h: 180 }],
    ['title', { x: 160, y: 390, w: 1600, h: 300 }],
    ['note', { x: 1320, y: 60, w: 540, h: 96 }],
  ] as const)(
    'places a %s hidden, without corners, in the rectangle of its style',
    (style, rect) => {
      const item = newItem('txt_abcd1234', 'text', 'itm_t', CANVAS, style);

      expect(item).toMatchObject({ ...rect, radius: 0, hidden: true });
      expect(validateItem(item)).toEqual([]);
    },
  );

  it('starts a text without a style as a lower third', () => {
    expect(newItem('txt_abcd1234', 'text', 'itm_t', CANVAS)).toMatchObject({ x: 80, y: 820 });
  });

  it.each(['camera', 'image', 'video', undefined] as const)('uses cover for %s', (kind) => {
    expect(newItem('src', kind, 'itm_y', CANVAS).fit).toBe('cover');
  });

  it('passes validation and does not share nested objects between items', () => {
    const a = newItem('src', 'camera', 'itm_a', CANVAS);
    const b = newItem('src', 'camera', 'itm_b', CANVAS);
    expect(validateItem(a)).toEqual([]);
    expect(a.crop).not.toBe(b.crop);
    expect(a.onLost).not.toBe(b.onLost);
  });
});

describe('createItemId', () => {
  it('creates prefixed ids of 16 lowercase base32 characters', () => {
    const id = createItemId();
    expect(id).toMatch(/^itm_[a-z2-7]{16}$/);
  });

  it('creates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createItemId()));
    expect(ids.size).toBe(1000);
  });

  it('uses the whole base32 alphabet', () => {
    const characters = new Set(Array.from({ length: 200 }, () => createItemId().slice(4)).join(''));
    expect(characters.size).toBe(32);
  });
});

describe('rect helpers', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };

  it('reads the rectangle of an item', () => {
    expect(rectOf(itemFixture('i', 's', { x: 1, y: 2, w: 30, h: 40 }))).toEqual({
      x: 1,
      y: 2,
      w: 30,
      h: 40,
    });
  });

  it('compares rectangles', () => {
    expect(rectsEqual(a, { ...a })).toBe(true);
    expect(rectsEqual(a, { ...a, h: 99 })).toBe(false);
  });

  it('detects intersections by positive area only', () => {
    expect(rectIntersects(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
    expect(rectIntersects(a, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
    expect(rectIntersects(a, { x: 100, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectIntersects(a, { x: 0, y: 100, w: 10, h: 10 })).toBe(false);
    expect(rectIntersects(a, { x: -20, y: -20, w: 10, h: 10 })).toBe(false);
    expect(rectIntersects(a, { x: 10, y: 10, w: 0, h: 10 })).toBe(false);
  });

  it('computes the centre', () => {
    expect(rectCenter({ x: 10, y: 20, w: 100, h: 50 })).toEqual({ x: 60, y: 45 });
  });

  it('moves a rectangle onto the canvas and shrinks oversized ones', () => {
    expect(clampRectToCanvas({ x: -50, y: 1000, w: 200, h: 200 }, CANVAS)).toEqual({
      x: 0,
      y: 880,
      w: 200,
      h: 200,
    });
    expect(clampRectToCanvas({ x: 1800, y: -5, w: 300, h: 100 }, CANVAS)).toEqual({
      x: 1620,
      y: 0,
      w: 300,
      h: 100,
    });
    expect(clampRectToCanvas({ x: 100, y: 100, w: 4000, h: 3000 }, CANVAS)).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
    });
    expect(clampRectToCanvas({ x: 500, y: 500, w: -10, h: 20 }, CANVAS)).toEqual({
      x: 500,
      y: 500,
      w: 0,
      h: 20,
    });
  });
});
