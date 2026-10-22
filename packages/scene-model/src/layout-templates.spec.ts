import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants';
import type { SceneItemDto, SourceKind } from './contracts';
import { rectIntersects, rectOf } from './geometry';
import {
  LAYOUT_TEMPLATES,
  applyLayoutTemplate,
  autoGridSlots,
  layoutTemplate,
  type LayoutTemplateId,
} from './layout-templates';
import { itemFixture } from './testing/fixtures';

const KINDS: Record<string, SourceKind> = {
  cam1: 'camera',
  cam2: 'camera',
  screen1: 'screen',
  screen2: 'screen',
  image: 'image',
  video: 'video',
};
const kindOf = (sourceId: string): SourceKind | undefined => KINDS[sourceId];

function slotRect(
  templateId: LayoutTemplateId,
  index: number,
): { x: number; y: number; w: number; h: number } {
  const slot = layoutTemplate(templateId).slots?.[index];
  if (!slot) {
    throw new Error(`no slot ${index} in ${templateId}`);
  }
  const [x, y, w, h] = slot;
  return { x, y, w, h };
}

function byId(items: readonly SceneItemDto[], id: string): SceneItemDto {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`no item ${id}`);
  }
  return item;
}

describe('LAYOUT_TEMPLATES', () => {
  it('has the eight templates of the plan in order', () => {
    expect(LAYOUT_TEMPLATES.map((template) => template.name)).toEqual([
      'Vollbild',
      'Nebeneinander',
      'Bild-in-Bild',
      'Screen + Kamera-Spalte',
      'Eins plus zwei',
      '2 × 2',
      '3 × 3',
      'Auto-Grid',
    ]);
  });

  it('keeps every slot on the canvas', () => {
    for (const template of LAYOUT_TEMPLATES) {
      for (const [x, y, w, h] of template.slots ?? []) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(CANVAS_WIDTH);
        expect(y + h).toBeLessThanOrEqual(CANVAS_HEIGHT);
      }
    }
  });

  it('uses the prototype slot rectangles', () => {
    expect(layoutTemplate('pip').slots).toEqual([
      [0, 0, 1920, 1080],
      [1400, 772, 480, 270],
    ]);
    expect(layoutTemplate('grid3').slots).toHaveLength(9);
    expect(layoutTemplate('grid3').slots?.[4]).toEqual([674, 378, 572, 322]);
    expect(layoutTemplate('auto').slots).toBeNull();
  });

  it('throws for an unknown id', () => {
    expect(() => layoutTemplate('nope' as LayoutTemplateId)).toThrow(/Unknown layout template/);
  });
});

describe('autoGridSlots', () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 9],
    [9, 9],
    [12, 9],
  ])('%s sources → %s slots', (count, slots) => {
    expect(autoGridSlots(count)).toHaveLength(slots);
  });

  it('reuses the template slots and centres the third slot of three', () => {
    expect(autoGridSlots(1)).toEqual(layoutTemplate('full').slots);
    expect(autoGridSlots(2)).toEqual(layoutTemplate('two').slots);
    expect(autoGridSlots(3)[2]).toEqual([525, 550, 871, 490]);
    expect(autoGridSlots(4)).toEqual(layoutTemplate('grid').slots);
    expect(autoGridSlots(7)).toEqual(layoutTemplate('grid3').slots);
  });

  it('never returns overlapping slots', () => {
    for (let count = 0; count <= 12; count += 1) {
      const slots = autoGridSlots(count).map(([x, y, w, h]) => ({ x, y, w, h }));
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          expect(rectIntersects(slots[i], slots[j])).toBe(false);
        }
      }
    }
  });
});

