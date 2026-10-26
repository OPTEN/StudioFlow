import { resetLocaleForTests } from '@studioflow/i18n';
import {
  CANVAS_FORMATS,
  CANVAS_RESOLUTIONS,
  DEFAULT_CANVAS,
  canvasSize,
  type CanvasSize,
} from './canvas';
import type { SourceKind } from './contracts';
import { rectIntersects, rectOf } from './geometry';
import {
  applyLayoutTemplate,
  autoGridSlots,
  layoutTemplate,
  layoutTemplates,
  type SlotRect,
} from './layout-templates';
import { itemFixture } from './testing/fixtures';

const CANVASES = CANVAS_FORMATS.flatMap((format) =>
  CANVAS_RESOLUTIONS.map((resolution) => ({
    name: `${format} ${resolution}`,
    canvas: canvasSize(format, resolution),
  })),
);

const SLOT_COUNTS = { full: 1, two: 2, pip: 2, col: 3, onetwo: 3, grid: 4, grid3: 9 } as const;

function asRect([x, y, w, h]: SlotRect): { x: number; y: number; w: number; h: number } {
  return { x, y, w, h };
}

function insideCanvas([x, y, w, h]: SlotRect, canvas: CanvasSize): boolean {
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= canvas.width && y + h <= canvas.height;
}

function overlapping(slots: readonly SlotRect[]): [number, number][] {
  const found: [number, number][] = [];
  slots.forEach((a, i) =>
    slots.forEach((b, j) => {
      if (j > i && rectIntersects(asRect(a), asRect(b))) {
        found.push([i, j]);
      }
    }),
  );
  return found;
}

describe.each(CANVASES)('layout templates on $name', ({ canvas }) => {
  it('has the slot counts of the plan', () => {
    for (const template of layoutTemplates(canvas)) {
      expect(template.slots?.length ?? null).toBe(
        template.id === 'auto' ? null : SLOT_COUNTS[template.id],
      );
    }
  });

  it('keeps every slot inside the canvas', () => {
    for (const template of layoutTemplates(canvas)) {
      for (const slot of template.slots ?? []) {
        expect(insideCanvas(slot, canvas), `${template.id} ${slot.join(',')}`).toBe(true);
      }
    }
  });

  it('overlaps slots only in picture in picture, where the small picture lies in the big one', () => {
    for (const template of layoutTemplates(canvas)) {
      const found = overlapping(template.slots ?? []);
      expect(found, template.id).toEqual(template.id === 'pip' ? [[0, 1]] : []);
    }
  });

  it('keeps the margin of the picture in the corner, inside the big picture', () => {
    const [full, corner] = layoutTemplate('pip', canvas).slots ?? [];

    expect(full).toEqual([0, 0, canvas.width, canvas.height]);
    expect(corner[0] + corner[2]).toBeLessThan(canvas.width);
    expect(corner[1] + corner[3]).toBeLessThan(canvas.height);
  });

  it.each([0, 1, 2, 3, 4, 5, 9, 12])(
    'arranges the auto grid for %s sources without overlap, inside the canvas',
    (count) => {
      const slots = autoGridSlots(count, canvas);

      expect(slots.length).toBe(count <= 1 ? 1 : Math.min(count <= 4 ? count : 9, 9));
      expect(slots.every((slot) => insideCanvas(slot, canvas))).toBe(true);
      expect(overlapping(slots)).toEqual([]);
    },
  );

  it('places items from a template inside the canvas with square corners only for a full slot', () => {
    const kinds: Record<string, SourceKind> = { a: 'screen', b: 'camera', c: 'camera' };
    const items = ['a', 'b', 'c'].map((id) => itemFixture(id, id));
    const { items: placed } = applyLayoutTemplate(items, 'pip', (source) => kinds[source], canvas);

    expect(placed.map((item) => item.radius)).toEqual([0, 12, 12]);
    for (const item of placed.slice(0, 2)) {
      expect(insideCanvas([item.x, item.y, item.w, item.h], canvas)).toBe(true);
    }
  });
});

