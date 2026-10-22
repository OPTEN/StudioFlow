/**
 * Boot configuration of the output page: `/o/{slug}?k={key}[&bg=transparent][&debug=1][&latency=1]` (spec 4.8, 9.3)
 * and the measurement clock `/o/_uhr`.
 *
 * The output key is a secret. It is kept in memory, sent only as `X-Output-Key` / hub `access_token` / asset `?k=`,
 * and never logged. After boot it is removed from the visible address bar (screenshots, screen shares and «copy
 * link» on the proxy machine no longer reveal it) and stored in `sessionStorage` for this tab only, so a reload of
 * the same tab keeps working: sessionStorage is per tab and per origin, not shared with other tabs or windows, and is
 * gone when the tab closes. When the key cannot be stored (storage blocked, e.g. a partitioned third-party iframe with
 * storage disabled), the key stays in the URL, because removing it would make the next reload show «Kein Zugang».
 */

/** Path segment of the measurement clock; an underscore can never be part of a slug. */
export const CLOCK_SEGMENT = '_uhr';

/** Production slugs: lowercase `[a-z0-9-]{1,48}` (spec 4.2). */
export const SLUG_PATTERN = /^[a-z0-9-]{1,48}$/;

/**
 * Output keys are 32 random bytes in base64url without padding (43 characters, spec 4.1). The check is deliberately
 * looser than that, so a future key format keeps working; it only rejects values that cannot be a key at all.
 */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/** sessionStorage key prefix; the slug follows. */
export const KEY_STORAGE_PREFIX = 'flowstudio.output.key:';

/** Letterbox and stage background. */
export type OutputBackground = 'black' | 'transparent';

/** Display flags from the query string; valid for every route, also for a broken link. */
export interface OutputFlags {
  /** `bg=transparent` for OBS/vMix overlays; anything else is black. */
  readonly background: OutputBackground;
  /** `debug=1`: measuring overlay (scene, revision, connections, per-source stats, latency). */
  readonly debug: boolean;
  /** `latency=1`: test aid that decodes latency stamps from source videos (see latency-probe.ts). */
  readonly latency: boolean;
}

/** A usable output link. */
export interface OutputConfig {
  readonly kind: 'output';
  readonly slug: string;
  readonly key: string;
  readonly flags: OutputFlags;
  /** True when the key came from the URL (and should be moved to sessionStorage), false when from storage. */
  readonly keyFromUrl: boolean;
}

/** Why a link cannot work: no valid slug, or no (valid) key. */
export type InvalidReason = 'slug' | 'key';

/** Result of parsing the location. */
export type OutputRoute =
  | { readonly kind: 'clock' }
  | OutputConfig
  | { readonly kind: 'invalid'; readonly reason: InvalidReason; readonly flags: OutputFlags };

/** The parts of `Location` the parser reads. */
export interface LocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** The parts of `Storage` the key store uses. */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The parts of `Window` {@link resolveRoute} touches. */
export interface RouteWindow {
  readonly location: LocationLike;
  readonly history: Pick<History, 'replaceState' | 'state'>;
  readonly sessionStorage?: KeyStorage;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes']);

function flag(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value !== null && TRUE_VALUES.has(value.trim().toLowerCase());
}

/** Reads the display flags; unknown values fall back to the defaults (black, no debug, no latency). */
export function parseFlags(search: string): OutputFlags {
  const params = new URLSearchParams(search);
  return {
    background: params.get('bg')?.trim().toLowerCase() === 'transparent' ? 'transparent' : 'black',
    debug: flag(params, 'debug'),
    latency: flag(params, 'latency'),
  };
}

/**
 * The single path segment after the base (`/o/`), percent-decoded, with an optional trailing slash; null when the
 * path is outside the base, empty, nested or not decodable.
 */
export function pathSegment(pathname: string, base: string): string | null {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  if (!pathname.startsWith(normalizedBase)) {
    return null;
  }
  let rest = pathname.slice(normalizedBase.length);
  if (rest.endsWith('/')) {
    rest = rest.slice(0, -1);
  }
  if (rest === '' || rest.includes('/')) {
    return null;
  }
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/**
 * Parses the location into a route (pure). `storedKey` looks up the key a previous load of this tab stored for a slug.
 * A key in the URL always wins (a regenerated link replaces the stored key); a malformed key in the URL makes the link
 * invalid instead of silently falling back to an older stored key.
 */
export function parseRoute(
  location: LocationLike,
  base: string,
  storedKey: (slug: string) => string | null = () => null,
): OutputRoute {
  const flags = parseFlags(location.search);
  const segment = pathSegment(location.pathname, base);
  if (segment === CLOCK_SEGMENT) {
    return { kind: 'clock' };
  }
  if (segment === null || !SLUG_PATTERN.test(segment)) {
    return { kind: 'invalid', reason: 'slug', flags };
  }
  const urlKey = new URLSearchParams(location.search).get('k');
  if (urlKey !== null) {
    return KEY_PATTERN.test(urlKey)
      ? { kind: 'output', slug: segment, key: urlKey, flags, keyFromUrl: true }
      : { kind: 'invalid', reason: 'key', flags };
  }
  const stored = storedKey(segment);
  return stored !== null && KEY_PATTERN.test(stored)
    ? { kind: 'output', slug: segment, key: stored, flags, keyFromUrl: false }
    : { kind: 'invalid', reason: 'key', flags };
}

/** The current URL (path, query, hash) without the `k` parameter; other parameters keep their order. */
export function urlWithoutKey(location: LocationLike): string {
  const params = new URLSearchParams(location.search);
  params.delete('k');
  const query = params.toString();
  return `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`;
}

/** sessionStorage, or null when the browser refuses access (blocked storage throws on property access). */
function sessionStorageOf(win: RouteWindow): KeyStorage | null {
  try {
    return win.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readKey(storage: KeyStorage | null, slug: string): string | null {
  try {
    return storage?.getItem(KEY_STORAGE_PREFIX + slug) ?? null;
  } catch {
    return null;
  }
}

/** Stores the key and reads it back; false when storage is unavailable or full. */
function storeKey(storage: KeyStorage | null, slug: string, key: string): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(KEY_STORAGE_PREFIX + slug, key);
    return storage.getItem(KEY_STORAGE_PREFIX + slug) === key;
  } catch {
    return false;
  }
}

/**
 * Parses the current location and, for a key that came with the URL, moves it to sessionStorage and removes it from
 * the address bar with `history.replaceState` (no reload, no new history entry). See the module comment for why.
 */
export function resolveRoute(win: RouteWindow, base: string): OutputRoute {
  const storage = sessionStorageOf(win);
  const route = parseRoute(win.location, base, (slug) => readKey(storage, slug));
  if (route.kind === 'output' && route.keyFromUrl && storeKey(storage, route.slug, route.key)) {
    try {
      win.history.replaceState(win.history.state, '', urlWithoutKey(win.location));
    } catch {
      // A sandboxed frame may refuse history changes; the key then simply stays visible.
    }
  }
  return route;
}
