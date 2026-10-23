import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { t } from '@studioflow/i18n';
import { AppUpdateService } from '../core/app-update.service';
import { LiveStateService } from '../core/live-state.service';
import { NoticeService } from '../core/notice.service';
import { IconComponent } from '../shared/icon.component';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { LaptopStationComponent } from './laptop-station.component';
import { MessageBannerComponent } from './message-banner.component';
import { PhoneStationComponent } from './phone-station.component';
import { TallyFrameComponent } from './tally-frame.component';
import { TechCheckPanelComponent } from './tech-check-panel.component';

/** The “Paired” greeting of a phone disappears after this time. */
const GREETING_MS = 8000;
/** “Server not reachable” only after the connection has been down this long. */
const UNREACHABLE_AFTER_MS = 5000;

/**
 * `/join/station`: the paired device. Owns the {@link DeviceSessionService}, renders the phone or laptop UI, the
 * tally frame, Regie messages, the technical check and the screens for blocked devices and replaced sessions.
 */
@Component({
  selector: 'sf-station',
  imports: [
    ConnectionStatusComponent,
    IconComponent,
    LaptopStationComponent,
    MessageBannerComponent,
    PhoneStationComponent,
    TallyFrameComponent,
    TechCheckPanelComponent,
  ],
  providers: [DeviceSessionService],
  templateUrl: './station.component.html',
  styleUrl: './station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationComponent {
  protected readonly t = t;
  protected readonly session = inject(DeviceSessionService);
  protected readonly updates = inject(AppUpdateService);
  private readonly liveState = inject(LiveStateService);
  private readonly router = inject(Router);

  protected readonly justPaired = signal(inject(NoticeService).takeJustPaired());
  protected readonly greeting = signal(this.justPaired());
  protected readonly techCheckOpen = signal(false);

  protected readonly kind = this.session.kind;
  protected readonly phase = this.session.phase;
  protected readonly dark = computed(
    () => this.session.settings().dark && this.kind() === 'phone' && this.phase() !== 'blocked',
  );
  protected readonly tally = computed(() =>
    this.phase() === 'online' || this.phase() === 'connecting'
      ? this.session.tally().overall
      : 'off',
  );
  protected readonly cameraCode = computed(() => this.session.camera()?.code ?? null);
  protected readonly showUpdate = computed(
    () => (this.updates.updateReady() || this.updates.broken()) && this.liveState.busy(),
  );
  protected readonly unreachable = computed(() => {
    const since = this.session.degradedSince();
    return (
      this.session.serverUnreachable() &&
      this.session.connection() !== 'offline' &&
      since !== null &&
      this.session.now() - since >= UNREACHABLE_AFTER_MS
    );
  });

  constructor() {
    this.session.start();
    effect(() => {
      if (this.phase() === 'removed') {
        void this.router.navigate(['/'], { replaceUrl: true });
      }
    });
    if (this.greeting()) {
      const timer = setTimeout(() => this.greeting.set(false), GREETING_MS);
      inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    }
  }

  protected openTechCheck(): void {
    this.techCheckOpen.set(true);
  }

  protected closeTechCheck(): void {
    this.techCheckOpen.set(false);
  }
}
