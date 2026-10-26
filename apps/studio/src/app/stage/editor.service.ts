import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import {
  LIMITS,
  applyLayoutTemplate,
  clampItem,
  createItemId,
  layoutTemplate,
  newItem,
  type CanvasRect,
  type LayoutTemplateId,
  type SceneDto,
  type SceneItemDto,
  type SceneLayoutMode,
  type TextSourceDto,
  type TextStyle,
} from '@studioflow/scene-model';
import { StudioApiService } from '../core/api/studio-api.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { KeyboardService } from '../core/ui/keyboard.service';
import {
  isPermutation,
  moveEntry,
  sameOrder,
  sortByOrder,
  stepTarget,
  type ReorderStep,
} from '../core/ui/reorder';
import { ToastService } from '../core/ui/toast.service';
import { SwitcherService } from './switcher.service';

/** Toast when an edit targets the live scene in Studio Mode (prototype), in the active language. */
export function liveLockedMessage(): string {
  return t('regie.stage.editor.liveLocked');
}
/**
 * Transitional export for `docks/sources/add-source-popover`, which still reads the former string constant
 * (`{{ lockedMessage }}`). It renders as {@link liveLockedMessage}, resolved when it is read, so it follows the
 * language. Remove it once the docks call {@link liveLockedMessage} themselves.
 *
 * @deprecated use {@link liveLockedMessage}
 */
export const LIVE_LOCKED_MESSAGE = {
  toString: liveLockedMessage,
} as unknown as string;
/** Toast when undo/redo would change the live scene in Studio Mode (prototype), in the active language. */
export function liveUndoMessage(): string {
  return t('regie.stage.editor.liveUnchanged');
}
/** Toast when an edit needs the server but the hub is disconnected, in the active language. */
export function offlineEditMessage(): string {
  return t('regie.stage.editor.offline');
}

/** Placeholder content of a new text per style; the operator replaces it before the text is shown. */
const TEXT_PLACEHOLDERS = {
  lowerThird: { line1: 'regie.text.placeholder.name', line2: 'regie.text.placeholder.role' },
  title: { line1: 'regie.text.placeholder.title', line2: null },
  note: { line1: 'regie.text.placeholder.note', line2: null },
} as const satisfies Record<TextStyle, { line1: PlainMessageKey; line2: PlainMessageKey | null }>;

/** Undo steps kept per scene (spec 9.1). */
export const UNDO_LIMIT = 60;

/** Items and layout mode of a scene at one point in time (undo/redo entries). */
export interface SceneSnapshot {
  readonly items: readonly SceneItemDto[];
  readonly layoutMode: SceneLayoutMode;
}

/** Returns the rectangles the renderer actually uses per item id (Auto-Grid), see `SceneRenderer.effectiveRects()`. */
export type EffectiveRectsProvider = () => ReadonlyMap<string, CanvasRect>;

/** Options of {@link EditorService.updateItem}. */
export interface UpdateItemOptions {
  /** Rectangles of an Auto-Grid scene, used when the edit switches it to free layout. */
  readonly effectiveRects?: ReadonlyMap<string, CanvasRect>;
  /** Record an undo step (default true; ignored inside a gesture, which records one step). */
  readonly undo?: boolean;
  /** Allowed on the live scene in Studio Mode: showing and hiding a text is an operation, not an edit. */
  readonly whileLive?: boolean;
}

type WriteOp =
  | { readonly kind: 'item'; readonly item: SceneItemDto }
  | { readonly kind: 'remove'; readonly itemId: string }
  | { readonly kind: 'order'; readonly itemIds: readonly string[] }
  | {
      readonly kind: 'replace';
      readonly items: readonly SceneItemDto[];
      readonly layoutMode: SceneLayoutMode | null;
    };

/** Optimistic local changes of one scene, shown until the server state contains them. */
interface SceneDraft {
  readonly listOverride: SceneSnapshot | null;
  readonly itemOverrides: ReadonlyMap<string, SceneItemDto>;
  readonly removed: ReadonlySet<string>;
  /** Item ids back to front after a reorder; items it does not list (added by another session) stay in front. */
  readonly order: readonly string[] | null;
  /** Highest scene version returned by our requests; the draft is dropped once the store reaches it. */
  readonly ackVersion: number;
}

