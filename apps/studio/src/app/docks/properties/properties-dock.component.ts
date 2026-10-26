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
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { placeholderName } from '../sources/placeholder-view';
import { ElementInspectorComponent } from './element-inspector.component';
import { SceneInspectorComponent } from './scene-inspector.component';

/**
 * The Properties dock (prototype "Properties"): the element inspector while an item is selected (header "Item" with
 * "K1 · Phone stage left"), otherwise the scene inspector (header "Scene" with the scene name).
 *
 * In the element view the header holds "Back to scene", which clears the selection and so leads back to the scene
 * settings and templates (also Escape, a second click on the row in Sources, a click on the current scene in Scenes
 * or on the stage around the monitor). When the element view closes under the focus ("Back to scene", Escape inside
 * the dock), the focus moves to the dock heading "Scene", so keyboard users continue from the top of the scene view.
 * The accessible name of the button contains its visible text (WCAG 2.5.3).
 */
@Component({
  selector: 'sf-properties-dock',
  imports: [DockFrameComponent, ElementInspectorComponent, IconComponent, SceneInspectorComponent],
  template: `
    <sf-dock-frame dock="insp" [title]="title()" [subtitle]="subtitle()">
      @if (showsElement()) {
        <button
          sfDockActions
          class="c-btn c-btn--sm"
          type="button"
          aria-keyshortcuts="Escape"
          [attr.aria-label]="t('regie.properties.dock.backLabel')"
          [title]="t('regie.properties.dock.backTitle')"
          (click)="backToScene()"
        >
          <svg sfIcon="close" [size]="14"></svg>{{ t('regie.properties.dock.back') }}
        </button>
      }
      @if (loading()) {
        <div class="c-empty">
          <strong>{{ t('regie.properties.dock.loadingTitle') }}</strong
          >{{ t('regie.docks.loadingText') }}
        </div>
      } @else if (editor.selectedItem(); as item) {
        <sf-element-inspector [item]="item" />
      } @else if (editor.editScene(); as scene) {
        <sf-scene-inspector [scene]="scene" />
      } @else {
        <div class="c-empty">
          <strong>{{ t('regie.properties.dock.noSceneTitle') }}</strong
          >{{ t('regie.properties.dock.noSceneText') }}
        </div>
      }
    </sf-dock-frame>
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

  protected readonly t = t;
  protected readonly loading = computed(() => this.store.state() === null);
  /** The element inspector is shown. */
  protected readonly showsElement = computed(
    () => !this.loading() && this.editor.selectedItem() !== null,
  );
  protected readonly title = computed(() =>
    this.editor.selectedItem()
      ? t('regie.properties.dock.titleItem')
      : t('regie.properties.dock.titleScene'),
  );
  protected readonly subtitle = computed(() => {
    const item = this.editor.selectedItem();
    if (item) {
      const source = this.store.sourceById(item.source);
      if (source) {
        return `${source.code} · ${source.label}`;
      }
      const placeholder = this.store.placeholderOf(item.source);
      return placeholder ? placeholderName(placeholder) : t('model.scene.sourceMissing');
    }
    return this.editor.editScene()?.name ?? null;
  });

  /** "Back to scene": clears the selection; the dock shows the scene again. */
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
