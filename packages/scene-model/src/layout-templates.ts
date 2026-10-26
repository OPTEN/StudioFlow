import { t, type PlainMessageKey } from '@studioflow/i18n';
import { DEFAULT_CANVAS, isLandscape, type CanvasSize } from './canvas';
import { DEFAULT_ITEM_RADIUS } from './constants';
import type { SceneItemDto, SceneLayoutMode, SourceKind } from './contracts';

/** A slot rectangle in canvas pixels: [x, y, w, h]. */
export type SlotRect = readonly [x: number, y: number, w: number, h: number];

/** Identifier of a layout template. */
export type LayoutTemplateId =
  'full' | 'two' | 'pip' | 'col' | 'onetwo' | 'grid' | 'grid3' | 'auto';

/**
 * A layout template for one canvas; `slots` is null for the auto grid, which depends on the number of available
 * sources. `name` and `description` are looked up when they are read, so they follow the active language.
 */
export interface LayoutTemplate {
  readonly id: LayoutTemplateId;
  readonly name: string;
  readonly description: string;
  readonly slots: readonly SlotRect[] | null;
}

/** The slot sets the templates and the auto grid are made of. */
type SlotSet = 'full' | 'two' | 'pip' | 'col' | 'onetwo' | 'grid' | 'grid3' | 'three';

/**
 * The slots of the prototype on a 1920 × 1080 canvas. Together with the two layouts below they are the reference
 * every canvas derives its slots from; on 1920 × 1080 itself they are used as they are.
 */
const SLOTS_16_9: Readonly<Record<SlotSet, readonly SlotRect[]>> = {
  full: [[0, 0, 1920, 1080]],
  two: [
    [40, 287, 900, 506],
    [980, 287, 900, 506],
  ],
  pip: [
    [0, 0, 1920, 1080],
    [1400, 772, 480, 270],
  ],
  col: [
    [40, 158, 1360, 765],
    [1440, 283, 440, 248],
    [1440, 551, 440, 248],
  ],
  onetwo: [
    [40, 196, 1225, 689],
    [1285, 196, 595, 335],
    [1285, 551, 595, 335],
  ],
  grid: [
    [79, 40, 871, 490],
    [970, 40, 871, 490],
    [79, 550, 871, 490],
    [970, 550, 871, 490],
  ],
  grid3: [40, 378, 716].flatMap((y) => [86, 674, 1262].map((x): SlotRect => [x, y, 572, 322])),
  three: [
    [79, 40, 871, 490],
    [970, 40, 871, 490],
    [525, 550, 871, 490],
  ],
};

/** The 1920 × 1080 slots on a canvas of the same height and another width (4:3): narrowed, the tiles stay 16:9. */
function narrowed(slots: readonly SlotRect[], referenceWidth: number): SlotRect[] {
  const factor = referenceWidth / DEFAULT_CANVAS.width;
  return slots.map(([x, y, w, h]): SlotRect => {
    if (w === DEFAULT_CANVAS.width && h === DEFAULT_CANVAS.height) {
      return [0, 0, referenceWidth, DEFAULT_CANVAS.height];
    }
    const centerY = y + h / 2;
    return [x * factor, centerY - (h * factor) / 2, w * factor, h * factor];
  });
}

/** Height of a 16:9 picture of the given width. */
function pictureHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

/** Margin to the edge, gap inside a row of pictures and gap between stacked pictures on the 1080 pixel reference. */
const STACK_MARGIN = 40;
const ROW_GAP = 20;
const STACK_GAP = 40;

/**
 * Layouts for canvases that are square or taller (1:1 and 9:16), on a reference with a short side of 1080: the pictures
 * are stacked instead of placed side by side. Everything is centred vertically and keeps the 40 px margin; the tiles are
 * 16:9, only the main picture of "One plus two" and the cells of the grids (square) are taller.
 */
