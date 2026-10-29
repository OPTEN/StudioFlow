import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective, PopoverService } from '../../core/ui/popover.directive';
import { ViewportService } from '../../core/ui/viewport.service';
import { DOCK_IDS, DOCK_TITLE_KEYS, type DockId } from '../workspace/dock-layout';
import { DockLayoutService } from '../workspace/dock-layout.service';

/** Id of the "Layout" popover. */
export const LAYOUT_POPOVER = 'layout';

/**
 * "Layout" (prototype `renderLayoutPop`): one switch per dock to show or hide it, "Reset layout…" behind a confirmation
 * that names what goes back to the default (the toast then offers "Undo"), the keyboard shortcuts, and a line on how
 * docks and dividers work (or why they do not while the window is narrow). Rendered by the header inside its popover
 * wrapper while open; "Keyboard shortcuts" closes it and asks the header (`shortcuts`) to open the sheet.
 */
@Component({
  selector: 'sf-layout-popover',
  imports: [ConfirmBoxComponent, IconComponent, PopoverDirective],
  template: `
    <div
      class="c-pop c-layout-pop"
      role="dialog"
      [attr.aria-label]="t('regie.header.layout.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h">{{ t('regie.header.layout.docks') }}</div>
      <div class="c-layout-pop__docks">
        @for (id of dockIds; track id) {
          <label class="c-switch c-layout-pop__row">
            <span class="c-layout-pop__name">{{ t(titleKeys[id]) }}</span>
            <input
              type="checkbox"
              role="switch"
              [checked]="layout.isShown(id)"
              (change)="toggle(id, $event)"
            />
          </label>
        }
      </div>
      <div class="c-menu-sep"></div>
      @if (confirming()) {
        <sf-confirm-box
          [label]="t('regie.workspace.layout.reset')"
          [message]="t('regie.workspace.layout.resetConfirm')"
          [confirmLabel]="t('regie.workspace.layout.reset')"
          (confirm)="reset()"
          (cancel)="endConfirm()"
        />
      } @else {
        <button #resetButton class="c-menu-item" type="button" (click)="confirming.set(true)">
          <svg sfIcon="refresh"></svg>{{ t('regie.workspace.layout.resetMenu') }}
        </button>
      }
      <button class="c-menu-item" type="button" (click)="showShortcuts()">
        <svg sfIcon="keyboard"></svg>
        <span class="u-spacer">{{ t('regie.header.layout.shortcuts') }}</span>
        <kbd class="c-layout-pop__key" aria-hidden="true">?</kbd>
      </button>
      <p class="c-pop-note c-layout-pop__note">
        {{
          viewport.stacked() ? t('regie.workspace.layout.stacked') : t('regie.header.layout.note')
        }}
      </p>
    </div>
  `,
  styles: `
    .c-layout-pop {
      width: 280px;
    }

    .c-layout-pop__docks {
      display: grid;
      padding: 0 4px;
    }

    .c-layout-pop__row {
      border-radius: var(--radius-sm);
      justify-content: space-between;
      min-height: 32px;
      padding: 4px 6px;

      &:hover {
        background: var(--fill);
      }
    }

    .c-layout-pop__name {
      font-weight: 400;
    }

    .c-layout-pop__key {
      background: var(--fill);
      border-radius: var(--radius-xs);
      color: var(--muted);
      font: 600 11px / 1 var(--font-ui);
      padding: 3px 6px;
    }

    .c-menu-item:hover .c-layout-pop__key,
    .c-menu-item:focus-visible .c-layout-pop__key {
      background: color-mix(in srgb, var(--on-fill) 20%, transparent);
      color: var(--on-fill);
    }

    .c-layout-pop__note {
      line-height: 1.4;
      margin: 4px 0 0;
      padding-top: 6px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutPopoverComponent {
  protected readonly layout = inject(DockLayoutService);
  protected readonly viewport = inject(ViewportService);
  private readonly popovers = inject(PopoverService);
  private readonly injector = inject(Injector);
  private readonly resetButton = viewChild<ElementRef<HTMLButtonElement>>('resetButton');
  protected readonly popoverId = LAYOUT_POPOVER;
  protected readonly dockIds = DOCK_IDS;
  protected readonly titleKeys = DOCK_TITLE_KEYS;
  protected readonly t = t;
  /** "Reset layout…" asks first. */
  protected readonly confirming = signal(false);

  /** "Keyboard shortcuts": the header opens the sheet. */
  readonly shortcuts = output<void>();

  protected toggle(id: DockId, event: Event): void {
    this.layout.setShown(id, (event.target as HTMLInputElement).checked);
  }

  /** Resets and stays open, so the switches show the result; the toast offers "Undo". */
  protected reset(): void {
    this.layout.resetLayout();
    this.endConfirm();
  }

  /** Back from the confirmation: the focus returns to "Reset layout…", which replaces it. */
  protected endConfirm(): void {
    this.confirming.set(false);
    afterNextRender(() => this.resetButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected showShortcuts(): void {
    this.popovers.close(this.popoverId);
    this.shortcuts.emit();
  }
}
