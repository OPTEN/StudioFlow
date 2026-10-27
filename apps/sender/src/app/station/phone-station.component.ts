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
import type { Facing, Resolution } from '../core/sender-settings.service';
import { IconComponent } from '../shared/icon.component';
import { MediaPreviewDirective } from '../shared/media-preview.directive';
import { describeCameraProblem } from './camera-problem';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { remoteCameraNoticeText, type RemoteCameraNotice } from './remote-camera-notice';

/** Controls stay visible this long after a tap in dark mode. */
const WAKE_MS = 10_000;

/**
 * Phone as a fixed camera (plan “Phone as a camera”): full-screen preview (mirrored only for the front camera), name and
 * slot code, connection line, and the controls start/stop, Front/Back, 720p/1080p, “Dark” and “Tech check”. A short
 * note tells the person at the phone when the control room changed the camera remotely.
 */
@Component({
  selector: 'sf-phone-station',
  imports: [ConnectionStatusComponent, IconComponent, MediaPreviewDirective],
  templateUrl: './phone-station.component.html',
  styleUrl: './phone-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneStationComponent {
  protected readonly session = inject(DeviceSessionService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  /** “Technik-Check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly camera = this.session.camera;
  protected readonly facing = this.session.facing;
  protected readonly resolution = computed(() => this.session.settings().resolution);
  protected readonly dark = computed(() => this.session.settings().dark);
  protected readonly awake = signal(false);
  protected readonly name = computed(() => this.session.self()?.name ?? '');
  protected readonly tally = computed(() => this.session.tally().overall);

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
  protected readonly controlsVisible = computed(() => !this.dark() || this.awake());

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearWake());
  }

  protected noticeText(notice: RemoteCameraNotice): string {
    return remoteCameraNoticeText(notice);
  }

  protected toggleCamera(): void {
    if (this.running()) {
      this.session.stopCamera();
    } else {
      this.session.startCamera();
    }
  }

  protected toggleMic(): void {
    if (this.micRunning()) {
      this.session.stopMic();
    } else {
      void this.session.startMic();
    }
  }

  protected setFacing(facing: Facing): void {
    this.session.setFacing(facing);
  }

  protected setResolution(resolution: Resolution): void {
    this.session.setResolution(resolution);
  }

  protected toggleDark(): void {
    const dark = !this.dark();
    this.session.setDark(dark);
    this.awake.set(false);
    this.clearWake();
  }

  /** A tap on the black screen shows the controls for a while. */
  protected wake(): void {
    if (!this.dark()) {
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
