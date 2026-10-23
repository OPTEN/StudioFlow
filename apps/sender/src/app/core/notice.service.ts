import { Injectable, signal } from '@angular/core';
import type { PlainMessageKey } from '@studioflow/i18n';

/** One-time notices handed from one screen to the next. */
@Injectable({ providedIn: 'root' })
export class NoticeService {
  /**
   * Shown above the pairing form (device removed, invite expired …). It holds the key of the message, so the notice
   * follows a language switch.
   */
  readonly pairingNotice = signal<PlainMessageKey | null>(null);
  /** Set right after pairing: the station greets with “Paired”. */
  readonly justPaired = signal(false);

  /** Returns and clears the pairing notice. */
  takePairingNotice(): PlainMessageKey | null {
    const notice = this.pairingNotice();
    this.pairingNotice.set(null);
    return notice;
  }

  /** Returns and clears the “just paired” flag. */
  takeJustPaired(): boolean {
    const paired = this.justPaired();
    this.justPaired.set(false);
    return paired;
  }
}
