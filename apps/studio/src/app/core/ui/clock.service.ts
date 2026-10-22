import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * The one shared second tick of the Regie: header clock, LIVE runtime, outage timers and invite countdowns all read
 * {@link now}, so the whole UI updates once per second with a single timer. The tick is aligned to the start of each
 * local second.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly nowMs = signal(Date.now());

  /** Local time in ms since the epoch, updated once per second. */
  readonly now = this.nowMs.asReadonly();

  constructor() {
    this.schedule();
    inject(DestroyRef).onDestroy(() => {
      if (this.timer !== null) {
        clearTimeout(this.timer);
      }
      this.timer = null;
    });
  }

  private schedule(): void {
    const delay = 1000 - (Date.now() % 1000) + 5;
    this.timer = setTimeout(() => {
      this.nowMs.set(Date.now());
      this.schedule();
    }, delay);
  }
}
