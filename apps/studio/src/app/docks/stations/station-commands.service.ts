import { Injectable, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS, type DeviceDto, type IncidentDto, type SourceDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { IncidentAckService } from '../../core/state/incident-ack.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';

/** Quick picks of the control room chat; the text is looked up when it is shown or sent. */
export const QUICK_MESSAGE_KEYS = [
  'regie.stations.quick.live',
  'regie.stations.quick.smile',
  'regie.stations.quick.break',
] as const;

/**
 * The device commands of the Devices dock (spec 4.6): ask for a reshare, switch the camera, send a control room
 * chat message, rename, block / unblock, remove, and acknowledge recovered incidents ("Dismiss"). Each command has its
 * own lock per device ({@link busy}), goes through {@link DockCommandService} (offline guard, error toasts in the
 * active language) and confirms with a toast. Commands to a disconnected device are accepted by the server and
 * dropped; the toast says so. Unsent messages are kept per device ({@link draft}), so closing a row loses nothing.
 */
@Injectable({ providedIn: 'root' })
export class StationCommandsService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly commands = inject(DockCommandService);
  private readonly toasts = inject(ToastService);
  private readonly acks = inject(IncidentAckService);
  /** Unsent message per device id (kept while the Regie is open). */
  private readonly drafts = new Map<string, string>();

  /** The unsent message of a device, or ''. */
  draft(deviceId: string): string {
    return this.drafts.get(deviceId) ?? '';
  }

  /** Keeps the unsent message of a device (an empty text forgets it). */
  keepDraft(deviceId: string, text: string): void {
    if (text) {
      this.drafts.set(deviceId, text);
    } else {
      this.drafts.delete(deviceId);
    }
  }

  /** True while the command `kind` for the device runs (e.g. `block`, `message`, `reshare:screen-1`). */
  busy(deviceId: string, kind: string): boolean {
    return this.commands.busy(`device:${deviceId}:${kind}`);
  }

  /** True when the button of the command is disabled: it runs, or the Regie is offline. */
  blocked(deviceId: string, kind: string): boolean {
    return this.commands.blocked(`device:${deviceId}:${kind}`);
  }

  /** "Ask to share again": asks the laptop to share the screen of `source` again. */
  async reshare(device: DeviceDto, source: SourceDto): Promise<boolean> {
    const slot = source.slot;
    if (!slot) {
      return false;
    }
    const sent = await this.run(device, `reshare:${slot}`, (productionId) =>
      this.api.sendDeviceCommand(productionId, device.id, { kind: 'reshare', slot, text: null }),
    );
    if (sent) {
      this.toasts.show(
        this.isOffline(device)
          ? t('regie.stations.toast.reshareOffline', { label: source.label })
          : t('regie.stations.toast.reshareSent', { label: source.label }),
      );
    }
    return sent;
  }

  /** "Switch camera" (front/back) on a phone. */
  async switchCamera(device: DeviceDto): Promise<boolean> {
    const sent = await this.run(device, 'camera', (productionId) =>
      this.api.sendDeviceCommand(productionId, device.id, {
        kind: 'switchCamera',
        slot: 'camera',
        text: null,
      }),
    );
    if (sent) {
      this.toasts.show(
        this.isOffline(device)
          ? t('regie.stations.toast.cameraOffline', { name: device.name })
          : t('regie.stations.toast.cameraSwitching', { label: this.label(device) }),
      );
    }
    return sent;
  }

  /** Control room chat: a short message (1–140 characters) that the device shows as a banner. */
  async sendMessage(device: DeviceDto, text: string): Promise<boolean> {
    const message = text.trim();
    if (!message || message.length > LIMITS.messageLength) {
      this.toasts.show(t('regie.stations.toast.messageLength', { max: LIMITS.messageLength }));
      return false;
    }
    const sent = await this.run(device, 'message', (productionId) =>
      this.api.sendDeviceCommand(productionId, device.id, {
        kind: 'message',
        slot: null,
        text: message,
      }),
    );
    if (sent) {
      this.toasts.show(
        this.isOffline(device)
          ? t('regie.stations.toast.messageOffline', { name: device.name })
          : t('regie.stations.toast.messageSent', { name: device.name, message }),
      );
    }
    return sent;
  }

  /** Renames the station (1–60 characters). */
  async rename(device: DeviceDto, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > LIMITS.deviceNameLength) {
      this.toasts.show(t('regie.stations.toast.nameLength', { max: LIMITS.deviceNameLength }));
      return false;
    }
    return this.run(device, 'rename', (productionId) =>
      this.api.renameDevice(productionId, device.id, { name: trimmed }),
    );
  }

  /** "Block device": disconnects the device at once; it cannot reconnect until unblocked. */
  async block(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'block', (productionId) =>
      this.api.blockDevice(productionId, device.id),
    );
    if (done) {
      this.toasts.show(t('regie.stations.toast.blocked', { label: this.label(device) }));
    }
    return done;
  }

  /** "Unblock": the device may connect again. */
  async unblock(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'unblock', (productionId) =>
      this.api.unblockDevice(productionId, device.id),
    );
    if (done) {
      this.toasts.show(t('regie.stations.toast.unblocked', { label: this.label(device) }));
    }
    return done;
  }

  /** "Remove": deletes the device and its sources (items show "Source missing"). */
  async remove(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'remove', async (productionId) => {
      await this.api.deleteDevice(productionId, device.id);
      return true;
    });
    if (done) {
      this.toasts.show(t('regie.stations.toast.removed', { name: device.name }));
    }
    return done;
  }

  /**
   * "Dismiss": acknowledges the recovered incidents of the station (shared by every Regie session). Incidents that are
   * open again are left alone (see {@link IncidentAckService}).
   */
  async acknowledge(device: DeviceDto, incidents: readonly IncidentDto[]): Promise<boolean> {
    const recovered = incidents.filter((incident) => this.acks.canAcknowledge(incident.id));
    if (recovered.length === 0) {
      return false;
    }
    return this.run(device, 'ack', (productionId) =>
      this.acks.acknowledge(
        productionId,
        recovered.map((incident) => incident.id),
      ),
    );
  }

  /** "K2" or "S1 S2" for toasts; the name for devices without slots. */
  label(device: DeviceDto): string {
    const codes = this.store.deviceSources(device.id).map((source) => source.code);
    return codes.length > 0 ? codes.join(' ') : device.name;
  }

  private isOffline(device: DeviceDto): boolean {
    return this.store.deviceById(device.id)?.connection === 'offline';
  }

  private async run(
    device: DeviceDto,
    kind: string,
    action: (productionId: string) => Promise<unknown>,
  ): Promise<boolean> {
    const result = await this.commands.run(`device:${device.id}:${kind}`, async (productionId) => {
      await action(productionId);
      return true;
    });
    return result === true;
  }
}
