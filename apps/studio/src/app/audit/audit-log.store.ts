import { Injectable, computed, inject, signal } from '@angular/core';
import type { AuditEntryDto } from '@studioflow/scene-model';
import { ApiError } from '../core/api/api-error';
import { StudioApiService, type AuditQuery } from '../core/api/studio-api.service';

/** Entries per request. */
export const AUDIT_PAGE_SIZE = 50;

/** State of the first page: `loading` until it arrived, `error` when it could not be loaded. */
export type AuditLoadStatus = 'loading' | 'ready' | 'error';

/** Whether the older entries below the loaded ones are being loaded or failed to load. */
export type AuditMoreStatus = 'idle' | 'loading' | 'error';

/** True when `a` comes before `b` in the log (newer, or as new with a higher id). */
function isNewer(a: AuditEntryDto, b: AuditEntryDto): boolean {
  const difference = new Date(a.at).getTime() - new Date(b.at).getTime();
  return difference > 0 || (difference === 0 && a.id > b.id);
}

/**
 * The loaded part of the audit log for one filter: the first page, the pages that were loaded after it with the
 * cursor of the server, and the newest entries that arrived since. Provided by the audit page, so every visit starts
 * empty. A response that arrives after a newer request for another filter is dropped.
 */
@Injectable()
export class AuditLogStore {
  private readonly api = inject(StudioApiService);
  private query: AuditQuery | null = null;
  private generation = 0;
  private readonly cursor = signal<string | null>(null);
  private readonly loaded = signal<readonly AuditEntryDto[]>([]);
  private readonly freshIds = signal<ReadonlySet<number>>(new Set());

  /** The entries loaded so far, newest first. */
  readonly entries = this.loaded.asReadonly();
  readonly status = signal<AuditLoadStatus>('loading');
  readonly moreStatus = signal<AuditMoreStatus>('idle');
  /** The error of the first page, for its message. */
  readonly error = signal<ApiError | null>(null);
  /** True when the server has older entries than the loaded ones. */
  readonly hasMore = computed(() => this.cursor() !== null);

  /** True for an entry that arrived while the page was open (it is highlighted until the next one arrives). */
  isFresh(entry: AuditEntryDto): boolean {
    return this.freshIds().has(entry.id);
  }

  /** Starts over with a filter: shows the loading state and loads the first page. */
  async load(query: AuditQuery): Promise<void> {
    const generation = ++this.generation;
    this.query = query;
    this.status.set('loading');
    this.moreStatus.set('idle');
    this.error.set(null);
    this.loaded.set([]);
    this.cursor.set(null);
    this.freshIds.set(new Set());
    try {
      const page = await this.api.listAuditLog({ ...query, limit: AUDIT_PAGE_SIZE });
      if (generation === this.generation) {
        this.loaded.set(page.entries);
        this.cursor.set(page.nextCursor);
        this.status.set('ready');
      }
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(ApiError.from(error));
        this.status.set('error');
      }
    }
  }

  /** Shows an empty list, for a filter that cannot match anything. */
  clear(): void {
    this.generation++;
    this.query = null;
    this.loaded.set([]);
    this.cursor.set(null);
    this.error.set(null);
    this.moreStatus.set('idle');
    this.status.set('ready');
  }

  /** Loads the page after the loaded entries. A page already on its way, or the end of the log, does nothing. */
  async loadMore(): Promise<void> {
    const cursor = this.cursor();
    if (cursor === null || this.status() !== 'ready' || this.moreStatus() === 'loading') {
      return;
    }
    const generation = this.generation;
    this.moreStatus.set('loading');
    try {
      const page = await this.api.listAuditLog({ ...this.query, limit: AUDIT_PAGE_SIZE, cursor });
      if (generation === this.generation) {
        this.loaded.update((entries) => [...entries, ...page.entries]);
        this.cursor.set(page.nextCursor);
        this.moreStatus.set('idle');
      }
    } catch {
      if (generation === this.generation) {
        this.moreStatus.set('error');
      }
    }
  }

  /**
   * Adds the entries that were written since the newest loaded one to the top. A failure is ignored, the next try
   * is soon. When more than a page arrived, the gap cannot be closed and the list starts over with the newest page.
   */
  async refreshHead(): Promise<void> {
    if (this.query === null || this.status() !== 'ready' || this.moreStatus() === 'loading') {
      return;
    }
    const generation = this.generation;
    try {
      const page = await this.api.listAuditLog({ ...this.query, limit: AUDIT_PAGE_SIZE });
      if (generation !== this.generation || this.moreStatus() === 'loading') {
        return;
      }
      this.merge(page.entries, page.nextCursor);
    } catch {
      // The list stays as it is.
    }
  }

  private merge(newest: readonly AuditEntryDto[], nextCursor: string | null): void {
    const known = this.loaded();
    const top = known[0];
    const added = top === undefined ? newest : newest.filter((entry) => isNewer(entry, top));
    if (added.length === 0) {
      return;
    }
    const closesTheGap = top !== undefined && added.length < newest.length;
    this.freshIds.set(new Set(added.map((entry) => entry.id)));
    if (closesTheGap) {
      this.loaded.set([...added, ...known]);
    } else {
      this.loaded.set(newest);
      this.cursor.set(nextCursor);
    }
  }
}
