import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { formatDateTime, t } from '@studioflow/i18n';
import { formatBytes, type BackupsDto } from '@studioflow/scene-model';
import { ApiError, toUserMessage } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { ToastService } from '../core/ui/toast.service';

/** How often the list looks for a new backup while the page is open. */
export const BACKUPS_REFRESH_MS = 5000;

/**
 * The latest backups of the backup service and "Back up now" (issue #27). Restoring is a command on the server (it
 * replaces the database and needs the stack stopped), so the list only shows the folder names that command takes.
 */
@Component({
  selector: 'sf-backups-list',
  templateUrl: './backups-list.component.html',
  styleUrl: './server-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupsListComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly toasts = inject(ToastService);

  protected readonly t = t;
  protected readonly state = signal<BackupsDto | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly requesting = signal(false);
  protected readonly requested = signal(false);
  /** The newest backup when "Back up now" was pressed: a different one means that the requested backup is done. */
  private newestWhenRequested: string | null = null;
  protected readonly rows = computed(() =>
    (this.state()?.backups ?? []).map((backup) => ({
      name: backup.name,
      kind:
        backup.kind === 'manual'
          ? t('regie.server.backup.listManual')
          : t('regie.server.backup.listAuto'),
      size: formatBytes(backup.bytes),
      time: formatDateTime(new Date(backup.at)),
    })),
  );

  constructor() {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), BACKUPS_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async backUpNow(): Promise<void> {
    if (this.requesting()) {
      return;
    }
    this.requesting.set(true);
    try {
      await this.settings.requestBackup();
      this.newestWhenRequested = this.state()?.backups[0]?.name ?? null;
      this.requested.set(true);
      await this.refresh();
    } catch (error) {
      this.toasts.show(toUserMessage(ApiError.from(error)));
    } finally {
      this.requesting.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const state = await this.settings.listBackups();
      this.state.set(state);
      this.loadFailed.set(false);
      if (state.running || (state.backups[0]?.name ?? null) !== this.newestWhenRequested) {
        // It runs, or it is in the list: the hint that one was requested has done its job.
        this.requested.set(false);
      }
    } catch {
      this.loadFailed.set(true);
    }
  }
}
