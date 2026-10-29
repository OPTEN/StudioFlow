import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { ItemFit, SceneDto, SceneItemDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ClipboardService } from '../core/ui/clipboard.service';
import type { ContextMenuEntry } from '../core/ui/context-menu';
import { BROWSER_STORAGE } from '../core/ui/preferences.service';
import { keyHint } from '../core/ui/shortcuts';
import { DockLayoutService } from '../shell/workspace/dock-layout.service';
import { EditorService } from './editor.service';
import type { MonitorKind } from './monitor.component';
import { SwitcherService } from './switcher.service';

/** Browser storage key of "Show safe area" (per browser, like Studio Mode). */
export const SAFE_AREA_KEY = 'studioflow.safeArea';

function hasCrop(item: SceneItemDto): boolean {
  const { top, right, bottom, left } = item.crop;
  return top > 0 || right > 0 || bottom > 0 || left > 0;
}

function readSafeArea(storage: () => Storage | null): boolean {
  try {
    return storage()?.getItem(SAFE_AREA_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The commands of the stage's right-click menus and ⋯ buttons, in one place so the menu of an item on the monitor, its
 * ⋯ button in the label tab and the ⋯ button of a monitor header offer exactly the same entries.
 *
 * - Item on the editable monitor: layer order, Fit / Fill (pictures), Full screen, Reset crop (when cropped), Lock or
 *   Unlock, Hide, Properties… (selects it and brings the Properties dock into view) and Remove from scene (Del, with
 *   "Undo" in its toast). While the scene is live in Studio Mode the changing entries are disabled.
 * - Monitor: Preview: Take (Space), Send Program to Preview, Load next scene; Program: Turn on/off Studio Mode; both:
 *   Show safe area (per browser) and Copy scene name.
 *
 * Every entry is also reachable elsewhere: the ⋯ buttons, the Properties and Sources docks and the control column.
 */
@Injectable({ providedIn: 'root' })
export class StageCommandsService {
  private readonly editor = inject(EditorService);
  private readonly switcher = inject(SwitcherService);
  private readonly store = inject(ProductionStoreService);
  private readonly layout = inject(DockLayoutService);
  private readonly clipboard = inject(ClipboardService);
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(BROWSER_STORAGE);

  private readonly safeAreaSignal = signal(readSafeArea(this.storage));
  /** The dashed safe-area guide shows on both monitors all the time (else only while editing). */
  readonly showSafeArea = this.safeAreaSignal.asReadonly();

  /** "Show safe area" on or off (kept in this browser). */
  toggleSafeArea(): void {
    const next = !this.safeAreaSignal();
    this.safeAreaSignal.set(next);
    try {
      this.storage()?.setItem(SAFE_AREA_KEY, next ? '1' : '0');
    } catch {
      // Private mode: the setting lasts until the page is reloaded.
    }
  }

  /** The menu of an item of the edit scene; selects the item (a right click selects, like on a desktop). */
  itemMenu(itemId: string): readonly ContextMenuEntry[] {
    const scene = this.editor.editScene();
    const item = this.editor.itemById(itemId);
    if (!scene || !item) {
      return [];
    }
    const locked = this.editor.editLocked();
    if (!locked && this.editor.selectedItemId() !== itemId) {
      this.editor.select(itemId);
    }
    const index = scene.items.findIndex((entry) => entry.id === itemId);
    const top = index === scene.items.length - 1;
    const bottom = index === 0;
    const picture = this.store.kindOf(item.source) !== 'text';
    const fixed = locked || item.locked;
    const entries: ContextMenuEntry[] = [
      {
        label: t('regie.stage.menu.forward'),
        icon: 'up',
        disabled: locked || top,
        run: () => this.editor.moveLayer(itemId, 'up'),
      },
      {
        label: t('regie.stage.menu.backward'),
        icon: 'down',
        disabled: locked || bottom,
        run: () => this.editor.moveLayer(itemId, 'down'),
      },
      {
        label: t('regie.stage.menu.front'),
        disabled: locked || top,
        run: () => this.editor.moveLayer(itemId, 'front'),
      },
      {
        label: t('regie.stage.menu.back'),
        disabled: locked || bottom,
        run: () => this.editor.moveLayer(itemId, 'back'),
      },
      'separator',
    ];
    if (picture) {
      entries.push(
        {
          label: t('regie.stage.menu.fit'),
          checked: item.fit === 'contain',
          disabled: locked,
          run: () => this.setFit(itemId, 'contain'),
        },
        {
          label: t('regie.stage.menu.fill'),
          checked: item.fit === 'cover',
          disabled: locked,
          run: () => this.setFit(itemId, 'cover'),
        },
      );
    }
    entries.push({
      label: t('regie.stage.menu.fullScreen'),
      disabled: fixed,
      run: () => this.fullScreen(itemId),
    });
    if (picture && hasCrop(item)) {
      entries.push({
        label: t('regie.stage.menu.resetCrop'),
        disabled: fixed,
        run: () => this.resetCrop(itemId),
      });
    }
    entries.push(
      'separator',
      {
        label: item.locked ? t('regie.stage.menu.unlock') : t('regie.stage.menu.lock'),
        icon: item.locked ? 'unlock' : 'lock',
        run: () => this.editor.toggleLocked(itemId),
      },
      {
        label: t('regie.stage.menu.hide'),
        icon: 'eye-off',
        disabled: locked && picture,
        run: () => this.editor.toggleHidden(itemId),
      },
      {
        label: t('regie.stage.menu.properties'),
        icon: 'sliders',
        disabled: locked,
        run: () => this.showProperties(itemId),
      },
      'separator',
      {
        label: t('regie.stage.menu.remove'),
        icon: 'trash',
        shortcut: keyHint('Del'),
        danger: true,
        disabled: locked,
        run: () => this.editor.removeItem(itemId),
      },
    );
    return entries;
  }

  /** The menu of a monitor (header, ⋯ button and the picture around the items). */
  monitorMenu(kind: MonitorKind, scene: SceneDto | null): readonly ContextMenuEntry[] {
    const studio = this.switcher.studioMode();
    const entries: ContextMenuEntry[] = [];
    if (kind === 'preview') {
      const program = this.store.programSceneId();
      const next = this.switcher.nextSceneId();
      const preview = this.store.previewSceneId();
      entries.push(
        {
          label: t('regie.stage.control.take'),
          icon: 'play',
          shortcut: keyHint('space'),
          disabled: !this.switcher.canTake(),
          run: () => void this.switcher.take(),
        },
        {
          label: t('regie.stage.menu.programToPreview'),
          disabled: !studio || program === null || program === preview || this.switcher.busy(),
          run: () => void this.switcher.programToPreview(),
        },
        {
          label: t('regie.stage.menu.nextScene'),
          disabled: !studio || next === null || next === preview || this.switcher.busy(),
          run: () => void this.switcher.loadNextScene(),
        },
      );
    } else {
      entries.push({
        label: studio ? t('regie.stage.menu.studioOff') : t('regie.stage.previewOff.action'),
        run: () => void this.switcher.setStudioMode(!studio),
      });
    }
    entries.push(
      'separator',
      {
        label: t('regie.stage.menu.safeArea'),
        checked: this.showSafeArea(),
        run: () => this.toggleSafeArea(),
      },
      {
        label: t('regie.stage.menu.copyName'),
        icon: 'copy',
        disabled: !scene,
        run: () => {
          if (scene) {
            void this.clipboard.copy(scene.name);
          }
        },
      },
    );
    return entries;
  }

  /** Fit (`contain`) or Fill (`cover`) of a picture. */
  setFit(itemId: string, fit: ItemFit): void {
    const item = this.editor.itemById(itemId);
    if (item && item.fit !== fit) {
      this.editor.updateItem({ ...item, fit });
    }
  }

  /** The item covers the whole canvas (square corners, like the "Full screen" template slot). */
  fullScreen(itemId: string): void {
    const item = this.editor.itemById(itemId);
    if (!item) {
      return;
    }
    const canvas = this.store.canvas();
    this.editor.updateItem({ ...item, x: 0, y: 0, w: canvas.width, h: canvas.height, radius: 0 });
  }

  resetCrop(itemId: string): void {
    const item = this.editor.itemById(itemId);
    if (item && hasCrop(item)) {
      this.editor.updateItem({ ...item, crop: { top: 0, right: 0, bottom: 0, left: 0 } });
    }
  }

  /** Selects the item and brings the Properties dock into view with the focus on its title. */
  showProperties(itemId: string): void {
    this.editor.select(itemId);
    if (!this.layout.isShown('insp')) {
      this.layout.setShown('insp', true);
    }
    // The dock renders in the next frame when it was hidden.
    setTimeout(() => {
      const title = this.document.querySelector<HTMLElement>(
        '[data-dock="insp"] .c-dock-frame__title',
      );
      title?.focus({ preventScroll: true });
      title?.scrollIntoView?.({ block: 'nearest' });
    });
  }
}
