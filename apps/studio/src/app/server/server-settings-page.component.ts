import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { t } from '@studioflow/i18n';
import type { ApplyStatusDto } from '@studioflow/scene-model';
import { StudioApiService } from '../core/api/studio-api.service';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { IconComponent } from '../core/ui/icon.component';
import { ToastService } from '../core/ui/toast.service';
import { AddressSectionComponent } from './address-section.component';
import { BackupSectionComponent } from './backup-section.component';
import { BackupsListComponent } from './backups-list.component';
import { EmbeddingSectionComponent } from './embedding-section.component';
import { MediaSectionComponent } from './media-section.component';

/** How often the state of the services is read while the page is open. */
export const SERVICE_STATUS_REFRESH_MS = 10_000;

/** One line of the service overview. */
interface ServiceRow {
  readonly id: 'caddy' | 'liveKit' | 'backup';
  readonly label: string;
  readonly state: 'ok' | 'pending' | 'failed';
}

/**
 * The "Server settings" page `/settings` (issue #27), reached from the production menu: the sections of the first-run
 * wizard (media address, address and certificate, embedding) plus the backup schedule, the off-site copy and the latest
 * backups, each saved on its own. A line per service shows whether Caddy, LiveKit and the backup service run the saved
 * settings. A page of its own like `/audit`, with a header bar and one scrolling panel.
 */
@Component({
  selector: 'sf-server-settings-page',
  imports: [
    AddressSectionComponent,
    BackupSectionComponent,
    BackupsListComponent,
    EmbeddingSectionComponent,
    IconComponent,
    MediaSectionComponent,
    RouterLink,
  ],
  templateUrl: './server-settings-page.component.html',
  styleUrl: './server-settings-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSettingsPageComponent {
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  protected readonly settings = inject(ServerSettingsService);

  protected readonly t = t;
  protected readonly loadFailed = signal(false);
  private readonly status = signal<ApplyStatusDto | null>(null);
  protected readonly services = computed<readonly ServiceRow[]>(() => {
    const status = this.status();
    if (!status) {
      return [];
    }
    const row = (
      id: ServiceRow['id'],
      label: string,
      target: ApplyStatusDto['caddy'],
    ): ServiceRow => ({
      id,
      label,
      state: target.applied ? 'ok' : target.error ? 'failed' : 'pending',
    });
    return [
      row('caddy', t('regie.server.status.caddy'), status.caddy),
      row('liveKit', t('regie.server.status.liveKit'), status.liveKit),
      row('backup', t('regie.server.status.backup'), status.backup),
    ];
  });

  constructor() {
    void this.load();
    const timer = setInterval(() => void this.refreshStatus(), SERVICE_STATUS_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      await this.settings.load();
    } catch {
      this.loadFailed.set(true);
      return;
    }
    await this.refreshStatus();
  }

  protected stateText(row: ServiceRow): string {
    switch (row.state) {
      case 'ok':
        return t('regie.server.status.ok');
      case 'pending':
        return t('regie.server.status.pending');
      case 'failed':
        return t('regie.server.status.failed');
    }
  }

  /** A section was saved: say so and look at the services again. */
  protected saved(): void {
    this.toasts.show(t('regie.server.saved'));
    void this.refreshStatus();
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.status.set(await this.api.getServerSettingsStatus());
    } catch {
      // A moment without an answer (the API restarts) is not worth a message; the next look tries again.
    }
  }
}
