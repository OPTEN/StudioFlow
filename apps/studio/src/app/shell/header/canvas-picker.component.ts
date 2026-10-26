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
 * Format and target resolution of a production, chosen from the fixed lists (16:9, 9:16, 1:1, 4:3 at 720p or 1080p):
 * two segmented controls, the size of the choice and the note that the proxy captures the picture at the size of its
 * window. Used by the new-production form and by "Format and resolution". Both values are two-way (`model`).
 */
@Component({
  selector: 'sf-canvas-picker',
  template: `
    <div class="c-canvas__field">
      <span class="c-canvas__label" [id]="formatLabelId">{{ t('regie.canvas.format') }}</span>
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
      <span class="c-hint c-canvas__name">{{ t(formatNameKey()) }}</span>
    </div>
    <div class="c-canvas__field">
      <span class="c-canvas__label" [id]="resolutionLabelId">{{
        t('regie.canvas.resolution')
      }}</span>
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
      <span class="c-hint c-canvas__size">{{
        t('regie.canvas.currentSize', { size: size() })
      }}</span>
    </div>
    <p class="c-hint">{{ t('regie.canvas.note') }}</p>
  `,
  styles: `
    :host {
      display: grid;
      gap: 8px;
    }

    .c-canvas__field {
      display: grid;
      gap: 4px;
    }

    .c-canvas__label {
      color: var(--muted);
      font-size: 12.5px;
    }

    .c-canvas__field .c-seg {
      justify-self: start;
    }

    .c-canvas__name,
    .c-canvas__size {
      margin: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasPickerComponent {
  /** The chosen format. */
  readonly format = model.required<CanvasFormat>();
  /** The chosen target resolution. */
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

  protected ratio(format: CanvasFormat): string {
    return formatRatioLabel(format);
  }

  protected resolutionName(resolution: CanvasResolution): string {
    return resolutionLabel(resolution);
  }
}
