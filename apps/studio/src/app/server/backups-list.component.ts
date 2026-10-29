import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { formatDateTime, msg, t } from '@studioflow/i18n';
import { formatBytes, type BackupsDto } from '@studioflow/scene-model';
import { ApiError, toUserMessage } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { ClipboardService } from '../core/ui/clipboard.service';
import { IconComponent } from '../core/ui/icon.component';
import { ToastService } from '../core/ui/toast.service';
import type { LampTone } from '../docks/shared/source-view';
import type { ServerProblem } from './apply-messages';
import { ServerProblemComponent } from './server-problem.component';
import { TechnicalDetailsComponent } from './technical-details.component';

/** How often the list looks for a new backup while the page is open. */
export const BACKUPS_REFRESH_MS = 5000;

/** The restore command of the backup service; `<folder>` is the name of a backup. */
export function restoreCommand(folder: string): string {
  return `docker compose run --rm backup restore ${folder}`;
}

/** The template of the restore command, for the explanation under the list. */
export const RESTORE_TEMPLATE = restoreCommand('<folder>');

/** The status line above the list: a lamp and one sentence. */
interface StatusLine {
  readonly lamp: LampTone;
  readonly text: string;
}

/**
 * The latest backups of the backup service and "Back up now" (issue #27): a status line with the button next to it, a
 * table with column headers (backup, kind, size, finished) and, per row, a button that copies its restore command.
 * Restoring is a command on the server (it replaces the database and needs the stack stopped), so the page offers the
 * command instead of a button. Polled every {@link BACKUPS_REFRESH_MS}.
 */
@Component({
  selector: 'sf-backups-list',
  imports: [IconComponent, ServerProblemComponent, TechnicalDetailsComponent],
  templateUrl: './backups-list.component.html',
  styleUrls: ['./server-section.scss', './backups-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupsListComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly toasts = inject(ToastService);
  private readonly clipboard = inject(ClipboardService);

  protected readonly t = t;
  protected readonly restoreTemplate = RESTORE_TEMPLATE;
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
  protected readonly status = computed<StatusLine>(() => {
    const backups = this.state();
    if (!backups) {
      return this.loadFailed()
        ? { lamp: 'is-bad', text: t('regie.server.backup.listLoadError') }
        : { lamp: 'is-idle', text: t('regie.server.loading') };
    }
    if (!backups.serviceSeen) {
      return { lamp: 'is-warn', text: t('regie.server.backup.listNotSeen') };
    }
    if (backups.postponed) {
      return { lamp: 'is-warn', text: t('regie.server.backup.listPostponed') };
    }
    if (backups.running) {
      return { lamp: 'is-warn', text: t('regie.server.backup.listRunning') };
    }
    if (this.requested()) {
      return { lamp: 'is-idle', text: t('regie.server.backup.listRequested') };
    }
    return { lamp: '', text: t('regie.server.backup.listIdle') };
  });
  /** The last run failed: the operator's sentence, and the service's reason for whoever runs the server. */
  protected readonly failure = computed<ServerProblem | null>(() => {
    const error = this.state()?.lastError;
    return error
      ? {
          message: msg('regie.server.backup.listFailed'),
          command: 'docker compose logs backup',
          detail: error,
        }
      : null;
  });

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

  protected copyRestore(name: string): void {
    void this.clipboard.copy(restoreCommand(name));
  }

  protected copyTemplate(element: HTMLElement): void {
    void this.clipboard.copy(RESTORE_TEMPLATE, { selectElement: element });
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
