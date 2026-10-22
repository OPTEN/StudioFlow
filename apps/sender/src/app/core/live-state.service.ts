import { Injectable, computed, signal } from '@angular/core';

/**
 * What the station currently does, for decisions outside the station (service worker updates). Written by the
 * station, read anywhere; lives in the root injector so the update logic does not load the media code.
 */
@Injectable({ providedIn: 'root' })
export class LiveStateService {
  /** The device is in the program or the preview (tally not `off`). */
  readonly onAir = signal(false);
  /** A screen share is running; a reload would end it and need a new click. */
  readonly sharingScreen = signal(false);

  /** A reload now would be noticed by the audience or need a user action. */
  readonly busy = computed(() => this.onAir() || this.sharingScreen());

  /** Resets everything (the station was left). */
  reset(): void {
    this.onAir.set(false);
    this.sharingScreen.set(false);
  }
}
