import { Injectable, inject } from '@angular/core';
import { BROWSER_STORAGE } from '../../core/ui/preferences.service';
import type { PairingTab } from '../../shell/workspace/dock-layout.service';

/** Storage key of the last pairing tab (per browser, like the dock layout). */
export const PAIRING_TAB_KEY = 'studioflow.pairingTab';

const TABS: readonly PairingTab[] = ['phone', 'laptop', 'link'];

/**
 * The tab "Add device" opens on: the one used last in this browser, and Phone the first time, because camera phones by
 * QR code are the common case of a setup (PRODUCT.md). Never throws: without storage the dock simply opens on Phone.
 */
@Injectable({ providedIn: 'root' })
export class PairingTabMemory {
  private readonly storage = inject(BROWSER_STORAGE);

  /** The tab to open on. */
  last(): PairingTab {
    try {
      const stored = this.storage()?.getItem(PAIRING_TAB_KEY);
      return TABS.find((tab) => tab === stored) ?? 'phone';
    } catch {
      return 'phone';
    }
  }

  /** Remembers the tab the operator chose. */
  remember(tab: PairingTab): void {
    try {
      this.storage()?.setItem(PAIRING_TAB_KEY, tab);
    } catch {
      // Without storage the next opening starts on Phone again.
    }
  }
}
