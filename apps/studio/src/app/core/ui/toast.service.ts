import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { toUserMessage, type ErrorMessageOverrides } from '../api/api-error';

/** Optional action button of a toast ("Undo", "Add to scene"). */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/**
 * Tone of a toast: `success` confirms that something worked (check icon), `info` reports a neutral fact or a hint
 * (info icon, the default), `error` says that something failed (alert icon, red, stays longer).
 */
export type ToastKind = 'success' | 'info' | 'error';

/** One toast on screen. */
export interface Toast {
  /** Increments with every new toast, so an equal message re-announces once the previous one has gone. */
  readonly id: number;
  readonly message: string;
  readonly action: ToastAction | null;
  readonly kind: ToastKind;
}

/** Display time of a plain toast (prototype: 3.2 s). */
export const TOAST_MS = 3200;
/** Display time with an action button, so there is time to reach it (prototype: 6 s). */
export const TOAST_WITH_ACTION_MS = 6000;
/** Display time of an error: long enough to read a sentence about what failed and what to do. */
export const TOAST_ERROR_MS = 8000;
/** Toasts on screen at once; a further one pushes the oldest out. */
export const TOAST_MAX = 3;

/** A toast with its running timer. */
interface Entry {
  readonly toast: Toast;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Feedback toasts at the bottom of the window, rendered by `ToastHostComponent` in a polite live region. Toasts queue up
 * (at most {@link TOAST_MAX}, newest last) instead of replacing each other, so a quick second event never wipes out the
 * "Undo" of the first. Each toast has its own timer; while the pointer or the focus is on the stack the timers wait
 * ({@link hold}), so nobody loses a toast while reaching for its button. Use {@link error} for failed API calls.
 *
 * The same message (without action) while it is still shown keeps that toast and only restarts its timer: requests
 * that fail again and again during a short outage (a drag sends many) give one calm message, not a storm of identical
 * announcements.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private held = false;
  private readonly entries = signal<readonly Entry[]>([]);

  /** Every toast on screen, oldest first. */
  readonly toasts = computed(() => this.entries().map((entry) => entry.toast));
  /** The newest toast, or null. */
  readonly current = computed(() => this.entries().at(-1)?.toast ?? null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.entries().forEach((entry) => this.stop(entry)));
  }

  /** Shows a message, optionally with an action button; `kind` sets the tone (default `info`). */
  show(message: string, action?: ToastAction | null, kind: ToastKind = 'info'): void {
    const entries = this.entries();
    const repeated = action
      ? undefined
      : entries.find(
          (entry) =>
            entry.toast.action === null &&
            entry.toast.message === message &&
            entry.toast.kind === kind,
        );
    if (repeated) {
      this.start(repeated);
      return;
    }
    const entry: Entry = {
      toast: { id: this.nextId++, message, action: action ?? null, kind },
      timer: null,
    };
    const kept = entries.slice(Math.max(0, entries.length - TOAST_MAX + 1));
    entries.filter((old) => !kept.includes(old)).forEach((old) => this.stop(old));
    this.entries.set([...kept, entry]);
    this.start(entry);
  }

  /** A success toast: something worked as asked ("Scene created"). */
  success(message: string, action?: ToastAction | null): void {
    this.show(message, action, 'success');
  }

  /** Shows the message of an API (or any) error in the active language as an error toast; see `toUserMessage`. */
  error(error: unknown, overrides?: ErrorMessageOverrides): void {
    this.show(toUserMessage(error, overrides), null, 'error');
  }

  /** Runs the action of a toast (default: the newest) and hides that toast. */
  runAction(id?: number): void {
    const toast = id === undefined ? this.current() : this.find(id);
    if (!toast?.action) {
      return;
    }
    const { run } = toast.action;
    this.dismiss(toast.id);
    run();
  }

  /** Hides one toast, or every toast when no id is given. */
  dismiss(id?: number): void {
    const entries = this.entries();
    const gone = id === undefined ? entries : entries.filter((entry) => entry.toast.id === id);
    gone.forEach((entry) => this.stop(entry));
    const rest = entries.filter((entry) => !gone.includes(entry));
    this.entries.set(rest);
    if (rest.length === 0) {
      // Nothing left to point at or focus: the next toast runs its timer again.
      this.held = false;
    }
  }

  /**
   * Holds the timers while the pointer or the focus is on the toasts (`true`) and restarts them with their full time
   * when it leaves (`false`).
   */
  hold(held: boolean): void {
    if (this.held === held) {
      return;
    }
    this.held = held;
    for (const entry of this.entries()) {
      if (held) {
        this.stop(entry);
      } else {
        this.start(entry);
      }
    }
  }

  private find(id: number): Toast | null {
    return this.entries().find((entry) => entry.toast.id === id)?.toast ?? null;
  }

  private start(entry: Entry): void {
    this.stop(entry);
    if (this.held) {
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.entries.update((entries) => entries.filter((other) => other !== entry));
    }, durationOf(entry.toast));
  }

  private stop(entry: Entry): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
}

/** How long a toast stays: errors longest, toasts with an action longer than plain ones. */
function durationOf(toast: Toast): number {
  if (toast.kind === 'error') {
    return TOAST_ERROR_MS;
  }
  return toast.action ? TOAST_WITH_ACTION_MS : TOAST_MS;
}
