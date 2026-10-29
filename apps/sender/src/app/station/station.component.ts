import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { t } from '@studioflow/i18n';
import { AppUpdateService } from '../core/app-update.service';
import { LiveStateService } from '../core/live-state.service';
import { NoticeService } from '../core/notice.service';
import { ConfirmKeysDirective } from '../shared/confirm-keys.directive';
import { IconComponent } from '../shared/icon.component';
import { AudioStationComponent } from './audio-station.component';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { LaptopStationComponent } from './laptop-station.component';
import { MessageBannerComponent } from './message-banner.component';
import { PhoneStationComponent } from './phone-station.component';
import { TallyFrameComponent } from './tally-frame.component';
import { TechCheckPanelComponent } from './tech-check-panel.component';

/** The “Paired” greeting disappears after this time. */
const GREETING_MS = 8000;
/** “Server not reachable” only after the connection has been down this long. */
const UNREACHABLE_AFTER_MS = 5000;
/** “This takes longer than usual” on the starting screen after this time. */
const STARTING_SLOW_MS = 15_000;
/** The brand in the tab title (never translated). */
const BRAND = 'StudioFlow';

/**
 * `/join/station`: the paired device. Owns the {@link DeviceSessionService}, renders the phone, laptop or audio station UI, the
 * tally frame, the banners (Regie message, greeting, connection, update), the tech check and the screens for blocked
 * devices and replaced sessions. The banners are projected into each station's own layout, in the flow under its
 * status bar, so they never cover a control. The tab title says what matters to a speaker in another window: “Live”,
 * a message or a request to share again.
 */
@Component({
  selector: 'sf-station',
  imports: [
    AudioStationComponent,
    ConfirmKeysDirective,
    ConnectionStatusComponent,
    IconComponent,
    LaptopStationComponent,
    MessageBannerComponent,
    NgTemplateOutlet,
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
  private readonly title = inject(Title);

  protected readonly greeting = signal(inject(NoticeService).takeJustPaired());
  protected readonly techCheckOpen = signal(false);
  /** “Reload now…” was pressed on the update banner: the consequence is shown with the final button. */
  protected readonly confirmReload = signal(false);
  protected readonly startingSlow = signal(false);

  protected readonly kind = this.session.kind;
  protected readonly phase = this.session.phase;
  protected readonly screenOff = computed(
    () => this.session.settings().dark && this.kind() === 'phone' && this.phase() !== 'blocked',
  );
  protected readonly tally = computed(() => {
    if (this.phase() !== 'online' && this.phase() !== 'connecting') {
      return 'off';
    }
    // The audio station has no picture: its tally is the microphone, red while the Regie lets the sound through.
    return this.kind() === 'audioStation'
      ? (this.session.tally().slots['mic'] ?? 'off')
      : this.session.tally().overall;
  });
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
  /** The tab title: “Live · Message · Laptop Anna – StudioFlow”. */
  private readonly tabTitle = computed(() => {
    const name = this.session.self()?.name ?? '';
    if (name === '') {
      return null;
    }
    const parts: string[] = [];
    if (this.tally() === 'program') {
      parts.push(t('sender.station.tally.live'));
    }
    if (this.session.message() !== null) {
      parts.push(t('sender.station.tab.message'));
    } else if (this.session.screens().some((slot) => slot.reshareRequested)) {
      parts.push(t('sender.station.laptop.shareAgain'));
    }
    return `${[...parts, name].join(' · ')} – ${BRAND}`;
  });

  constructor() {
    this.session.start();
    const destroyRef = inject(DestroyRef);
    effect(() => {
      if (this.phase() === 'removed') {
        void this.router.navigate(['/'], { replaceUrl: true });
      }
    });
    effect(() => {
      const title = this.tabTitle();
      if (title !== null) {
        this.title.setTitle(title);
      }
    });
    effect(() => {
      if (!this.showUpdate()) {
        this.confirmReload.set(false);
      }
    });
    if (this.greeting()) {
      const timer = setTimeout(() => this.greeting.set(false), GREETING_MS);
      destroyRef.onDestroy(() => clearTimeout(timer));
    }
    const slowTimer = setTimeout(() => this.startingSlow.set(true), STARTING_SLOW_MS);
    destroyRef.onDestroy(() => clearTimeout(slowTimer));
  }

  protected openTechCheck(): void {
    this.techCheckOpen.set(true);
  }

  protected closeTechCheck(): void {
    this.techCheckOpen.set(false);
  }
}
