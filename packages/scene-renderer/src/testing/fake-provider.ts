import type { DesiredSize, SourceAvailability, SourceMediaProvider } from '../types';

/** One recorded `setDesiredSize` call. */
export interface SizeCall {
  readonly sourceId: string;
  readonly consumerId: string;
  readonly size: DesiredSize | null;
}

/**
 * Test double of the media provider: records registrations and desired sizes, and lets a test drive availability
 * (which notifies listeners like the LiveKit provider does).
 */
export class FakeProvider implements SourceMediaProvider {
  readonly attachCalls: Array<{ readonly sourceId: string; readonly video: HTMLVideoElement }> = [];
  readonly detachCalls: Array<{ readonly sourceId: string; readonly video: HTMLVideoElement }> = [];
  readonly sizeCalls: SizeCall[] = [];
  readonly urls = new Map<string, string>();
  private readonly registrations = new Map<string, Set<HTMLVideoElement>>();
  private readonly states = new Map<string, SourceAvailability>();
  private readonly listeners = new Set<(sourceId: string) => void>();
  private readonly sizes = new Map<string, Map<string, DesiredSize>>();

  attach(sourceId: string, video: HTMLVideoElement): void {
    this.attachCalls.push({ sourceId, video });
    const set = this.registrations.get(sourceId) ?? new Set();
    set.add(video);
    this.registrations.set(sourceId, set);
  }

  detach(sourceId: string, video: HTMLVideoElement): void {
    this.detachCalls.push({ sourceId, video });
    this.registrations.get(sourceId)?.delete(video);
  }

  availability(sourceId: string): SourceAvailability {
    return this.states.get(sourceId) ?? { state: 'pending' };
  }

  onChange(listener: (sourceId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setDesiredSize(sourceId: string, consumerId: string, size: DesiredSize | null): void {
    this.sizeCalls.push({ sourceId, consumerId, size });
    const perConsumer = this.sizes.get(consumerId) ?? new Map<string, DesiredSize>();
    if (size) {
      perConsumer.set(sourceId, size);
    } else {
      perConsumer.delete(sourceId);
    }
    this.sizes.set(consumerId, perConsumer);
  }

  assetUrl(assetId: string): string | null {
    return this.urls.get(assetId) ?? null;
  }

  /** Changes the availability of a source and notifies listeners. */
  set(sourceId: string, availability: SourceAvailability): void {
    this.states.set(sourceId, availability);
    for (const listener of [...this.listeners]) {
      listener(sourceId);
    }
  }

  /** Marks a source live. */
  live(sourceId: string): void {
    this.set(sourceId, { state: 'live' });
  }

  /** Marks a source lost now (or at `since`). */
  lose(sourceId: string, since = performance.now()): void {
    this.set(sourceId, { state: 'lost', since });
  }

  /** Video elements currently registered for a source. */
  attached(sourceId: string): HTMLVideoElement[] {
    return [...(this.registrations.get(sourceId) ?? [])];
  }

  /** Number of registrations over all sources. */
  get registrationCount(): number {
    let count = 0;
    for (const set of this.registrations.values()) {
      count += set.size;
    }
    return count;
  }

  /** Current desired sizes per source for consumers whose id matches the filter. */
  desired(filter: (consumerId: string) => boolean = () => true): Map<string, DesiredSize> {
    const result = new Map<string, DesiredSize>();
    for (const [consumerId, perConsumer] of this.sizes) {
      if (filter(consumerId)) {
        for (const [sourceId, size] of perConsumer) {
          result.set(sourceId, size);
        }
      }
    }
    return result;
  }

  /** Number of desired-size entries left over all consumers. */
  get desiredCount(): number {
    let count = 0;
    for (const perConsumer of this.sizes.values()) {
      count += perConsumer.size;
    }
    return count;
  }

  /** Number of subscribed change listeners. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
