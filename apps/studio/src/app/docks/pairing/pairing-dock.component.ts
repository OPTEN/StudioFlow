import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
} from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import { IconComponent } from '../../core/ui/icon.component';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { DockLayoutService, type PairingTab } from '../../shell/workspace/dock-layout.service';
import { LaptopTabComponent } from './laptop-tab.component';
import { LinkTabComponent } from './link-tab.component';
import { PairingRequestsComponent } from './pairing-requests.component';
import { PairingRequestsService } from './pairing-requests.service';
import { PairingTabMemory } from './pairing-tab-memory.service';
import { PhoneTabComponent } from './phone-tab.component';

/** A tab of the pairing dock. */
interface TabDefinition {
  readonly id: PairingTab;
  readonly labelKey: PlainMessageKey;
  readonly icon: 'phone' | 'laptop' | 'link';
}

/** Tabs in order (prototype: Phone | Laptop | Link); the label is a message key. */
export const PAIRING_TABS: readonly TabDefinition[] = [
  { id: 'phone', labelKey: 'regie.pairing.tab.phone', icon: 'phone' },
  { id: 'laptop', labelKey: 'regie.pairing.tab.laptop', icon: 'laptop' },
  { id: 'link', labelKey: 'regie.pairing.tab.link', icon: 'link' },
];

/** The tab reached from `current` with an arrow key, Home or End (wrapping), or null for other keys. */
export function tabForKey(current: PairingTab, key: string): PairingTab | null {
  const index = PAIRING_TABS.findIndex((tab) => tab.id === current);
  const last = PAIRING_TABS.length - 1;
  switch (key) {
    case 'ArrowRight':
      return PAIRING_TABS[index >= last ? 0 : index + 1].id;
    case 'ArrowLeft':
      return PAIRING_TABS[index <= 0 ? last : index - 1].id;
    case 'Home':
      return PAIRING_TABS[0].id;
    case 'End':
      return PAIRING_TABS[last].id;
    default:
      return null;
  }
}

/**
 * The "Add device" dock (prototype "Pair device (docked)"): tabs Phone | Laptop | Link with roving tabindex (arrow
 * keys, Home, End) pinned above the scrolling tab content, and a side column with the waiting requests (knock cards;
 * on the Phone tab only while one waits) and, on the Phone tab, the tips for mounted phones. The chosen tab is
 * remembered per browser ({@link PairingTabMemory}). Shown by the workspace in place of Sources and Properties while
 * `DockLayoutService.pairingOpen()`; Escape and the close button close it. Opening it moves the focus to the
 * selected tab.
 */
@Component({
  selector: 'sf-pairing-dock',
  imports: [
    DockFrameComponent,
    IconComponent,
    LaptopTabComponent,
    LinkTabComponent,
    PairingRequestsComponent,
    PhoneTabComponent,
  ],
  templateUrl: './pairing-dock.component.html',
  styleUrl: './pairing-dock.component.scss',
  host: { id: 'sf-pairing-dock', style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingDockComponent {
  protected readonly layout = inject(DockLayoutService);
  protected readonly requests = inject(PairingRequestsService);
  private readonly tabMemory = inject(PairingTabMemory);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly t = t;
  protected readonly tabs = PAIRING_TABS;

  constructor() {
    // The dock is created once and parked while closed: every opening focuses the selected tab (prototype openPair).
    effect(() => {
      if (this.layout.pairingOpen()) {
        afterNextRender(() => this.focusTab(this.layout.pairingTab()), {
          injector: this.injector,
        });
      }
    });
  }

  protected select(tab: PairingTab): void {
    this.layout.setPairingTab(tab);
    this.tabMemory.remember(tab);
  }

  protected onTabKeyDown(event: KeyboardEvent): void {
    const next = tabForKey(this.layout.pairingTab(), event.key);
    if (!next) {
      return;
    }
    event.preventDefault();
    this.select(next);
    this.focusTab(next);
  }

  private focusTab(tab: PairingTab): void {
    this.element.querySelector<HTMLButtonElement>(`#sf-pair-tab-${tab}`)?.focus();
  }
}
