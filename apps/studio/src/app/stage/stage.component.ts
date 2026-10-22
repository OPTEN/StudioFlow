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
import type { SceneDto } from '@flowstudio/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ViewportService } from '../core/ui/viewport.service';
import { DockLayoutService } from '../shell/workspace/dock-layout.service';
import { SplitterDirective } from '../shell/workspace/splitter.directive';
import { ControlColumnComponent } from './control-column.component';
import { EditorService } from './editor.service';
import { MONITOR_SPLIT_PX, monitorWidths } from './monitor-layout';
import { MonitorComponent } from './monitor.component';
import type { SceneTransitionCue } from './scene-view.component';
import { SwitcherService } from './switcher.service';

/** The editable 16:9 surface: its overlay handles clicks itself (select, empty area deselects). */
const EDITABLE_SCREEN = '.c-monitor.is-editable .c-monitor__screen';
/** Controls inside the stage that keep their own pointer behaviour (no deselect). */
const STAGE_CONTROLS =
  'button, a, input, select, textarea, label, [role="separator"], [role="switch"], .c-pop, fs-control-column';

function sceneIn(scenes: readonly SceneDto[], id: string | null): SceneDto | null {
  return id ? (scenes.find((scene) => scene.id === id) ?? null) : null;
}

/**
 * The stage (prototype `.stage-in`, DESIGN.md «Stage»): monitors on the left, the fixed control column on the right.
 * Rendered by the workspace inside `section.c-workspace__stage` («Monitore»).
 *
 * - Studio-Modus off: one Program monitor, right-aligned against the control column, with the quiet «Preview aus»
 *   note in the free space; the Program header says «Änderungen gehen sofort live» and carries the edit overlay.
 * - Studio-Modus on: Preview | split | Program. The split is resizable (pointer, arrow keys, double-click/Enter
 *   resets; `DockLayoutService.split`), the Preview carries the overlay, and while preview = program editing is
 *   locked (live note). The control column and the docks never move when the mode toggles.
 * - Both monitors show the scenes with local edit drafts (`EditorService.scenes`); the Program plays the transition of
 *   every program switch event and flashes.
 * - Sizes: a ResizeObserver measures the stage and writes the monitor widths (`monitor-layout.ts`) as the custom
 *   properties `--fs-preview-w` / `--fs-program-w` directly on the host, so resizing never runs change detection.
 * - ≤ 1180 px only the width counts; ≤ 900 px everything stacks: Program, controls, Preview.
 * - A press on the stage around the editable screen (monitor headers, the «Preview aus» space, the other monitor,
 *   the free stage) clears the element selection, so Eigenschaften shows the scene again even when an element fills
 *   the whole editable screen («Vollbild»). Controls (control column, splitter) are left alone.
 */
@Component({
  selector: 'fs-stage',
  imports: [MonitorComponent, ControlColumnComponent, SplitterDirective],
  templateUrl: './stage.component.html',
  styleUrl: './stage.component.scss',
  host: { class: 'c-stage', '(pointerdown)': 'onPointerDown($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageComponent {
  protected readonly switcher = inject(SwitcherService);
  protected readonly editor = inject(EditorService);
  protected readonly viewport = inject(ViewportService);
  private readonly store = inject(ProductionStoreService);
  private readonly layout = inject(DockLayoutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly monitors = viewChild.required<ElementRef<HTMLElement>>('monitors');
  private size = { width: 0, height: 0 };

  /** The program scene with local drafts. */
  protected readonly programScene = computed(() =>
    sceneIn(this.editor.scenes(), this.store.programSceneId()),
  );
  /** The preview scene with local drafts (Studio-Modus). */
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
    this.store.state() ? 'Keine Szene' : 'Verbindet …',
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
      width: this.size.width,
      height: this.size.height,
      studio: this.switcher.studioMode(),
      split: this.layout.split(),
      heightBound: !this.viewport.stacked(),
      fullWidth: this.viewport.narrow(),
    });
    this.host.style.setProperty('--fs-preview-w', `${widths.preview}px`);
    this.host.style.setProperty('--fs-program-w', `${widths.program}px`);
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
      this.applyWidths();
    });
    observer.observe(this.host, { box: 'border-box' });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
