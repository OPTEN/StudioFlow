import { Injectable, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { CAMERA_PROTOCOL_VERSION, mergeCameraControl } from '@studioflow/media-client/device';
import type { CameraControlDto, DeviceDto } from '@studioflow/scene-model';
import { toUserMessage } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';

/** At most one camera command per phone and this interval: a dragged slider must not flood a weak Wi-Fi. */
export const CAMERA_COMMAND_INTERVAL_MS = 120;

/** What a command changes; unset fields are left alone. */
export type CameraChange = Partial<Omit<CameraControlDto, 'v'>>;

interface Channel {
  /** The newest merged change that has not been sent yet. */
  pending: CameraControlDto | null;
  timer: ReturnType<typeof setTimeout> | null;
  sentAt: number;
  inFlight: boolean;
}

function command(change: CameraChange): CameraControlDto {
  return {
    v: CAMERA_PROTOCOL_VERSION,
    lensId: null,
    zoom: null,
    focusMode: null,
    focusDistance: null,
    exposureCompensation: null,
    torch: null,
    reset: null,
    ...change,
  };
}

/**
 * Sends the camera commands of the camera panel (issue #11). Changes of one phone merge while the previous one is on
 * its way or the interval has not passed (throttle with a trailing send), so the newest value always arrives and a
 * slider drag sends about ten commands a second at most. The server clamps and refuses what the phone cannot do; a
 * failure becomes an inline message of the phone ({@link failureOf}), never a crash or a toast storm.
 */
@Injectable({ providedIn: 'root' })
export class CameraControlService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly channels = new Map<string, Channel>();
  private readonly failures = signal<Readonly<Record<string, string>>>({});

  /** The message of the last failed command of a phone, or null (reactive). */
  failureOf(deviceId: string): string | null {
    return this.failures()[deviceId] ?? null;
  }

  /** Forgets the failure message of a phone (the panel closes or the next command works). */
  clearFailure(deviceId: string): void {
    if (deviceId in this.failures()) {
      this.failures.update(({ [deviceId]: _removed, ...rest }) => rest);
    }
  }

  /** Queues a change for the phone; the newest value of each field wins. */
  send(device: DeviceDto, change: CameraChange): void {
    if (!this.store.canCommand()) {
      this.fail(device.id, t('regie.docks.offline'));
      return;
    }
    const channel = this.channel(device.id);
    const next = command(change);
    channel.pending = channel.pending === null ? next : mergeCameraControl(channel.pending, next);
    this.schedule(device.id, channel);
  }

  private channel(deviceId: string): Channel {
    let channel = this.channels.get(deviceId);
    if (channel === undefined) {
      channel = { pending: null, timer: null, sentAt: Number.NEGATIVE_INFINITY, inFlight: false };
      this.channels.set(deviceId, channel);
    }
    return channel;
  }

  private schedule(deviceId: string, channel: Channel): void {
    if (channel.timer !== null || channel.inFlight || channel.pending === null) {
      return;
    }
    const wait = Math.max(0, channel.sentAt + CAMERA_COMMAND_INTERVAL_MS - Date.now());
    channel.timer = setTimeout(() => {
      channel.timer = null;
      void this.flush(deviceId, channel);
    }, wait);
  }

  private async flush(deviceId: string, channel: Channel): Promise<void> {
    const camera = channel.pending;
    const productionId = this.store.productionId();
    channel.pending = null;
    if (camera === null || productionId === null || productionId === '') {
      return;
    }
    channel.inFlight = true;
    try {
      await this.api.sendDeviceCommand(productionId, deviceId, {
        kind: 'cameraControl',
        slot: 'camera',
        text: null,
        camera,
      });
      this.clearFailure(deviceId);
    } catch (error) {
      this.fail(deviceId, toUserMessage(error));
    } finally {
      channel.inFlight = false;
      channel.sentAt = Date.now();
      this.schedule(deviceId, channel);
    }
  }

  private fail(deviceId: string, message: string): void {
    this.failures.update((failures) => ({ ...failures, [deviceId]: message }));
  }
}
