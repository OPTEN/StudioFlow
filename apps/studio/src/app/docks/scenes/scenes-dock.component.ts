import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LIMITS, type SceneDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { SceneCommandsService } from './scene-commands.service';
import { sceneRowView, type SceneRowView } from './scene-list';
import { SceneRowComponent } from './scene-row.component';

/** One entry of the scene list: the scene (with drafts) and its row model. */
interface SceneEntry {
  readonly scene: SceneDto;
  readonly view: SceneRowView;
}

/**
 * The Szenen dock (prototype «Szenenliste»): every scene in list order with thumbnail, keycap 1–9, name and meta
 * (PGM/PVW tags, slot codes or the health lamp «K2 gestört»). A click goes through `SwitcherService.chooseScene`:
 * without Studio-Modus the scene goes live, with it the scene goes into the preview; a click on the scene being edited
 * clears the element selection (Eigenschaften shows the scene). «+ Szene» creates «Neue Szene N»
 * and opens its name; each row has Umbenennen, Duplizieren and Nach oben/unten. Compact one-line rows at heights
 * ≤ 820 px, a horizontal strip at widths ≤ 900 px.
 */
@Component({
  selector: 'sf-scenes-dock',
  imports: [DockFrameComponent, IconComponent, SceneRowComponent],
  templateUrl: './scenes-dock.component.html',
  styleUrl: './scenes-dock.component.scss',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenesDockComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(SceneCommandsService);
  private readonly editor = inject(EditorService);
  private readonly switcher = inject(SwitcherService);

  protected readonly maxScenes = LIMITS.scenesPerProduction;
  protected readonly loading = computed(() => this.store.state() === null);
  protected readonly entries = computed<readonly SceneEntry[]>(() => {
    const programSceneId = this.store.programSceneId();
    const previewSceneId = this.store.previewSceneId();
    const studioMode = this.switcher.studioMode();
    const health = this.store.sceneHealthById();
    return this.editor.scenes().map((scene, index) => ({
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
  protected readonly createTitle = computed(() =>
    this.store.scenes().length >= LIMITS.scenesPerProduction
      ? `Höchstens ${LIMITS.scenesPerProduction} Szenen`
      : 'Neue Szene am Ende der Liste',
  );

  /**
   * A click on a row. On the scene being edited it also clears the element selection, so Eigenschaften shows the
   * scene again; switching works as before (`chooseScene` is a no-op for the current scene, and switching to another
   * scene clears the selection through the editor).
   */
  protected choose(sceneId: string): void {
    if (sceneId === this.editor.editSceneId()) {
      this.editor.select(null);
    }
    void this.switcher.chooseScene(sceneId);
  }

  protected create(): void {
    void this.commands.create();
  }
}
