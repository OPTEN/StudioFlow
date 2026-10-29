import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { AudioDockComponent } from '../../docks/audio/audio-dock.component';
import { PairingDockComponent } from '../../docks/pairing/pairing-dock.component';
import { PropertiesDockComponent } from '../../docks/properties/properties-dock.component';
import { ScenesDockComponent } from '../../docks/scenes/scenes-dock.component';
import { SourcesDockComponent } from '../../docks/sources/sources-dock.component';
import { StationsDockComponent } from '../../docks/stations/stations-dock.component';
import { ViewportService } from '../../core/ui/viewport.service';
import { DOCK_REGION_KEYS, DOCK_TITLE_KEYS, DOCK_ZONES, type DockSlotId } from './dock-layout';
import { DockDragService } from './dock-drag.service';
import { DockLayoutService } from './dock-layout.service';
import { DockWorkspace } from './dock-workspace';
import { SplitterDirective } from './splitter.directive';

/**
 * One dock inside a zone (prototype `section.panel[data-dock]`): the region with its accessible name, its flex weight,
 * the 16 px window gutter at the outer edges, the hairline splitter to the previous dock and the dock component
 * itself. Created once per dock by `WorkspaceComponent` and moved between zones without being destroyed, so dock
 * state survives moves and the pairing dock replacing Sources and Properties.
 */
@Component({
  selector: 'sf-dock-slot',
  imports: [
    SplitterDirective,
    ScenesDockComponent,
    SourcesDockComponent,
    PropertiesDockComponent,
    StationsDockComponent,
    AudioDockComponent,
    PairingDockComponent,
  ],
  template: `
    @if (splitBefore(); as split) {
      <div
        class="c-dock-slot__split"
        [class.c-dock-slot__split--across]="split.across"
        [sfSplitter]="split.behavior"
        [splitterValue]="splitValue()"
        [orientation]="split.across ? 'vertical' : 'horizontal'"
        [splitterDisabled]="viewport.stacked()"
        [attr.aria-label]="split.label"
      ></div>
    }
    @switch (dockId()) {
      @case ('scenes') {
        <sf-scenes-dock />
      }
      @case ('src') {
        <sf-sources-dock />
      }
      @case ('insp') {
        <sf-properties-dock />
      }
      @case ('st') {
        <sf-stations-dock />
      }
      @case ('audio') {
        <sf-audio-dock />
      }
      @case ('pair') {
        <sf-pairing-dock />
      }
    }
  `,
  styleUrl: './dock-slot.component.scss',
  host: {
    role: 'region',
    '[attr.aria-label]': 'label()',
    '[attr.data-dock]': 'dockId()',
    '[class.has-split-across]': 'splitBefore()?.across === true',
    '[class.has-split-down]': 'splitBefore()?.across === false',
    '[class.is-edge-l]': 'edgeLeft()',
    '[class.is-edge-r]': 'edgeRight()',
    '[class.is-moving]': 'moving()',
    '[class.is-pair]': "dockId() === 'pair'",
    '[style.flex-grow]': 'weight()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockSlotComponent {
  /** The dock shown in this slot. */
  readonly dockId = input.required<DockSlotId>();

  protected readonly viewport = inject(ViewportService);
  private readonly layout = inject(DockLayoutService);
  private readonly drag = inject(DockDragService);
  private readonly workspace = inject(DockWorkspace);

  protected readonly label = computed(() => t(DOCK_REGION_KEYS[this.dockId()]));
  protected readonly weight = computed(() => this.layout.layout().weights[this.dockId()] ?? 1);
  protected readonly edgeLeft = computed(() => this.layout.leftEdgeDocks().includes(this.dockId()));
  protected readonly edgeRight = computed(() =>
    this.layout.rightEdgeDocks().includes(this.dockId()),
  );
  protected readonly moving = computed(() => this.drag.dragging()?.id === this.dockId());

  /** The hairline to the previous dock in the same zone, or null for the first dock. */
  protected readonly splitBefore = computed(() => {
    const id = this.dockId();
    const zones = this.layout.zones();
    for (const zone of DOCK_ZONES) {
      const index = zones[zone].indexOf(id);
      if (index > 0) {
        const previous = zones[zone][index - 1];
        const across = zone === 'bottom';
        return {
          across,
          previous,
          behavior: this.workspace.splitBehavior(previous, id, across),
          label: t('regie.workspace.splitter.between', {
            first: t(DOCK_TITLE_KEYS[previous]),
            second: t(DOCK_TITLE_KEYS[id]),
          }),
        };
      }
    }
    return null;
  });

  /** Share of the previous dock in the space of both docks (percent), the position of the hairline. */
  protected readonly splitValue = computed(() => {
    const previous = this.splitBefore()?.previous;
    if (!previous) {
      return 0;
    }
    const weights = this.layout.layout().weights;
    const first = weights[previous];
    return Math.round((first / (first + weights[this.dockId()])) * 100);
  });
}