interface SceneQueue {
  readonly productionId: string;
  readonly ops: WriteOp[];
  inFlight: boolean;
  /** Incremented when the queue is discarded (error); answers of older requests are ignored. */
  epoch: number;
}

interface Gesture {
  readonly sceneId: string;
  readonly before: SceneSnapshot;
  changed: boolean;
}

const EMPTY_DRAFT: SceneDraft = {
  listOverride: null,
  itemOverrides: new Map(),
  removed: new Set(),
  order: null,
  ackVersion: 0,
};

function snapshotOf(scene: SceneDto): SceneSnapshot {
  return { items: scene.items, layoutMode: scene.layoutMode };
}

/** The queued op `queued` is obsolete once `op` follows it (same item, or both set the whole order). */
function supersedes(op: WriteOp, queued: WriteOp): boolean {
  if (op.kind === 'order' || queued.kind === 'order') {
    return op.kind === queued.kind;
  }
  const itemOf = (entry: WriteOp): string | null =>
    entry.kind === 'item' ? entry.item.id : entry.kind === 'remove' ? entry.itemId : null;
  return itemOf(op) === itemOf(queued);
}

function sameRect(a: SceneItemDto, b: SceneItemDto): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Editing the scene in the editable monitor (prototype "Overlay", "Selection", "Properties", spec 4.3, 9.1).
 *
 * - {@link editScene}: the preview scene in Studio Mode, else the program scene, with local drafts applied.
 * - {@link editLocked}: Studio Mode with preview = program (the live scene cannot be edited then).
 * - Writes are optimistic: the change shows immediately ({@link displayScene}) and is sent sequentially per scene
 *   (at most one request in flight, so never more than one per item); rapid edits of the same item coalesce and the
 *   newest state wins. A draft is dropped when the store reaches the scene version our requests returned, or on an
 *   error (with a toast), which shows the server state again.
 * - Undo/redo per scene (60 steps) via `ReplaceSceneItems`; a drag wraps its updates in
 *   {@link beginGesture}/{@link endGesture} so it becomes one step.
 * - Auto-Grid: changing an item's geometry switches the scene to free layout with the rectangles the renderer
 *   currently uses ({@link useEffectiveRects} or {@link UpdateItemOptions.effectiveRects}).
 *
 * Used by the stage overlay, the sources dock and the properties dock. Keyboard (Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y,
 * Escape deselects) is registered by {@link registerShortcuts}, which the Regie page calls.
 */
