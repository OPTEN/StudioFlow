import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import type { SceneDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ViewportService } from '../core/ui/viewport.service';
import { DockLayoutService } from '../shell/workspace/dock-layout.service';
import { SplitterDirective } from '../shell/workspace/splitter.directive';
import { ControlColumnComponent } from './control-column.component';
import { EditorService } from './editor.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { MONITOR_SPLIT_PX, monitorWidths } from './monitor-layout';
import { MonitorComponent } from './monitor.component';
import type { SceneTransitionCue } from './scene-view.component';
import { SwitcherService } from './switcher.service';

/** The editable surface: its overlay handles clicks itself (select, empty area deselects). */
const EDITABLE_SCREEN = '.c-monitor.is-editable .c-monitor__screen';
/** Controls inside the stage that keep their own pointer behaviour (no deselect). */
const STAGE_CONTROLS =
  'button, a, input, select, textarea, label, [role="separator"], [role="switch"], .c-pop, sf-control-column';

function sceneIn(scenes: readonly SceneDto[], id: string | null): SceneDto | null {
  return id ? (scenes.find((scene) => scene.id === id) ?? null) : null;
}

/**
 * The stage (prototype `.stage-in`, DESIGN.md "Stage"): monitors on the left, the fixed control column on the right.
 * Rendered by the workspace inside `section.c-workspace__stage` ("Monitors").
 *
 * - Studio Mode off: one Program monitor, right-aligned against the control column, with the quiet "Preview off"
 *   note in the free space; the Program header says "Changes go live immediately" and carries the edit overlay.
 * - Studio Mode on: Preview | split | Program. The split is resizable (pointer, arrow keys, double-click/Enter
 *   resets; `DockLayoutService.split`), the Preview carries the overlay, and while preview = program editing is
 *   locked (live note). The control column and the docks never move when the mode toggles.
 * - Both monitors show the scenes with local edit drafts (`EditorService.scenes`); the Program plays the transition of
 *   every program switch event and flashes.
 * - The monitors have the shape of the production's canvas (16:9, 9:16, 1:1 or 4:3); a portrait monitor is narrow and
 *   the free space stays empty beside it.
 * - Sizes: a ResizeObserver measures the stage and, one animation frame later, writes the monitor widths
 *   (`monitor-layout.ts`) as the custom properties `--sf-preview-w` / `--sf-program-w` directly on the host, so resizing
 *   never runs change detection. The write is not made inside the observer callback: it resizes the observed host again.
 * - ≤ 1180 px only the width counts; ≤ 900 px everything stacks: Program, controls, Preview.
 * - A press on the stage around the editable screen (monitor headers, the "Preview off" space, the other monitor,
 *   the free stage) clears the element selection, so Properties shows the scene again even when an element fills
 *   the whole editable screen ("Full screen"). Controls (control column, splitter) are left alone.
 */
@Component({
  selector: 'sf-stage',
  imports: [MonitorComponent, ControlColumnComponent, SplitterDirective],
  templateUrl: './stage.component.html',
  styleUrl: './stage.component.scss',
  host: { class: 'c-stage', '(pointerdown)': 'onPointerDown($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageComponent {
  protected readonly t = t;
  protected readonly switcher = inject(SwitcherService);
  protected readonly editor = inject(EditorService);
  protected readonly viewport = inject(ViewportService);
  private readonly store = inject(ProductionStoreService);
  private readonly layout = inject(DockLayoutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly monitors = viewChild.required<ElementRef<HTMLElement>>('monitors');
  private readonly scheduleFrame = inject(FRAME_SCHEDULER);
  private size = { width: 0, height: 0 };
  /** Cancels the pending width write of {@link observeSize}, null when none is scheduled. */
  private cancelWidths: (() => void) | null = null;

  /** The program scene with local drafts. */
  protected readonly programScene = computed(() =>
    sceneIn(this.editor.scenes(), this.store.programSceneId()),
  );
  /** The preview scene with local drafts (Studio Mode). */
  protected readonly previewScene = computed(() =>
    sceneIn(this.editor.scenes(), this.store.previewSceneId()),
  );
  /** The last program switch event as a transition cue for the Program monitor. */
  protected readonly cue = computed<SceneTransitionCue | null>(() => {
    const notice = this.store.programSwitch();
    return notice
      ? { seq: notice.seq, sceneId: notice.programSceneId, transition: notice.transition }
      : null;
  });
  /** Quiet text in an empty monitor. */
  protected readonly emptyText = computed(() =>
    this.store.state() ? t('regie.stage.monitor.noScene') : t('regie.stage.monitor.connecting'),
  );
  /** Splitter between Preview and Program (width of the monitor row minus the split itself). */
  protected readonly splitBehavior = this.layout.monitorSplitBehavior(
    () => this.monitors().nativeElement.getBoundingClientRect().width - MONITOR_SPLIT_PX,
  );

  constructor() {
    effect(() => {
      // Mode, split and breakpoints change the widths without a resize.
      this.switcher.studioMode();
      this.layout.split();
      this.viewport.stacked();
      this.viewport.narrow();
      // Another format changes the shape of the monitors, and with it how wide they may be.
      this.store.canvas();
      untracked(() => this.applyWidths());
    });
    this.observeSize();
  }

  /** Deselects on a primary press outside the editable screen and outside controls. */
  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(EDITABLE_SCREEN) || target.closest(STAGE_CONTROLS)) {
      return;
    }
    this.editor.select(null);
  }

  /** Writes the monitor widths for the last measured stage size. */
  private applyWidths(): void {
    if (this.size.width <= 0) {
      // Not measured yet (or no ResizeObserver): the CSS fallbacks apply.
      return;
    }
    const widths = monitorWidths({
      canvas: this.store.canvas(),
      width: this.size.width,
      height: this.size.height,
      studio: this.switcher.studioMode(),
      split: this.layout.split(),
      heightBound: !this.viewport.stacked(),
      fullWidth: this.viewport.narrow(),
    });
    this.host.style.setProperty('--sf-preview-w', `${widths.preview}px`);
    this.host.style.setProperty('--sf-program-w', `${widths.program}px`);
  }

  private observeSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    // The border box: the 12 px stage padding above and below is part of the 56 px vertical chrome.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry?.borderBoxSize?.[0];
      if (box) {
        this.size = { width: box.inlineSize, height: box.blockSize };
      } else if (entry) {
        this.size = { width: this.host.offsetWidth, height: this.host.offsetHeight };
      } else {
        return;
      }
      this.scheduleWidths();
    });
    observer.observe(this.host, { box: 'border-box' });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      this.cancelWidths?.();
    });
  }

  /**
   * Writes the widths one frame after the measurement. The widths resize the observed host again; written inside the
   * observer callback that is a layout change within the same delivery, which browsers report as the error event
   * “ResizeObserver loop completed with undelivered notifications” (Angular's global error listener logs it).
   */
  private scheduleWidths(): void {
    if (this.cancelWidths) {
      return;
    }
    this.cancelWidths = this.scheduleFrame(() => {
      this.cancelWidths = null;
      this.applyWidths();
    });
  }
}
