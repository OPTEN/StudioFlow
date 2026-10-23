import { DEFAULT_HOLD_MS, ITEM_BOUNDS } from '@studioflow/scene-model';

import type { ResolvedSource } from './source-resolver';
import type { SourceAvailability } from './types';

/**
 * What an item can show right now (pure). A lost device source keeps its last frame while `holding` and switches to
 * the darkened or fallback picture once `held` (plan: «Standbild 3 s, dann abgedunkelt»).
 */
export type SourceState =
  /** Malformed reference, unknown asset or a device source the production does not know. */
  | { readonly kind: 'missing' }
  /** Image or video asset: always available. */
  | { readonly kind: 'media' }
  /** Device source that never delivered a picture in this session. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'live' }
  /** Lost since `since`, last frame still shown sharp; `expiresAt` is null when the hold never ends. */
  | { readonly kind: 'holding'; readonly since: number; readonly expiresAt: number | null }
  /** Lost since `since`, for longer than the hold time. */
  | { readonly kind: 'held'; readonly since: number };

/** Hold time of an item: null keeps the frame forever, malformed values fall back to the default. */
export function normalizeHoldMs(holdMs: unknown): number | null {
  if (holdMs === null) {
    return null;
  }
  if (typeof holdMs !== 'number' || !Number.isFinite(holdMs)) {
    return DEFAULT_HOLD_MS;
  }
  return Math.min(ITEM_BOUNDS.maxHoldMs, Math.max(0, holdMs));
}

/**
 * State of a resolved source. `availability` is only read for device sources; `known` is false when the production
 * does not know the device source (Regie `statusOf` returned undefined).
 */
export function sourceState(
  source: ResolvedSource,
  availability: SourceAvailability,
  holdMs: number | null,
  known: boolean,
  now: number,
): SourceState {
  switch (source.kind) {
    case 'missing':
      return { kind: 'missing' };
    case 'image':
    case 'video':
      return { kind: 'media' };
    case 'device':
      break;
  }
  if (!known) {
    return { kind: 'missing' };
  }
  if (availability.state === 'live') {
    return { kind: 'live' };
  }
  if (availability.state !== 'lost') {
    // 'pending' and anything malformed: nothing to show yet.
    return { kind: 'pending' };
  }
  // A malformed timestamp counts as «lost just now» rather than producing NaN timers.
  const since = Number.isFinite(availability.since) ? availability.since : now;
  if (holdMs === null) {
    return { kind: 'holding', since, expiresAt: null };
  }
  const expiresAt = since + holdMs;
  return now >= expiresAt ? { kind: 'held', since } : { kind: 'holding', since, expiresAt };
}

/** Auto-Grid places media, live sources and lost sources that are still inside their hold time. */
export function isGridAvailable(state: SourceState): boolean {
  return state.kind === 'media' || state.kind === 'live' || state.kind === 'holding';
}

/** True while the item shows a picture of a lost source (hold frame, darkened or fallback). */
export function isLostState(
  state: SourceState,
): state is Extract<SourceState, { kind: 'holding' | 'held' }> {
  return state.kind === 'holding' || state.kind === 'held';
}
