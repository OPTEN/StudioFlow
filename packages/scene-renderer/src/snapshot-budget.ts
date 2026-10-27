import { now } from './timers';

/**
 * A time budget for the pictures copied out of videos (issue #12): the rolling hold frames of live items and the stills of
 * the thumbnails. Copying a frame is the most expensive thing a renderer does on the main thread when the computer decodes
 * in software: the frame is converted to RGB at its full size first, and a 2560 × 1440 screen costs 50 to 100 ms per copy.
 * The measurement of the reference scenario showed 30 % of the Regie's time in these copies and animation frames dropping
 * to a handful per second. Where copies are cheap (a graphics card converts the frame) the budget never limits anything;
 * where they are not, the copies come less often instead of blocking the page.
 */

/** The share of the time the copies may take up on the main thread. */
export const SNAPSHOT_TIME_SHARE = 0.04;
/** The most a single copy can weigh on the budget: one outlier (the page was suspended) must not stop the copies for long. */
const MAX_DEBT_MS = 150;

export class SnapshotBudget {
  private debtMs = 0;
  private settledAt: number;

  constructor(
    private readonly share: number = SNAPSHOT_TIME_SHARE,
    private readonly clock: () => number = now,
  ) {
    this.settledAt = clock();
  }

  /** True when the previous copies are paid off: another may be taken now. */
  allows(): boolean {
    this.settle();
    return this.debtMs <= 0;
  }

  /** Runs a copy and charges its duration. */
  measure<T>(copy: () => T): T {
    const start = this.clock();
    try {
      return copy();
    } finally {
      this.charge(this.clock() - start);
    }
  }

  /** Charges `ms` of copying time (it is paid off at {@link SNAPSHOT_TIME_SHARE} of the passing time). */
  charge(ms: number): void {
    this.settle();
    if (Number.isFinite(ms) && ms > 0) {
      this.debtMs = Math.min(MAX_DEBT_MS, this.debtMs + ms);
    }
  }

  /** Forgets the debt (tests). */
  reset(): void {
    this.debtMs = 0;
    this.settledAt = this.clock();
  }

  private settle(): void {
    const time = this.clock();
    const elapsed = Math.max(0, time - this.settledAt);
    this.settledAt = time;
    this.debtMs = Math.max(0, this.debtMs - elapsed * this.share);
  }
}

/** The budget of this page: one main thread, one budget, whichever renderers copy frames. */
export const snapshotBudget = new SnapshotBudget();
