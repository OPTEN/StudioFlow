import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { IconComponent, type IconName } from '../core/ui/icon.component';
import { ToastService, type ToastKind } from '../core/ui/toast.service';

/** Icon per tone: a check for success, an info circle for hints, a warning triangle for errors. */
const KIND_ICON: Readonly<Record<ToastKind, IconName>> = {
  success: 'circle-check',
  info: 'info',
  error: 'alert',
};

/**
 * Renders the toasts of `ToastService`: a short stack centred at the bottom, newest at the bottom, each on the floating
 * material with its tone icon, the message, an optional action and a dismiss button. The host is a permanent polite live
 * region that announces additions only (`aria-atomic="false"`), so a new toast is read on its own and not together with
 * the ones still on screen. While the pointer or the focus is on the stack the toasts stay.
 */
@Component({
  selector: 'sf-toast-host',
  imports: [IconComponent],
  template: `
    @for (toast of toasts.toasts(); track toast.id) {
      <div class="c-toast" [class]="'c-toast--' + toast.kind" [attr.data-toast-id]="toast.id">
        <svg class="c-toast__icon" [sfIcon]="icon[toast.kind]"></svg>
        <span class="c-toast__text">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button
            class="c-btn c-btn--sm c-btn--plain c-toast__action"
            type="button"
            (click)="act(toast.id)"
          >
            {{ action.label }}
          </button>
        }
        <button
          class="c-ibtn c-toast__close"
          type="button"
          [attr.aria-label]="t('regie.core.toast.dismiss')"
          [title]="t('regie.core.toast.dismiss')"
          (click)="close(toast.id)"
        >
          <svg sfIcon="close" [size]="14"></svg>
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      display: grid;
      gap: 8px;
      justify-items: center;
      left: 50%;
      max-width: calc(100vw - 32px);
      pointer-events: none;
      position: fixed;
      transform: translateX(-50%);
      width: max-content;
      z-index: 60;
    }

    .c-toast {
      align-items: center;
      animation: c-toast-in var(--dur-reveal) var(--ease);
      background: var(--float);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-pop);
      color: var(--text);
      display: flex;
      font-size: var(--fs-body);
      gap: 10px;
      line-height: 1.35;
      max-width: min(560px, calc(100vw - 32px));
      min-height: 44px;
      padding: 7px 6px 7px 14px;
      pointer-events: auto;
    }

    .c-toast__icon {
      height: 18px;
      width: 18px;
    }

    .c-toast--success .c-toast__icon {
      color: var(--green);
    }

    .c-toast--info .c-toast__icon {
      color: var(--blue);
    }

    .c-toast--error .c-toast__icon {
      color: var(--red);
    }

    .c-toast__text {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
      padding-block: 4px;
    }

    .c-toast__action {
      flex: none;
    }

    .c-toast__close {
      flex: none;
    }

    @keyframes c-toast-in {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
    }
  `,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'false',
    'aria-relevant': 'additions text',
    '(pointerenter)': 'onPointer(true)',
    '(pointerleave)': 'onPointer(false)',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly icon = KIND_ICON;
  protected readonly t = t;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private pointer = false;
  private focus = false;

  protected onPointer(inside: boolean): void {
    this.pointer = inside;
    this.sync();
  }

  protected onFocusIn(): void {
    this.focus = true;
    this.sync();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    this.focus = next instanceof Node && this.host.contains(next);
    this.sync();
  }

  /** Runs the action of a toast. Its button goes with it, so the stack no longer holds the focus. */
  protected act(id: number): void {
    this.focus = false;
    this.toasts.runAction(id);
    this.sync();
  }

  /** Dismisses a toast; like {@link act}, the focus leaves with its button. */
  protected close(id: number): void {
    this.focus = false;
    this.toasts.dismiss(id);
    this.sync();
  }

  private sync(): void {
    if (this.toasts.toasts().length === 0) {
      this.pointer = false;
      this.focus = false;
    }
    this.toasts.hold(this.pointer || this.focus);
  }
}
