import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SessionDto } from '@flowstudio/scene-model';
import { ApiError } from '../api/api-error';
import { StudioApiService } from '../api/studio-api.service';

/** What the client knows about the admin session. `unknown`: not checked yet or the server was unreachable. */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Path of the login page. */
export const LOGIN_PATH = '/login';

/** Returns `next` when it is a safe in-app path (no scheme, no protocol-relative URL, not the login page). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith(LOGIN_PATH)) {
    return '/';
  }
  return next;
}

/**
 * Admin session of the Regie (spec 5: cookie `fs_session`, sliding 12 h). Holds the session in signals, signs in and
 * out, and sends the operator to the login page whenever the API or a hub answers 401/403
 * ({@link handleUnauthorized}). Services that hold server connections register {@link onSignedOut} to stop them.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(StudioApiService);
  private readonly router = inject(Router);
  private readonly signedOutHandlers = new Set<() => void>();
  private pendingCheck: Promise<AuthStatus> | null = null;

  /** The signed-in admin, or null. */
  readonly session = signal<SessionDto | null>(null);
  /** Session state; see {@link AuthStatus}. */
  readonly status = signal<AuthStatus>('unknown');
  /** True while signed in. */
  readonly isAuthenticated = computed(() => this.status() === 'authenticated');

  /**
   * Checks the session once (`GET /api/auth/me`) and caches the result. Resolves `unknown` when the server cannot be
   * reached, so a reload during a server restart does not throw the operator out of a running production.
   */
  ensureSession(): Promise<AuthStatus> {
    const current = this.status();
    if (current !== 'unknown') {
      return Promise.resolve(current);
    }
    this.pendingCheck ??= this.api
      .getSession()
      .then((session) => {
        this.session.set(session);
        this.status.set('authenticated');
        return 'authenticated' as const;
      })
      .catch((error: unknown) => {
        const apiError = ApiError.from(error);
        if (apiError.status === 401 || apiError.status === 403) {
          this.session.set(null);
          this.status.set('anonymous');
          return 'anonymous' as const;
        }
        return 'unknown' as const;
      })
      .finally(() => {
        this.pendingCheck = null;
      });
    return this.pendingCheck;
  }

  /** Signs in. Rejects with an {@link ApiError} (401 wrong credentials, 429 lockout with `retryAfterSeconds`). */
  async login(username: string, password: string): Promise<SessionDto> {
    const session = await this.api.login({ username, password });
    this.session.set(session);
    this.status.set('authenticated');
    return session;
  }

  /** Signs out (best effort on the server), stops all connections and shows the login page. */
  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The cookie may already be gone; signing out locally is what matters.
    }
    this.signOutLocally();
    await this.router.navigateByUrl(LOGIN_PATH);
  }

  /**
   * The server refused the session (401 from REST, 401/403 from a hub): forget it, stop connections and navigate to
   * the login page, remembering the current page as `next`. Idempotent while already signed out.
   */
  handleUnauthorized(): void {
    this.signOutLocally();
    const url = this.router.url;
    if (url.startsWith(LOGIN_PATH)) {
      return;
    }
    void this.router.navigate([LOGIN_PATH], {
      queryParams: url && url !== '/' ? { next: url } : {},
    });
  }

  /** Registers a callback that runs whenever the session ends (logout or expiry); returns the unregister function. */
  onSignedOut(handler: () => void): () => void {
    this.signedOutHandlers.add(handler);
    return () => this.signedOutHandlers.delete(handler);
  }

  private signOutLocally(): void {
    this.session.set(null);
    this.status.set('anonymous');
    for (const handler of [...this.signedOutHandlers]) {
      try {
        handler();
      } catch (error) {
        console.warn('[FlowStudio] sign-out handler failed', error);
      }
    }
  }
}
