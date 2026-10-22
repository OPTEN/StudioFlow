import { InjectionToken } from '@angular/core';

/** Schedules a callback for the next animation frame; returns a function that cancels it. */
export type FrameScheduler = (callback: () => void) => () => void;

/**
 * Animation-frame scheduling of the stage (pointer batching in the edit overlay, rectangle refreshes of scene views).
 * Replaced by a synchronous or manual scheduler in unit tests. Falls back to a 16 ms timeout without
 * `requestAnimationFrame`.
 */
export const FRAME_SCHEDULER = new InjectionToken<FrameScheduler>('FRAME_SCHEDULER', {
  providedIn: 'root',
  factory: () => (callback) => {
    if (typeof requestAnimationFrame === 'function') {
      const handle = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(handle);
    }
    const timer = setTimeout(callback, 16);
    return () => clearTimeout(timer);
  },
});
