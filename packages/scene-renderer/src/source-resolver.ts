import { parseSourceRef } from '@studioflow/scene-model';

import type { AssetMediaKind } from './types';

/**
 * The one place that decides how a source reference is rendered: a device slot (`<video>` fed by the provider), an
 * image or video asset (URL from the provider), or missing (malformed reference or unknown asset).
 */
export type ResolvedSource =
  | { readonly kind: 'device'; readonly sourceId: string }
  | { readonly kind: AssetMediaKind; readonly sourceId: string; readonly url: string }
  | { readonly kind: 'missing'; readonly sourceId: string };

/** Lookups the resolution needs; both may be backed by foreign code and are expected to be guarded by the caller. */
export interface SourceLookup {
  assetUrl(assetId: string): string | null;
  assetKind(assetId: string): AssetMediaKind | undefined;
}

/** Resolves a source reference of a scene item or fallback. */
export function resolveSource(ref: string, lookup: SourceLookup): ResolvedSource {
  const parsed = typeof ref === 'string' ? parseSourceRef(ref) : null;
  if (!parsed) {
    return { kind: 'missing', sourceId: String(ref) };
  }
  if (parsed.kind === 'device') {
    return { kind: 'device', sourceId: ref };
  }
  const url = lookup.assetUrl(parsed.assetId);
  if (!url) {
    return { kind: 'missing', sourceId: ref };
  }
  return { kind: lookup.assetKind(parsed.assetId) ?? 'image', sourceId: ref, url };
}

/** True when both resolutions need the same media element (same kind, source and URL). */
export function isSameSource(a: ResolvedSource, b: ResolvedSource): boolean {
  if (a.kind !== b.kind || a.sourceId !== b.sourceId) {
    return false;
  }
  return !('url' in a) || !('url' in b) || a.url === b.url;
}
