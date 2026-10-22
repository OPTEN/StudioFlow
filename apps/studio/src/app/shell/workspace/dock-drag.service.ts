import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { DragCursorService } from '../../core/ui/drag-cursor.service';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { PopoverService } from '../../core/ui/popover.directive';
import { ViewportService } from '../../core/ui/viewport.service';
import { DOCK_ZONES, type DockId, type DockZone } from './dock-layout';
import { DockLayoutService } from './dock-layout.service';

/** A dock drag in progress: the dock and the empty zones shown as drop strips. */
export interface DockDragState {
  readonly id: DockId;
  readonly strips: readonly DockZone[];
}

/** Pointer travel before a press on a dock header becomes a drag (prototype: 5 px). */
const DRAG_THRESHOLD_PX = 5;

/**
 * Drag and drop of docks by their header (prototype «Dock an der Kopfzeile ziehen»): after 5 px the dock fades, a
 * ghost follows the pointer, empty zones appear as dashed drop strips and a blue insertion line shows the target
 * between docks. Pointer moves are handled with native document listeners (no change detection per move); the
 * ghost and the line are positioned with direct style writes. Escape (layer `dockDrag`) cancels.
 *
 * Provided by `WorkspaceComponent`; dock frames call {@link pointerDown}.
 */
@Injectable()
export class DockDragService {
  private readonly document = inject(DOCUMENT);
  private readonly layout = inject(DockLayoutService);
  private readonly popovers = inject(PopoverService);
  private readonly cursor = inject(DragCursorService);
  private readonly viewport = inject(ViewportService);

  private host: HTMLElement | null = null;
  private pending: {
    readonly id: DockId;
    readonly x: number;
    readonly y: number;
    readonly pointerId: number;
  } | null = null;
  private target: { readonly zone: DockZone; readonly index: number } | null = null;
  private readonly draggingSignal = signal<DockDragState | null>(null);
  private readonly hotStripSignal = signal<DockZone | null>(null);

  private readonly onMove = (event: PointerEvent): void => this.handleMove(event);
  private readonly onUp = (event: PointerEvent): void => {
    if (this.pending && event.pointerId === this.pending.pointerId) {
      this.end(true);
    }
  };
  private readonly onCancel = (event: PointerEvent): void => {
    if (this.pending && event.pointerId === this.pending.pointerId) {
      this.end(false);
    }
  };

  /** The running drag, or null. */
  readonly dragging = this.draggingSignal.asReadonly();
  /** The drop strip under the pointer. */
  readonly hotStrip = this.hotStripSignal.asReadonly();

  constructor() {
    const unregister = inject(KeyboardService).registerEscape('dockDrag', () => {
      if (!this.draggingSignal()) {
        return false;
      }
      this.end(false);
      return true;
    });
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.end(false);
    });
  }

  /** The workspace element (drop strips and hit tests live inside it). */
  attach(host: HTMLElement): void {
    this.host = host;
  }

  /** A press on a dock header; becomes a drag after 5 px. Ignored on stacked layouts. */
  pointerDown(id: DockId, event: PointerEvent): void {
    if (event.button !== 0 || this.viewport.stacked() || this.pending) {
      return;
    }
    this.pending = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    this.document.addEventListener('pointermove', this.onMove);
    this.document.addEventListener('pointerup', this.onUp);
    this.document.addEventListener('pointercancel', this.onCancel);
  }

  private handleMove(event: PointerEvent): void {
    const pending = this.pending;
    if (!pending || event.pointerId !== pending.pointerId) {
      return;
    }
    if (!this.draggingSignal()) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD_PX) {
        return;
      }
      this.start(pending.id);
    }
    event.preventDefault();
    this.track(pending.id, event.clientX, event.clientY);
  }

  private start(id: DockId): void {
    this.popovers.closeAll();
    const zones = this.layout.zones();
    const strips = DOCK_ZONES.filter((zone) => !zones[zone].some((entry) => entry !== id));
    this.draggingSignal.set({ id, strips });
    this.cursor.begin('grabbing');
  }

  private track(id: DockId, x: number, y: number): void {
    const ghost = this.host?.querySelector<HTMLElement>('.c-dock-ghost');
    if (ghost) {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
    }
    const line = this.host?.querySelector<HTMLElement>('.c-drop-line');
    this.target = null;
    if (line) {
      line.style.display = 'none';
    }
    let hot: DockZone | null = null;
    for (const strip of this.host?.querySelectorAll<HTMLElement>('[data-strip]') ?? []) {
      const rect = strip.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        hot = strip.dataset['strip'] as DockZone;
      }
    }
    if (this.hotStripSignal() !== hot) {
      this.hotStripSignal.set(hot);
    }
    if (hot) {
      this.target = { zone: hot, index: 0 };
      return;
    }
    const dock = this.dockUnder(x, y);
    if (!dock || !line) {
      return;
    }
    const dockId = dock.dataset['dock'] as DockId;
    const zone = (dock.closest<HTMLElement>('[data-zone]')?.dataset['zone'] ??
      'bottom') as DockZone;
    const rect = dock.getBoundingClientRect();
    const across = zone === 'bottom';
    const after = across ? x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2;
    const list = this.layout.layout().zones[zone].filter((entry) => entry !== id);
    this.target = { zone, index: list.indexOf(dockId) + (after ? 1 : 0) };
    line.style.display = 'block';
    if (across) {
      Object.assign(line.style, {
        left: `${(after ? rect.right : rect.left) - 1.5}px`,
        top: `${rect.top}px`,
        width: '3px',
        height: `${rect.height}px`,
      });
    } else {
      Object.assign(line.style, {
        left: `${rect.left}px`,
        top: `${(after ? rect.bottom : rect.top) - 1.5}px`,
        width: `${rect.width}px`,
        height: '3px',
      });
    }
  }

  /** The dock under the pointer (ignoring the cursor layer, the ghost and the dragged dock), or null. */
  private dockUnder(x: number, y: number): HTMLElement | null {
    const dragged = this.draggingSignal()?.id;
    for (const element of this.document.elementsFromPoint(x, y)) {
      if (this.cursor.isLayer(element) || element.closest('.c-dock-ghost')) {
        continue;
      }
      const dock = element.closest<HTMLElement>('[data-zone] [data-dock]');
      if (!dock) {
        return null;
      }
      const id = dock.dataset['dock'];
      return id === dragged || id === 'pair' ? null : dock;
    }
    return null;
  }

  private end(commit: boolean): void {
    const pending = this.pending;
    this.pending = null;
    this.document.removeEventListener('pointermove', this.onMove);
    this.document.removeEventListener('pointerup', this.onUp);
    this.document.removeEventListener('pointercancel', this.onCancel);
    if (!this.draggingSignal()) {
      return;
    }
    const target = this.target;
    this.target = null;
    this.draggingSignal.set(null);
    this.hotStripSignal.set(null);
    this.cursor.end();
    if (commit && pending && target) {
      this.layout.moveDock(pending.id, target.zone, target.index);
    }
  }
}
