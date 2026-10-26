/**
 * Reload after an update – once, and never on air.
 *
 * Decision: the page never reloads by itself, with one exception. A proxy may keep the page open for weeks; after an
 * update of the stack (docker compose pull && up -d; the operator picks the time) the old code would keep running against a
 * newer API. So after every hub *re*connect (an update restarts the API) the page fetches its own `index.html`
 * (no-cache, about 1 KB) and compares the hashed entry script with the one it runs. When they differ it reloads –
 * but only while the broadcast is not live (standby, ended, or no state); if it is live, the reload waits until the
 * broadcast has ended. A marker in sessionStorage limits this to one reload per new version, so a cache that keeps
 * serving an old index can never cause a reload loop; without sessionStorage the page never reloads itself.
 * In the Vite dev server the entry is `/src/main.ts` on both sides, so nothing happens.
 */

/** sessionStorage key: the entry script a reload was already done for. */
export const RELOAD_MARKER_KEY = 'studioflow.output.reloadedFor';
/** At most one index check per this interval (reconnect storms during a restart). */
export const VERSION_CHECK_MIN_INTERVAL_MS = 60_000;

/** The `src` of the module entry script in an HTML document, or null. */
export function entryScriptOf(html: string): string | null {
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype\s*=\s*["']?module["']?/i.test(tag)) {
      continue;
    }
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (src) {
      return src[1];
    }
  }
  return null;
}

/** The parts of `Storage` the watch uses. */
export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Options of {@link VersionWatch}. */
export interface VersionWatchOptions {
  /** Entry script of the running page (`script[type=module][src]`), null disables the watch. */
  readonly currentEntry: string | null;
  /** Fetches the current index.html. */
  readonly fetchIndex: () => Promise<string>;
  /** sessionStorage, or null when unavailable (disables the watch). */
  readonly storage: MarkerStorage | null;
  /** True while a reload is acceptable (the broadcast is not live). */
  readonly canReload: () => boolean;
  readonly reload: () => void;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
}

/** See the module comment. */
export class VersionWatch {
  #pending: string | null = null;
  #lastCheckAt = Number.NEGATIVE_INFINITY;
  #reloading = false;

  constructor(private readonly options: VersionWatchOptions) {}

  /** A newer build was found and waits for the broadcast to leave “live”. */
  get pending(): string | null {
    return this.#pending;
  }

  /** Checks the published index (call after a hub reconnect). Never rejects. */
  async check(): Promise<void> {
    const { currentEntry, storage } = this.options;
    const now = (this.options.now ?? Date.now)();
    if (!currentEntry || !storage || this.#reloading) {
      return;
    }
    if (now - this.#lastCheckAt < (this.options.minIntervalMs ?? VERSION_CHECK_MIN_INTERVAL_MS)) {
      return;
    }
    this.#lastCheckAt = now;
    let published: string | null;
    try {
      published = entryScriptOf(await this.options.fetchIndex());
    } catch {
      return;
    }
    if (!published || published === currentEntry || this.#readMarker() === published) {
      this.#pending = null;
      return;
    }
    this.#pending = published;
    this.maybeReload();
  }

  /** Reloads if a newer build is pending and the broadcast allows it (call on every state change). */
  maybeReload(): void {
    const target = this.#pending;
    if (!target || this.#reloading || !this.options.canReload()) {
      return;
    }
    try {
      this.options.storage?.setItem(RELOAD_MARKER_KEY, target);
    } catch {
      this.#pending = null;
      return;
    }
    if (this.#readMarker() !== target) {
      this.#pending = null;
      return;
    }
    this.#reloading = true;
    this.options.reload();
  }

  #readMarker(): string | null {
    try {
      return this.options.storage?.getItem(RELOAD_MARKER_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
