import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  DEFAULT_FADE_MS,
  FADE_DURATIONS_MS,
  type FadeDurationMs,
  type TransitionKind,
} from '@studioflow/scene-model';

/** Storage keys of the Regie (spec 9.1). */
export const PREFERENCE_KEYS = {
  studioMode: 'studioflow.studio',
  transition: 'studioflow.transition',
  layout: 'studioflow.layout',
} as const;

/**
 * Resolves the browser storage. A function, because merely reading `window.localStorage` throws in some privacy
 * modes; every access goes through try/catch.
 */
export const BROWSER_STORAGE = new InjectionToken<() => Storage | null>('BROWSER_STORAGE', {
  providedIn: 'root',
  factory: () => () => (typeof localStorage === 'undefined' ? null : localStorage),
});

/** Remembered transition of the control column: the kind and the fade duration (kept while Cut is chosen). */
export interface TransitionPreference {
  readonly kind: TransitionKind;
  readonly durationMs: FadeDurationMs;
}

const DEFAULT_TRANSITION: TransitionPreference = { kind: 'fade', durationMs: DEFAULT_FADE_MS };

function isFadeDuration(value: unknown): value is FadeDurationMs {
  return typeof value === 'number' && (FADE_DURATIONS_MS as readonly number[]).includes(value);
}

/**
 * Per-browser preferences in `localStorage` (Studio Mode, transition, dock layout v1). Never throws: unavailable or
 * full storage, private mode and corrupt values fall back to the defaults, and the Regie keeps working without
 * persistence.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly storage = inject(BROWSER_STORAGE);

  /** Studio Mode on/off (`studioflow.studio` = '1' | '0'); default off. */
  readStudioMode(): boolean {
    return this.read(PREFERENCE_KEYS.studioMode) === '1';
  }

  /** Persists the Studio Mode. */
  writeStudioMode(on: boolean): void {
    this.write(PREFERENCE_KEYS.studioMode, on ? '1' : '0');
  }

  /** Transition kind and fade duration (`studioflow.transition`); default Fade 0.3 s. */
  readTransition(): TransitionPreference {
    const parsed = this.readJson(PREFERENCE_KEYS.transition);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_TRANSITION;
    }
    const { kind, durationMs } = parsed as Record<string, unknown>;
    return {
      kind: kind === 'cut' || kind === 'fade' ? kind : DEFAULT_TRANSITION.kind,
      durationMs: isFadeDuration(durationMs) ? durationMs : DEFAULT_TRANSITION.durationMs,
    };
  }

  /** Persists the transition. */
  writeTransition(transition: TransitionPreference): void {
    this.write(PREFERENCE_KEYS.transition, JSON.stringify(transition));
  }

  /** The stored dock layout as parsed JSON (unvalidated; `DockLayoutService` validates it), or null. */
  readLayout(): unknown {
    return this.readJson(PREFERENCE_KEYS.layout);
  }

  /** Persists the dock layout. */
  writeLayout(layout: unknown): void {
    this.write(PREFERENCE_KEYS.layout, JSON.stringify(layout));
  }

  /** Removes the stored dock layout. */
  clearLayout(): void {
    try {
      this.storage()?.removeItem(PREFERENCE_KEYS.layout);
    } catch {
      // Without storage the default layout is used anyway.
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private readJson(key: string): unknown {
    const raw = this.read(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage()?.setItem(key, value);
    } catch {
      // Quota exceeded or storage blocked: keep working without persistence.
    }
  }
}
