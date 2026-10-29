import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  canvasSizeLabel,
  formatItemCount,
  safeMargin,
  type SceneDto,
} from '@studioflow/scene-model';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ContextMenuDirective, ContextMenuService } from '../core/ui/context-menu';
import { IconComponent } from '../core/ui/icon.component';
import { ViewportService } from '../core/ui/viewport.service';
import { EditOverlayComponent } from './edit-overlay.component';
import { SceneViewComponent, type SceneTransitionCue } from './scene-view.component';
import { StageCommandsService } from './stage-commands.service';

/** Which monitor: Preview (green tally) or Program (red tally, shows exactly the output). */
export type MonitorKind = 'preview' | 'program';

/** A fade of the program that is still running: its length and how much of it has passed (server time). */
export interface MonitorFade {
  readonly durationMs: number;
  readonly elapsedMs: number;
}

/** Program flash (DESIGN.md "Monitors"): 6 px light red settling to the 2 px tally outline in 500 ms. */
const FLASH_KEYFRAMES: Keyframe[] = [
  { outlineWidth: '6px', outlineColor: 'var(--red-flash)' },
  { outlineWidth: '2px', outlineColor: 'var(--red)' },
];
const FLASH_MS = 500;

let nextMonitorId = 0;

/**
 * One monitor of the stage: a header and the picture.
 *
 * - Header: the tally lamp with "Preview" (green) or "Program" (red), the scene name as the headline and quiet facts on
 *   the right: the item count on the Preview ("3 items · 1 hidden"), the size of the canvas on the Program. While the
 *   Program is the edit surface (Studio Mode off) it carries the note "Changes go live immediately": neutral with a
 *   pencil, red while the broadcast is on air. While the live scene sits in the Preview (editing locked) the Preview
 *   says "Live, read only" with the full reason as its tooltip; nothing covers the picture, so a lower third stays
 *   visible. A running fade of the Program draws a thin red progress line under the header.
 * - Picture: the screen with the 2 px tally outline (red Program, green Preview) in the shape of the production's
 *   canvas. It holds a {@link SceneViewComponent}; on the editable monitor also the {@link EditOverlayComponent}.
 *   An empty screen says what is missing ("Connecting…", "No scene yet" and where to add one).
 *
 * Menu: a right click on the header or the picture (or the ⋯ button at the end of the header) offers the monitor's
 * commands ({@link StageCommandsService.monitorMenu}): Take, Send Program to Preview, Load next scene on the Preview,
 * Studio Mode on the Program, Show safe area and Copy scene name on both. With "Show safe area" on, the dashed guide
 * stays on both pictures.
 *
 * The Program monitor flashes once whenever a cued program switch has been played. The width comes from the stage
 * (`--sf-preview-w` / `--sf-program-w`, see `monitor-layout.ts`).
 */
@Component({
  selector: 'sf-monitor',
  imports: [SceneViewComponent, EditOverlayComponent, IconComponent, ContextMenuDirective],
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
  /** The edit overlay sits on this monitor (Preview in Studio Mode, else Program). */
  readonly editable = input(false);
  /** "Changes go live immediately" in the header (Program without Studio Mode). */
  readonly liveEdit = input(false);
  /** Editing is locked (Studio Mode, preview = program): "Live, read only" in the header. */
  readonly locked = input(false);
  /** Program switch to animate (Program monitor). */
  readonly cue = input<SceneTransitionCue | null>(null);
  /** The fade of the program that is running right now (Program monitor), or null. */
  readonly fade = input<MonitorFade | null>(null);
  /** Quiet text in the empty screen (loading, no scene). */
  readonly emptyText = input<string | null>(null);
  /** The next step under the empty text, or null. */
  readonly emptyHint = input<string | null>(null);

  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(StageCommandsService);
  private readonly menus = inject(ContextMenuService);
  private readonly viewport = inject(ViewportService);
  private readonly screen = viewChild.required<ElementRef<HTMLElement>>('screen');

  /** The scene view (Auto-Grid rectangles for the overlay). */
  protected readonly view = viewChild(SceneViewComponent);
  protected readonly labelId = `sf-monitor-label-${++nextMonitorId}`;
  protected readonly t = t;
  protected readonly title = computed(() =>
    this.kind() === 'program' ? t('regie.stage.monitor.program') : t('regie.stage.monitor.preview'),
  );
  /** The broadcast is on air: the live-edit note turns red. */
  protected readonly onAir = computed(() => this.store.broadcast() === 'live');
  protected readonly meta = computed(() => {
    if (this.kind() === 'program') {
      return canvasSizeLabel(this.store.canvas());
    }
    const scene = this.scene();
    if (!scene) {
      return '';
    }
    const count = formatItemCount(scene.items.length);
    const hidden = scene.items.filter((item) => item.hidden).length;
    return hidden > 0 ? `${count} · ${t('regie.stage.monitor.hidden', { count: hidden })}` : count;
  });
  protected readonly viewLabel = computed(() => {
    const name = this.scene()?.name ?? t('regie.stage.monitor.noSceneName');
    return this.kind() === 'program'
      ? t('regie.stage.monitor.programLabel', { name })
      : t('regie.stage.monitor.previewLabel', { name });
  });

  /** Accessible name and tooltip of the ⋯ button ("Program options"). */
  protected readonly moreLabel = computed(() =>
    t('regie.stage.menu.monitorMore', { monitor: this.title() }),
  );
  /** The safe margin as a share of the canvas (the dashed guide of "Show safe area"). */
  protected readonly safeArea = computed(() => {
    const canvas = this.store.canvas();
    const margin = safeMargin(canvas);
    return {
      x: `${(margin / canvas.width) * 100}%`,
      y: `${(margin / canvas.height) * 100}%`,
    };
  });
  /** The monitor's menu (right click on the header or the picture, ⋯ button). */
  protected readonly menu = () => this.commands.monitorMenu(this.kind(), this.scene());

  /** The ⋯ button: the monitor's menu under the button. */
  protected openMenu(event: MouseEvent): void {
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = button?.getBoundingClientRect();
    this.menus.open(
      this.menu(),
      { x: rect?.left ?? event.clientX, y: (rect?.bottom ?? event.clientY) + 4 },
      { label: this.title(), returnFocus: button },
    );
  }

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
