import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  isDown,
  rectOf,
  safeMargin,
  type CanvasRect,
  type CropDto,
  type SceneItemDto,
} from '@studioflow/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ContextMenuService } from '../core/ui/context-menu';
import { DragCursorService, type DragCursor } from '../core/ui/drag-cursor.service';
import { IconComponent } from '../core/ui/icon.component';
import { ToastService } from '../core/ui/toast.service';
import {
  CORNERS,
  EDGES,
  NO_GUIDES,
  boxDetail,
  cropRect,
  isArrowKey,
  isCorner,
  moveRect,
  nudgeRect,
  passedDragThreshold,
  resizeRect,
  snapLines,
  snapThreshold,
  toCanvasPoint,
  toPercent,
  type CanvasPointer,
  type Corner,
  type GeometryResult,
  type Guides,
  type Handle,
  type PercentRect,
  type ScreenBox,
  type SnapLines,
} from './edit-geometry';
import { EditorService, liveLockedMessage, offlineEditMessage } from './editor.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import type { SceneViewComponent } from './scene-view.component';
import { StageCommandsService } from './stage-commands.service';
import { SwitcherService } from './switcher.service';

/** One selection box over a visible element. */
export interface EditBox {
  readonly id: string;
  /** Rectangle on the canvas (the renderer's rectangle for Auto-Grid scenes). */
  readonly rect: CanvasRect;
  readonly percent: PercentRect;
  /** Slot code of the source ("K1"), or null when the source is gone. */
  readonly code: string | null;
  /** Name of the source ("Stage phone"), "Source missing" when it is gone. */
  readonly name: string;
  /** Size on the canvas, with the crop: "600 × 338 · Crop R 10%". */
  readonly detail: string;
  readonly selected: boolean;
  /** Locked element (not draggable) or the whole scene is locked. */
  readonly locked: boolean;
  /** The element itself is locked: a lock badge on hover and selection, with the way out as tooltip. */
  readonly pinned: boolean;
  /** Down source: amber (`warn`, reconnecting) or red (`bad`) dashed outline. */
  readonly alert: 'warn' | 'bad' | null;
  /** Corner handles and crop edges are shown (selected and not locked). */
  readonly handles: boolean;
}

type DragMode =
  | { readonly kind: 'move' }
  | { readonly kind: 'resize'; readonly corner: Corner }
  | { readonly kind: 'crop'; readonly handle: Handle };

interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

interface Drag {
  readonly pointerId: number;
  readonly itemId: string;
  readonly mode: DragMode;
  readonly start: CanvasPointer;
  readonly screen: ScreenBox;
  readonly origin: CanvasRect;
  readonly crop: CropDto;
  readonly lines: SnapLines;
  readonly threshold: number;
  /** Renderer rectangles of an Auto-Grid scene at the start (the first change switches it to free layout). */
  readonly autoRects: ReadonlyMap<string, CanvasRect> | null;
  moved: boolean;
  latest: PointerSample | null;
  cancelFrame: (() => void) | null;
  /** The geometry last sent to the editor (starts with the element's own). */
  applied: { readonly rect: CanvasRect; readonly crop: CropDto };
}

