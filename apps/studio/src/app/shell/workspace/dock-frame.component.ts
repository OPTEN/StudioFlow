import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { IconComponent } from '../../core/ui/icon.component';
import { DOCK_TITLES, type DockId, type DockSlotId } from './dock-layout';
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
 * Chrome of a dock (prototype `.panel-h` + `.panel-b`): a 40 px header with the drag grip, the uppercase title, an
 * optional subtitle and mono count, right-aligned actions, and a scrolling body with scroll-edge fades. Every dock
 * component wraps its content in it:
 *
 * ```html
 * <fs-dock-frame dock="st" [count]="stations().length">
 *   <button fsDockActions class="c-btn c-btn--sm c-btn--primary" type="button">…Gerät koppeln</button>
 *   …body…
 * </fs-dock-frame>
 * ```
 *
 * Dragging the header (or the grip) moves the dock between zones; arrow keys on the grip move it step by step.
 * The pairing dock uses `[draggable]="false"`. On stacked layouts (≤ 1180 px) the grip is hidden.
 */
@Component({
  selector: 'fs-dock-frame',
  imports: [IconComponent],
  template: `
    <div
      class="c-dock-frame__head"
      [class.is-draggable]="draggable()"
      (pointerdown)="onHeadPointerDown($event)"
    >
      @if (draggable()) {
        <button
          class="c-dock-frame__grip"
          type="button"
          [attr.aria-label]="'Dock ' + dockTitle() + ' verschieben, mit Pfeiltasten'"
          (keydown)="onGripKeyDown($event)"
        >
          <svg fsIcon="grip"></svg>
        </button>
      }
      <span class="c-dock-frame__title" [class.c-dock-frame__title--solo]="!draggable()">{{
        heading()
      }}</span>
      @if (subtitle()) {
        <span class="c-dock-frame__sub">{{ subtitle() }}</span>
      }
      @if (count() !== null) {
        <span class="c-dock-frame__count">{{ count() }}</span>
      }
      <span class="u-spacer"></span>
      <ng-content select="[fsDockActions]" />
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
  /** Header text; defaults to the dock title (Eigenschaften shows «Szene» or «Element»). */
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

  protected readonly dockTitle = computed(() => DOCK_TITLES[this.dock()]);
  protected readonly heading = computed(() => this.title() ?? this.dockTitle());

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
