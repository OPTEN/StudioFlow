import { InjectionToken } from '@angular/core';

/**
 * Key/value storage that never throws. Browsers throw on `localStorage` access in some private modes, with blocked
 * cookies or when the quota is full; the sender then keeps working with values in memory for the current page.
 */
export interface SafeStorage {
  /** Parsed JSON value of a key, or null when missing, unreadable or not valid JSON. */
  readJson(key: string): unknown;
  /** Stores a value as JSON; returns false when the browser refused (the value is still kept in memory). */
  writeJson(key: string, value: unknown): boolean;
  /** Removes a key (memory and browser storage). */
  remove(key: string): void;
}

/**
 * {@link SafeStorage} on top of a Web Storage area. Values whose write was refused are kept in memory, so the current
 * page keeps working; everything else is read from the browser storage only.
 */
export class WebStorage implements SafeStorage {
  /** Values the browser refused to store (private mode, quota, blocked storage). */
  readonly #fallback = new Map<string, string>();

  constructor(private readonly area: () => Storage | null) {}

  readJson(key: string): unknown {
    const raw = this.#read(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  writeJson(key: string, value: unknown): boolean {
    const raw = JSON.stringify(value);
    try {
      const area = this.area();
      if (area === null) {
        this.#fallback.set(key, raw);
        return false;
      }
      area.setItem(key, raw);
      this.#fallback.delete(key);
      return true;
    } catch {
      this.#fallback.set(key, raw);
      return false;
    }
  }

  remove(key: string): void {
    this.#fallback.delete(key);
    try {
      this.area()?.removeItem(key);
    } catch {
      // Storage not accessible: the fallback copy is gone, nothing else to do.
    }
  }

  #read(key: string): string | null {
    const fallback = this.#fallback.get(key);
    if (fallback !== undefined) {
      return fallback;
    }
    try {
      return this.area()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

function storageArea(name: 'localStorage' | 'sessionStorage'): () => Storage | null {
  return () => (typeof window === 'undefined' ? null : window[name]);
}

/** Persistent storage (credentials, settings). Survives reloads and browser restarts. */
export const LOCAL_STORAGE = new InjectionToken<SafeStorage>('flowstudio.localStorage', {
  providedIn: 'root',
  factory: () => new WebStorage(storageArea('localStorage')),
});

/** Per-tab storage (a pending knock). Survives reloads of the same tab only. */
export const SESSION_STORAGE = new InjectionToken<SafeStorage>('flowstudio.sessionStorage', {
  providedIn: 'root',
  factory: () => new WebStorage(storageArea('sessionStorage')),
});

/** Storage keys of the sender. */
export const STORAGE_KEYS = {
  /** Device credentials and the redeem client id (localStorage). */
  credentials: 'flowstudio.sender.v1',
  /** Camera facing, resolution, dark mode (localStorage). */
  settings: 'flowstudio.sender.settings',
  /** Pending knock of this tab (sessionStorage). */
  pairing: 'flowstudio.pairing',
} as const;
