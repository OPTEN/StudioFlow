import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LAYOUT_TEMPLATES, autoGridSlots, type LayoutTemplateId } from '@studioflow/scene-model';
import { LayoutPreviewComponent, type PreviewBlock } from '../shared/layout-preview.component';

/** Templates whose first slot is the main picture (prototype `presetThumb`: `full`, `pip`, `col`, `onetwo`). */
const STRONG_FIRST: ReadonlySet<LayoutTemplateId> = new Set(['full', 'pip', 'col', 'onetwo']);

/** A template tile. */
interface TemplateTile {
  readonly id: LayoutTemplateId;
  readonly name: string;
  readonly description: string;
  readonly blocks: readonly PreviewBlock[];
}

const TILES: readonly TemplateTile[] = LAYOUT_TEMPLATES.map((template) => ({
  id: template.id,
  name: template.name,
  description: template.description,
  blocks: (template.slots ?? autoGridSlots(3)).map(([x, y, w, h], index) => ({
    x,
    y,
    w,
    h,
    strong: index === 0 && STRONG_FIRST.has(template.id),
  })),
}));

/**
 * «Vorlage anwenden» (prototype `.presets`): the eight layout templates as 16:9 previews in a 4-column grid (2
 * columns at ≤ 900 px). Auto-Grid shows as pressed while the scene uses it. Emits the chosen template; the scene
 * inspector applies it through `EditorService.applyTemplate`.
 */
@Component({
  selector: 'sf-template-picker',
  imports: [LayoutPreviewComponent],
  template: `
    @for (tile of tiles; track tile.id) {
      <button
        class="c-preset"
        type="button"
        [title]="tile.description"
        [attr.aria-pressed]="tile.id === 'auto' ? autoGridActive() : null"
        [class.is-active]="tile.id === 'auto' && autoGridActive()"
        [disabled]="disabled()"
        (click)="pick.emit(tile.id)"
      >
        <sf-layout-preview [blocks]="tile.blocks" />
        <span class="c-preset__name">{{ tile.name }}</span>
      </button>
    }
  `,
  styleUrl: './template-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePickerComponent {
  /** The scene uses Auto-Grid. */
  readonly autoGridActive = input(false);
  /** Editing is not possible (live scene, offline). */
  readonly disabled = input(false);

  /** The operator chose a template. */
  readonly pick = output<LayoutTemplateId>();

  protected readonly tiles = TILES;
}
