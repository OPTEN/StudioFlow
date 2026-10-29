import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { PreferencesService } from '../../core/ui/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import type { SplitterBehavior } from './splitter.directive';
import {
  DOCK_IDS,
  DOCK_TITLE_KEYS,
  DOCK_ZONES,
  LAYOUT_LIMITS,
  defaultLayout,
  moveDock,
  stepTarget,
  validateLayout,
  visibleZones,
  zoneOf,
  type DockId,
  type DockLayout,
  type DockSlotId,
  type DockZone,
} from './dock-layout';

/** Tabs of the pairing dock. */
export type PairingTab = 'phone' | 'laptop' | 'link';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The dock layout of the Regie (prototype `L`, `applyLayout`, `moveDock`, `resetLayout`): which dock is in which zone,
 * weights, zone sizes, the monitor split, hidden docks and the temporary pairing dock. Persisted per browser
 * (`studioflow.layout`, v1); a stored layout with any inconsistency is replaced by the default.
 *
 * Used by the workspace (rendering, drag and drop, splitters), the header ("Layout"), the devices dock
 * (pairing toggle) and the stage (monitor split: {@link split}, {@link monitorSplitBehavior}).
 */
@Injectable({ providedIn: 'root' })
export class DockLayoutService {
  private readonly preferences = inject(PreferencesService);
  private readonly toasts = inject(ToastService);

  private readonly layoutSignal = signal<DockLayout>(
    validateLayout(this.preferences.readLayout()) ?? defaultLayout(),
  );
  private readonly pairingOpenSignal = signal(false);
  private readonly pairingTabSignal = signal<PairingTab>('laptop');

  /** The current layout. */
  readonly layout = this.layoutSignal.asReadonly();
  /** The pairing dock is open (it replaces Sources and Properties). */
  readonly pairingOpen = this.pairingOpenSignal.asReadonly();
  /** Tab the pairing dock should show (set by {@link openPairing}). */
  readonly pairingTab = this.pairingTabSignal.asReadonly();
  /** Docks shown per zone, in order, with the pairing dock substituted while open. */
  readonly zones = computed(() => visibleZones(this.layoutSignal(), this.pairingOpenSignal()), {
    equal: (a, b) =>
      DOCK_ZONES.every(
        (zone) =>
          a[zone].length === b[zone].length && a[zone].every((id, index) => id === b[zone][index]),
      ),
  });
  /** Monitor split in Studio Mode (share of the Preview, 0.3–0.7). */
  readonly split = computed(() => this.layoutSignal().split);
  /** True when at least one side zone shows a dock. */
  readonly hasSideDocks = computed(() => {
    const zones = this.zones();
    return zones.left.length > 0 || zones.right.length > 0;
  });
  /** Docks that keep the 16 px window gutter on the left (prototype `edge-l`). */
  readonly leftEdgeDocks = computed<readonly DockSlotId[]>(() => {
    const zones = this.zones();
    return zones.left.length > 0 ? zones.left : zones.bottom.slice(0, 1);
  });
  /** Docks that keep the 16 px window gutter on the right (prototype `edge-r`). */
  readonly rightEdgeDocks = computed<readonly DockSlotId[]>(() => {
    const zones = this.zones();
    return zones.right.length > 0 ? zones.right : zones.bottom.slice(-1);
  });