describe('applyLayoutTemplate', () => {
  it('orders visible items by kind: screen, then media, then camera', () => {
    const items = [
      itemFixture('c', 'cam1'),
      itemFixture('m', 'image'),
      itemFixture('s', 'screen1'),
    ];
    const { items: placed, layoutMode } = applyLayoutTemplate(items, 'col', kindOf);
    expect(layoutMode).toBe('free');
    expect(rectOf(byId(placed, 's'))).toEqual(slotRect('col', 0));
    expect(rectOf(byId(placed, 'm'))).toEqual(slotRect('col', 1));
    expect(rectOf(byId(placed, 'c'))).toEqual(slotRect('col', 2));
  });

  it('keeps the item order (z-order) of the scene', () => {
    const items = [itemFixture('c', 'cam1'), itemFixture('s', 'screen1')];
    expect(applyLayoutTemplate(items, 'pip', kindOf).items.map((item) => item.id)).toEqual([
      'c',
      's',
    ]);
  });

  it('keeps the scene order within one kind', () => {
    const items = [itemFixture('c2', 'cam2'), itemFixture('c1', 'cam1')];
    const placed = applyLayoutTemplate(items, 'two', kindOf).items;
    expect(rectOf(byId(placed, 'c2'))).toEqual(slotRect('two', 0));
    expect(rectOf(byId(placed, 'c1'))).toEqual(slotRect('two', 1));
  });

  it('puts unknown (deleted) sources last', () => {
    const items = [itemFixture('x', 'gone'), itemFixture('c', 'cam1')];
    const placed = applyLayoutTemplate(items, 'two', kindOf).items;
    expect(rectOf(byId(placed, 'c'))).toEqual(slotRect('two', 0));
    expect(rectOf(byId(placed, 'x'))).toEqual(slotRect('two', 1));
  });

  it('fits a screen in slot 0 with contain, everything else with cover', () => {
    const items = [
      itemFixture('s', 'screen1', { fit: 'cover' }),
      itemFixture('s2', 'screen2', { fit: 'contain' }),
      itemFixture('c', 'cam1', { fit: 'contain' }),
    ];
    const placed = applyLayoutTemplate(items, 'onetwo', kindOf).items;
    expect(byId(placed, 's').fit).toBe('contain');
    expect(byId(placed, 's2').fit).toBe('cover');
    expect(byId(placed, 'c').fit).toBe('cover');
  });

  it.each(['two', 'grid', 'grid3'] as const)('uses cover for a lead screen in %s', (templateId) => {
    const placed = applyLayoutTemplate(
      [itemFixture('s', 'screen1', { fit: 'contain' })],
      templateId,
      kindOf,
    ).items;
    expect(byId(placed, 's').fit).toBe('cover');
  });

  it('uses radius 0 for full-canvas slots and 12 otherwise', () => {
    const items = [
      itemFixture('s', 'screen1', { radius: 50 }),
      itemFixture('c', 'cam1', { radius: 0 }),
    ];
    const placed = applyLayoutTemplate(items, 'pip', kindOf).items;
    expect(byId(placed, 's').radius).toBe(0);
    expect(byId(placed, 'c').radius).toBe(12);
  });

  it('leaves hidden items untouched and does not give them a slot', () => {
    const hidden = itemFixture('h', 'screen1', { hidden: true, x: 7, y: 8, w: 99, h: 98 });
    const items = [hidden, itemFixture('c', 'cam1')];
    const placed = applyLayoutTemplate(items, 'full', kindOf).items;
    expect(byId(placed, 'h')).toEqual(hidden);
    expect(rectOf(byId(placed, 'c'))).toEqual(slotRect('full', 0));
  });

  it('keeps the geometry of items beyond the slot count', () => {
    const extra = itemFixture('c2', 'cam2', {
      x: 5,
      y: 6,
      w: 70,
      h: 80,
      fit: 'contain',
      radius: 3,
    });
    const placed = applyLayoutTemplate([itemFixture('c1', 'cam1'), extra], 'full', kindOf).items;
    expect(byId(placed, 'c2')).toEqual(extra);
  });

  it('keeps all other item properties (crop, mirror, lock, fallback)', () => {
    const item = itemFixture('c', 'cam1', {
      crop: { top: 0.1, right: 0, bottom: 0, left: 0 },
      mirror: true,
      locked: true,
      onLost: { holdMs: null, fallbackSource: 'image' },
    });
    const placed = byId(applyLayoutTemplate([item], 'full', kindOf).items, 'c');
    expect(placed).toMatchObject({
      crop: item.crop,
      mirror: true,
      locked: true,
      onLost: item.onLost,
    });
  });

  it('Auto-Grid only switches the layout mode', () => {
    const items = [itemFixture('c', 'cam1', { x: 1, y: 2 })];
    const { items: placed, layoutMode } = applyLayoutTemplate(items, 'auto', kindOf);
    expect(layoutMode).toBe('autoGrid');
    expect(placed).toEqual(items);
    expect(placed[0]).not.toBe(items[0]);
  });

  it('handles an empty scene', () => {
    expect(applyLayoutTemplate([], 'grid', kindOf)).toEqual({ items: [], layoutMode: 'free' });
  });

  it('does not mutate the input items', () => {
    const items = [itemFixture('c', 'cam1')];
    const copy = structuredClone(items);
    applyLayoutTemplate(items, 'grid3', kindOf);
    expect(items).toEqual(copy);
  });
});
