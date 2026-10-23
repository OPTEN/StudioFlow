import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';

/**
 * Speaks a short status to screen readers through one visually hidden live region at the end of the body (a list
 * cannot hold a live region of its own: its only children are its items). Used for what a sighted user sees happen,
 * such as "K1 moved to position 2 of 5" while a row is reordered.
 *
 * The region is assertive so that quick successive keystrokes are not queued behind each other. The same text twice
 * in a row is still announced: the region is emptied first.
 */
@Injectable({ providedIn: 'root' })
export class LiveAnnouncerService {
  private readonly document = inject(DOCUMENT);
  private region: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.clearTimer();
      this.region?.remove();
      this.region = null;
    });
  }

  /** Announces `text`, replacing an announcement that has not been read yet. */
  announce(text: string): void {
    const region = this.ensureRegion();
    this.clearTimer();
    region.textContent = '';
    this.timer = setTimeout(() => {
      region.textContent = text;
      this.timer = null;
    }, 30);
  }

  private ensureRegion(): HTMLElement {
    if (!this.region) {
      const region = this.document.createElement('div');
      region.className = 'u-sr-only';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'assertive');
      region.setAttribute('aria-atomic', 'true');
      this.document.body.append(region);
      this.region = region;
    }
    return this.region;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