describe('layout templates across canvases', () => {
  it('uses the prototype slots on 1920 × 1080', () => {
    expect(layoutTemplate('two', DEFAULT_CANVAS).slots).toEqual([
      [40, 287, 900, 506],
      [980, 287, 900, 506],
    ]);
    expect(layoutTemplate('grid', DEFAULT_CANVAS).slots?.[3]).toEqual([970, 550, 871, 490]);
    expect(autoGridSlots(3, DEFAULT_CANVAS)[2]).toEqual([525, 550, 871, 490]);
  });

  it('scales the slots with the resolution of the same format', () => {
    for (const format of CANVAS_FORMATS) {
      const large = canvasSize(format, 'p1080');
      const small = canvasSize(format, 'p720');
      for (const template of layoutTemplates(large)) {
        const scaled = layoutTemplate(template.id, small).slots ?? [];
        (template.slots ?? []).forEach((slot, index) => {
          slot.forEach((value, part) => {
            expect(Math.abs(scaled[index][part] - (value * 2) / 3)).toBeLessThanOrEqual(1);
          });
        });
      }
    }
  });

  it('narrows the 16:9 layouts to 75 % on 4:3 and keeps the tiles 16:9', () => {
    const standard = canvasSize('standard', 'p1080');

    expect(layoutTemplate('two', standard).slots).toEqual([
      [30, 350, 675, 380],
      [735, 350, 675, 380],
    ]);
    expect(layoutTemplate('full', standard).slots).toEqual([[0, 0, 1440, 1080]]);
    for (const [, , w, h] of layoutTemplate('grid3', standard).slots ?? []) {
      expect(Math.abs(w / h - 16 / 9)).toBeLessThan(0.02);
    }
  });

  it('stacks two pictures on a portrait canvas and on a square one', () => {
    expect(layoutTemplate('two', canvasSize('portrait', 'p1080')).slots).toEqual([
      [40, 377, 1000, 563],
      [40, 980, 1000, 563],
    ]);
    expect(layoutTemplate('two', canvasSize('square', 'p1080')).slots).toEqual([
      [114, 40, 853, 480],
      [114, 560, 853, 480],
    ]);
  });

  it('stacks three pictures in the auto grid of a portrait canvas', () => {
    const slots = autoGridSlots(3, canvasSize('portrait', 'p1080'));

    expect(slots.map(([x, , w]) => [x, w])).toEqual([
      [40, 1000],
      [40, 1000],
      [40, 1000],
    ]);
    expect(slots.map(([, y]) => y)).toEqual([...slots.map(([, y]) => y)].sort((a, b) => a - b));
  });

  it('puts the main picture above the pair on a portrait canvas', () => {
    const [main, left, right] = layoutTemplate('col', canvasSize('portrait', 'p1080')).slots ?? [];

    expect(main[2]).toBeGreaterThan(left[2]);
    expect(left[1]).toBe(right[1]);
    expect(left[1]).toBeGreaterThanOrEqual(main[1] + main[3]);
    expect(left[0]).toBeLessThan(right[0]);
  });

  it('keeps the grid cells square on a portrait canvas', () => {
    for (const [, , w, h] of layoutTemplate('grid', canvasSize('portrait', 'p1080')).slots ?? []) {
      expect(w).toBe(h);
    }
  });
});

describe('layout template names across canvases', () => {
  afterEach(() => resetLocaleForTests('en'));

  it('says "Side by side" and "Screen + camera column" on wide canvases', () => {
    for (const format of ['widescreen', 'standard'] as const) {
      const canvas = canvasSize(format, 'p1080');

      expect(layoutTemplate('two', canvas).name).toBe('Side by side');
      expect(layoutTemplate('col', canvas).name).toBe('Screen + camera column');
    }
  });

  it('says "Stacked" and "Screen + camera row" on square and portrait canvases', () => {
    for (const format of ['portrait', 'square'] as const) {
      const canvas = canvasSize(format, 'p1080');

      expect(layoutTemplate('two', canvas).name).toBe('Stacked');
      expect(layoutTemplate('col', canvas).name).toBe('Screen + camera row');
      expect(layoutTemplate('grid', canvas).name).toBe('2 × 2');
    }
  });

  it('follows the language', () => {
    const portrait = canvasSize('portrait', 'p1080');
    const template = layoutTemplate('two', portrait);
    resetLocaleForTests('de-CH');

    expect(template.name).toBe('Untereinander');
  });
});

describe('rectOf stays usable with slots', () => {
  it('turns a placed item back into its slot rectangle', () => {
    const canvas = canvasSize('square', 'p1080');
    const { items } = applyLayoutTemplate([itemFixture('a', 'a')], 'full', () => 'camera', canvas);

    expect(rectOf(items[0])).toEqual({ x: 0, y: 0, w: 1080, h: 1080 });
  });
});
