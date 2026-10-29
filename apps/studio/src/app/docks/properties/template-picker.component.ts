import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  autoGridSlots,
  layoutTemplates,
  type CanvasSize,
  type LayoutTemplate,
  type LayoutTemplateId,
} from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { LayoutPreviewComponent, type PreviewBlock } from '../shared/layout-preview.component';

/** Templates whose first slot is the main picture (prototype `presetThumb`: `full`, `pip`, `col`, `onetwo`). */
const STRONG_FIRST: ReadonlySet<LayoutTemplateId> = new Set(['full', 'pip', 'col', 'onetwo']);

/**
 * A template tile. It keeps the template itself: `name` and `description` are looked up when they are read, so a tile
 * follows the language (a copy made at import time would not).
 */
interface TemplateTile {
  readonly id: LayoutTemplateId;
  readonly template: LayoutTemplate;
  readonly blocks: readonly PreviewBlock[];
}

/** The eight tiles for a canvas: the slots follow its shape (side by side on 16:9, stacked on 9:16). */
function tilesFor(canvas: CanvasSize): readonly TemplateTile[] {
  return layoutTemplates(canvas).map((template) => ({
    id: template.id,
    template,
    blocks: (template.slots ?? autoGridSlots(3, canvas)).map(([x, y, w, h], index) => ({
      x,
      y,
      w,
      h,
      strong: index === 0 && STRONG_FIRST.has(template.id),
    })),
  }));
}

/**
 * "Layout templates": the eight layout templates as tiles with a preview in the shape of the production's canvas, the
 * name and what it is for (two columns in a dock of usual width, more where there is room). Auto grid shows as pressed
 * while the scene uses it. The accessible name of a tile is its name; the purpose is its description (tooltip). Emits
 * the chosen template; the scene inspector applies it through `EditorService.applyTemplate`.
 */
@Component({
  selector: 'sf-template-picker',
  imports: [LayoutPreviewComponent],
  template: `
    @for (tile of tiles(); track tile.id) {
      <button
        class="c-preset"
        type="button"
        [title]="tile.template.description"
        [attr.aria-pressed]="tile.id === 'auto' ? autoGridActive() : null"
        [class.is-active]="tile.id === 'auto' && autoGridActive()"
        [disabled]="disabled()"
        (click)="pick.emit(tile.id)"
      >
        <sf-layout-preview class="c-preset__preview" [blocks]="tile.blocks" [canvas]="canvas()" />
        <span class="c-preset__name">{{ tile.template.name }}</span>
        <span class="c-preset__info" aria-hidden="true">{{ tile.template.description }}</span>
      </button>
    }
  `,
  styleUrl: './template-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePickerComponent {
  /** The scene uses Auto grid. */
  readonly autoGridActive = input(false);
  /** Editing is not possible (live scene, offline). */
  readonly disabled = input(false);

  /** The operator chose a template. */
  readonly pick = output<LayoutTemplateId>();

  private readonly store = inject(ProductionStoreService);

  protected readonly canvas = this.store.canvas;
  protected readonly tiles = computed(() => tilesFor(this.store.canvas()));
}
