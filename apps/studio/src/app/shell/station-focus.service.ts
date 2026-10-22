import { Injectable, inject, signal } from '@angular/core';
import { ProductionStoreService } from '../core/state/production-store.service';
import { DockLayoutService } from './workspace/dock-layout.service';

/** A request to show one station (prototype `showStation`): open its details, scroll it into view, flash it. */
export interface StationFocusRequest {
  /** Increments with every request, so the same station can be requested twice. */
  readonly seq: number;
  readonly deviceId: string;
  /** The source that caused the request (incident), if any. */
  readonly sourceId: string | null;
}

/**
 * Bridge between the places that point at a station (health chip in the header, incident in the message strip) and
 * the Stationen dock, which listens to {@link request} and opens, scrolls and flashes the row. Makes the Stationen
 * dock visible first if it was hidden.
 */
@Injectable({ providedIn: 'root' })
export class StationFocusService {
  private readonly store = inject(ProductionStoreService);
  private readonly layout = inject(DockLayoutService);
  private seq = 0;
  private readonly requestSignal = signal<StationFocusRequest | null>(null);

  /** The latest request, or null. */
  readonly request = this.requestSignal.asReadonly();

  /** Shows the station of a source. Returns false when the source belongs to no device (media, deleted). */
  showSource(sourceId: string): boolean {
    const deviceId = this.store.sourceById(sourceId)?.deviceId;
    if (!deviceId) {
      return false;
    }
    this.emit(deviceId, sourceId);
    return true;
  }

  /** Shows a station by device id. */
  showDevice(deviceId: string): void {
    this.emit(deviceId, null);
  }

  private emit(deviceId: string, sourceId: string | null): void {
    if (!this.layout.isShown('st')) {
      this.layout.setShown('st', true);
    }
    this.seq += 1;
    this.requestSignal.set({ seq: this.seq, deviceId, sourceId });
  }
}
