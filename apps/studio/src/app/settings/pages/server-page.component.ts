import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import type { Observable } from 'rxjs';
import { ServerSettingsService, type ApplyTarget } from '../../core/state/server-settings.service';
import { ToastService } from '../../core/ui/toast.service';
import { AddressSectionComponent } from '../../server/address-section.component';
import { BackupSectionComponent } from '../../server/backup-section.component';
import { BackupsListComponent } from '../../server/backups-list.component';
import { EmbeddingSectionComponent } from '../../server/embedding-section.component';
import { MediaSectionComponent } from '../../server/media-section.component';
import { ServiceStatusComponent } from '../../server/service-status.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Which server section a page shows. */
export type ServerSection = 'media' | 'network' | 'embedding' | 'backups';

/** What each server page names: its title, the sentence under the scope line and the service it configures. */
const SECTIONS: Readonly<
  Record<
    ServerSection,
    {
      readonly title: PlainMessageKey;
      readonly note: PlainMessageKey;
      readonly service: ApplyTarget;
    }
  >
> = {
  media: {
    title: 'regie.settings.nav.media',
    note: 'regie.server.media.intro',
    service: 'liveKit',
  },
  network: {
    title: 'regie.settings.nav.network',
    note: 'regie.server.address.intro',
    service: 'caddy',
  },
  embedding: {
    title: 'regie.settings.nav.embedding',
    note: 'regie.server.embedding.intro',
    service: 'caddy',
  },
  backups: {
    title: 'regie.settings.nav.backups',
    note: 'regie.server.backup.intro',
    service: 'backup',
  },
};

/**
 * A server page of the settings window (`/settings/media`, `/network`, `/embedding`, `/backups`): the state of the
 * service it configures at the top (plain words, a lamp and the time it was checked), then one grouped form, saved on
 * its own. A save shows the toast "Saved." and checks the service again at once.
 */
@Component({
  selector: 'sf-server-page',
  imports: [
    AddressSectionComponent,
    BackupSectionComponent,
    BackupsListComponent,
    EmbeddingSectionComponent,
    MediaSectionComponent,
    ServiceStatusComponent,
    SettingsPageHeadComponent,
  ],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t(info().title)" scope="server" [note]="t(info().note)" />
      <div class="c-page__body">
        <sf-service-status [service]="info().service" />
        @if (settings.settings()) {
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
              <sf-backups-list />
              <sf-backup-section (saved)="saved()" />
            }
          }
        } @else if (loadFailed()) {
          <div class="c-empty c-server-page__state" role="alert">
            <strong>{{ t('regie.server.loadError') }}</strong>
            <span>{{ t('regie.server.loadErrorHint') }}</span>
            <button class="c-btn" type="button" (click)="load()">
              {{ t('regie.server.retry') }}
            </button>
          </div>
        } @else {
          <div class="c-empty c-server-page__state" role="status">
            {{ t('regie.server.loading') }}
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .c-server-page__state {
      display: grid;
      gap: 8px;
      justify-items: start;
      padding-inline: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerPageComponent {
  private readonly toasts = inject(ToastService);
  protected readonly settings = inject(ServerSettingsService);
  protected readonly t = t;
  protected readonly loadFailed = signal(false);
  private readonly status = viewChild(ServiceStatusComponent);
  private readonly data = toSignal(
    inject(ActivatedRoute).data as Observable<{ section?: ServerSection }>,
  );
  protected readonly section = computed<ServerSection>(() => this.data()?.section ?? 'media');
  protected readonly info = computed(() => SECTIONS[this.section()]);

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
    void this.status()?.refresh();
  }
}