const CROP_CURSORS: Readonly<Record<Handle, DragCursor>> = {
  n: 'row-resize',
  s: 'row-resize',
  e: 'col-resize',
  w: 'col-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

function cursorFor(mode: DragMode): DragCursor {
  switch (mode.kind) {
    case 'move':
      return 'move';
    case 'resize':
      return CROP_CURSORS[mode.corner];
    case 'crop':
      return CROP_CURSORS[mode.handle];
  }
}

function sameRect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameCrop(a: CropDto, b: CropDto): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function isHandle(value: string | undefined): value is Handle {
  return (
    value !== undefined &&
    ((CORNERS as readonly string[]).includes(value) || (EDGES as readonly string[]).includes(value))
  );
}

/**
 * The edit overlay on the editable monitor (Preview in Studio Mode, else Program; prototype "Overlay: edit items",
 * spec 9.1). It edits `EditorService.editScene()`:
 *
 * - Boxes for every visible element (the renderer's rectangles for Auto-Grid scenes). The selected one gets a blue
 *   outline (with a dark hairline, so it shows on bright slides too), soft round corner handles and a label tab with
 *   the source: code, name and size ("K1 Stage phone 600 × 338", with the crop). Down sources get the amber/red dashed
 *   outline; a locked element shows a lock badge on hover and selection, with the way out as its tooltip.
 * - Click selects (empty area deselects), drag moves with snapping to the canvas edges, the safe margin, the centre and
 *   the other elements' edges and centres (7 screen px, blue guides; Alt disables snapping), a corner resizes keeping
 *   the aspect ratio (Shift frees it, minimum 96 × 54), Alt+drag on a corner or an edge crops (OBS). Arrow keys move
 *   by 1 px (Shift 10 px), one undo step per key-repeat burst. Escape deselects (EditorService). Delete/Backspace
 *   removes the selected item (toast with "Undo"), Tab/Shift+Tab selects the next/previous item.
 * - Right click on an item (or the context-menu key, or the ⋯ button in its label tab) opens its menu
 *   ({@link StageCommandsService.itemMenu}): layer order, Fit/Fill, Full screen, Lock, Hide, Properties…, Remove.
 * - While hovering or dragging: the dashed safe-area guide. Locked elements are selectable but not draggable; while
 *   the scene is locked (Studio Mode, preview = program) a press shows the prototype's toast.
 * - Pointer moves are native listeners (no change detection per event), batched to one geometry step per animation
 *   frame; the overlay rectangle is measured once at pointerdown (no layout reads during a drag). Every step goes to
 *   `EditorService.updateItem` inside `beginGesture`/`endGesture`, which coalesces the requests. Pointer capture,
 *   `pointercancel`/`lostpointercapture`, mouse, pen and touch are handled alike.
 */
@Component({
  selector: 'sf-edit-overlay',
  imports: [IconComponent],
  templateUrl: './edit-overlay.component.html',
  styleUrl: './edit-overlay.component.scss',
  host: {
    class: 'c-edit-overlay',
    role: 'group',
    tabindex: '0',
    '[attr.aria-label]': "t('regie.stage.overlay.label')",
    '[class.is-locked]': 'editor.editLocked()',
    '[class.is-dragging]': 'dragging()',
    '[class.is-alt]': 'altHeld()',
    '[style.--sf-safe-x]': 'safeArea().x',
    '[style.--sf-safe-y]': 'safeArea().y',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeyDown($event)',
    '(keyup)': 'onKeyUp($event)',
    '(contextmenu)': 'onContextMenu($event)',
    '(focusout)': 'onFocusOut()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditOverlayComponent {
  /** The scene view of the same monitor: Auto-Grid rectangles and the editor's effective-rects source. */
  readonly view = input<SceneViewComponent | null>(null);

  protected readonly t = t;
  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);
  private readonly toasts = inject(ToastService);
  private readonly cursor = inject(DragCursorService);
  private readonly frame = inject(FRAME_SCHEDULER);
  private readonly menus = inject(ContextMenuService);
  private readonly commands = inject(StageCommandsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly corners = CORNERS;
  protected readonly edges = EDGES;
  protected readonly dragging = signal(false);
  protected readonly altHeld = signal(false);
  /** The safe margin as a share of the canvas width and height (the faint dashed guide). */
  protected readonly safeArea = computed(() => {
    const canvas = this.store.canvas();
    const margin = safeMargin(canvas);
    return {
      x: `${(margin / canvas.width) * 100}%`,
      y: `${(margin / canvas.height) * 100}%`,
    };
  });
  /** Blue guide lines (canvas px) while snapping. */
  protected readonly guides = signal<Guides>(NO_GUIDES);
  protected readonly guideX = computed(() => {
    const x = this.guides().x;
    return x === null ? null : toPercent({ x, y: 0, w: 0, h: 0 }, this.store.canvas()).left;
  });
  protected readonly guideY = computed(() => {
    const y = this.guides().y;
    return y === null ? null : toPercent({ x: 0, y, w: 0, h: 0 }, this.store.canvas()).top;
  });

  /** A box for every visible element of the edit scene, in z-order (the last one is on top). */
  readonly boxes = computed<readonly EditBox[]>(() => {
    const scene = this.editor.editScene();
    if (!scene) {
      return [];
    }
    const canvas = this.store.canvas();
    const locked = this.editor.editLocked();
    const selectedId = this.editor.selectedItemId();
    const autoRects = scene.layoutMode === 'autoGrid' ? (this.view()?.rects() ?? null) : null;
    const boxes: EditBox[] = [];
    for (const item of scene.items) {
      if (item.hidden) {
        continue;
      }
      const rect = autoRects ? autoRects.get(item.id) : rectOf(item);
      if (!rect) {
        // Auto-Grid leaves out sources that are not available.
        continue;
      }
      const status = this.store.statusOf(item.source);
      const selected = !locked && item.id === selectedId;
      boxes.push({
        id: item.id,
        rect,
        percent: toPercent(rect, canvas),
        code: this.store.codeOf(item.source) ?? null,
        name: this.store.sourceLabel(item.source),
        detail: boxDetail(rect, item.crop),
        selected,
        locked: locked || item.locked,
        pinned: item.locked,
        alert: status && isDown(status) ? (status === 'reconnecting' ? 'warn' : 'bad') : null,
        handles: selected && !item.locked,
      });
    }
    return boxes;
  });

  private drag: Drag | null = null;
  private nudging = false;
  private readonly onMove = (event: PointerEvent): void => this.pointerMove(event);
  private readonly onEnd = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.endDrag(true);
    }
  };

  constructor() {
    effect((onCleanup) => {
      const view = this.view();
      if (!view) {
        return;
      }
      onCleanup(this.editor.useEffectiveRects(() => view.effectiveRects()));
    });
    inject(DestroyRef).onDestroy(() => {
      this.endDrag(false);
      this.endNudge();
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.drag || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.c-edit-box__more')) {
      // The ⋯ button of the label tab opens the menu on click; no drag starts there.
      return;
    }
    const boxElement = target?.closest<HTMLElement>('[data-item-id]') ?? null;
    this.host.focus({ preventScroll: true });
    if (!boxElement || !this.host.contains(boxElement)) {
      if (!this.editor.editLocked()) {
        this.editor.select(null);
      }
      return;
    }
    if (this.switcher.transitionRunning()) {
      return;
    }
    if (this.editor.editLocked()) {
      this.toasts.show(liveLockedMessage());
      return;
    }
    const id = boxElement.dataset['itemId'] ?? '';
    const box = this.boxes().find((entry) => entry.id === id);
    const item = this.editor.itemById(id);
    if (!box || !item) {
      return;
    }
    event.preventDefault();
    if (this.editor.selectedItemId() !== id) {
      this.editor.select(id);
    }
    if (item.locked) {
      return;
    }
    if (!this.store.canCommand()) {
      this.toasts.show(offlineEditMessage());
      return;
    }
    const handleValue = target?.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const handle = isHandle(handleValue) ? handleValue : null;
    const screen = this.host.getBoundingClientRect();
    const canvas = this.store.canvas();
    const start = toCanvasPoint(event.clientX, event.clientY, screen, canvas);
    const others = this.boxes()
      .filter((entry) => entry.id !== id)
      .map((entry) => entry.rect);
    const autoGrid = this.editor.editScene()?.layoutMode === 'autoGrid';
    this.drag = {
      pointerId: event.pointerId,
      itemId: id,
      mode: this.modeFor(handle, event.altKey),
      start,
      screen: { left: screen.left, top: screen.top, width: screen.width, height: screen.height },
      origin: box.rect,
      crop: item.crop,
      lines: snapLines(others, canvas),
      threshold: snapThreshold(start.scale),
      autoRects: autoGrid ? (this.view()?.effectiveRects() ?? null) : null,
      moved: false,
      latest: null,
      cancelFrame: null,
      // Steps that end where the element already is send nothing.
      applied: { rect: box.rect, crop: item.crop },
    };
    try {
      this.host.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the listeners on the overlay still follow the pointer inside the monitor.
    }
    this.host.addEventListener('pointermove', this.onMove);
    this.host.addEventListener('pointerup', this.onEnd);
    this.host.addEventListener('pointercancel', this.onEnd);
    this.host.addEventListener('lostpointercapture', this.onEnd);
  }

  /** Right click on an item: its menu (selects it); elsewhere the monitor's menu takes over. */
  protected onContextMenu(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const id = target?.closest<HTMLElement>('[data-item-id]')?.dataset['itemId'];
    if (!id || this.drag) {
      return;
    }
    const entries = this.commands.itemMenu(id);
    if (entries.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.host.focus({ preventScroll: true });
    this.menus.open(
      entries,
      { x: event.clientX, y: event.clientY },
      { label: this.nameOf(id), returnFocus: this.host },
    );
  }

  /** The ⋯ button in the label tab of the selected item: the same menu, under the button. */
  protected openItemMenu(itemId: string, event: MouseEvent): void {
    event.stopPropagation();
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = button?.getBoundingClientRect();
    this.menus.open(
      this.commands.itemMenu(itemId),
      { x: rect?.left ?? event.clientX, y: (rect?.bottom ?? event.clientY) + 4 },
      { label: this.nameOf(itemId), returnFocus: this.host },
    );
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Alt') {
      // Alt+drag crops; keep the browser from moving the focus to its menu.
      event.preventDefault();
      this.altHeld.set(true);
      return;
    }
    if (this.drag) {
      return;
    }
    if (this.onItemKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!isArrowKey(event.key) || event.ctrlKey || event.metaKey || event.altKey || this.drag) {
      return;
    }
    const box = this.boxes().find((entry) => entry.selected);
    const item = this.editor.selectedItem();
    if (!box || !item || item.locked || this.editor.editLocked()) {
      return;
    }
    event.preventDefault();
    const rect = nudgeRect(box.rect, event.key, event.shiftKey);
    if (!rect) {
      return;
    }
    if (!this.nudging) {
      this.editor.beginGesture();
      this.nudging = true;
    }
    const changed = this.editor.updateItem(
      { ...item, x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      { effectiveRects: this.autoRectsNow() },
    );
    if (!changed) {
      this.endNudge();
    }
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Alt') {
      event.preventDefault();
      this.altHeld.set(false);
      return;
    }
    if (isArrowKey(event.key)) {
      this.endNudge();
    }
  }

  protected onFocusOut(): void {
    this.endNudge();
    this.altHeld.set(false);
  }

  /**
   * Keys on the selected item: Delete/Backspace removes it (the toast offers "Undo"), Tab/Shift+Tab selects the next or
   * previous item (past the last one the focus leaves the overlay as usual, so it is no trap), the context-menu key or
   * Shift+F10 opens its menu. Returns true when the key was used.
   */
  private onItemKey(event: KeyboardEvent): boolean {
    const box = this.boxes().find((entry) => entry.selected);
    if (!box || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.shiftKey) {
      if (!event.repeat) {
        this.editor.removeItem(box.id);
      }
      return true;
    }
    if (event.key === 'Tab') {
      const boxes = this.boxes();
      const next = boxes[boxes.indexOf(box) + (event.shiftKey ? -1 : 1)];
      if (!next) {
        return false;
      }
      this.endNudge();
      this.editor.select(next.id);
      return true;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const rect = this.host
        .querySelector<HTMLElement>(`[data-item-id="${CSS.escape(box.id)}"]`)
        ?.getBoundingClientRect();
      this.menus.open(
        this.commands.itemMenu(box.id),
        { x: (rect?.left ?? 0) + 12, y: (rect?.top ?? 0) + 12 },
        { label: box.name, returnFocus: this.host },
      );
      return true;
    }
    return false;
  }

  private nameOf(itemId: string): string {
    return this.boxes().find((entry) => entry.id === itemId)?.name ?? '';
  }

  private modeFor(handle: Handle | null, alt: boolean): DragMode {
    if (!handle) {
      return { kind: 'move' };
    }
    if (alt) {
      return { kind: 'crop', handle };
    }
    return isCorner(handle) ? { kind: 'resize', corner: handle } : { kind: 'move' };
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    drag.latest = {
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    if (!drag.cancelFrame) {
      drag.cancelFrame = this.frame(() => {
        drag.cancelFrame = null;
        this.applyDrag(drag);
      });
    }
  }

  /** One geometry step with the newest pointer sample (once per animation frame). */
  private applyDrag(drag: Drag): void {
    const sample = drag.latest;
    if (this.drag !== drag || !sample) {
      return;
    }
    const point = toCanvasPoint(sample.clientX, sample.clientY, drag.screen, this.store.canvas());
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved) {
      if (!passedDragThreshold(dx, dy, drag.start.scale)) {
        return;
      }
      drag.moved = true;
      this.editor.beginGesture();
      this.dragging.set(true);
      this.cursor.begin(cursorFor(drag.mode));
    }
    const result = this.step(drag, dx, dy, sample);
    this.guides.set(result.guides);
    const crop = result.crop ?? drag.crop;
    if (sameRect(drag.applied.rect, result.rect) && sameCrop(drag.applied.crop, crop)) {
      return;
    }
    const item = this.editor.itemById(drag.itemId);
    if (!item) {
      this.endDrag(false);
      return;
    }
    const next: SceneItemDto = {
      ...item,
      x: result.rect.x,
      y: result.rect.y,
      w: result.rect.w,
      h: result.rect.h,
      crop,
    };
    if (!this.editor.updateItem(next, { effectiveRects: drag.autoRects ?? undefined })) {
      this.endDrag(false);
      return;
    }
    drag.applied = { rect: result.rect, crop };
  }

  private step(
    drag: Drag,
    dx: number,
    dy: number,
    sample: PointerSample,
  ): GeometryResult & { readonly crop?: CropDto } {
    switch (drag.mode.kind) {
      case 'move':
        return moveRect(drag.origin, dx, dy, {
          lines: drag.lines,
          threshold: drag.threshold,
          snap: !sample.altKey,
        });
      case 'resize':
        return resizeRect(drag.origin, drag.mode.corner, dx, dy, {
          lines: drag.lines,
          threshold: drag.threshold,
          snap: true,
          keepRatio: !sample.shiftKey,
        });
      case 'crop':
        return cropRect(drag.origin, drag.crop, drag.mode.handle, dx, dy);
    }
  }

  /** Ends the drag; `flush` applies a pending pointer sample first (pointerup lands exactly where released). */
  private endDrag(flush: boolean): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    if (drag.cancelFrame) {
      drag.cancelFrame();
      drag.cancelFrame = null;
      if (flush) {
        this.applyDrag(drag);
      }
    }
    this.drag = null;
    this.host.removeEventListener('pointermove', this.onMove);
    this.host.removeEventListener('pointerup', this.onEnd);
    this.host.removeEventListener('pointercancel', this.onEnd);
    this.host.removeEventListener('lostpointercapture', this.onEnd);
    try {
      if (this.host.hasPointerCapture?.(drag.pointerId)) {
        this.host.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Already released.
    }
    if (drag.moved) {
      this.editor.endGesture();
      this.cursor.end();
    }
    this.dragging.set(false);
    this.guides.set(NO_GUIDES);
  }

  private endNudge(): void {
    if (this.nudging) {
      this.nudging = false;
      this.editor.endGesture();
    }
  }

  private autoRectsNow(): ReadonlyMap<string, CanvasRect> | undefined {
    return this.editor.editScene()?.layoutMode === 'autoGrid'
      ? this.view()?.effectiveRects()
      : undefined;
  }
}
