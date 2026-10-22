import { Injectable, signal } from '@angular/core';

/** One-time notices handed from one screen to the next. */
@Injectable({ providedIn: 'root' })
export class NoticeService {
  /** Shown above the pairing form (device removed, invite expired …). */
  readonly pairingNotice = signal<string | null>(null);
  /** Set right after pairing: the station greets with «Gekoppelt». */
  readonly justPaired = signal(false);

  /** Returns and clears the pairing notice. */
  takePairingNotice(): string | null {
    const notice = this.pairingNotice();
    this.pairingNotice.set(null);
    return notice;
  }

  /** Returns and clears the «just paired» flag. */
  takeJustPaired(): boolean {
    const paired = this.justPaired();
    this.justPaired.set(false);
    return paired;
  }
}
