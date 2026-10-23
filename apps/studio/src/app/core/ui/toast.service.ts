import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { toUserMessage, type ErrorMessageOverrides } from '../api/api-error';

/** Optional action button of a toast ("Undo", "Reset layout"). */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/** The toast currently shown. */
export interface Toast {
  /** Increments with every new toast, so an equal message re-announces once the previous one has gone. */
  readonly id: number;
  readonly message: string;
  readonly action: ToastAction | null;
}

/** Display time without action (prototype: 3.2 s). */
export const TOAST_MS = 3200;
/** Display time with an action button (prototype: 6 s). */
export const TOAST_WITH_ACTION_MS = 6000;

/**
 * One toast at a time, centred at the bottom (prototype `toast()`): a new toast replaces the current one. Rendered by
 * `ToastHostComponent` in a polite live region. Use {@link error} for failed API calls.
 *
 * The same message (without action) while it is still shown keeps that toast and only restarts its timer: requests
 * that fail again and again during a short outage (a drag sends many) give one calm message, not a storm of identical
 * announcements.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly currentToast = signal<Toast | null>(null);

  /** The visible toast, or null. */
  readonly current = this.currentToast.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /** Shows a message, optionally with an action button; replaces the current toast. */
  show(message: string, action?: ToastAction): void {
    this.clearTimer();
    const current = this.currentToast();
    const repeated =
      !action && current !== null && current.action === null && current.message === message;
    const toast: Toast = repeated
      ? current
      : { id: this.nextId++, message, action: action ?? null };
    this.currentToast.set(toast);
    this.timer = setTimeout(
      () => {
        if (this.currentToast()?.id === toast.id) {
          this.currentToast.set(null);
        }
        this.timer = null;
      },
      action ? TOAST_WITH_ACTION_MS : TOAST_MS,
    );
  }

  /** Shows the message of an API (or any) error in the active language; see `toUserMessage`. */
  error(error: unknown, overrides?: ErrorMessageOverrides): void {
    this.show(toUserMessage(error, overrides));
  }

  /** Runs the action of the current toast and hides it. */
  runAction(): void {
    const action = this.currentToast()?.action;
    this.dismiss();
    action?.run();
  }

  /** Hides the current toast. */
  dismiss(): void {
    this.clearTimer();
    this.currentToast.set(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
