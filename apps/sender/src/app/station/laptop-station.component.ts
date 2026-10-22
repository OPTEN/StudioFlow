import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { LIMITS } from '@flowstudio/scene-model';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { MediaPreviewDirective } from '../shared/media-preview.directive';
import { describeCameraProblem, type CameraProblem } from './camera-problem';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService, type StationSlot } from './device-session.service';
import { slotNumber } from './device-messages';

const BUSY = new Set(['starting', 'live', 'paused']);

/** German state line of a slot. */
export function slotStateText(slot: StationSlot): string {
  const screen = slot.kind === 'screen';
  switch (slot.state) {
    case 'starting':
      return screen ? 'Freigabe startet …' : 'Kamera startet …';
    case 'live':
      return screen ? 'Wird geteilt' : 'Kamera sendet';
    case 'paused':
      return 'Pausiert, das Bild kommt gleich zurück';
    case 'ended':
      return 'Teilen beendet';
    case 'failed':
      return screen ? 'Teilen fehlgeschlagen' : 'Kamera ausgefallen';
    default:
      return screen ? 'Bereit zum Teilen' : 'Kamera ist aus';
  }
}

/**
 * Laptop with screens (plan «Laptop mit Screens»): one row per screen slot with code, state, local preview,
 * «Teilen beenden» and «Entfernen»; «Bildschirm teilen», «+ weiteren Bildschirm», a large «Erneut teilen» after an
 * ended share or a reshare request, and the optional camera.
 */
@Component({
  selector: 'fs-laptop-station',
  imports: [BrandMarkComponent, ConnectionStatusComponent, IconComponent, MediaPreviewDirective],
  templateUrl: './laptop-station.component.html',
  styleUrl: './laptop-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaptopStationComponent {
  protected readonly session = inject(DeviceSessionService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  /** Greet with «Gekoppelt» right after pairing. */
  readonly justPaired = input(false);
  /** «Technik-Check» was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly canShareScreen = this.environment.canShareScreen();
  protected readonly self = this.session.self;
  protected readonly screens = this.session.screens;
  protected readonly camera = this.session.camera;
  protected readonly facing = this.session.facing;
  protected readonly reshare = computed(() =>
    this.screens().filter((slot) => slot.reshareRequested),
  );

  /** «+ weiteren Bildschirm» only once every existing screen is in use. */
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

  protected readonly stateText = slotStateText;

  protected label(slot: StationSlot): string {
    return slot.kind === 'camera' ? 'Kamera' : `Bildschirm ${slotNumber(slot.slot)}`;
  }

  protected busy(slot: StationSlot): boolean {
    return BUSY.has(slot.state);
  }

  protected preview(slot: StationSlot): MediaStream | null {
    return this.busy(slot) ? this.session.preview(slot.slot) : null;
  }

  protected cameraProblem(slot: StationSlot): CameraProblem | null {
    return slot.kind === 'camera' && slot.state === 'failed'
      ? describeCameraProblem(slot.message ?? undefined, this.environment.userAgent())
      : null;
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
