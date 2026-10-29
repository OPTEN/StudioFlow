import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { DOCK_TITLE_KEYS, DOCK_ZONES, type DockId, type DockSlotId } from './dock-layout';
import { DockDragService } from './dock-drag.service';
import { DockLayoutService } from './dock-layout.service';

/** Elements inside a dock header that keep their own pointer behaviour (no dock drag). */
const INTERACTIVE = 'button:not(.c-dock-frame__grip), input, select, textarea, label, a, .c-pop';

/** Grip keys: left/up move towards the left zone, right/down towards the right zone. */
const GRIP_KEYS: Readonly<Record<string, -1 | 1 | undefined>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

/**
 * Chrome of a dock (prototype `.panel-h` + `.panel-b`): a 40 px header with the drag grip (shown on hover and focus),
 * the sentence-case title, an optional subtitle and a count badge, right-aligned actions, and a scrolling body with
 * scroll-edge fades. Every dock component wraps its content in it:
 *
 * ```html
 * <sf-dock-frame dock="st" [count]="stations().length">
 *   <button sfDockActions class="c-btn c-btn--sm c-btn--primary" type="button">…Add device</button>
 *   …body…
 * </sf-dock-frame>
 * ```
 *
 * Dragging the header (or the grip) moves the dock between zones; arrow keys on the grip move it step by step.
 * The pairing dock uses `[draggable]="false"`. On stacked layouts (≤ 1180 px) the grip is hidden. A right click on the
 * header (or Shift+F10 on the grip) offers "Hide dock", "Move to the left / bottom / right" and "Reset size"; each also
 * exists visibly ("Layout", the grip and dragging, a double click on the divider).
 */
@Component({
  selector: 'sf-dock-frame',
  imports: [ContextMenuDirective, IconComponent],
  template: `
    <div
      class="c-dock-frame__head"
      [class.is-draggable]="draggable()"
      [sfContextMenu]="menu"
      [sfContextMenuLabel]="dockTitle()"
      (pointerdown)="onHeadPointerDown($event)"
    >
      @if (draggable()) {
        <button
          class="c-dock-frame__grip"
          type="button"
          [attr.aria-label]="t('regie.workspace.grip', { title: dockTitle() })"
          [title]="t('regie.workspace.gripTitle')"
          (keydown)="onGripKeyDown($event)"
        >
          <svg sfIcon="grip"></svg>
        </button>
      }
      <span
        #title
        class="c-dock-frame__title"
        tabindex="-1"
        [class.c-dock-frame__title--solo]="!draggable()"
        >{{ heading() }}</span
      >
      @if (subtitle()) {
        <span class="c-dock-frame__sub">{{ subtitle() }}</span>
      }
      @if (count() !== null) {
        <span class="c-badge c-dock-frame__count">{{ count() }}</span>
      }
      <span class="u-spacer"></span>
      <ng-content select="[sfDockActions]" />
    </div>
    <div class="c-dock-frame__body" [class.c-dock-frame__body--static]="!scroll()">
      <ng-content />
    </div>
  `,
  styleUrl: './dock-frame.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockFrameComponent {
  /** Which dock this is. */
  readonly dock = input.required<DockSlotId>();
  /** Header text; defaults to the dock title (Properties shows "Scene" or "Item"). */
  readonly title = input<string | null>(null);
  /** Secondary header text (prototype `.panel-sub`, e.g. the scene name). */
  readonly subtitle = input<string | null>(null);
  /** Mono count after the title (null hides it). */
  readonly count = input<number | null>(null);
  /** Header drag and grip (false for the pairing dock). */
  readonly draggable = input(true);
  /** The body scrolls with edge fades (false: the content manages its own layout, e.g. the pairing grid). */
  readonly scroll = input(true);

  private readonly drag = inject(DockDragService, { optional: true });
  private readonly layout = inject(DockLayoutService);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly titleElement = viewChild.required<ElementRef<HTMLElement>>('title');

  protected readonly t = t;
  protected readonly dockTitle = computed(() => t(DOCK_TITLE_KEYS[this.dock()]));
  protected readonly heading = computed(() => this.title() ?? this.dockTitle());

  /** The right-click menu of the header; the pairing dock has none (it closes with its own button). */
  protected readonly menu = (): readonly ContextMenuEntry[] => {
    const id = this.dock();
    if (id === 'pair') {
      return [];
    }
    const zone = this.layout.zoneOf(id);
    return [
      {
        label: t('regie.workspace.menu.hide'),
        icon: 'eye-off',
        run: () => this.layout.hideDock(id),
      },
      'separator',
      ...DOCK_ZONES.map((target): ContextMenuEntry => ({
        label: t(`regie.workspace.menu.${target}`),
        checked: target === zone,
        disabled: target === zone,
        run: () => this.moveTo(id, target),
      })),
      'separator',
      {
        label: t('regie.workspace.menu.resetSize'),
        icon: 'refresh',
        run: () => this.layout.resetDockSize(id),
      },
    ];
  };

  /**
   * Moves the focus to the header title (focusable with `tabindex="-1"`, not in the tab order); used when the dock's
   * content is replaced under the focus, e.g. Properties going back from the element to the scene.
   */
  focusTitle(): void {
    this.titleElement().nativeElement.focus();
  }

  protected onHeadPointerDown(event: PointerEvent): void {
    const id = this.dock();
    if (!this.draggable() || id === 'pair' || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest(INTERACTIVE)) {
      return;
    }
    this.drag?.pointerDown(id as DockId, event);
  }

  /** Docks at the end of another zone (menu "Move to …"). */
  private moveTo(id: DockId, zone: (typeof DOCK_ZONES)[number]): void {
    this.layout.moveDock(id, zone, this.layout.layout().zones[zone].length);
  }

  protected onGripKeyDown(event: KeyboardEvent): void {
    const direction = GRIP_KEYS[event.key];
    const id = this.dock();
    if (!direction || id === 'pair') {
      return;
    }
    event.preventDefault();
    if (this.layout.moveDockBy(id, direction)) {
      // The dock's view moves to another place in the DOM, which drops the focus: put it back on the grip.
      afterNextRender(
        () => this.element.querySelector<HTMLButtonElement>('.c-dock-frame__grip')?.focus(),
        { injector: this.injector },
      );
    }
  }
}
