import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  LIMITS,
  type SceneBackgroundDto,
  type SceneDto,
  type SceneLayoutMode,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { isPermutation, sameOrder } from '../../core/ui/reorder';
import { ToastService } from '../../core/ui/toast.service';
import { SwitcherService } from '../../stage/switcher.service';
import { DockCommandService } from '../shared/dock-command.service';
import { copyName, moveSceneOrder, nextSceneName } from './scene-list';

/** {@link DockCommandService} key of the reorder request. */
const ORDER_KEY = 'scene:order';
/** How long a dropped order stays on screen when the store does not report it (a lost event). */
const PENDING_ORDER_MS = 3000;

/**
 * The scene commands of the Scenes and Properties docks (spec 4.2, 4.3): create ("+ Scene"), duplicate, rename,
 * reorder (drag and drop, move up/down), send to the Preview, change the background or layout mode and delete. Every
 * command goes through
 * {@link DockCommandService} (double-click protection, offline guard, error toasts in the active language); the new
 * state arrives as `sceneUpserted` / `scenesReordered` / `sceneRemoved` events through the store.
 *
 * {@link renamingId} is the scene whose name is being edited inline in the scene list; creating a scene opens it.
 */
@Injectable({ providedIn: 'root' })
export class SceneCommandsService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);
  private readonly toasts = inject(ToastService);
  private readonly commands = inject(DockCommandService);

  private readonly renamingIdSignal = signal<string | null>(null);
  /** The order just dropped while its request runs and until the store reports it, or null. */
  private readonly pendingOrder = signal<readonly string[] | null>(null);
  private queuedOrder: readonly string[] | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Scene whose name is edited inline in the scene list, or null. */
  readonly renamingId = this.renamingIdSignal.asReadonly();
  private readonly storeOrder = computed(() => this.store.scenes().map((scene) => scene.id));
  /** Scene ids in list order: the order just dropped while it is being saved, else the store's. */
  readonly order = computed(() => this.pendingOrder() ?? this.storeOrder());
  /** "+ Scene" is possible: connected and fewer than 99 scenes. */
  readonly canCreate = computed(
    () => this.store.canCommand() && this.store.scenes().length < LIMITS.scenesPerProduction,
  );
  /** Scene commands can reach the server. */
  readonly online = computed(() => this.store.canCommand());
  /** A reorder request is in flight. */
  readonly reordering = computed(() => this.commands.busy(ORDER_KEY));

  constructor() {
    // The dropped order has done its job once the store reports it and no request is left.
    effect(() => {
      const pending = this.pendingOrder();
      if (pending && !this.reordering() && sameOrder(pending, this.storeOrder())) {
        untracked(() => this.pendingOrder.set(null));
      }
    });
    inject(DestroyRef).onDestroy(() => this.clearPendingTimer());
  }

  /** Opens (scene id) or closes (null) the inline rename field. */
  setRenaming(sceneId: string | null): void {
    this.renamingIdSignal.set(sceneId);
  }

  /** "+ Scene": creates "New scene N" at the end and opens its name for editing. */
  async create(): Promise<SceneDto | undefined> {
    if (this.store.scenes().length >= LIMITS.scenesPerProduction) {
      this.toasts.show(t('regie.scenes.toast.limit', { max: LIMITS.scenesPerProduction }));
      return undefined;
    }
    const name = nextSceneName(this.store.scenes());
    const created = await this.commands.run('scene:create', (productionId) =>
      this.api.createScene(productionId, { name, cloneFromSceneId: null }),
    );
    if (created) {
      this.toasts.show(t('regie.scenes.toast.created', { name: created.name }));
      this.renamingIdSignal.set(created.id);
    }
    return created;
  }

  /** Duplicates a scene with its items, layout mode and background as "Name (copy)". */
  async duplicate(sceneId: string): Promise<SceneDto | undefined> {
    const scene = this.store.sceneById(sceneId);
    if (!scene) {
      return undefined;
    }
    if (this.store.scenes().length >= LIMITS.scenesPerProduction) {
      this.toasts.show(t('regie.scenes.toast.limit', { max: LIMITS.scenesPerProduction }));
      return undefined;
    }
    const name = copyName(scene.name, this.store.scenes());
    const created = await this.commands.run(`scene:${sceneId}:duplicate`, (productionId) =>
      this.api.createScene(productionId, { name, cloneFromSceneId: sceneId }),
    );
    if (created) {
      this.toasts.show(t('regie.scenes.toast.created', { name: created.name }));
    }
    return created;
  }

  /** Renames a scene (1–80 characters after trimming). Resolves true on success. */
  async rename(sceneId: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > LIMITS.sceneNameLength) {
      this.toasts.show(t('regie.scenes.toast.nameLength', { max: LIMITS.sceneNameLength }));
      return false;
    }
    const scene = this.store.sceneById(sceneId);
    if (!scene || scene.name === trimmed) {
      return scene !== null;
    }
    const updated = await this.commands.run(`scene:${sceneId}:rename`, (productionId) =>
      this.api.updateScene(productionId, sceneId, {
        name: trimmed,
        layoutMode: null,
        background: null,
      }),
    );
    return updated !== undefined;
  }

  /** True when the scene can move one place in `direction`. */
  canMove(sceneId: string, direction: -1 | 1): boolean {
    return moveSceneOrder(this.order(), sceneId, direction) !== null;
  }

  /** Moves a scene one place up (−1) or down (+1) in the list (keys 1–9 follow the order). */
  async move(sceneId: string, direction: -1 | 1): Promise<boolean> {
    const order = moveSceneOrder(this.order(), sceneId, direction);
    return order !== null && (await this.reorder(order));
  }

  /**
   * Applies a new scene order (drag and drop, Alt+↑/↓, Move up/down). The list shows it at once ({@link order}) and
   * the request follows; moves made while it is in flight are merged, so only the newest order is sent next. If a
   * request fails the list returns to the server's order and a toast says why. Resolves true when the order was
   * sent.
   */
  async reorder(sceneIds: readonly string[]): Promise<boolean> {
    if (sameOrder(sceneIds, this.order()) || !isPermutation(sceneIds, this.order())) {
      return false;
    }
    this.pendingOrder.set(sceneIds);
    this.queuedOrder = sceneIds;
    if (this.commands.busy(ORDER_KEY)) {
      return true;
    }
    return this.sendQueuedOrders();
  }

  private async sendQueuedOrders(): Promise<boolean> {
    while (this.queuedOrder) {
      const sceneIds = this.queuedOrder;
      this.queuedOrder = null;
      const sent = await this.commands.run(ORDER_KEY, async (productionId) => {
        await this.api.reorderScenes(productionId, { sceneIds: [...sceneIds] });
        return true;
      });
      if (!sent) {
        this.queuedOrder = null;
        this.pendingOrder.set(null);
        return false;
      }
    }
    this.dropPendingOrderLater();
    return true;
  }

  /** The order the store reports can lag behind the response: keep the dropped order until it arrives. */
  private dropPendingOrderLater(): void {
    const dropped = this.pendingOrder();
    this.clearPendingTimer();
    this.pendingTimer = setTimeout(() => {
      if (this.pendingOrder() === dropped) {
        this.pendingOrder.set(null);
      }
    }, PENDING_ORDER_MS);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** Sets the background colour and image of a scene. */
  async setBackground(sceneId: string, background: SceneBackgroundDto): Promise<boolean> {
    const updated = await this.commands.run(`scene:${sceneId}:background`, (productionId) =>
      this.api.updateScene(productionId, sceneId, { name: null, layoutMode: null, background }),
    );
    return updated !== undefined;
  }

  /** Sets the layout mode of a scene (free or auto grid) without touching the items. */
  async setLayoutMode(sceneId: string, layoutMode: SceneLayoutMode): Promise<boolean> {
    const updated = await this.commands.run(`scene:${sceneId}:layout`, (productionId) =>
      this.api.updateScene(productionId, sceneId, { name: null, layoutMode, background: null }),
    );
    return updated !== undefined;
  }

  /** Says why the live scene cannot be deleted (Delete key on its row). */
  explainLiveDelete(): void {
    this.toasts.show(t('regie.scenes.toast.liveDelete'));
  }

  /**
   * Deletes a scene with all its items. The live scene cannot be deleted. In Studio Mode a deleted preview scene is
   * replaced by its neighbour first (prototype), so the preview never jumps elsewhere.
   */
  async remove(sceneId: string): Promise<boolean> {
    const scene = this.store.sceneById(sceneId);
    if (!scene) {
      return false;
    }
    if (sceneId === this.store.programSceneId()) {
      this.explainLiveDelete();
      return false;
    }
    const done = await this.commands.run(`scene:${sceneId}:delete`, async (productionId) => {
      const neighbour = this.previewAfterDelete(sceneId);
      if (neighbour) {
        await this.api.setPreview(productionId, { sceneId: neighbour });
      }
      await this.api.deleteScene(productionId, sceneId);
      return true;
    });
    if (done) {
      if (this.renamingIdSignal() === sceneId) {
        this.renamingIdSignal.set(null);
      }
      this.toasts.show(t('regie.scenes.toast.deleted', { name: scene.name }));
    }
    return done === true;
  }

  /**
   * "Send to Preview" of the row menu: loads the scene into the Preview so that it can be prepared in Sources and
   * Properties without going live. Without Studio Mode it turns Studio Mode on first (the switcher says so in a toast).
   */
  async sendToPreview(sceneId: string): Promise<void> {
    if (!this.store.sceneById(sceneId)) {
      return;
    }
    if (!this.switcher.studioMode()) {
      await this.switcher.setStudioMode(true);
    }
    await this.switcher.chooseScene(sceneId);
  }

  /** True when the scene is in the Preview of Studio Mode ("Send to Preview" has nothing to do). */
  inPreview(sceneId: string): boolean {
    return this.switcher.studioMode() && this.store.previewSceneId() === sceneId;
  }

  /** True while the command with this key runs (see {@link DockCommandService.busy}). */
  busy(key: string): boolean {
    return this.commands.busy(key);
  }

  /** True when the command's button is disabled: it runs, or the Regie is offline. */
  blocked(key: string): boolean {
    return this.commands.blocked(key);
  }

  /** The new preview when the preview scene is deleted in Studio Mode (prototype), else null. */
  private previewAfterDelete(sceneId: string): string | null {
    if (!this.switcher.studioMode() || this.store.previewSceneId() !== sceneId) {
      return null;
    }
    const scenes = this.store.scenes();
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const rest = scenes.filter((scene) => scene.id !== sceneId);
    if (rest.length === 0) {
      return null;
    }
    const program = this.store.programSceneId();
    const candidate = rest[index] ?? rest[index - 1] ?? rest[0];
    if (candidate.id !== program || rest.length === 1) {
      return candidate.id;
    }
    return rest.find((entry) => entry.id !== program)?.id ?? candidate.id;
  }
}
