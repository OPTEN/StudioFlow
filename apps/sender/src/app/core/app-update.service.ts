import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, InjectionToken, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { LiveStateService } from './live-state.service';

/** How often a long-running station asks the server for a new version. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** The station must be off air this long before an automatic reload. */
const QUIET_PERIOD_MS = 5_000;

/** Reloads the page (a token so tests can observe it). */
export const PAGE_RELOAD = new InjectionToken<() => void>('flowstudio.pageReload', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return () => document.location.reload();
  },
});

/**
 * Service worker updates (PWA app shell). A ready version is activated and the page reloaded as soon as nothing is
 * live: not in program or preview and no screen share that a reload would end. While live, the banner «Neue Version
 * bereit – nach der Sendung neu laden» is shown instead and the reload follows once the station is quiet again.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly liveState = inject(LiveStateService);
  private readonly reloadPage = inject(PAGE_RELOAD);

  /** A new version is downloaded and waits for a quiet moment. */
  readonly updateReady = signal(false);
  /** The running version is broken (unrecoverable state); a reload is required. */
  readonly broken = signal(false);

  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private reloading = false;

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }
    this.swUpdate.versionUpdates
      .pipe(
        filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.updateReady.set(true));
    this.swUpdate.unrecoverable.pipe(takeUntilDestroyed()).subscribe(() => this.broken.set(true));

    const interval = setInterval(() => {
      this.swUpdate.checkForUpdate().catch(() => undefined);
    }, CHECK_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(interval);
      this.clearQuietTimer();
    });

    effect(() => {
      const pending = this.updateReady() || this.broken();
      const busy = this.liveState.busy();
      this.clearQuietTimer();
      if (pending && !busy) {
        this.quietTimer = setTimeout(() => void this.reloadNow(), QUIET_PERIOD_MS);
      }
    });
  }

  /** Activates the waiting version and reloads (also the banner's «Jetzt neu laden»). */
  async reloadNow(): Promise<void> {
    if (this.reloading) {
      return;
    }
    this.reloading = true;
    this.clearQuietTimer();
    try {
      if (this.updateReady()) {
        await this.swUpdate.activateUpdate();
      }
    } catch {
      // A failed activation still reloads: the service worker then serves the newest complete version.
    } finally {
      this.reloadPage();
    }
  }

  private clearQuietTimer(): void {
    if (this.quietTimer !== null) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
  }
}
