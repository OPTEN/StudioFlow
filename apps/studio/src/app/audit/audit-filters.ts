import type { AuditCategory, AuditEntryDto } from '@studioflow/scene-model';
import type { AuditQuery } from '../core/api/studio-api.service';

/** The time ranges of the filter bar. */
export type AuditRange = 'any' | 'today' | 'lastBroadcast' | 'custom';

/** Value of the production filter for entries without a production (sign-ins and account changes). */
export const NO_PRODUCTION = 'none';

/** The categories in the order of the filter bar. */
export const AUDIT_CATEGORIES = [
  'production',
  'devices',
  'security',
  'media',
  'output',
  'system',
] as const satisfies readonly AuditCategory[];

/** What the operator chose in the filter bar. */
export interface AuditFilters {
  readonly range: AuditRange;
  /** Start of a custom range as the value of a `datetime-local` input (local time), or empty. */
  readonly from: string;
  /** End of a custom range as the value of a `datetime-local` input (local time), or empty. */
  readonly to: string;
  /** A production id, {@link NO_PRODUCTION}, or empty for every production. */
  readonly production: string;
  /** Only these categories; empty means all. */
  readonly categories: readonly AuditCategory[];
  readonly text: string;
}

/** No restriction. */
export const NO_FILTERS: AuditFilters = {
  range: 'any',
  from: '',
  to: '',
  production: '',
  categories: [],
  text: '',
};

/** A range found in the log: the start of a broadcast and the moment after its end (null while it is live). */
export interface BroadcastRange {
  readonly from: string;
  readonly to: string | null;
}

const BROADCAST_ACTIONS = ['broadcast.started', 'broadcast.ended'];

/** The actions that mark the start and the end of a broadcast (for the "Last broadcast" lookup). */
export const BROADCAST_QUERY: AuditQuery = { action: BROADCAST_ACTIONS, limit: 200 };

/** True when `from` and `to` of a custom range are both set and the end is not after the start. */
export function isCustomRangeInvalid(filters: AuditFilters): boolean {
  if (filters.range !== 'custom' || filters.from === '' || filters.to === '') {
    return false;
  }
  return new Date(filters.to).getTime() <= new Date(filters.from).getTime();
}

/** True when any filter narrows the log. */
export function hasFilters(filters: AuditFilters): boolean {
  return (
    filters.range !== 'any' ||
    filters.production !== '' ||
    filters.categories.length > 0 ||
    filters.text.trim() !== ''
  );
}

/**
 * The query of the filter bar. "Today" starts at the local midnight of `now`, a custom range reads the local times of
 * the inputs, and "Last broadcast" uses the range found with {@link lastBroadcastRange} (none yet: no time limit).
 */
export function auditQuery(
  filters: AuditFilters,
  now: Date,
  broadcast: BroadcastRange | null,
): AuditQuery {
  const { from, to } = timeRange(filters, now, broadcast);
  return {
    from,
    to,
    production: filters.production || undefined,
    category: filters.categories.length > 0 ? [...filters.categories] : undefined,
    q: filters.text.trim() || undefined,
  };
}

function timeRange(
  filters: AuditFilters,
  now: Date,
  broadcast: BroadcastRange | null,
): { from?: string; to?: string } {
  switch (filters.range) {
    case 'today':
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() };
    case 'lastBroadcast':
      return broadcast ? { from: broadcast.from, to: broadcast.to ?? undefined } : {};
    case 'custom':
      return {
        from: filters.from === '' ? undefined : new Date(filters.from).toISOString(),
        to: filters.to === '' ? undefined : new Date(filters.to).toISOString(),
      };
    default:
      return {};
  }
}

/**
 * The range of the latest broadcast from the entries `broadcast.started` and `broadcast.ended` of a production, newest
 * first: from its start to just after its end, or open-ended while it is still live. Null when there was none.
 */
export function lastBroadcastRange(entries: readonly AuditEntryDto[]): BroadcastRange | null {
  const started = entries.findIndex((entry) => entry.action === 'broadcast.started');
  if (started < 0) {
    return null;
  }
  const ended = entries
    .slice(0, started)
    .reverse()
    .find((entry) => entry.action === 'broadcast.ended');

  // The end is exclusive on the server, so the range reaches one millisecond past the ending entry.
  return {
    from: entries[started].at,
    to: ended ? new Date(new Date(ended.at).getTime() + 1).toISOString() : null,
  };
}
