import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants';
import type { SceneItemDto, SceneLayoutMode, SourceKind } from './contracts';

/** A slot rectangle in canvas pixels: [x, y, w, h]. */
export type SlotRect = readonly [x: number, y: number, w: number, h: number];

/** Identifier of a layout template («Vorlage»). */
export type LayoutTemplateId = 'full' | 'two' | 'pip' | 'col' | 'onetwo' | 'grid' | 'grid3' | 'auto';

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
  { id: 'full', name: 'Vollbild', description: 'eine Quelle', slots: [[0, 0, CANVAS_WIDTH, CANVAS_HEIGHT]] },
  { id: 'two', name: 'Nebeneinander', description: 'Interview, Gespräch', slots: [[40, 287, 900, 506], [980, 287, 900, 506]] },
  { id: 'pip', name: 'Bild-in-Bild', description: 'Screen gross, Kamera in der Ecke', slots: [[0, 0, CANVAS_WIDTH, CANVAS_HEIGHT], [1400, 772, 480, 270]] },
  {
    id: 'col',
    name: 'Screen + Spalte',
    description: 'Präsentation mit zwei Personen',
    slots: [[40, 158, 1360, 765], [1440, 283, 440, 248], [1440, 551, 440, 248]],
  },
  {
    id: 'onetwo',
    name: 'Eins plus zwei',
    description: 'Moderation und zwei Gäste',
    slots: [[40, 196, 1225, 689], [1285, 196, 595, 335], [1285, 551, 595, 335]],
  },
  {
    id: 'grid',
    name: '2 × 2',
    description: 'Panel oder Q&A',
    slots: [[79, 40, 871, 490], [970, 40, 871, 490], [79, 550, 871, 490], [970, 550, 871, 490]],
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
    return [[79, 40, 871, 490], [970, 40, 871, 490], [525, 550, 871, 490]];
  }
  if (count === 4) {
    return layoutTemplate('grid').slots ?? [];
  }
  return GRID3;
}

/** Sort rank used when distributing items over slots: screens first, then media, then cameras. */
function kindRank(kind: SourceKind | undefined): number {
  switch (kind) {
    case 'screen':
      return 0;
    case 'image':
    case 'video':
      return 1;
    default:
      return 2;
  }
}

/**
 * Applies a template to the items of a scene (pure). Visible items are ordered by kind and get the slots in order;
 * hidden items and items beyond the slot count keep their geometry. Auto-Grid only switches the layout mode; the
 * renderer computes the rectangles from the available sources.
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
  const ordered = items
    .filter((item) => !item.hidden)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => kindRank(kindOf(a.item.source)) - kindRank(kindOf(b.item.source)) || a.index - b.index)
    .map(({ item }) => item);
  const placed = new Map<string, SceneItemDto>();
  ordered.forEach((item, index) => {
    const slot = slots[index];
    if (!slot) {
      return;
    }
    const [x, y, w, h] = slot;
    const isScreenLead = kindOf(item.source) === 'screen' && index === 0 && templateId !== 'two' && !templateId.startsWith('grid');
    placed.set(item.id, { ...item, x, y, w, h, fit: isScreenLead ? 'contain' : 'cover', radius: w === CANVAS_WIDTH ? 0 : 12 });
  });
  return { items: items.map((item) => placed.get(item.id) ?? { ...item }), layoutMode: 'free' };
}