@Injectable({ providedIn: 'root' })
export class EditorService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);
  private readonly toasts = inject(ToastService);
  private readonly keyboard = inject(KeyboardService);

  private readonly drafts = signal<ReadonlyMap<string, SceneDraft>>(new Map());
  private readonly queues = new Map<string, SceneQueue>();
  private readonly undoStacks = new Map<string, SceneSnapshot[]>();
  private readonly redoStacks = new Map<string, SceneSnapshot[]>();
  private readonly historyVersion = signal(0);
  private readonly selectedItemIdSignal = signal<string | null>(null);
  private readonly rectProviders: EffectiveRectsProvider[] = [];
  private gesture: Gesture | null = null;

  /** The scene being edited without drafts (store state). */
  private readonly baseEditScene = computed(() =>
    this.switcher.studioMode() ? this.store.previewScene() : this.store.programScene(),
  );

  /** The scene being edited, with local drafts: preview in Studio Mode, else program. Null without scenes. */
  readonly editScene = computed<SceneDto | null>(() => {
    const scene = this.baseEditScene();
    return scene ? this.displayScene(scene) : null;
  });
  /** Id of {@link editScene}. */
  readonly editSceneId = computed(() => this.baseEditScene()?.id ?? null);
  /** Studio Mode with preview = program: the live scene stays unchanged (prototype `editLocked`). */
  readonly editLocked = computed(() => {
    const preview = this.store.previewSceneId();
    return (
      this.switcher.studioMode() && preview !== null && preview === this.store.programSceneId()
    );
  });
  /** Edits are possible: an edit scene exists, it is not locked and the hub is connected. */
  readonly canEdit = computed(
    () => this.editScene() !== null && !this.editLocked() && this.store.canCommand(),
  );
  /** Every scene with local drafts applied (thumbnails, monitors). */
  readonly scenes = computed<readonly SceneDto[]>(() => {
    const drafts = this.drafts();
    const scenes = this.store.scenes();
    return drafts.size === 0 ? scenes : scenes.map((scene) => this.displayScene(scene));
  });
  /** Id of the selected item, or null. */
  readonly selectedItemId = this.selectedItemIdSignal.asReadonly();
  /**
   * The selected item of the edit scene (with drafts), or null when none, missing or hidden. A hidden text stays
   * selected: its content is prepared before it is shown.
   */
  readonly selectedItem = computed<SceneItemDto | null>(() => {
    const id = this.selectedItemIdSignal();
    const item = id ? this.editScene()?.items.find((entry) => entry.id === id) : undefined;
    return item && (!item.hidden || this.isText(item)) ? item : null;
  });
  /** Undo is available for the edit scene. */
  readonly canUndo = computed(() => this.historyDepth(this.undoStacks) > 0);
  /** Redo is available for the edit scene. */
  readonly canRedo = computed(() => this.historyDepth(this.redoStacks) > 0);
  /** True while requests of the edit scene are queued or in flight. */
  readonly saving = computed(() => {
    const id = this.editSceneId();
    return id !== null && this.drafts().has(id);
  });

  constructor() {
    // Selection belongs to one edit scene (prototype: S.sel = null on every switch of preview or program).
    effect(() => {
      this.editSceneId();
      untracked(() => this.selectedItemIdSignal.set(null));
    });
    const off = this.store.onChange(() => this.settleDrafts());
    inject(DestroyRef).onDestroy(off);
  }

  /** Registers Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y and Escape (deselect); returns the unregister function. */
  registerShortcuts(): () => void {
    const offUndo = this.keyboard.register('undo', () => {
      this.undo();
      return true;
    });
    const offRedo = this.keyboard.register('redo', () => {
      this.redo();
      return true;
    });
    const offEscape = this.keyboard.registerEscape('selection', () => {
      if (this.selectedItemIdSignal() === null) {
        return false;
      }
      this.select(null);
      return true;
    });
    return () => {
      offUndo();
      offRedo();
      offEscape();
    };
  }

  /**
   * Registers the renderer of the editable monitor as the source of Auto-Grid rectangles; returns the unregister
   * function. The most recent registration wins.
   */
  useEffectiveRects(provider: EffectiveRectsProvider): () => void {
    this.rectProviders.push(provider);
    return () => {
      const index = this.rectProviders.indexOf(provider);
      if (index >= 0) {
        this.rectProviders.splice(index, 1);
      }
    };
  }

  /** A scene with this editor's pending local changes applied (identity when there are none). */
  displayScene(scene: SceneDto): SceneDto {
    const draft = this.drafts().get(scene.id);
    if (
      !draft ||
      (!draft.listOverride &&
        !draft.order &&
        draft.removed.size === 0 &&
        draft.itemOverrides.size === 0)
    ) {
      return scene;
    }
    let items: SceneItemDto[] = [...(draft.listOverride?.items ?? scene.items)];
    if (draft.removed.size > 0) {
      items = items.filter((item) => !draft.removed.has(item.id));
    }
    if (draft.itemOverrides.size > 0) {
      items = items.map((item) => draft.itemOverrides.get(item.id) ?? item);
    }
    if (draft.order) {
      items = sortByOrder(items, draft.order, (item) => item.id);
    }
    return { ...scene, items, layoutMode: draft.listOverride?.layoutMode ?? scene.layoutMode };
  }

  /** Item of the edit scene by id (with drafts), or null. */
  itemById(itemId: string): SceneItemDto | null {
    return this.editScene()?.items.find((item) => item.id === itemId) ?? null;
  }

  /** Selects an item of the edit scene (null deselects). */
  select(itemId: string | null): void {
    this.selectedItemIdSignal.set(itemId);
  }

  /** Starts a gesture (drag, nudge burst): all updates until {@link endGesture} form one undo step. */
  beginGesture(): void {
    const scene = this.editScene();
    if (!scene || this.gesture) {
      return;
    }
    this.gesture = { sceneId: scene.id, before: snapshotOf(scene), changed: false };
  }

  /** Ends the gesture; records its undo step when something changed. */
  endGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.changed) {
      this.pushHistory(this.undoStacks, gesture.sceneId, gesture.before);
      this.clearRedo(gesture.sceneId);
    }
  }

  /**
   * Replaces one item of the edit scene (geometry, fit, crop, radius, mirror, rotation, border, hold, …). The item is
   * clamped to the server bounds, shown immediately and sent coalesced. Returns false when editing is not possible
   * (a toast says why) or the item does not exist.
   */
  updateItem(item: SceneItemDto, options: UpdateItemOptions = {}): boolean {
    const scene = this.editScene();
    if (!scene || !this.guard(options.whileLive)) {
      return false;
    }
    const current = scene.items.find((entry) => entry.id === item.id);
    if (!current) {
      return false;
    }
    const next = clampItem(item);
    this.recordUndo(scene, options.undo ?? true);
    if (scene.layoutMode === 'autoGrid' && !sameRect(current, next)) {
      const rects = options.effectiveRects ?? this.currentEffectiveRects();
      const items = scene.items.map((entry) => {
        if (entry.id === next.id) {
          return next;
        }
        const rect = rects?.get(entry.id);
        return rect ? clampItem({ ...entry, x: rect.x, y: rect.y, w: rect.w, h: rect.h }) : entry;
      });
      this.enqueue(scene, { kind: 'replace', items, layoutMode: 'free' });
      return true;
    }
    this.enqueue(scene, { kind: 'item', item: next });
    return true;
  }

  /** Replaces all items of the edit scene (templates); `layoutMode` unchanged when omitted. */
  replaceItems(items: readonly SceneItemDto[], layoutMode?: SceneLayoutMode): boolean {
    const scene = this.editScene();
    if (!scene || !this.guard()) {
      return false;
    }
    if (items.length > LIMITS.itemsPerScene) {
      this.toasts.show(t('regie.stage.editor.itemLimit', { count: LIMITS.itemsPerScene }));
      return false;
    }
    this.recordUndo(scene, true);
    this.enqueue(scene, {
      kind: 'replace',
      items: items.map(clampItem),
      layoutMode: layoutMode ?? null,
    });
    return true;
  }

  /**
   * Adds a source to the edit scene with the prototype defaults (600 × 338 at 1240/680) and selects it. A text that
   * was just created is passed along, because its source event may not have reached the store yet.
   */
  addSource(sourceId: string, text?: TextSourceDto): string | null {
    const scene = this.editScene();
    if (!scene || !this.guard()) {
      return null;
    }
    if (scene.items.length >= LIMITS.itemsPerScene) {
      this.toasts.show(t('regie.stage.editor.itemLimit', { count: LIMITS.itemsPerScene }));
      return null;
    }
    const source = this.store.sourceById(sourceId);
    const known = text ?? source?.text ?? undefined;
    const item = newItem(sourceId, known ? 'text' : source?.kind, createItemId(), known?.style);
    this.recordUndo(scene, true);
    this.enqueue(scene, { kind: 'replace', items: [...scene.items, item], layoutMode: null });
    this.select(item.id);
    this.toasts.show(
      t('regie.stage.editor.sourceAdded', {
        code: known?.code ?? source?.code ?? t('regie.stage.editor.sourceFallback'),
        scene: scene.name,
      }),
    );
    return item.id;
  }

  /**
   * Creates a text with placeholder content and adds it to the edit scene, hidden and selected for editing. Returns
   * the item id, or null when that was not possible (a toast says why).
   */
  async addText(style: TextStyle): Promise<string | null> {
    const productionId = this.store.productionId();
    if (!productionId || !this.guard()) {
      return null;
    }
    const placeholder = TEXT_PLACEHOLDERS[style];
    try {
      const text = await this.api.createText(productionId, {
        line1: t(placeholder.line1),
        line2: placeholder.line2 ? t(placeholder.line2) : null,
        style,
        align: null,
      });
      return this.addSource(text.id, text);
    } catch (error) {
      this.toasts.error(error);
      return null;
    }
  }

  /** Removes an item; the toast offers "Undo". */
  removeItem(itemId: string): boolean {
    const scene = this.editScene();
    const item = scene?.items.find((entry) => entry.id === itemId);
    if (!scene || !item || !this.guard()) {
      return false;
    }
    this.recordUndo(scene, true);
    this.enqueue(scene, { kind: 'remove', itemId });
    if (this.selectedItemIdSignal() === itemId) {
      this.select(null);
    }
    const code = this.store.codeOf(item.source) ?? t('regie.stage.editor.itemFallback');
    this.toasts.show(t('regie.stage.editor.itemRemoved', { code, scene: scene.name }), {
      label: t('regie.stage.editor.undo'),
      run: () => this.undo(scene.id),
    });
    return true;
  }

  /**
   * Shows or hides an item (eye toggle); hiding the selected item deselects it. A text is shown and hidden live, also
   * on the live scene in Studio Mode and without an undo step, and stays selected.
   */
  toggleHidden(itemId: string): boolean {
    const item = this.itemById(itemId);
    if (!item) {
      return false;
    }
    const text = this.isText(item);
    const hidden = !item.hidden;
    const changed = this.updateItem({ ...item, hidden }, { whileLive: text, undo: !text });
    if (changed && hidden && !text && this.selectedItemIdSignal() === itemId) {
      this.select(null);
    }
    return changed;
  }

  /** Locks or unlocks an item against moving in the editor (prototype: no undo step, allowed on the live scene). */
  toggleLocked(itemId: string): boolean {
    const scene = this.editScene();
    const item = scene?.items.find((entry) => entry.id === itemId);
    if (!scene || !item) {
      return false;
    }
    if (!this.store.canCommand()) {
      this.toasts.show(offlineEditMessage());
      return false;
    }
    this.enqueue(scene, { kind: 'item', item: { ...item, locked: !item.locked } });
    return true;
  }

  /**
   * Sets the z-order of the edit scene: the ids of all its items back to front (drag and drop in the Sources dock,
   * the layer buttons). Only the order is sent, so it cannot overwrite an item another session changed meanwhile.
   * Hidden and locked items can be reordered too. Returns false when nothing was reordered (a toast says why when
   * the scene cannot be edited).
   */
  reorderItems(itemIds: readonly string[]): boolean {
    const scene = this.editScene();
    if (!scene || !this.guard()) {
      return false;
    }
    const current = scene.items.map((item) => item.id);
    if (sameOrder(current, itemIds) || !isPermutation(itemIds, current)) {
      return false;
    }
    this.recordUndo(scene, true);
    this.enqueue(scene, { kind: 'order', itemIds });
    return true;
  }

  /** Moves an item one layer to the front (`up`) or back (`down`), or to the very front or back. */
  moveLayer(itemId: string, direction: 'up' | 'down' | 'front' | 'back'): boolean {
    const scene = this.editScene();
    const ids = scene?.items.map((item) => item.id) ?? [];
    const index = ids.indexOf(itemId);
    if (index < 0) {
      return false;
    }
    const steps: Record<typeof direction, ReorderStep> = {
      up: 'later',
      down: 'earlier',
      front: 'last',
      back: 'first',
    };
    return this.reorderItems(
      moveEntry(ids, itemId, stepTarget(index, ids.length, steps[direction])),
    );
  }

  /** Applies a layout template ("Apply template"); the toast offers "Undo". */
  applyTemplate(templateId: LayoutTemplateId): boolean {
    const scene = this.editScene();
    if (!scene || !this.guard()) {
      return false;
    }
    if (!scene.items.some((item) => !item.hidden)) {
      this.toasts.show(t('regie.stage.editor.addSourceFirst'));
      return false;
    }
    const result = applyLayoutTemplate(scene.items, templateId, (sourceId) =>
      this.store.kindOf(sourceId),
    );
    this.recordUndo(scene, true);
    this.enqueue(scene, { kind: 'replace', items: result.items, layoutMode: result.layoutMode });
    this.toasts.show(
      t('regie.stage.editor.templateApplied', { name: layoutTemplate(templateId).name }),
      {
        label: t('regie.stage.editor.undo'),
        run: () => this.undo(scene.id),
      },
    );
    return true;
  }

  /** Undoes the last change of the edit scene (or of `sceneId`). */
  undo(sceneId?: string): void {
    this.travel(
      this.undoStacks,
      this.redoStacks,
      sceneId,
      'regie.stage.editor.nothingToUndo',
      'regie.stage.editor.undone',
    );
  }

  /** Redoes the last undone change of the edit scene (or of `sceneId`). */
  redo(sceneId?: string): void {
    this.travel(
      this.redoStacks,
      this.undoStacks,
      sceneId,
      'regie.stage.editor.nothingToRedo',
      'regie.stage.editor.redone',
    );
  }

  // ---------------------------------------------------------------- Internals

  private travel(
    from: Map<string, SceneSnapshot[]>,
    to: Map<string, SceneSnapshot[]>,
    sceneId: string | undefined,
    emptyMessage: PlainMessageKey,
    doneMessage: PlainMessageKey,
  ): void {
    const id = sceneId ?? this.editSceneId();
    const base = id ? this.store.sceneById(id) : null;
    const stack = id ? from.get(id) : undefined;
    if (!id || !base || !stack || stack.length === 0) {
      this.toasts.show(t(emptyMessage));
      return;
    }
    if (this.switcher.studioMode() && id === this.store.programSceneId()) {
      this.toasts.show(liveUndoMessage());
      return;
    }
    if (!this.store.canCommand()) {
      this.toasts.show(offlineEditMessage());
      return;
    }
    const target = stack.pop() as SceneSnapshot;
    const scene = this.displayScene(base);
    this.pushHistory(to, id, snapshotOf(scene));
    this.historyVersion.update((value) => value + 1);
    this.enqueue(scene, { kind: 'replace', items: target.items, layoutMode: target.layoutMode });
    const selected = this.selectedItemIdSignal();
    if (selected && !target.items.some((item) => item.id === selected)) {
      this.select(null);
    }
    this.toasts.show(t(doneMessage));
  }

  private isText(item: SceneItemDto): boolean {
    return this.store.kindOf(item.source) === 'text';
  }

  /** Checks the edit lock (unless the change is allowed on the live scene) and the connection; shows the reason as a toast. */
  private guard(whileLive = false): boolean {
    if (this.editLocked() && !whileLive) {
      this.toasts.show(liveLockedMessage());
      return false;
    }
    if (!this.store.canCommand()) {
      this.toasts.show(offlineEditMessage());
      return false;
    }
    return true;
  }

  private currentEffectiveRects(): ReadonlyMap<string, CanvasRect> | null {
    const provider = this.rectProviders[this.rectProviders.length - 1];
    if (!provider) {
      return null;
    }
    try {
      return provider();
    } catch {
      return null;
    }
  }

  private recordUndo(scene: SceneDto, record: boolean): void {
    if (this.gesture && this.gesture.sceneId === scene.id) {
      this.gesture.changed = true;
      return;
    }
    if (!record) {
      return;
    }
    this.pushHistory(this.undoStacks, scene.id, snapshotOf(scene));
    this.clearRedo(scene.id);
  }

  private pushHistory(
    stacks: Map<string, SceneSnapshot[]>,
    sceneId: string,
    snapshot: SceneSnapshot,
  ): void {
    const stack = stacks.get(sceneId) ?? [];
    stack.push(snapshot);
    if (stack.length > UNDO_LIMIT) {
      stack.splice(0, stack.length - UNDO_LIMIT);
    }
    stacks.set(sceneId, stack);
    this.historyVersion.update((value) => value + 1);
  }

  private clearRedo(sceneId: string): void {
    if (this.redoStacks.get(sceneId)?.length) {
      this.redoStacks.delete(sceneId);
      this.historyVersion.update((value) => value + 1);
    }
  }

  private historyDepth(stacks: Map<string, SceneSnapshot[]>): number {
    this.historyVersion();
    const id = this.editSceneId();
    return id ? (stacks.get(id)?.length ?? 0) : 0;
  }

  /** Applies an operation to the draft (optimistic) and queues it. */
  private enqueue(scene: SceneDto, op: WriteOp): void {
    const productionId = this.store.productionId();
    if (!productionId) {
      return;
    }
    this.updateDraft(scene.id, (draft) => {
      switch (op.kind) {
        case 'item': {
          const itemOverrides = new Map(draft.itemOverrides);
          itemOverrides.set(op.item.id, op.item);
          return { ...draft, itemOverrides };
        }
        case 'remove': {
          const itemOverrides = new Map(draft.itemOverrides);
          itemOverrides.delete(op.itemId);
          const removed = new Set(draft.removed);
          removed.add(op.itemId);
          return { ...draft, itemOverrides, removed };
        }
        case 'order':
          return { ...draft, order: op.itemIds };
        case 'replace':
          return {
            ...draft,
            listOverride: { items: op.items, layoutMode: op.layoutMode ?? scene.layoutMode },
            itemOverrides: new Map(),
            removed: new Set(),
            order: null,
          };
      }
    });
    let queue = this.queues.get(scene.id);
    if (!queue || queue.productionId !== productionId) {
      queue = { productionId, ops: [], inFlight: false, epoch: (queue?.epoch ?? 0) + 1 };
      this.queues.set(scene.id, queue);
    }
    this.coalesce(queue, op);
    this.flush(scene.id);
  }

  /**
   * Latest state wins: a replace supersedes every queued op, an order supersedes a queued order, an item update
   * replaces a queued one of the item.
   */
  private coalesce(queue: SceneQueue, op: WriteOp): void {
    if (op.kind === 'replace') {
      queue.ops.length = 0;
      queue.ops.push(op);
      return;
    }
    const lastReplace = queue.ops.map((entry) => entry.kind).lastIndexOf('replace');
    for (let index = queue.ops.length - 1; index > lastReplace; index -= 1) {
      if (supersedes(op, queue.ops[index])) {
        queue.ops.splice(index, 1);
      }
    }
    queue.ops.push(op);
  }

  private flush(sceneId: string): void {
    const queue = this.queues.get(sceneId);
    if (!queue || queue.inFlight) {
      return;
    }
    const op = queue.ops.shift();
    if (!op) {
      this.settleDrafts();
      return;
    }
    queue.inFlight = true;
    const epoch = queue.epoch;
    this.send(queue.productionId, sceneId, op)
      .then((scene) => {
        if (this.queues.get(sceneId) !== queue || queue.epoch !== epoch) {
          return;
        }
        queue.inFlight = false;
        if (scene) {
          this.updateDraft(sceneId, (draft) => ({
            ...draft,
            ackVersion: Math.max(draft.ackVersion, scene.version),
          }));
        }
        this.flush(sceneId);
      })
      .catch((error: unknown) => {
        if (this.queues.get(sceneId) !== queue || queue.epoch !== epoch) {
          return;
        }
        this.discard(sceneId);
        this.toasts.error(error);
      });
  }

  private send(productionId: string, sceneId: string, op: WriteOp): Promise<SceneDto | void> {
    switch (op.kind) {
      case 'item':
        return this.api.updateSceneItem(productionId, sceneId, op.item.id, op.item);
      case 'remove':
        return this.api.removeSceneItem(productionId, sceneId, op.itemId);
      case 'order':
        return this.api.reorderSceneItems(productionId, sceneId, { itemIds: [...op.itemIds] });
      case 'replace':
        return this.api.replaceSceneItems(productionId, sceneId, {
          items: [...op.items],
          layoutMode: op.layoutMode,
        });
    }
  }

  /** Drops the draft and the queue of a scene (error, scene deleted). */
  private discard(sceneId: string): void {
    const queue = this.queues.get(sceneId);
    if (queue) {
      queue.epoch += 1;
      queue.ops.length = 0;
      queue.inFlight = false;
    }
    this.queues.delete(sceneId);
    if (this.drafts().has(sceneId)) {
      const next = new Map(this.drafts());
      next.delete(sceneId);
      this.drafts.set(next);
    }
  }

  /** Drops drafts whose changes the store contains (idle queue and the store at or past the acknowledged version). */
  private settleDrafts(): void {
    const drafts = this.drafts();
    if (drafts.size === 0) {
      return;
    }
    let next: Map<string, SceneDraft> | null = null;
    for (const [sceneId, draft] of drafts) {
      const scene = this.store.sceneById(sceneId);
      const queue = this.queues.get(sceneId);
      const idle = !queue || (!queue.inFlight && queue.ops.length === 0);
      if (!scene) {
        this.queues.get(sceneId)?.ops.splice(0);
        this.queues.delete(sceneId);
        this.undoStacks.delete(sceneId);
        this.redoStacks.delete(sceneId);
      } else if (!idle || scene.version < draft.ackVersion) {
        continue;
      }
      next ??= new Map(drafts);
      next.delete(sceneId);
      if (queue && idle) {
        this.queues.delete(sceneId);
      }
    }
    if (next) {
      this.drafts.set(next);
    }
  }

  private updateDraft(sceneId: string, change: (draft: SceneDraft) => SceneDraft): void {
    const drafts = this.drafts();
    const next = new Map(drafts);
    next.set(sceneId, change(drafts.get(sceneId) ?? EMPTY_DRAFT));
    this.drafts.set(next);
  }
}
