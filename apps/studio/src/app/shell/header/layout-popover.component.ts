import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { DOCK_IDS, DOCK_TITLE_KEYS, type DockId } from '../workspace/dock-layout';
import { DockLayoutService } from '../workspace/dock-layout.service';

/** Id of the "Docks and layout" popover. */
export const LAYOUT_POPOVER = 'layout';

/**
 * "Docks and layout" (prototype `renderLayoutPop`): show or hide each dock, reset the layout, and the hint how docks
 * and hairlines work. Rendered by the header inside its popover wrapper while open.
 */
@Component({
  selector: 'sf-layout-popover',
  imports: [IconComponent, PopoverDirective],
  template: `
    <div
      class="c-pop"
      role="dialog"
      [attr.aria-label]="t('regie.header.layout.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h">{{ t('regie.header.layout.docks') }}</div>
      @for (id of dockIds; track id) {
        <label class="c-menu-item">
          <input type="checkbox" [checked]="layout.isShown(id)" (change)="toggle(id, $event)" />{{
            t(titleKeys[id])
          }}
        </label>
      }
      <div class="c-menu-sep"></div>
      <button class="c-menu-item" type="button" (click)="layout.resetLayout()">
        <svg sfIcon="refresh"></svg>{{ t('regie.workspace.layout.reset') }}
      </button>
      <div class="c-pop-note">{{ t('regie.header.layout.note') }}</div>
    </div>
  `,
  styles: `
    .c-pop {
      width: 280px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutPopoverComponent {
  protected readonly layout = inject(DockLayoutService);
  protected readonly popoverId = LAYOUT_POPOVER;
  protected readonly dockIds = DOCK_IDS;
  protected readonly titleKeys = DOCK_TITLE_KEYS;
  protected readonly t = t;

  protected toggle(id: DockId, event: Event): void {
    this.layout.setShown(id, (event.target as HTMLInputElement).checked);
  }
}
