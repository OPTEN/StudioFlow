import type { MonitorSourceStatus } from './types';

/**
 * Remembers since when each source has its current monitor status (for the “Freeze frame 00:12” timer when the provider
 * has no lost time). Entries of sources that a full render pass did not look at are dropped, so the map only holds
 * what is on stage.
 */
export class StatusClock {
  private readonly entries = new Map<
    string,
    { readonly status: MonitorSourceStatus; readonly since: number }
  >();
  private readonly seen = new Set<string>();

  /** Returns since when `sourceId` has `status`; a different status than last time starts at `now`. */
  observe(sourceId: string, status: MonitorSourceStatus, now: number): number {
    this.seen.add(sourceId);
    const entry = this.entries.get(sourceId);
    if (entry && entry.status === status) {
      return entry.since;
    }
    this.entries.set(sourceId, { status, since: now });
    return now;
  }

  /** Starts a render pass. */
  beginPass(): void {
    this.seen.clear();
  }

  /** Ends a render pass: forgets sources that were not observed. */
  endPass(): void {
    for (const sourceId of this.entries.keys()) {
      if (!this.seen.has(sourceId)) {
        this.entries.delete(sourceId);
      }
    }
  }
}
