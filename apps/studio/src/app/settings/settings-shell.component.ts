import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { t } from '@studioflow/i18n';
import { SystemInfoService } from '../core/api/system-info.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { IconComponent } from '../core/ui/icon.component';
import { SETTINGS_NAV } from './settings-nav';

/**
 * The settings window (`/settings/*`, `/monitoring`, `/audit`): a sidebar grouped by scope (production, this browser,
 * server, diagnostics, account) next to the page, as in System Settings. One place for everything that is not switching
 * the program; "Control room" leads back. Starts the production store, so the production pages and the sidebar know the
 * active production.
 */
@Component({
  selector: 'sf-settings-shell',
  imports: [IconComponent, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './settings-shell.component.html',
  styleUrl: './settings-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsShellComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly system = inject(SystemInfoService);
  protected readonly groups = SETTINGS_NAV;
  protected readonly t = t;

  constructor() {
    this.store.start();
    this.system.ensureLoaded();
  }
}
