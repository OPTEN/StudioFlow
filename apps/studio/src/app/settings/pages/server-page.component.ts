import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { t } from '@studioflow/i18n';
import type { Observable } from 'rxjs';
import { ServerSettingsService } from '../../core/state/server-settings.service';
import { ToastService } from '../../core/ui/toast.service';
import { AddressSectionComponent } from '../../server/address-section.component';
import { BackupSectionComponent } from '../../server/backup-section.component';
import { BackupsListComponent } from '../../server/backups-list.component';
import { EmbeddingSectionComponent } from '../../server/embedding-section.component';
import { MediaSectionComponent } from '../../server/media-section.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Which server section a page shows. */
type ServerSection = 'media' | 'network' | 'embedding' | 'backups';

/**
 * A server page of the settings window (`/settings/media`, `/network`, `/embedding`, `/backups`): one section of the
 * former long server-settings page, each saved on its own.
 */
@Component({
  selector: 'sf-server-page',
  imports: [
    AddressSectionComponent,
    BackupSectionComponent,
    BackupsListComponent,
    EmbeddingSectionComponent,
    MediaSectionComponent,
    SettingsPageHeadComponent,
  ],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="title()" scope="server" />
      @if (settings.settings()) {
        <div class="c-page__body">
          @switch (section()) {
            @case ('media') {
              <sf-media-section (saved)="saved()" />
            }
            @case ('network') {
              <sf-address-section (saved)="saved()" />
            }
            @case ('embedding') {
              <sf-embedding-section (saved)="saved()" />
            }
            @case ('backups') {
              <sf-backup-section (saved)="saved()" />
              <sf-backups-list />
            }
          }
        </div>
      } @else if (loadFailed()) {
        <div class="c-empty">
          <strong>{{ t('regie.server.loadError') }}</strong>
          <button class="c-btn c-btn--sm" type="button" (click)="load()">
            {{ t('regie.server.retry') }}
          </button>
        </div>
      } @else {
        <div class="c-empty">{{ t('regie.server.loading') }}</div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerPageComponent {
  private readonly toasts = inject(ToastService);
  protected readonly settings = inject(ServerSettingsService);
  protected readonly t = t;
  protected readonly loadFailed = signal(false);
  private readonly data = toSignal(
    inject(ActivatedRoute).data as Observable<{ section?: ServerSection }>,
  );
  protected readonly section = computed<ServerSection>(() => this.data()?.section ?? 'media');
  protected readonly title = computed(() => {
    switch (this.section()) {
      case 'media':
        return t('regie.settings.nav.media');
      case 'network':
        return t('regie.settings.nav.network');
      case 'embedding':
        return t('regie.settings.nav.embedding');
      case 'backups':
        return t('regie.settings.nav.backups');
    }
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      await this.settings.load();
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected saved(): void {
    this.toasts.show(t('regie.server.saved'));
  }
}
