import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/ui/toast.service';

/**
 * Renders the toast of `ToastService` (prototype `.toast`): centred at the bottom on raised-2 with the pop shadow,
 * optional action button. The host is a permanent polite live region, so screen readers announce every toast.
 */
@Component({
  selector: 'sf-toast-host',
  template: `
    @if (toasts.current(); as toast) {
      <div class="c-toast">
        <span>{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button class="c-btn c-btn--sm" type="button" (click)="toasts.runAction()">
            {{ action.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      max-width: calc(100vw - 32px);
      position: fixed;
      transform: translateX(-50%);
      z-index: 60;
    }

    .c-toast {
      align-items: center;
      background: var(--raised-2);
      border: 1px solid var(--seam-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-pop);
      display: inline-flex;
      font-size: 13.5px;
      gap: 12px;
      padding: 9px 10px 9px 14px;
      width: max-content;
      max-width: calc(100vw - 32px);
    }

    .c-btn {
      height: 26px;
    }
  `,
  host: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', lang: 'de-CH' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
}
