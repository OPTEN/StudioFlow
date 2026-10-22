/**
 * Keeps a phone's screen on while it is a camera station (best effort). The browser releases the lock whenever the
 * page is hidden; it is re-requested when the page becomes visible again. Concurrent requests are coalesced, and a
 * request that resolves after {@link ScreenWakeLock.disable} is released at once.
 */

/** Environment of the wake lock (injectable for tests). */
export interface WakeLockEnvironment {
  readonly wakeLock: WakeLock | undefined;
  readonly document:
    (EventTarget & { readonly visibilityState: DocumentVisibilityState }) | undefined;
}

function browserEnvironment(): WakeLockEnvironment {
  return {
    wakeLock:
      typeof navigator !== 'undefined' && 'wakeLock' in navigator ? navigator.wakeLock : undefined,
    document: typeof document === 'undefined' ? undefined : document,
  };
}

/** Screen wake lock with re-acquire on visibility; never throws. */
export class ScreenWakeLock {
  readonly #wakeLock: WakeLock | undefined;
  readonly #document: WakeLockEnvironment['document'];
  #sentinel: WakeLockSentinel | null = null;
  #wanted = false;
  #disposed = false;
  #inFlight: Promise<void> | null = null;

  constructor(environment: Partial<WakeLockEnvironment> = {}) {
    const defaults = browserEnvironment();
    this.#wakeLock = 'wakeLock' in environment ? environment.wakeLock : defaults.wakeLock;
    this.#document = 'document' in environment ? environment.document : defaults.document;
    this.#document?.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  /** True when the browser offers the Screen Wake Lock API (secure context required). */
  get supported(): boolean {
    return this.#wakeLock !== undefined;
  }

  /** True while a lock is held. */
  get active(): boolean {
    return this.#sentinel !== null && !this.#sentinel.released;
  }

  /** Requests the lock (now if visible, else on the next visibility); resolves with {@link active}. */
  async enable(): Promise<boolean> {
    if (this.#disposed) {
      return false;
    }
    this.#wanted = true;
    await this.#acquire();
    return this.active;
  }

  /** Releases the lock and stops re-acquiring it. */
  async disable(): Promise<void> {
    this.#wanted = false;
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    await sentinel?.release().catch(() => undefined);
  }

  /** Releases the lock and removes the visibility listener. */
  dispose(): void {
    this.#disposed = true;
    this.#document?.removeEventListener('visibilitychange', this.#onVisibilityChange);
    void this.disable();
  }

  readonly #onVisibilityChange = (): void => {
    if (this.#document?.visibilityState === 'visible') {
      void this.#acquire();
    }
  };

  #acquire(): Promise<void> {
    if (
      this.#wakeLock === undefined ||
      !this.#wanted ||
      this.#disposed ||
      this.#document?.visibilityState === 'hidden' ||
      this.active
    ) {
      return Promise.resolve();
    }
    this.#inFlight ??= this.#request(this.#wakeLock).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #request(wakeLock: WakeLock): Promise<void> {
    let sentinel: WakeLockSentinel;
    try {
      sentinel = await wakeLock.request('screen');
    } catch {
      // Power saver, missing permission policy or a hidden page: retried on the next visibility change.
      return;
    }
    if (!this.#wanted || this.#disposed) {
      await sentinel.release().catch(() => undefined);
      return;
    }
    sentinel.addEventListener(
      'release',
      () => {
        if (this.#sentinel === sentinel) {
          this.#sentinel = null;
        }
      },
      { once: true },
    );
    this.#sentinel = sentinel;
  }
}
