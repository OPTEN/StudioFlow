import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_ITEM_RADIUS } from './constants';
import type { SceneItemDto, SceneLayoutMode, SourceKind } from './contracts';

/** A slot rectangle in canvas pixels: [x, y, w, h]. */
export type SlotRect = readonly [x: number, y: number, w: number, h: number];

/** Identifier of a layout template («Vorlage»). */
export type LayoutTemplateId =
  'full' | 'two' | 'pip' | 'col' | 'onetwo' | 'grid' | 'grid3' | 'auto';

/** A layout template; `slots` is null for Auto-Grid, which depends on the number of available sources. */
export interface LayoutTemplate {
  readonly id: LayoutTemplateId;
  readonly name: string;
  readonly description: string;
  readonly slots: readonly SlotRect[] | null;
}

const GRID3: readonly SlotRect[] = [40, 378, 716].flatMap((y) =>
  [86, 674, 1262].map((x): SlotRect => [x, y, 572, 322]),
);

/** The eight templates of the plan; slot rectangles are identical to the prototype. */
export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  {
    id: 'full',
    name: 'Vollbild',
    description: 'eine Quelle',
    slots: [[0, 0, CANVAS_WIDTH, CANVAS_HEIGHT]],
  },
  {
    id: 'two',
    name: 'Nebeneinander',
    description: 'Interview, Gespräch',
    slots: [
      [40, 287, 900, 506],
      [980, 287, 900, 506],
    ],
  },
  {
    id: 'pip',
    name: 'Bild-in-Bild',
    description: 'Screen gross, Kamera in der Ecke',
    slots: [
      [0, 0, CANVAS_WIDTH, CANVAS_HEIGHT],
      [1400, 772, 480, 270],
    ],
  },
  {
    id: 'col',
    name: 'Screen + Kamera-Spalte',
    description: 'Präsentation mit zwei Personen',
    slots: [
      [40, 158, 1360, 765],
      [1440, 283, 440, 248],
      [1440, 551, 440, 248],
    ],
  },
  {
    id: 'onetwo',
    name: 'Eins plus zwei',
    description: 'Moderation und zwei Gäste',
    slots: [
      [40, 196, 1225, 689],
      [1285, 196, 595, 335],
      [1285, 551, 595, 335],
    ],
  },
  {
    id: 'grid',
    name: '2 × 2',
    description: 'Panel oder Q&A',
    slots: [
      [79, 40, 871, 490],
      [970, 40, 871, 490],
      [79, 550, 871, 490],
      [970, 550, 871, 490],
    ],
  },
  { id: 'grid3', name: '3 × 3', description: 'Galerie, viele Gäste', slots: GRID3 },
  { id: 'auto', name: 'Auto-Grid', description: 'ordnet sich nach aktiven Kameras', slots: null },
];

/** Looks up a template by id. */
export function layoutTemplate(id: LayoutTemplateId): LayoutTemplate {
  const template = LAYOUT_TEMPLATES.find((t) => t.id === id);
  if (!template) {
    throw new Error(`Unknown layout template ${id}`);
  }
  return template;
}

/** Slots of the Auto-Grid for `count` available sources (prototype `autoSlots`). */
export function autoGridSlots(count: number): readonly SlotRect[] {
  if (count <= 1) {
    return layoutTemplate('full').slots ?? [];
  }
  if (count === 2) {
    return layoutTemplate('two').slots ?? [];
  }
  if (count === 3) {
    return [
      [79, 40, 871, 490],
      [970, 40, 871, 490],
      [525, 550, 871, 490],
    ];
  }
  if (count === 4) {
    return layoutTemplate('grid').slots ?? [];
  }
  return GRID3;
}

/**
 * Sort rank used when distributing items over slots: screens first, then media, then cameras; items whose source no
 * longer exists («Quelle fehlt») come last so they never take the main slot.
 */
function kindRank(kind: SourceKind | undefined): number {
  switch (kind) {
    case 'screen':
      return 0;
    case 'image':
    case 'video':
      return 1;
    case 'camera':
      return 2;
    case undefined:
      return 3;
  }
}

/**
 * Applies a template to the items of a scene (pure).
 *
 * Slots: the visible items are ordered by kind (screen, then image/video, then camera, then missing sources; stable
 * inside a kind) and get the slots in that order. A screen in slot 0 gets fit `contain` (except Nebeneinander and the
 * grids), everything else `cover`; full-canvas slots get radius 0, the others 12.
 *
 * Z-order: the item order is the layer order (first = back), so the result is re-ordered to match the slots, because
 * slots may overlap (Bild-in-Bild: the small picture lies on top of the full one):
 * 1. the placed items first, in slot order – slot 0 at the back, every later slot in front of the earlier ones;
 * 2. then every item that got no slot – hidden items and visible items beyond the slot count – in front of the
 *    placed ones, in their previous relative order and with their geometry unchanged.
 *
 * Unplaced items go in front so that nothing that is visible, or becomes visible when it is shown again later,
 * disappears behind a template slot it does not belong to: a leftover stays visible and clickable in the monitor,
 * and a hidden item shows up where the operator can see it.
 *
 * Auto-Grid only switches the layout mode and keeps the item order; the renderer computes the rectangles from the
 * available sources in item order, and its slots never overlap.
 */
export function applyLayoutTemplate(
  items: readonly SceneItemDto[],
  templateId: LayoutTemplateId,
  kindOf: (sourceId: string) => SourceKind | undefined,
): { items: SceneItemDto[]; layoutMode: SceneLayoutMode } {
  if (templateId === 'auto') {
    return { items: items.map((item) => ({ ...item })), layoutMode: 'autoGrid' };
  }
  const slots = layoutTemplate(templateId).slots ?? [];
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.hidden)
    .sort(
      (a, b) =>
        kindRank(kindOf(a.item.source)) - kindRank(kindOf(b.item.source)) || a.index - b.index,
    )
    .slice(0, slots.length);
  const placed = candidates.map(({ item }, slotIndex) => {
    const [x, y, w, h] = slots[slotIndex];
    const isScreenLead =
      kindOf(item.source) === 'screen' &&
      slotIndex === 0 &&
      templateId !== 'two' &&
      !templateId.startsWith('grid');
    return {
      ...item,
      x,
      y,
      w,
      h,
      fit: isScreenLead ? 'contain' : 'cover',
      radius: w === CANVAS_WIDTH ? 0 : DEFAULT_ITEM_RADIUS,
    } satisfies SceneItemDto;
  });
  const placedIndexes = new Set(candidates.map(({ index }) => index));
  const unplaced = items
    .filter((_, index) => !placedIndexes.has(index))
    .map((item) => ({ ...item }));
  return { items: [...placed, ...unplaced], layoutMode: 'free' };
}
