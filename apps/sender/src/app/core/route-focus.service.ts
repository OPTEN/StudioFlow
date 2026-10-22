import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Moves the focus to the main heading after every route change (not on the first load), so screen readers announce
 * the new screen and keyboard users start at its top. Headings opt in with `data-route-focus` and `tabindex="-1"`.
 */
@Injectable({ providedIn: 'root' })
export class RouteFocusService {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  /** Starts listening; call once from the root component. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    let first = true;
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (first) {
          first = false;
          return;
        }
        afterNextRender(() => this.focusHeading(), { injector: this.injector });
      });
  }

  /** Focuses the first `[data-route-focus]` element of the page, if any. */
  focusHeading(): void {
    const target = this.document.querySelector<HTMLElement>('[data-route-focus]');
    target?.focus({ preventScroll: false });
  }
}
