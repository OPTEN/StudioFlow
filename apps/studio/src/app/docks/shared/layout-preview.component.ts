import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CanvasSize } from '@studioflow/scene-model';

/** One block of a layout preview: a rectangle in canvas pixels, optionally emphasised (the main slot). */
export interface PreviewBlock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly strong?: boolean;
}

/** Percent box of a block for inline positioning. */
interface PercentBlock {
  readonly key: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly strong: boolean;
}

/**
 * A well with slot blocks in the shape of the canvas (prototype `.pv` / `presetThumb`, 16:9 by default): the template
 * previews in "Apply template". Purely decorative (`aria-hidden`); positions are percentages of the canvas.
 */
@Component({
  selector: 'sf-layout-preview',
  template: `
    @for (block of percentBlocks(); track block.key) {
      <i
        class="c-layout-preview__slot"
        [class.is-strong]="block.strong"
        [style.left.%]="block.left"
        [style.top.%]="block.top"
        [style.width.%]="block.width"
        [style.height.%]="block.height"
      ></i>
    }
  `,
  styles: `
    :host {
      background: var(--well);
      border-radius: var(--radius-screen);
      display: block;
      outline: 1px solid var(--seam);
      overflow: hidden;
      position: relative;
    }

    .c-layout-preview__slot {
      background: var(--slot);
      border-radius: 1.5px;
      position: absolute;
    }

    .c-layout-preview__slot.is-strong {
      background: var(--slot-strong);
    }
  `,
  host: { 'aria-hidden': 'true', '[style.aspect-ratio]': 'aspectRatio()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutPreviewComponent {
  /** Blocks in canvas pixels, back to front. */
  readonly blocks = input.required<readonly PreviewBlock[]>();
  /** The canvas the blocks are placed on. */
  readonly canvas = input.required<CanvasSize>();

  protected readonly aspectRatio = computed(
    () => `${this.canvas().width} / ${this.canvas().height}`,
  );

  protected readonly percentBlocks = computed<readonly PercentBlock[]>(() =>
    this.blocks().map((block, key) => ({
      key,
      left: (block.x / this.canvas().width) * 100,
      top: (block.y / this.canvas().height) * 100,
      width: (block.w / this.canvas().width) * 100,
      height: (block.h / this.canvas().height) * 100,
      strong: block.strong === true,
    })),
  );
}
