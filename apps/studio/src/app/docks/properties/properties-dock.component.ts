import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { ElementInspectorComponent } from './element-inspector.component';
import { SceneInspectorComponent } from './scene-inspector.component';

/**
 * The Eigenschaften dock (prototype «Eigenschaften»): the element inspector while an item is selected (header
 * «Element» with «K1 · Handy Bühne links»), otherwise the scene inspector (header «Szene» with the scene name).
 */
@Component({
  selector: 'fs-properties-dock',
  imports: [DockFrameComponent, ElementInspectorComponent, SceneInspectorComponent],
  template: `
    <fs-dock-frame dock="insp" [title]="title()" [subtitle]="subtitle()">
      @if (loading()) {
        <div class="c-empty">
          <strong>Eigenschaften werden geladen …</strong>Die Regie verbindet mit dem Server.
        </div>
      } @else if (editor.selectedItem(); as item) {
        <fs-element-inspector [item]="item" />
      } @else if (editor.editScene(); as scene) {
        <fs-scene-inspector [scene]="scene" />
      } @else {
        <div class="c-empty">
          <strong>Keine Szene.</strong>Unter Szenen mit «+ Szene» eine Szene anlegen.
        </div>
      }
    </fs-dock-frame>
  `,
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertiesDockComponent {
  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);

  protected readonly loading = computed(() => this.store.state() === null);
  protected readonly title = computed(() => (this.editor.selectedItem() ? 'Element' : 'Szene'));
  protected readonly subtitle = computed(() => {
    const item = this.editor.selectedItem();
    if (item) {
      const source = this.store.sourceById(item.source);
      return source ? `${source.code} · ${source.label}` : 'Quelle fehlt';
    }
    return this.editor.editScene()?.name ?? null;
  });
}
