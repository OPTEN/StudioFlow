import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { ElementInspectorComponent } from './element-inspector.component';
import { SceneInspectorComponent } from './scene-inspector.component';

/** Accessible name of «Zur Szene» in the element view (contains the visible text, WCAG 2.5.3). */
export const BACK_TO_SCENE_LABEL = 'Auswahl aufheben, zurück zur Szene';
/** Tooltip of «Zur Szene». */
export const BACK_TO_SCENE_TITLE = 'Auswahl aufheben (Esc)';

/**
 * The Eigenschaften dock (prototype «Eigenschaften»): the element inspector while an item is selected (header
 * «Element» with «K1 · Handy Bühne links»), otherwise the scene inspector (header «Szene» with the scene name).
 *
 * In the element view the header holds «Zur Szene», which clears the selection and so leads back to the scene
 * settings and templates (also Escape, a second click on the row in Quellen, a click on the current scene in Szenen
 * or on the stage around the monitor). When the element view closes under the focus («Zur Szene», Escape inside the
 * dock), the focus moves to the dock heading «Szene», so keyboard users continue from the top of the scene view.
 */
@Component({
  selector: 'fs-properties-dock',
  imports: [DockFrameComponent, ElementInspectorComponent, IconComponent, SceneInspectorComponent],
  template: `
    <fs-dock-frame dock="insp" [title]="title()" [subtitle]="subtitle()">
      @if (showsElement()) {
        <button
          fsDockActions
          class="c-btn c-btn--sm"
          type="button"
          aria-keyshortcuts="Escape"
          [attr.aria-label]="backLabel"
          [title]="backTitle"
          (click)="backToScene()"
        >
          <svg fsIcon="close" [size]="14"></svg>Zur Szene
        </button>
      }
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
  host: { style: 'display: contents', '(keydown)': 'onKeyDown($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertiesDockComponent {
  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly frame = viewChild.required(DockFrameComponent);

  protected readonly backLabel = BACK_TO_SCENE_LABEL;
  protected readonly backTitle = BACK_TO_SCENE_TITLE;
  protected readonly loading = computed(() => this.store.state() === null);
  /** The element inspector is shown. */
  protected readonly showsElement = computed(
    () => !this.loading() && this.editor.selectedItem() !== null,
  );
  protected readonly title = computed(() => (this.editor.selectedItem() ? 'Element' : 'Szene'));
  protected readonly subtitle = computed(() => {
    const item = this.editor.selectedItem();
    if (item) {
      const source = this.store.sourceById(item.source);
      return source ? `${source.code} · ${source.label}` : 'Quelle fehlt';
    }
    return this.editor.editScene()?.name ?? null;
  });

  /** «Zur Szene»: clears the selection; the dock shows the scene again. */
  protected backToScene(): void {
    this.editor.select(null);
    this.keepFocusInDock();
  }

  /** Escape inside the dock deselects (EditorService, document listener); keep the focus in the dock then. */
  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.defaultPrevented && this.showsElement()) {
      this.keepFocusInDock();
    }
  }

  /**
   * After the next render: when the element view has closed and took the focus with it (the focused control is gone),
   * focus the dock heading. Leaves the focus alone when the selection stayed (Escape closed a popover instead) or the
   * focus is still on a connected element.
   */
  private keepFocusInDock(): void {
    afterNextRender(
      () => {
        if (this.editor.selectedItem() !== null) {
          return;
        }
        const active = this.document.activeElement;
        if (active && active !== this.document.body && active.isConnected) {
          return;
        }
        this.frame().focusTitle();
      },
      { injector: this.injector },
    );
  }
}
