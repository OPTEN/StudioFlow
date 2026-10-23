import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  formatItemCount,
  type SceneDto,
} from '@studioflow/scene-model';
import { ViewportService } from '../core/ui/viewport.service';
import { EditOverlayComponent } from './edit-overlay.component';
import { SceneViewComponent, type SceneTransitionCue } from './scene-view.component';

/** Which monitor: Preview (green tally) or Program (red tally, shows exactly the output). */
export type MonitorKind = 'preview' | 'program';

/** Text of the live note on a locked editable monitor (prototype `#liveNote`). */
export const LIVE_NOTE =
  'Diese Szene ist gerade live. Bearbeiten geht erst, wenn eine andere Szene im Program ist.';

/** Program flash (DESIGN.md «Monitors»): 6 px light red settling to the 2 px tally outline in 500 ms. */
const FLASH_KEYFRAMES: Keyframe[] = [
  { outlineWidth: '6px', outlineColor: '#ff8a80' },
  { outlineWidth: '2px', outlineColor: '#f85149' },
];
const FLASH_MS = 500;

let nextMonitorId = 0;

/**
 * One monitor of the stage (prototype `.mon`): the header with tally dot and label (PREVIEW green, PROGRAM red), the
 * scene name, the meta on the right («2 Elemente» on the Preview, «1920 × 1080 · 30 fps» on the Program) and
 * «Änderungen gehen sofort live» when Studio-Modus is off, then the 16:9 screen with its 2 px tally outline.
 *
 * The screen holds a {@link SceneViewComponent}; on the editable monitor also the {@link EditOverlayComponent}, and
 * the live note while editing is locked. The Program monitor flashes once whenever a cued program switch has been
 * played. The width comes from the stage (`--sf-preview-w` / `--sf-program-w`, see `monitor-layout.ts`).
 */
@Component({
  selector: 'sf-monitor',
  imports: [SceneViewComponent, EditOverlayComponent],
  templateUrl: './monitor.component.html',
  styleUrl: './monitor.component.scss',
  host: {
    class: 'c-monitor',
    role: 'region',
    '[class.c-monitor--preview]': "kind() === 'preview'",
    '[class.c-monitor--program]': "kind() === 'program'",
    '[class.is-editable]': 'editable()',
    '[attr.aria-labelledby]': 'labelId',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitorComponent {
  /** Preview or Program. */
  readonly kind = input.required<MonitorKind>();
  /** The scene shown (with local edit drafts). */
  readonly scene = input<SceneDto | null>(null);
  /** The edit overlay sits on this monitor (Preview in Studio-Modus, else Program). */
  readonly editable = input(false);
  /** «Änderungen gehen sofort live» in the header (Program without Studio-Modus). */
  readonly liveEdit = input(false);
  /** Editing is locked (Studio-Modus, preview = program): shows the live note. */
  readonly locked = input(false);
  /** Program switch to animate (Program monitor). */
  readonly cue = input<SceneTransitionCue | null>(null);
  /** Quiet text in the empty screen (loading, no scene). */
  readonly emptyText = input<string | null>(null);

  private readonly viewport = inject(ViewportService);
  private readonly screen = viewChild.required<ElementRef<HTMLElement>>('screen');

  /** The scene view (Auto-Grid rectangles for the overlay). */
  protected readonly view = viewChild(SceneViewComponent);
  protected readonly labelId = `sf-monitor-label-${++nextMonitorId}`;
  protected readonly title = computed(() => (this.kind() === 'program' ? 'Program' : 'Preview'));
  protected readonly meta = computed(() => {
    if (this.kind() === 'program') {
      return `${CANVAS_WIDTH} × ${CANVAS_HEIGHT} · 30 fps`;
    }
    const scene = this.scene();
    return scene ? formatItemCount(scene.items.filter((item) => !item.hidden).length) : '';
  });
  protected readonly viewLabel = computed(() => {
    const name = this.scene()?.name ?? 'keine Szene';
    return this.kind() === 'program'
      ? `Program-Monitor: ${name}, entspricht dem Output`
      : `Preview-Monitor: ${name}`;
  });
  protected readonly liveNote = LIVE_NOTE;

  /** Flashes the Program outline once (prototype `is-flash`); skipped with reduced motion. */
  protected onTransitionEnd(): void {
    if (this.kind() !== 'program' || this.viewport.reducedMotion()) {
      return;
    }
    const element = this.screen().nativeElement;
    if (typeof element.animate === 'function') {
      element.animate(FLASH_KEYFRAMES, {
        duration: FLASH_MS,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    }
  }
}