function stackedSlots(set: SlotSet, canvas: CanvasSize): SlotRect[] {
  const { width, height } = canvas;
  const contentWidth = width - 2 * STACK_MARGIN;
  const centeredY = (block: number): number => Math.round((height - block) / 2);
  /** Left edges of `count` tiles of one width in a row, centred. */
  const rowXs = (tileWidth: number, count: number): number[] => {
    const rowWidth = count * tileWidth + (count - 1) * ROW_GAP;
    return Array.from({ length: count }, (_, i) =>
      Math.round((width - rowWidth) / 2 + i * (tileWidth + ROW_GAP)),
    );
  };
  const stack = (count: number): SlotRect[] => {
    const available = Math.floor((height - 2 * STACK_MARGIN - (count - 1) * STACK_GAP) / count);
    const tileWidth = Math.min(contentWidth, Math.floor((available * 16) / 9));
    const tileHeight = Math.min(available, pictureHeight(tileWidth));
    const y0 = centeredY(count * tileHeight + (count - 1) * STACK_GAP);
    return Array.from({ length: count }, (_, i): SlotRect => [
      Math.round((width - tileWidth) / 2),
      y0 + i * (tileHeight + STACK_GAP),
      tileWidth,
      tileHeight,
    ]);
  };
  /** The main picture over two tiles side by side. */
  const mainOverTwo = (mainHeight: number, tileWidth: number): SlotRect[] => {
    const tileHeight = pictureHeight(tileWidth);
    const y0 = centeredY(mainHeight + ROW_GAP + tileHeight);
    const tileY = y0 + mainHeight + ROW_GAP;
    const [left, right] = rowXs(tileWidth, 2);
    return [
      [STACK_MARGIN, y0, contentWidth, mainHeight],
      [left, tileY, tileWidth, tileHeight],
      [right, tileY, tileWidth, tileHeight],
    ];
  };
  /** A square grid of `columns` × `columns` cells. */
  const cells = (columns: number): SlotRect[] => {
    const size = Math.floor((contentWidth - (columns - 1) * ROW_GAP) / columns);
    const xs = rowXs(size, columns);
    const y0 = centeredY(columns * size + (columns - 1) * ROW_GAP);
    return Array.from({ length: columns * columns }, (_, i): SlotRect => [
      xs[i % columns],
      y0 + Math.floor(i / columns) * (size + ROW_GAP),
      size,
      size,
    ]);
  };
  switch (set) {
    case 'full':
      return [[0, 0, width, height]];
    case 'two':
      return stack(2);
    case 'three':
      return stack(3);
    case 'pip': {
      const tileWidth = Math.round(width * 0.4);
      const tileHeight = pictureHeight(tileWidth);
      return [
        [0, 0, width, height],
        [
          width - STACK_MARGIN - tileWidth,
          height - STACK_MARGIN - tileHeight,
          tileWidth,
          tileHeight,
        ],
      ];
    }
    case 'col':
      return mainOverTwo(pictureHeight(contentWidth), Math.round(contentWidth * 0.4));
    case 'onetwo':
      return mainOverTwo(Math.round(contentWidth * 0.7), Math.floor((contentWidth - ROW_GAP) / 2));
    case 'grid':
      return cells(2);
    case 'grid3':
      return cells(3);
  }
}

/** The slots of a set on the canvas, scaled from the 1080 pixel short side reference. */
function slotsOf(set: SlotSet, canvas: CanvasSize): readonly SlotRect[] {
  const factor = Math.min(canvas.width, canvas.height) / DEFAULT_CANVAS.height;
  const landscape = isLandscape(canvas);
  const reference: CanvasSize = landscape
    ? { width: Math.round(canvas.width / factor), height: DEFAULT_CANVAS.height }
    : { width: DEFAULT_CANVAS.height, height: Math.round(canvas.height / factor) };
  const slots = landscape
    ? narrowed(SLOTS_16_9[set], reference.width)
    : stackedSlots(set, reference);
  return slots.map(([x, y, w, h]): SlotRect => [
    Math.round(x * factor),
    Math.round(y * factor),
    Math.round(w * factor),
    Math.round(h * factor),
  ]);
}

const TEMPLATE_SLOTS = {
  full: 'full',
  two: 'two',
  pip: 'pip',
  col: 'col',
  onetwo: 'onetwo',
  grid: 'grid',
  grid3: 'grid3',
} as const satisfies Record<Exclude<LayoutTemplateId, 'auto'>, SlotSet>;

/** The ids of the templates in the order the Regie offers them. */
export const LAYOUT_TEMPLATE_IDS: readonly LayoutTemplateId[] = [
  'full',
  'two',
  'pip',
  'col',
  'onetwo',
  'grid',
  'grid3',
  'auto',
];

