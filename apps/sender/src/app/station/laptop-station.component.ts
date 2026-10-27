import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS } from '@studioflow/scene-model';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { MediaPreviewDirective } from '../shared/media-preview.directive';
import { describeCameraProblem, type CameraProblem } from './camera-problem';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService, type StationSlot } from './device-session.service';
import { slotNumber } from './device-messages';
import { actionErrorText } from './slot-errors';

const BUSY = new Set(['starting', 'live', 'paused']);

/** State line of a slot, in the active language. */
export function slotStateText(slot: StationSlot): string {
  const screen = slot.kind === 'screen';
  switch (slot.state) {
    case 'starting':
      return t(
        screen ? 'sender.station.slot.startingScreen' : 'sender.station.slot.startingCamera',
      );
    case 'live':
      return t(screen ? 'sender.station.slot.liveScreen' : 'sender.station.slot.liveCamera');
    case 'paused':
      return t('sender.station.slot.paused');
    case 'ended':
      return t('sender.station.slot.ended');
    case 'failed':
      return t(screen ? 'sender.station.slot.failedScreen' : 'sender.station.slot.failedCamera');
    default:
      return t(screen ? 'sender.station.slot.idleScreen' : 'sender.station.slot.idleCamera');
  }
}

/**
 * Laptop with screens (plan “Laptop with screens”): one row per screen slot with code, state, local preview,
 * “Stop sharing” and “Remove”; “Share screen”, “+ Another screen”, a large “Share again” after an ended share or a
 * reshare request, and the optional camera.
 */
@Component({
  selector: 'sf-laptop-station',
  imports: [BrandMarkComponent, ConnectionStatusComponent, IconComponent, MediaPreviewDirective],
  templateUrl: './laptop-station.component.html',
  styleUrl: './laptop-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaptopStationComponent {
  protected readonly session = inject(DeviceSessionService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  /** Greet with “Paired” right after pairing. */
  readonly justPaired = input(false);
  /** “Technik-Check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly canShareScreen = this.environment.canShareScreen();
  protected readonly self = this.session.self;
  protected readonly screens = this.session.screens;
  protected readonly camera = this.session.camera;
  protected readonly facing = this.session.facing;
  protected readonly reshare = computed(() =>
    this.screens().filter((slot) => slot.reshareRequested),
  );

  /** “+ weiteren Bildschirm” only once every existing screen is in use. */
  protected readonly canAddScreen = computed(() => {
    const screens = this.screens();
    return (
      this.canShareScreen &&
      screens.length > 0 &&
      screens.length < LIMITS.screensPerDevice &&
      screens.every((slot) => BUSY.has(slot.state))
    );
  });
  protected readonly techLevel = computed(() => this.session.techCheck()?.overall ?? 'unknown');
  /** Error of the last action in the active language. */
  protected readonly actionError = computed(() => {
    const error = this.session.actionError();
    return error === null ? null : actionErrorText(error);
  });

  protected readonly stateText = slotStateText;

  protected label(slot: StationSlot): string {
    return slot.kind === 'camera'
      ? t('sender.station.slot.camera')
      : t('sender.station.slot.screen', { number: slotNumber(slot.slot) });
  }

  protected busy(slot: StationSlot): boolean {
    return BUSY.has(slot.state);
  }

  protected preview(slot: StationSlot): MediaStream | null {
    return this.busy(slot) ? this.session.preview(slot.slot) : null;
  }

  protected cameraProblem(slot: StationSlot): CameraProblem | null {
    return slot.kind === 'camera' && slot.state === 'failed'
      ? describeCameraProblem(slot.failure, slot.messageKey, this.environment.userAgent())
      : null;
  }

  protected videoScreen(slot: StationSlot): boolean {
    return this.session.videoScreen(slot.slot);
  }

  /** “Video in screen”: 30 instead of 15 frames per second for this screen. */
  protected toggleVideoScreen(slot: StationSlot): void {
    this.session.setVideoScreen(slot.slot, !this.session.videoScreen(slot.slot));
  }

  /** Must stay synchronous: the browser's share dialog needs the click (user gesture). */
  protected share(slot: StationSlot): void {
    this.session.shareScreen(slot.slot);
  }

  /** Must stay synchronous for the same reason. */
  protected addScreen(): void {
    this.session.addScreen();
  }
}
