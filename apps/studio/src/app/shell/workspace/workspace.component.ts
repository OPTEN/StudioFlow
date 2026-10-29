import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  Injector,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  createComponent,
  effect,
  forwardRef,
  inject,
  signal,
  untracked,
  viewChild,
  type ComponentRef,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ViewportService } from '../../core/ui/viewport.service';
import { FRAME_SCHEDULER } from '../../stage/frame-scheduler';
import { StageComponent } from '../../stage/stage.component';
import {
  DOCK_TITLE_KEYS,
  DOCK_ZONES,
  LAYOUT_LIMITS,
  type DockSlotId,
  type DockZone,
} from './dock-layout';
import { DockDragService } from './dock-drag.service';
import { DockLayoutService } from './dock-layout.service';
import { DockSlotComponent } from './dock-slot.component';
import { DockWorkspace } from './dock-workspace';
import { SplitterDirective, type SplitterBehavior } from './splitter.directive';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A dock along the splitter axis: its content size and the padding and border around it. */
interface DockExtent {
  readonly content: number;
  readonly chrome: number;
}

/**
 * Size of a dock along the splitter axis. The docks share the zone by flex weight (flex-basis 0), so only the content
 * size (without padding and border) is proportional to the weight: the docks at the window edge carry a gutter as
 * padding that would otherwise skew the conversion of pixels into weights.
 */
function dockExtent(element: HTMLElement, across: boolean): DockExtent {
  const style = getComputedStyle(element);
  const names = across
    ? ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']
    : ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'];
  const chrome = names.reduce(
    (sum, name) => sum + (parseFloat(style.getPropertyValue(name)) || 0),
    0,
  );
  const size = element.getBoundingClientRect()[across ? 'width' : 'height'];
  return { content: Math.max(1, size - chrome), chrome };
}

/** Width of the control column plus the monitor split and gap (prototype fitStage: 212 px). */
const STAGE_CHROME_PX = 212;
/** Monitor header and stage padding above/below the picture (prototype fitStage: 58 px). */
const STAGE_VERTICAL_CHROME_PX = 58;

/**
 * The Regie workspace (prototype `.work`): the stage in the centre, the dock zones left, bottom and right with
 * hairline splitters, drag and drop of docks, the pairing dock in place of Sources and Properties, and the
 * responsive stacking (≤ 1180 px two-column grid below the stage, ≤ 900 px one column).
 *
 * Every dock is created once (`DockSlotComponent`) and its view is moved between the zone containers when the layout
 * changes, so no dock loses its state. Without side docks the bottom zone keeps its default height; with side docks
 * it fits the stage to the Studio Mode monitors (prototype `fitStage`) so no empty band remains.
 */