/** Name key of a template: on a stacking canvas "Side by side" is "Stacked" and the camera column is a row. */
function nameKey(id: LayoutTemplateId, canvas: CanvasSize): PlainMessageKey {
  if (isLandscape(canvas)) {
    return `model.scene.templateName.${id}`;
  }
  switch (id) {
    case 'two':
      return 'model.scene.templateName.twoStacked';
    case 'col':
      return 'model.scene.templateName.colRow';
    default:
      return `model.scene.templateName.${id}`;
  }
}

function template(id: LayoutTemplateId, canvas: CanvasSize): LayoutTemplate {
  return {
    id,
    get name() {
      return t(nameKey(id, canvas));
    },
    get description() {
      return t(`model.scene.templateInfo.${id}`);
    },
    slots: id === 'auto' ? null : slotsOf(TEMPLATE_SLOTS[id], canvas),
  };
}

/** The eight templates of the plan on a canvas; on 1920 × 1080 the slot rectangles are those of the prototype. */
export function layoutTemplates(canvas: CanvasSize): readonly LayoutTemplate[] {
  return LAYOUT_TEMPLATE_IDS.map((id) => template(id, canvas));
}

/** Looks up a template by id. */
export function layoutTemplate(id: LayoutTemplateId, canvas: CanvasSize): LayoutTemplate {
  if (!LAYOUT_TEMPLATE_IDS.includes(id)) {
    throw new Error(`Unknown layout template ${id}`);
  }
  return template(id, canvas);
}

/** Slots of the auto grid for `count` available sources (prototype `autoSlots`) on a canvas. */
export function autoGridSlots(count: number, canvas: CanvasSize): readonly SlotRect[] {
  if (count <= 1) {
    return slotsOf('full', canvas);
  }
  if (count === 2) {
    return slotsOf('two', canvas);
  }
  if (count === 3) {
    return slotsOf('three', canvas);
  }
  return slotsOf(count === 4 ? 'grid' : 'grid3', canvas);
}

/**
 * Sort rank used when distributing items over slots: screens first, then media, then cameras; items whose source no
 * longer exists ("Source missing") come last so they never take the main slot.
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
    case 'text':
    case 'audio':
    case undefined:
      return 3;
  }
}

/**
 * Applies a template to the items of a scene (pure).
 *
 * Slots: the visible items are ordered by kind (screen, then image/video, then camera, then missing sources; stable
 * inside a kind) and get the slots in that order. A screen in slot 0 gets fit `contain` (except side by side and the
 * grids), everything else `cover`; full-canvas slots get radius 0, the others 12.
 *
 * Z-order: the item order is the layer order (first = back), so the result is re-ordered to match the slots, because
 * slots may overlap (picture in picture: the small picture lies on top of the full one):
 * 1. the placed items first, in slot order – slot 0 at the back, every later slot in front of the earlier ones;
 * 2. then every item that got no slot – hidden items, texts (they overlay the picture and keep their place) and
 *    visible items beyond the slot count – in front of the placed ones, in their previous relative order and with
 *    their geometry unchanged.
 *
 * Unplaced items go in front so that nothing that is visible, or becomes visible when it is shown again later,
 * disappears behind a template slot it does not belong to: a leftover stays visible and clickable in the monitor,
 * and a hidden item shows up where the operator can see it.
 *
 * Auto grid only switches the layout mode and keeps the item order; the renderer computes the rectangles from the
 * available sources in item order, and its slots never overlap.
 */
export function applyLayoutTemplate(
  items: readonly SceneItemDto[],
  templateId: LayoutTemplateId,
  kindOf: (sourceId: string) => SourceKind | undefined,
  canvas: CanvasSize,
): { items: SceneItemDto[]; layoutMode: SceneLayoutMode } {
  if (templateId === 'auto') {
    return { items: items.map((item) => ({ ...item })), layoutMode: 'autoGrid' };
  }
  const slots = layoutTemplate(templateId, canvas).slots ?? [];
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.hidden && kindOf(item.source) !== 'text')
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
      radius: w === canvas.width ? 0 : DEFAULT_ITEM_RADIUS,
    } satisfies SceneItemDto;
  });
  const placedIndexes = new Set(candidates.map(({ index }) => index));
  const unplaced = items
    .filter((_, index) => !placedIndexes.has(index))
    .map((item) => ({ ...item }));
  return { items: [...placed, ...unplaced], layoutMode: 'free' };
}
