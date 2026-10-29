import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS, type SceneDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { sortByOrder } from '../../core/ui/reorder';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { SortableItemDirective, SortableListComponent } from '../shared/sortable-list.component';
import { SceneCommandsService } from './scene-commands.service';
import { sceneRowView, type SceneRowView } from './scene-list';
import { SceneRowComponent } from './scene-row.component';

/** One entry of the scene list: the scene (with drafts) and its row model. */
interface SceneEntry {
  readonly scene: SceneDto;
  readonly view: SceneRowView;
}

/**
 * The Scenes dock, a navigator like the slide list of Keynote: every scene in list order with its thumbnail and number
 * key 1–9, the name and a muted meta line (the "Live" / "Preview" capsule, then the slot codes or the health lamp
 * "K2 disrupted"). A click goes through `SwitcherService.chooseScene`: without Studio Mode the scene goes live, with it
 * the scene goes into the Preview (the row's tooltip says which); a click on the scene being edited clears the element
 * selection (Properties shows the scene). "+ Scene" (and the button of the empty state) creates "New scene N" and opens
 * its name; each row has a menu with Rename, Duplicate, Send to Preview, Move up/down and Delete. The rows are
 * reordered by drag and drop or from the keyboard ({@link SortableListComponent}). Tighter rows on short laptops, a
 * horizontal strip at widths ≤ 900 px.
 */
@Component({
  selector: 'sf-scenes-dock',
  imports: [
    DockFrameComponent,
    IconComponent,
    SceneRowComponent,
    SortableItemDirective,
    SortableListComponent,
  ],
  templateUrl: './scenes-dock.component.html',
  styleUrl: './scenes-dock.component.scss',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenesDockComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(SceneCommandsService);
  private readonly editor = inject(EditorService);
  protected readonly switcher = inject(SwitcherService);

  protected readonly t = t;
  protected readonly maxScenes = LIMITS.scenesPerProduction;
  protected readonly loading = computed(() => this.store.state() === null);
  protected readonly entries = computed<readonly SceneEntry[]>(() => {
    const programSceneId = this.store.programSceneId();
    const previewSceneId = this.store.previewSceneId();
    const studioMode = this.switcher.studioMode();
    const health = this.store.sceneHealthById();
    const scenes = sortByOrder(this.editor.scenes(), this.commands.order(), (scene) => scene.id);
    return scenes.map((scene, index) => ({
      scene,
      view: sceneRowView(scene, index, {
        programSceneId,
        previewSceneId,
        studioMode,
        health: health.get(scene.id) ?? null,
        codeOf: (sourceId) => this.store.codeOf(sourceId),
      }),
    }));
  });
  protected readonly sceneIds = computed(() => this.entries().map((entry) => entry.view.id));
  protected readonly entryById = computed(
    () => new Map(this.entries().map((entry) => [entry.view.id, entry] as const)),
  );
  /** Name of a scene for the reorder handle and the announcements. */
  protected readonly sceneName = (sceneId: string): string =>
    this.entryById().get(sceneId)?.view.name ?? '';
  /** "+ Scene" is possible: connected, fewer than 99 scenes, no create request in flight. */
  protected readonly canCreate = computed(
    () => this.commands.canCreate() && !this.commands.blocked('scene:create'),
  );
  protected readonly createTitle = computed(() =>
    this.store.scenes().length >= LIMITS.scenesPerProduction
      ? t('regie.scenes.dock.addTitleMax', { max: LIMITS.scenesPerProduction })
      : t('regie.scenes.dock.addTitle'),
  );

  /**
   * A click on a row. On the scene being edited it also clears the element selection, so Properties shows the
   * scene again; switching works as before (`chooseScene` is a no-op for the current scene, and switching to another
   * scene clears the selection through the editor).
   */
  protected choose(sceneId: string): void {
    if (this.switcher.busy()) {
      return;
    }
    if (sceneId === this.editor.editSceneId()) {
      this.editor.select(null);
    }
    void this.switcher.chooseScene(sceneId);
  }

  /** A scene was dragged or moved with the keyboard. */
  protected reorder(sceneIds: readonly string[]): void {
    void this.commands.reorder(sceneIds);
  }

  protected create(): void {
    void this.commands.create();
  }
}