  constructor() {
    const keyboard = inject(KeyboardService);
    const unregister = keyboard.registerEscape('pairing', () => {
      if (!this.pairingOpenSignal()) {
        return false;
      }
      this.closePairing();
      return true;
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  /** True when the dock is not hidden. */
  isShown(id: DockId): boolean {
    return !this.layoutSignal().hidden.includes(id);
  }

  /** Zone that holds a dock. */
  zoneOf(id: DockId): DockZone {
    return zoneOf(this.layoutSignal(), id);
  }

  /** Shows or hides a dock ("Layout"); persisted. */
  setShown(id: DockId, shown: boolean): void {
    const layout = this.layoutSignal();
    const hidden = shown
      ? layout.hidden.filter((entry) => entry !== id)
      : [...new Set([...layout.hidden, id])];
    this.commit({ ...layout, hidden });
  }

  /** "Hide dock" of a dock's right-click menu: hides it with a toast that offers "Undo" ("Layout" shows it again). */
  hideDock(id: DockId): void {
    if (!this.isShown(id)) {
      return;
    }
    this.setShown(id, false);
    this.toasts.show(t('regie.workspace.menu.hidden', { dock: t(DOCK_TITLE_KEYS[id]) }), {
      label: t('regie.workspace.layout.undo'),
      run: () => this.setShown(id, true),
    });
  }

  /**
   * Docks a dock in `zone` at `index` (drag and drop, keyboard); persisted. Shows "Devices is docked on the right"
   * with "Undo", which puts the docks back where they were before this move (sizes and hidden docks stay as they are
   * now). Returns false when nothing changed.
   */
  moveDock(id: DockId, zone: DockZone, index: number): boolean {
    const layout = this.layoutSignal();
    const next = moveDock(layout, id, zone, index);
    if (next === layout) {
      return false;
    }
    this.commit(next);
    const dock = t(DOCK_TITLE_KEYS[id]);
    this.toasts.success(t(`regie.workspace.docked.${zone}`, { dock }), {
      label: t('regie.workspace.layout.undo'),
      run: () => {
        this.commit({ ...this.layoutSignal(), zones: layout.zones });
        this.toasts.show(t('regie.workspace.layout.moveUndone', { dock }));
      },
    });
    return true;
  }

  /** Keyboard move with the grip: one step through left → bottom → right. Returns false at the ends. */
  moveDockBy(id: DockId, direction: -1 | 1): boolean {
    const target = stepTarget(this.layoutSignal(), id, direction);
    return target ? this.moveDock(id, target.zone, target.index) : false;
  }

  /**
   * Restores the default layout ("Reset layout…", after a confirmation); persisted. The toast offers "Undo", which
   * brings back the whole layout as it was.
   */
  resetLayout(): void {
    const before = this.layoutSignal();
    this.commit(defaultLayout());
    this.toasts.success(t('regie.workspace.layout.resetDone'), {
      label: t('regie.workspace.layout.undo'),
      run: () => this.commit(before),
    });
  }

  /** Sets the weights of two neighbouring docks while a splitter moves (not persisted until {@link save}). */
  setWeights(a: DockSlotId, weightA: number, b: DockSlotId, weightB: number): void {
    const limit = (value: number): number =>
      clamp(value, LAYOUT_LIMITS.weightMin, LAYOUT_LIMITS.weightMax);
    const layout = this.layoutSignal();
    this.layoutSignal.set({
      ...layout,
      weights: { ...layout.weights, [a]: limit(weightA), [b]: limit(weightB) },
    });
  }

  /** Resets the weights of two docks (double-click or Enter on their splitter); persisted. */
  resetWeights(a: DockSlotId, b: DockSlotId): void {
    const defaults = defaultLayout().weights;
    const layout = this.layoutSignal();
    this.commit({ ...layout, weights: { ...layout.weights, [a]: defaults[a], [b]: defaults[b] } });
  }

  /**
   * "Reset size" of a dock's right-click menu: its share of the zone and the zone's own size (the width of a side zone,
   * the height of the bottom zone) go back to their defaults; persisted.
   */
  resetDockSize(id: DockId): void {
    const defaults = defaultLayout();
    const layout = this.layoutSignal();
    const zone = zoneOf(layout, id);
    const weights = { ...layout.weights, [id]: defaults.weights[id] };
    if (zone === 'bottom') {
      this.commit({ ...layout, weights, bottomH: null });
    } else {
      const key = zone === 'left' ? 'leftW' : 'rightW';
      this.commit({ ...layout, weights, [key]: defaults[key] });
    }
  }

  /** Height of the bottom zone as a fraction of the centre column (null = default height). */
  setBottomHeight(fraction: number | null): void {
    const value = fraction === null ? null : clamp(fraction, 0.01, 0.99);
    this.layoutSignal.set({ ...this.layoutSignal(), bottomH: value });
  }

  /** Width of a side zone in px. */
  setSideWidth(zone: 'left' | 'right', width: number): void {
    const value = Math.round(clamp(width, LAYOUT_LIMITS.sideMin, LAYOUT_LIMITS.sideMax));
    this.layoutSignal.set({
      ...this.layoutSignal(),
      [zone === 'left' ? 'leftW' : 'rightW']: value,
    });
  }

  /** Resets a side zone width; persisted. */
  resetSideWidth(zone: 'left' | 'right'): void {
    const defaults = defaultLayout();
    this.commit({
      ...this.layoutSignal(),
      [zone === 'left' ? 'leftW' : 'rightW']: zone === 'left' ? defaults.leftW : defaults.rightW,
    });
  }

  /** Monitor split (share of the Preview, clamped to 0.3–0.7). */
  setSplit(split: number): void {
    this.layoutSignal.set({
      ...this.layoutSignal(),
      split: clamp(split, LAYOUT_LIMITS.splitMin, LAYOUT_LIMITS.splitMax),
    });
  }

  /** Resets the monitor split to 50/50; persisted. */
  resetSplit(): void {
    this.commit({ ...this.layoutSignal(), split: defaultLayout().split });
  }

  /** Resets the bottom zone to its default height; persisted. */
  resetBottomHeight(): void {
    this.commit({ ...this.layoutSignal(), bottomH: null });
  }

  /** Persists the current layout (end of a splitter drag). */
  save(): void {
    this.preferences.writeLayout(this.layoutSignal());
  }

  /** Opens the pairing dock (in place of Sources and Properties), optionally on a tab. */
  openPairing(tab?: PairingTab): void {
    if (tab) {
      this.pairingTabSignal.set(tab);
    }
    this.pairingOpenSignal.set(true);
  }

  /** Closes the pairing dock. */
  closePairing(): void {
    this.pairingOpenSignal.set(false);
  }

  /** Toggles the pairing dock ("Add device"), opening on the Laptop tab like the prototype. */
  togglePairing(): void {
    if (this.pairingOpenSignal()) {
      this.closePairing();
    } else {
      this.openPairing('laptop');
    }
  }

  /** Remembers the tab the pairing dock shows (roving tabs). */
  setPairingTab(tab: PairingTab): void {
    this.pairingTabSignal.set(tab);
  }

  /**
   * Splitter behaviour for the monitor split between Preview and Program (prototype `.split-mon`): `measureWidth`
   * returns the width of the monitor row minus the 20 px split. Use with `[sfSplitter]` on the split element.
   */
  monitorSplitBehavior(measureWidth: () => number): SplitterBehavior {
    return {
      begin: () => {
        const width = Math.max(1, measureWidth());
        const start = this.layoutSignal().split;
        return {
          move: (dx: number) => this.setSplit(start + dx / width),
          end: () => this.save(),
        };
      },
      reset: () => this.resetSplit(),
    };
  }

  /** All dock ids (for menus). */
  readonly dockIds = DOCK_IDS;
  /** All zones. */
  readonly dockZones = DOCK_ZONES;

  private commit(layout: DockLayout): void {
    this.layoutSignal.set(layout);
    this.save();
  }
}
