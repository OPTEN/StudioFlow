import { DestroyRef, Injectable, inject, signal, type Signal } from '@angular/core';

/** Media queries of the responsive rules in DESIGN.md (same values as styles/_mixins.scss). */
export const VIEWPORT_QUERIES = {
  stacked: '(max-width: 1180px)',
  narrow: '(max-width: 900px)',
  shortLaptop: '(max-height: 820px) and (min-width: 1181px)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

/**
 * The responsive breakpoints as signals, for logic that CSS alone cannot do (no dock dragging when stacked, inline
 * sizes only on wide screens, renderer fades off with reduced motion). Styles use the mixins in styles/_mixins.scss.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly destroyRef = inject(DestroyRef);

  /** Width ≤ 1180 px: docks stack below the stage, no dragging, no splitters. */
  readonly stacked = this.watch(VIEWPORT_QUERIES.stacked);
  /** Width ≤ 900 px: single column by priority. */
  readonly narrow = this.watch(VIEWPORT_QUERIES.narrow);
  /** Height ≤ 820 px on wide screens: compact rows. */
  readonly shortLaptop = this.watch(VIEWPORT_QUERIES.shortLaptop);
  /** prefers-reduced-motion: reduce (fades become cuts). */
  readonly reducedMotion = this.watch(VIEWPORT_QUERIES.reducedMotion);

  private watch(query: string): Signal<boolean> {
    const list = typeof matchMedia === 'function' ? matchMedia(query) : null;
    const state = signal(list?.matches ?? false);
    if (list) {
      const listener = (event: MediaQueryListEvent): void => state.set(event.matches);
      list.addEventListener('change', listener);
      this.destroyRef.onDestroy(() => list.removeEventListener('change', listener));
    }
    return state.asReadonly();
  }
}
