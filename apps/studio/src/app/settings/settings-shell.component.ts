import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { t } from '@studioflow/i18n';
import { filter } from 'rxjs';
import { SystemInfoService } from '../core/api/system-info.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { IconComponent } from '../core/ui/icon.component';
import { SettingsMemoryService } from './settings-memory.service';
import { SETTINGS_NAV } from './settings-nav';

/**
 * The settings window (`/settings/*`, `/monitoring`, `/audit`): a sidebar grouped by scope (production, this browser,
 * server, diagnostics, account) next to the page, as in System Settings. One place for everything that is not switching
 * the program; "Control room" leads back. Starts the production store, so the production pages and the sidebar know the
 * active production, and remembers the page for the next `/settings`.
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
    const router = inject(Router);
    const memory = inject(SettingsMemoryService);
    memory.remember(router.url);
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => memory.remember(event.urlAfterRedirects));
  }
}