@Component({
  selector: 'sf-workspace',
  imports: [StageComponent, SplitterDirective, IconComponent],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
  providers: [
    DockDragService,
    { provide: DockWorkspace, useExisting: forwardRef(() => WorkspaceComponent) },
  ],
  host: {
    class: 'c-workspace',
    '[style.--split]': 'layout.split()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent extends DockWorkspace {
  protected readonly layout = inject(DockLayoutService);
  protected readonly viewport = inject(ViewportService);
  private readonly store = inject(ProductionStoreService);
  protected readonly drag = inject(DockDragService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly environmentInjector = inject(EnvironmentInjector);

  private readonly leftOutlet = viewChild('leftOutlet', { read: ViewContainerRef });
  private readonly bottomOutlet = viewChild('bottomOutlet', { read: ViewContainerRef });
  private readonly rightOutlet = viewChild('rightOutlet', { read: ViewContainerRef });
  private readonly centerRef = viewChild<ElementRef<HTMLElement>>('center');
  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly bottomRef = viewChild<ElementRef<HTMLElement>>('bottom');
  private readonly leftRef = viewChild<ElementRef<HTMLElement>>('left');
  private readonly rightRef = viewChild<ElementRef<HTMLElement>>('right');

  private readonly slots = new Map<DockSlotId, ComponentRef<DockSlotComponent>>();
  /** Bottom zone height computed by fitStage (px), or null for the CSS default. */
  private readonly fittedBottom = signal<number | null>(null);
  /** Share of the bottom zone in the centre column as fitStage or the CSS default left it (0–1). */
  private readonly fittedBottomShare = signal(0.4);
  private readonly scheduleFrame = inject(FRAME_SCHEDULER);
  /** Cancels the pending fit of {@link scheduleFit}, null when none is scheduled. */
  private cancelFit: (() => void) | null = null;

  protected readonly zones = this.layout.zones;
  protected readonly titleKeys = DOCK_TITLE_KEYS;
  protected readonly t = t;

  /** Inline height of the bottom zone: stored fraction, fitted px, or the CSS default (`--dock-h`). */
  protected readonly bottomHeight = computed(() => {
    if (this.viewport.stacked()) {
      return null;
    }
    const fraction = this.layout.layout().bottomH;
    if (fraction !== null) {
      return `${(fraction * 100).toFixed(2)}%`;
    }
    const fitted = this.fittedBottom();
    return fitted === null ? null : `${fitted}px`;
  });

  /** Share of the bottom zone in the centre column (percent), the position of its splitter. */
  protected readonly bottomPercent = computed(() => {
    const fraction = this.layout.layout().bottomH;
    return Math.round((fraction ?? this.fittedBottomShare()) * 100);
  });
  protected readonly sideMin = LAYOUT_LIMITS.sideMin;
  protected readonly sideMax = LAYOUT_LIMITS.sideMax;

  protected readonly bottomSplit: SplitterBehavior = {
    begin: () => {
      const zone = this.bottomRef()?.nativeElement;
      const center = this.centerRef()?.nativeElement;
      if (!zone || !center) {
        return null;
      }
      const height = zone.getBoundingClientRect().height;
      const total = Math.max(1, center.getBoundingClientRect().height);
      return {
        move: (_dx, dy) =>
          this.layout.setBottomHeight(
            clamp(height - dy, LAYOUT_LIMITS.bottomMinPx, total - LAYOUT_LIMITS.stageMinPx) / total,
          ),
        end: () => this.layout.save(),
      };
    },
    reset: () => this.layout.resetBottomHeight(),
  };

  protected readonly leftSplit = this.sideSplit('left');
  protected readonly rightSplit = this.sideSplit('right');

  constructor() {
    super();
    this.drag.attach(this.host);
    effect(() => {
      const zones = this.zones();
      const outlets = {
        left: this.leftOutlet(),
        bottom: this.bottomOutlet(),
        right: this.rightOutlet(),
      };
      // Creating dock components must not make their signal reads dependencies of this effect.
      untracked(() => this.place(zones, outlets));
    });
    afterRenderEffect(() => {
      // Re-fit when the layout or the breakpoint changes; fitStage measures the DOM untracked.
      this.zones();
      this.layout.layout();
      this.viewport.stacked();
      this.store.canvas();
      untracked(() => this.fitStage());
    });
    this.observeSize();
    inject(DestroyRef).onDestroy(() => {
      for (const ref of this.slots.values()) {
        ref.destroy();
      }
      this.slots.clear();
    });
  }

  /** {@inheritDoc DockWorkspace.splitBehavior} */
  splitBehavior(a: DockSlotId, b: DockSlotId, across: boolean): SplitterBehavior {
    return {
      begin: () => {
        const first = this.host.querySelector<HTMLElement>(`[data-dock="${a}"]`);
        const second = this.host.querySelector<HTMLElement>(`[data-dock="${b}"]`);
        if (!first || !second) {
          return null;
        }
        const extentA = dockExtent(first, across);
        const extentB = dockExtent(second, across);
        const sizeA = extentA.content;
        const sizeB = extentB.content;
        const weights = this.layout.layout().weights;
        const weightA = weights[a];
        const weightB = weights[b];
        // The minimum sizes the whole dock (as min-width does), so the content of an edge dock may get smaller.
        const min = across ? LAYOUT_LIMITS.bottomDockMinPx : LAYOUT_LIMITS.sideDockMinPx;
        const minA = Math.max(1, min - extentA.chrome);
        const minB = Math.max(1, min - extentB.chrome);
        return {
          move: (dx, dy) => {
            const next = clamp(
              sizeA + (across ? dx : dy),
              minA,
              Math.max(minA, sizeA + sizeB - minB),
            );
            const nextA = ((weightA + weightB) * next) / Math.max(1, sizeA + sizeB);
            this.layout.setWeights(a, nextA, b, weightA + weightB - nextA);
          },
          end: () => this.layout.save(),
        };
      },
      reset: () => this.layout.resetWeights(a, b),
    };
  }

  private sideSplit(zone: 'left' | 'right'): SplitterBehavior {
    return {
      begin: () => {
        const element = (zone === 'left' ? this.leftRef() : this.rightRef())?.nativeElement;
        if (!element) {
          return null;
        }
        const width = element.getBoundingClientRect().width;
        const max = Math.max(LAYOUT_LIMITS.sideMin, this.host.clientWidth * 0.42);
        return {
          move: (dx) =>
            this.layout.setSideWidth(
              zone,
              clamp(width + (zone === 'left' ? dx : -dx), LAYOUT_LIMITS.sideMin, max),
            ),
          end: () => this.layout.save(),
        };
      },
      reset: () => this.layout.resetSideWidth(zone),
    };
  }

  /** Puts every shown dock view into its zone container in order; parks the others (kept alive, not in the DOM). */
  private place(
    zones: Readonly<Record<DockZone, readonly DockSlotId[]>>,
    outlets: Record<DockZone, ViewContainerRef | undefined>,
  ): void {
    if (!outlets.left || !outlets.bottom || !outlets.right) {
      return;
    }
    const containers = outlets as Record<DockZone, ViewContainerRef>;
    const wanted = new Map<DockSlotId, DockZone>();
    for (const zone of DOCK_ZONES) {
      for (const id of zones[zone]) {
        wanted.set(id, zone);
      }
    }
    // 1. Detach views that are parked or belong to another zone.
    for (const [id, ref] of this.slots) {
      for (const zone of DOCK_ZONES) {
        const index = containers[zone].indexOf(ref.hostView);
        if (index >= 0 && wanted.get(id) !== zone) {
          containers[zone].detach(index);
        }
      }
    }
    // 2. Insert or move the wanted views into position.
    for (const zone of DOCK_ZONES) {
      const container = containers[zone];
      zones[zone].forEach((id, position) => {
        const view = this.slot(id).hostView;
        const current = container.indexOf(view);
        if (current === position) {
          return;
        }
        if (current >= 0) {
          container.move(view, position);
        } else {
          container.insert(view, position);
        }
      });
    }
  }

  private slot(id: DockSlotId): ComponentRef<DockSlotComponent> {
    let ref = this.slots.get(id);
    if (!ref) {
      ref = createComponent(DockSlotComponent, {
        environmentInjector: this.environmentInjector,
        elementInjector: this.injector,
      });
      ref.setInput('dockId', id);
      this.slots.set(id, ref);
    }
    return ref;
  }

  /**
   * Prototype `fitStage`: with side docks (and no stored bottom height) the stage gets exactly the height of the
   * Studio Mode monitors and the remaining space goes to the bottom docks instead of an empty band.
   */
  private fitStage(): void {
    const stage = this.stageRef()?.nativeElement;
    const center = this.centerRef()?.nativeElement;
    const zones = this.zones();
    const sideDocks = zones.left.length > 0 || zones.right.length > 0;
    if (
      !stage ||
      !center ||
      this.layout.layout().bottomH !== null ||
      this.viewport.stacked() ||
      zones.bottom.length === 0 ||
      !sideDocks
    ) {
      this.fittedBottom.set(null);
      this.measureBottomShare();
      return;
    }
    const style = getComputedStyle(stage);
    const contentWidth =
      stage.clientWidth -
      parseFloat(style.paddingLeft || '0') -
      parseFloat(style.paddingRight || '0');
    const split = this.layout.split();
    const monitorWidth = Math.max(0, (contentWidth - STAGE_CHROME_PX) * Math.max(split, 1 - split));
    const canvas = this.store.canvas();
    const stageHeight =
      Math.ceil((monitorWidth * canvas.height) / canvas.width) + STAGE_VERTICAL_CHROME_PX;
    const centerHeight = center.clientHeight;
    const defaultDock = clamp(window.innerHeight * 0.42, 240, 420);
    const dock = Math.max(defaultDock, centerHeight - 1 - stageHeight);
    const height = Math.round(Math.min(dock, centerHeight - LAYOUT_LIMITS.stageMinPx - 1));
    const fitted = Math.max(LAYOUT_LIMITS.bottomMinPx, height);
    this.fittedBottom.set(fitted);
    this.fittedBottomShare.set(Math.min(1, fitted / Math.max(1, centerHeight)));
  }

  /** Reads the share of the bottom zone that the CSS default gives it. */
  private measureBottomShare(): void {
    const zone = this.bottomRef()?.nativeElement;
    const center = this.centerRef()?.nativeElement;
    if (zone && center && center.clientHeight > 0) {
      this.fittedBottomShare.set(
        Math.min(1, zone.getBoundingClientRect().height / center.clientHeight),
      );
    }
  }

  private observeSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => this.scheduleFit());
    effect(() => {
      const center = this.centerRef()?.nativeElement;
      observer.disconnect();
      if (center) {
        observer.observe(center);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      this.cancelFit?.();
    });
  }

  /**
   * Fits the stage one frame after the measurement. The fitted height of the bottom zone resizes the observed centre
   * again; written inside the observer callback that is a layout change within the same delivery, which browsers report
   * as the error event “ResizeObserver loop completed with undelivered notifications”.
   */
  private scheduleFit(): void {
    if (this.cancelFit) {
      return;
    }
    this.cancelFit = this.scheduleFrame(() => {
      this.cancelFit = null;
      this.fitStage();
    });
  }
}
