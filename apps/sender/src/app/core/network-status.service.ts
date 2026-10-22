import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Browser connectivity and visibility as signals. `navigator.onLine` is only a hint (a LAN adapter counts as online),
 * so it drives the offline banner; reconnects are driven by the hub and media sessions themselves.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  /** False while the browser reports no network. */
  readonly online = signal(this.window?.navigator.onLine ?? true);
  /** True while the page is visible. */
  readonly visible = signal(this.document.visibilityState !== 'hidden');

  private readonly wakeListeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();

  constructor() {
    const onOnline = (): void => {
      this.online.set(true);
      this.notify(this.changeListeners);
      this.notify(this.wakeListeners);
    };
    const onOffline = (): void => {
      this.online.set(false);
      this.notify(this.changeListeners);
    };
    const onVisibility = (): void => {
      const visible = this.document.visibilityState !== 'hidden';
      this.visible.set(visible);
      if (visible) {
        this.notify(this.wakeListeners);
      }
    };
    this.window?.addEventListener('online', onOnline);
    this.window?.addEventListener('offline', onOffline);
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.window?.removeEventListener('online', onOnline);
      this.window?.removeEventListener('offline', onOffline);
      this.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  /** Called when the network returns or the page becomes visible again; returns the unsubscribe function. */
  onWake(listener: () => void): () => void {
    this.wakeListeners.add(listener);
    return () => this.wakeListeners.delete(listener);
  }

  /** Called whenever {@link online} changes; returns the unsubscribe function. */
  onOnlineChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notify(listeners: ReadonlySet<() => void>): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A failing listener must not stop the others.
      }
    }
  }
}
