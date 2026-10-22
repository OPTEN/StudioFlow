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

describe('applyLayoutTemplate: z-order (item order, first = back)', () => {
  function ids(items: readonly SceneItemDto[]): string[] {
    return items.map((item) => item.id);
  }

  function apply(items: readonly SceneItemDto[], templateId: LayoutTemplateId): SceneItemDto[] {
    return applyLayoutTemplate(items, templateId, kindOf).items;
  }

  it('Bild-in-Bild, camera before screen: the screen goes to the back, the small camera in front', () => {
    const placed = apply([itemFixture('c', 'cam1'), itemFixture('s', 'screen1')], 'pip');
    expect(ids(placed)).toEqual(['s', 'c']);
    expect(rectOf(placed[0])).toEqual(slotRect('pip', 0));
    expect(rectOf(placed[1])).toEqual(slotRect('pip', 1));
  });

  it('Bild-in-Bild, screen before camera: the order stays', () => {
    const placed = apply([itemFixture('s', 'screen1'), itemFixture('c', 'cam1')], 'pip');
    expect(ids(placed)).toEqual(['s', 'c']);
    expect(rectOf(placed[0])).toEqual(slotRect('pip', 0));
    expect(rectOf(placed[1])).toEqual(slotRect('pip', 1));
  });

  it.each([
    [
      ['c1', 'c2'],
      ['c1', 'c2'],
    ],
    [
      ['c2', 'c1'],
      ['c2', 'c1'],
    ],
  ])(
    'Bild-in-Bild, two cameras %j: the back one gets the full picture, the front one the corner',
    (order, expected) => {
      const items = order.map((id) => itemFixture(id, id === 'c1' ? 'cam1' : 'cam2'));
      const placed = apply(items, 'pip');
      expect(ids(placed)).toEqual(expected);
      expect(rectOf(placed[0])).toEqual(slotRect('pip', 0));
      expect(rectOf(placed[1])).toEqual(slotRect('pip', 1));
    },
  );

  it('Bild-in-Bild, a missing source before a camera: the camera is full and at the back', () => {
    const placed = apply([itemFixture('x', 'gone'), itemFixture('c', 'cam1')], 'pip');
    expect(ids(placed)).toEqual(['c', 'x']);
    expect(rectOf(placed[1])).toEqual(slotRect('pip', 1));
  });

  it.each([
    [
      ['c', 'h', 's'],
      ['s', 'c', 'h'],
    ],
    [
      ['h', 'c', 's'],
      ['s', 'c', 'h'],
    ],
    [
      ['c', 's', 'h'],
      ['s', 'c', 'h'],
    ],
  ])(
    'three items, one hidden %j: the hidden item goes in front of the placed ones',
    (order, expected) => {
      const all: Record<string, SceneItemDto> = {
        c: itemFixture('c', 'cam1'),
        s: itemFixture('s', 'screen1'),
        h: itemFixture('h', 'screen2', { hidden: true, x: 7, y: 8, w: 99, h: 98 }),
      };
      const placed = apply(
        order.map((id) => all[id]),
        'pip',
      );
      expect(ids(placed)).toEqual(expected);
      expect(byId(placed, 'h')).toEqual(all['h']);
      expect(rectOf(byId(placed, 's'))).toEqual(slotRect('pip', 0));
      expect(rectOf(byId(placed, 'c'))).toEqual(slotRect('pip', 1));
    },
  );

  it('more items than slots: the items without a slot go in front, in their previous order', () => {
    const c1 = itemFixture('c1', 'cam1', { x: 5, y: 6, w: 70, h: 80 });
    const c2 = itemFixture('c2', 'cam2', { x: 9, y: 10, w: 110, h: 120 });
    const full = apply([c1, c2, itemFixture('s', 'screen1')], 'full');
    expect(ids(full)).toEqual(['s', 'c1', 'c2']);
    expect(byId(full, 'c1')).toEqual(c1);
    expect(byId(full, 'c2')).toEqual(c2);

    const pip = apply([c1, itemFixture('i', 'image'), c2, itemFixture('s', 'screen1')], 'pip');
    expect(ids(pip)).toEqual(['s', 'i', 'c1', 'c2']);
    expect(rectOf(byId(pip, 'i'))).toEqual(slotRect('pip', 1));
    expect(byId(pip, 'c1')).toEqual(c1);
    expect(byId(pip, 'c2')).toEqual(c2);
  });

  it('keeps the relative order of hidden items and items beyond the slot count together', () => {
    const items = [
      itemFixture('c1', 'cam1'),
      itemFixture('h1', 'image', { hidden: true }),
      itemFixture('c2', 'cam2'),
      itemFixture('s', 'screen1'),
      itemFixture('h2', 'screen2', { hidden: true }),
      itemFixture('v', 'video'),
    ];
    expect(ids(apply(items, 'two'))).toEqual(['s', 'v', 'c1', 'h1', 'c2', 'h2']);
  });

  it('Auto-Grid keeps the item order (its slots never overlap)', () => {
    const items = [itemFixture('c', 'cam1'), itemFixture('s', 'screen1')];
    expect(ids(applyLayoutTemplate(items, 'auto', kindOf).items)).toEqual(['c', 's']);
  });

  const SLOT_TEMPLATES = LAYOUT_TEMPLATES.filter((template) => template.slots !== null).map(
    (template) => [template.name, template.id] as const,
  );

  it.each(SLOT_TEMPLATES)(
    '%s: slot i is layer i, later slots in front, items without a slot in front of all slots',
    (_name, templateId) => {
      const slotCount = layoutTemplate(templateId).slots?.length ?? 0;
      // Worst case for the old behaviour: a hidden item at the very back, cameras and media behind a screen at the
      // front, and one item more than there are slots.
      const count = slotCount + 1;
      const kindAt = (index: number): SourceKind =>
        index === count - 1 ? 'screen' : (['camera', 'video', 'image'] as const)[index % 3];
      const visible = Array.from({ length: count }, (_, index) =>
        itemFixture(`v${index}`, `${kindAt(index)}:${index}`, { x: index, y: index }),
      );
      const items = [itemFixture('hid', 'screen:hidden', { hidden: true }), ...visible];
      const kindOfMixed = (source: string): SourceKind | undefined =>
        source.split(':')[0] as SourceKind;
      const result = applyLayoutTemplate(items, templateId, kindOfMixed).items;

      const rank: Readonly<Record<SourceKind, number>> = {
        screen: 0,
        image: 1,
        video: 1,
        camera: 2,
      };
      const expectedPlaced = visible
        .map((item, index) => ({ id: item.id, rank: rank[kindAt(index)], index }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, slotCount)
        .map(({ id }) => id);
      const expectedRest = ids(items).filter((id) => !expectedPlaced.includes(id));
      expect(ids(result)).toEqual([...expectedPlaced, ...expectedRest]);

      for (let slot = 0; slot < slotCount; slot += 1) {
        expect(rectOf(result[slot])).toEqual(slotRect(templateId, slot));
      }
      // Overlapping slots (Bild-in-Bild): the item of the later slot is painted on top.
      for (let i = 0; i < slotCount; i += 1) {
        for (let j = i + 1; j < slotCount; j += 1) {
          if (rectIntersects(slotRect(templateId, i), slotRect(templateId, j))) {
            const back = result.findIndex((item) => sameRect(item, slotRect(templateId, i)));
            const front = result.findIndex((item) => sameRect(item, slotRect(templateId, j)));
            expect(front).toBeGreaterThan(back);
          }
        }
      }
      // Items without a slot keep everything and lie in front of every placed item.
      for (const item of result.slice(slotCount)) {
        expect(item).toEqual(items.find((entry) => entry.id === item.id));
      }
    },
  );

  it('Bild-in-Bild is the only template with overlapping slots', () => {
    const overlapping = LAYOUT_TEMPLATES.filter((template) => {
      const slots = (template.slots ?? []).map(([x, y, w, h]) => ({ x, y, w, h }));
      return slots.some((a, i) => slots.some((b, j) => j > i && rectIntersects(a, b)));
    });
    expect(overlapping.map((template) => template.id)).toEqual(['pip']);
  });
});

function sameRect(
  item: SceneItemDto,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return item.x === rect.x && item.y === rect.y && item.w === rect.w && item.h === rect.h;
}
