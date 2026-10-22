/** Current time in the provider's time base (`SourceAvailability.since`). */
export function now(): number {
  return performance.now();
}

/**
 * One timer for the earliest of many deadlines (hold expiries): setting a new deadline replaces the old one, so there
 * is never more than one pending timeout.
 */
export class DeadlineTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(private readonly onFire: () => void) {}

  /** Fires at `deadline` (performance.now() base); null cancels. The same deadline keeps the running timeout. */
  set(deadline: number | null): void {
    if (deadline === this.deadline && (deadline === null || this.handle !== null)) {
      return;
    }
    this.clear();
    if (deadline === null || !Number.isFinite(deadline)) {
      return;
    }
    this.deadline = deadline;
    this.handle = setTimeout(
      () => {
        this.handle = null;
        this.deadline = null;
        this.onFire();
      },
      Math.max(0, Math.ceil(deadline - now())),
    );
  }

  /** Cancels the pending timeout. */
  clear(): void {
    if (this.handle !== null) {
      clearTimeout(this.handle);
    }
    this.handle = null;
    this.deadline = null;
  }
}

/** A fixed-rate tick that only runs while something needs it (running alert timers). */
export class Ticker {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => void,
  ) {}

  /** Starts or stops the tick. */
  setActive(active: boolean): void {
    if (active && this.handle === null) {
      this.handle = setInterval(this.onTick, this.intervalMs);
    } else if (!active && this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
