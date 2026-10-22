import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { DOCK_IDS, DOCK_TITLES, type DockId } from '../workspace/dock-layout';
import { DockLayoutService } from '../workspace/dock-layout.service';

/** Id of the «Docks und Layout» popover. */
export const LAYOUT_POPOVER = 'layout';

/**
 * «Docks und Layout» (prototype `renderLayoutPop`): show or hide each dock, reset the layout, and the hint how docks
 * and hairlines work. Rendered by the header inside its popover wrapper while open.
 */
@Component({
  selector: 'fs-layout-popover',
  imports: [IconComponent, PopoverDirective],
  template: `
    <div class="c-pop" role="dialog" aria-label="Docks und Layout" [fsPopover]="popoverId">
      <div class="c-pop-h">Docks</div>
      @for (id of dockIds; track id) {
        <label class="c-menu-item">
          <input type="checkbox" [checked]="layout.isShown(id)" (change)="toggle(id, $event)" />{{
            titles[id]
          }}
        </label>
      }
      <div class="c-menu-sep"></div>
      <button class="c-menu-item" type="button" (click)="layout.resetLayout()">
        <svg fsIcon="refresh"></svg>Layout zurücksetzen
      </button>
      <div class="c-pop-note">
        Ein Dock an der Kopfzeile nach unten, links oder rechts ziehen. Trennlinien ziehen ändert
        die Grösse, ein Doppelklick setzt sie zurück.
      </div>
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
  protected readonly titles = DOCK_TITLES;

  protected toggle(id: DockId, event: Event): void {
    this.layout.setShown(id, (event.target as HTMLInputElement).checked);
  }
}
