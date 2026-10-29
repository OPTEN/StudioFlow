import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent, type IconName } from '../../core/ui/icon.component';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { EditStatusComponent } from '../shared/edit-status.component';
import { SceneTagComponent } from '../shared/scene-tag.component';
import { KIND_ICON } from '../shared/source-view';
import { kindOfReference } from '../sources/source-rows';
import { ElementInspectorComponent } from './element-inspector.component';
import { SceneInspectorComponent } from './scene-inspector.component';

/** What the head of the element view shows: the kind icon, the slot code and the name of the item's source. */
interface Subject {
  readonly icon: IconName;
  readonly code: string;
  readonly name: string;
}

/**
 * The Properties dock, an inspector: its head names what is edited, the scene ("Interview" with its "Live" / "Preview"
 * capsule) or, while an item is selected, the item (kind icon, slot code and name) under a "Back to scene" button.
 * Below it the status line says when edits go on air at once or cannot be made ({@link EditStatusComponent}), then
 * follow the collapsible sections of the scene inspector or the element inspector.
 *
 * "Back to scene" clears the selection and so leads back to the scene settings and templates (also Escape, a second
 * click on the row in Sources, a click on the current scene in Scenes or on the stage around the monitor). When the
 * element view closes under the focus ("Back to scene", Escape inside the dock), the focus moves to the heading of the
 * scene view, so keyboard users continue from the top. The accessible name of the button contains its visible text
 * (WCAG 2.5.3).
 */
@Component({
  selector: 'sf-properties-dock',
  imports: [
    DockFrameComponent,
    EditStatusComponent,
    ElementInspectorComponent,
    IconComponent,
    SceneInspectorComponent,
    SceneTagComponent,
  ],
  templateUrl: './properties-dock.component.html',
  styleUrl: './properties-dock.component.scss',
  host: { style: 'display: contents', '(keydown)': 'onKeyDown($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertiesDockComponent {
  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly t = t;
  protected readonly loading = computed(() => this.store.state() === null);
  /** The element inspector is shown. */
  protected readonly showsElement = computed(
    () => !this.loading() && this.editor.selectedItem() !== null,
  );
  /** Kind icon, code and name of the selected item's source (a placeholder or a deleted source included). */
  protected readonly subject = computed<Subject>(() => {
    const sourceId = this.editor.selectedItem()?.source ?? '';
    const source = this.store.sourceById(sourceId);
    const placeholder = source ? null : this.store.placeholderOf(sourceId);
    return {
      icon: KIND_ICON[kindOfReference(sourceId, source, placeholder)],
      code: source?.code ?? placeholder?.code ?? '–',
      name:
        source?.label ??
        (placeholder
          ? (placeholder.label ?? t('regie.placeholders.unnamed'))
          : t('model.scene.sourceMissing')),
    };
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
   * focus the heading of the scene view. Leaves the focus alone when the selection stayed (Escape closed a popover
   * instead) or the focus is still on a connected element.
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
        this.heading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
