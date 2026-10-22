import { Injectable, computed, inject, signal } from '@angular/core';
import {
  LIMITS,
  type SceneBackgroundDto,
  type SceneDto,
  type SceneLayoutMode,
} from '@flowstudio/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';
import { SwitcherService } from '../../stage/switcher.service';
import { DockCommandService } from '../shared/dock-command.service';
import { copyName, moveSceneOrder, nextSceneName } from './scene-list';

/** Toast when the live scene should be deleted (prototype hint text). */
export const LIVE_SCENE_DELETE_MESSAGE = 'Die Live-Szene lässt sich nicht löschen.';

/**
 * The scene commands of the Szenen and Eigenschaften docks (spec 4.2, 4.3): create («+ Szene»), duplicate, rename,
 * move up/down, change the background or layout mode and delete. Every command goes through
 * {@link DockCommandService} (double-click protection, offline guard, German error toasts); the new state arrives
 * as `sceneUpserted` / `scenesReordered` / `sceneRemoved` events through the store.
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

  /** Scene whose name is edited inline in the scene list, or null. */
  readonly renamingId = this.renamingIdSignal.asReadonly();
  /** «+ Szene» is possible: connected and fewer than 99 scenes. */
  readonly canCreate = computed(
    () => this.store.canCommand() && this.store.scenes().length < LIMITS.scenesPerProduction,
  );
  /** Scene commands can reach the server. */
  readonly online = computed(() => this.store.canCommand());
  /** A reorder request is in flight. */
  readonly reordering = computed(() => this.commands.busy('scene:order'));

  /** Opens (scene id) or closes (null) the inline rename field. */
  setRenaming(sceneId: string | null): void {
    this.renamingIdSignal.set(sceneId);
  }

  /** «+ Szene»: creates «Neue Szene N» at the end and opens its name for editing. */
  async create(): Promise<SceneDto | undefined> {
    if (this.store.scenes().length >= LIMITS.scenesPerProduction) {
      this.toasts.show(`Eine Produktion hat höchstens ${LIMITS.scenesPerProduction} Szenen.`);
      return undefined;
    }
    const name = nextSceneName(this.store.scenes());
    const created = await this.commands.run('scene:create', (productionId) =>
      this.api.createScene(productionId, { name, cloneFromSceneId: null }),
    );
    if (created) {
      this.toasts.show(`Szene «${created.name}» erstellt`);
      this.renamingIdSignal.set(created.id);
    }
    return created;
  }

  /** Duplicates a scene with its items, layout mode and background as «Name (Kopie)». */
  async duplicate(sceneId: string): Promise<SceneDto | undefined> {
    const scene = this.store.sceneById(sceneId);
    if (!scene) {
      return undefined;
    }
    if (this.store.scenes().length >= LIMITS.scenesPerProduction) {
      this.toasts.show(`Eine Produktion hat höchstens ${LIMITS.scenesPerProduction} Szenen.`);
      return undefined;
    }
    const name = copyName(scene.name, this.store.scenes());
    const created = await this.commands.run(`scene:${sceneId}:duplicate`, (productionId) =>
      this.api.createScene(productionId, { name, cloneFromSceneId: sceneId }),
    );
    if (created) {
      this.toasts.show(`Szene «${created.name}» erstellt`);
    }
    return created;
  }

  /** Renames a scene (1–80 characters after trimming). Resolves true on success. */
  async rename(sceneId: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > LIMITS.sceneNameLength) {
      this.toasts.show(`Der Name braucht 1 bis ${LIMITS.sceneNameLength} Zeichen.`);
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
    return moveSceneOrder(this.sceneIds(), sceneId, direction) !== null;
  }

  /** Moves a scene one place up (−1) or down (+1) in the list (keys 1–9 follow the order). */
  async move(sceneId: string, direction: -1 | 1): Promise<boolean> {
    const order = moveSceneOrder(this.sceneIds(), sceneId, direction);
    if (!order) {
      return false;
    }
    const done = await this.commands.run('scene:order', async (productionId) => {
      await this.api.reorderScenes(productionId, { sceneIds: order });
      return true;
    });
    return done === true;
  }

  /** Sets the background colour and image of a scene. */
  async setBackground(sceneId: string, background: SceneBackgroundDto): Promise<boolean> {
    const updated = await this.commands.run(`scene:${sceneId}:background`, (productionId) =>
      this.api.updateScene(productionId, sceneId, { name: null, layoutMode: null, background }),
    );
    return updated !== undefined;
  }

  /** Sets the layout mode of a scene (free or Auto-Grid) without touching the items. */
  async setLayoutMode(sceneId: string, layoutMode: SceneLayoutMode): Promise<boolean> {
    const updated = await this.commands.run(`scene:${sceneId}:layout`, (productionId) =>
      this.api.updateScene(productionId, sceneId, { name: null, layoutMode, background: null }),
    );
    return updated !== undefined;
  }

  /**
   * Deletes a scene with all its items. The live scene cannot be deleted. In Studio-Modus a deleted preview scene is
   * replaced by its neighbour first (prototype), so the preview never jumps elsewhere.
   */
  async remove(sceneId: string): Promise<boolean> {
    const scene = this.store.sceneById(sceneId);
    if (!scene) {
      return false;
    }
    if (sceneId === this.store.programSceneId()) {
      this.toasts.show(LIVE_SCENE_DELETE_MESSAGE);
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
      this.toasts.show(`Szene «${scene.name}» gelöscht`);
    }
    return done === true;
  }

  /** True while the command with this key runs (see {@link DockCommandService.busy}). */
  busy(key: string): boolean {
    return this.commands.busy(key);
  }

  /** True when the command's button is disabled: it runs, or the Regie is offline. */
  blocked(key: string): boolean {
    return this.commands.blocked(key);
  }

  private sceneIds(): string[] {
    return this.store.scenes().map((scene) => scene.id);
  }

  /** The new preview when the preview scene is deleted in Studio-Modus (prototype), else null. */
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
