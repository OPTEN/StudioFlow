import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  CANVAS_FORMATS,
  CANVAS_RESOLUTIONS,
  canvasSize,
  canvasSizeLabel,
  formatRatioLabel,
  resolutionLabel,
  type CanvasFormat,
  type CanvasResolution,
} from '@studioflow/scene-model';

let nextPickerId = 0;

/**
 * Format and resolution of a production, chosen from the fixed lists (16:9, 9:16, 1:1, 4:3 at 720p or 1080p): two rows
 * of a settings group, each with a segmented control, the name of the format with a small drawing of its shape, and the
 * canvas size of the choice. Used by the General page of the production settings and by the new-production form; the
 * surrounding group carries the note about the output window. Both values are two-way (`model`).
 */
@Component({
  selector: 'sf-canvas-picker',
  template: `
    <div class="c-group__row c-canvas__row">
      <span class="c-canvas__label">
        <span class="c-canvas__shape" aria-hidden="true">
          <span [style.width.px]="shape().width" [style.height.px]="shape().height"></span>
        </span>
        <span class="c-group__label">
          <span [id]="formatLabelId">{{ t('regie.canvas.format') }}</span>
          <span class="c-group__sub c-canvas__name">{{ t(formatNameKey()) }}</span>
        </span>
      </span>
      <div class="c-seg" role="group" [attr.aria-labelledby]="formatLabelId">
        @for (option of formats; track option) {
          <button
            type="button"
            [attr.aria-pressed]="format() === option"
            [disabled]="disabled()"
            (click)="format.set(option)"
          >
            {{ ratio(option) }}
          </button>
        }
      </div>
    </div>
    <div class="c-group__row c-canvas__row">
      <span class="c-group__label c-canvas__text">
        <span [id]="resolutionLabelId">{{ t('regie.canvas.resolution') }}</span>
        <span class="c-group__sub c-canvas__size">{{
          t('regie.canvas.currentSize', { size: size() })
        }}</span>
      </span>
      <div class="c-seg" role="group" [attr.aria-labelledby]="resolutionLabelId">
        @for (option of resolutions; track option) {
          <button
            type="button"
            [attr.aria-pressed]="resolution() === option"
            [disabled]="disabled()"
            (click)="resolution.set(option)"
          >
            {{ resolutionName(option) }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: contents;
    }

    // The rows sit in a group of the page; the first one draws the hairline to a row before the picker.
    :host(:not(:first-child)) .c-canvas__row:first-child {
      box-shadow: inset 0 1px 0 var(--seam);
    }

    .c-canvas__row {
      @media (max-width: 560px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .c-canvas__label {
      align-items: center;
      display: flex;
      gap: 12px;
      min-width: 0;
    }

    // The shape of the chosen format, drawn in a 26 px square.
    .c-canvas__shape {
      display: grid;
      flex: none;
      height: 26px;
      place-items: center;
      width: 26px;

      > span {
        @include state-transition(height, width);
        border: 1.5px solid var(--text-2);
        border-radius: 3px;
      }
    }

    .c-canvas__text {
      padding-left: 38px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasPickerComponent {
  /** The chosen format. */
  readonly format = model.required<CanvasFormat>();
  /** The chosen resolution. */
  readonly resolution = model.required<CanvasResolution>();
  /** Nothing can be chosen (the broadcast is live). */
  readonly disabled = input(false);

  protected readonly t = t;
  protected readonly formats = CANVAS_FORMATS;
  protected readonly resolutions = CANVAS_RESOLUTIONS;
  private readonly id = ++nextPickerId;
  protected readonly formatLabelId = `sf-canvas-format-${this.id}`;
  protected readonly resolutionLabelId = `sf-canvas-resolution-${this.id}`;
  protected readonly formatNameKey = computed(
    () => `regie.canvas.formatName.${this.format()}` as const,
  );
  /** "1080 × 1920" for the chosen format and resolution. */
  protected readonly size = computed(() =>
    canvasSizeLabel(canvasSize(this.format(), this.resolution())),
  );
  /** The chosen format drawn in a 24 px square: its longer side fills it. */
  protected readonly shape = computed(() => {
    const { width, height } = canvasSize(this.format(), this.resolution());
    const scale = 24 / Math.max(width, height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  });

  protected ratio(format: CanvasFormat): string {
    return formatRatioLabel(format);
  }

  protected resolutionName(resolution: CanvasResolution): string {
    return resolutionLabel(resolution);
  }
}
