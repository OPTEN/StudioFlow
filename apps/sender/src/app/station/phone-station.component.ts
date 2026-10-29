import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import type { Resolution } from '../core/sender-settings.service';
import { ConfirmSheetComponent } from '../shared/confirm-sheet.component';
import { IconComponent } from '../shared/icon.component';
import { MediaPreviewDirective } from '../shared/media-preview.directive';
import { SheetComponent } from '../shared/sheet.component';
import { describeCameraProblem } from './camera-problem';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { remoteCameraNoticeText, type RemoteCameraNotice } from './remote-camera-notice';
import { TallyTagComponent } from './tally-tag.component';

/** Controls stay visible this long after a tap while the screen is off. */
const WAKE_MS = 10_000;

/** An action that changes the live picture and waits for a confirmation. */
type PendingAction = 'switch' | 'stop';

/**
 * Phone as a fixed camera (plan “Phone as a camera”): the camera picture owns the whole screen (mirrored only for the
 * front camera). The status sits on top (code, name, connection, Live/Preview, Mic live), the controls on a
 * translucent rail of round labelled buttons at the bottom, or at the side of a phone in landscape: switch camera,
 * picture quality (a sheet), microphone, screen off, tech check and stop. Switching or stopping the camera while it is
 * live asks first; the quality sheet says that the picture pauses. “Screen off” blacks out the phone on a stage while
 * it keeps sending; a tap (or Enter) shows the controls for a while.
 */
@Component({
  selector: 'sf-phone-station',
  imports: [
    ConfirmSheetComponent,
    ConnectionStatusComponent,
    IconComponent,
    MediaPreviewDirective,
    SheetComponent,
    TallyTagComponent,
  ],
  templateUrl: './phone-station.component.html',
  styleUrl: './phone-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneStationComponent {
  protected readonly session = inject(DeviceSessionService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  /** “Tech check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly camera = this.session.camera;
  protected readonly facing = this.session.facing;
  protected readonly resolution = computed(() => this.session.settings().resolution);
  protected readonly screenOff = computed(() => this.session.settings().dark);
  protected readonly awake = signal(false);
  protected readonly qualityOpen = signal(false);
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly name = computed(() => this.session.self()?.name ?? '');
  protected readonly tally = computed(() => this.session.tally().overall);
  /** The camera is in the program: changing the picture is seen by the audience. */
  protected readonly live = computed(() => this.camera()?.tally === 'program');
  protected readonly techLevel = computed(() => this.session.techCheck()?.overall ?? 'unknown');

  protected readonly cameraState = computed(() => this.camera()?.state ?? 'idle');
  protected readonly running = computed(() => {
    const state = this.cameraState();
    return state === 'starting' || state === 'live' || state === 'paused';
  });
  protected readonly micRunning = computed(() => {
    const state = this.session.mic()?.state ?? 'idle';
    return state === 'starting' || state === 'live' || state === 'paused';
  });
  protected readonly preview = computed(() =>
    this.running() ? this.session.preview('camera') : null,
  );
  protected readonly problem = computed(() =>
    this.cameraState() === 'failed'
      ? describeCameraProblem(
          this.camera()?.failure,
          this.camera()?.messageKey,
          this.environment.userAgent(),
        )
      : null,
  );
  protected readonly controlsVisible = computed(() => !this.screenOff() || this.awake());
  protected readonly facingLabel = computed(() =>
    this.facing() === 'user' ? t('sender.station.phone.front') : t('sender.station.phone.back'),
  );
  protected readonly qualityName = computed(() =>
    t('sender.station.phone.qualityName', {
      quality:
        this.resolution() === 1080
          ? t('sender.station.phone.qualityHigh')
          : t('sender.station.phone.qualityStandard'),
    }),
  );
  protected readonly connectionWord = computed(() =>
    t(`sender.station.connection.${this.session.connection()}`),
  );

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearWake());
  }

  protected noticeText(notice: RemoteCameraNotice): string {
    return remoteCameraNoticeText(notice);
  }

  /** “Switch camera”: at once off air, after a confirmation while live. */
  protected requestSwitch(): void {
    if (this.live()) {
      this.pending.set('switch');
    } else {
      this.session.toggleFacing();
    }
  }

  /** “Stop camera”: at once off air, after a confirmation while live. */
  protected requestStop(): void {
    if (this.live()) {
      this.pending.set('stop');
    } else {
      this.session.stopCamera();
    }
  }

  protected confirm(): void {
    const action = this.pending();
    this.pending.set(null);
    if (action === 'switch') {
      this.session.toggleFacing();
    } else if (action === 'stop') {
      this.session.stopCamera();
    }
  }

  protected toggleMic(): void {
    if (this.micRunning()) {
      this.session.stopMic();
    } else {
      void this.session.startMic();
    }
  }

  protected setResolution(resolution: Resolution): void {
    this.session.setResolution(resolution);
  }

  protected toggleScreenOff(): void {
    this.session.setDark(!this.screenOff());
    this.awake.set(false);
    this.clearWake();
  }

  /** A tap on the black screen shows the controls for a while. */
  protected wake(): void {
    if (!this.screenOff()) {
      return;
    }
    this.awake.set(true);
    this.clearWake();
    this.wakeTimer = setTimeout(() => this.awake.set(false), WAKE_MS);
  }

  private clearWake(): void {
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }
}
