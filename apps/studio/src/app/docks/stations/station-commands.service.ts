import { Injectable, inject } from '@angular/core';
import { LIMITS, type DeviceDto, type IncidentDto, type SourceDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { IncidentAckService } from '../../core/state/incident-ack.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';

/** Quick picks of the Regie-Chat. */
export const QUICK_MESSAGES: readonly string[] = ['In 10 s live', 'Bitte lächeln', 'Pause'];

/**
 * The station commands of the Stationen dock (spec 4.6): ask for a reshare, switch the camera, send a Regie-Chat
 * message, rename, block / unblock, remove, and acknowledge recovered incidents («Gesehen»). Each command has its own
 * lock per device ({@link busy}), goes through {@link DockCommandService} (offline guard, German error toasts) and
 * confirms with a toast. Commands to a disconnected device are accepted by the server and dropped; the toast says so.
 */
@Injectable({ providedIn: 'root' })
export class StationCommandsService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly commands = inject(DockCommandService);
  private readonly toasts = inject(ToastService);
  private readonly acks = inject(IncidentAckService);

  /** True while the command `kind` for the device runs (e.g. `block`, `message`, `reshare:screen-1`). */
  busy(deviceId: string, kind: string): boolean {
    return this.commands.busy(`device:${deviceId}:${kind}`);
  }

  /** True when the button of the command is disabled: it runs, or the Regie is offline. */
  blocked(deviceId: string, kind: string): boolean {
    return this.commands.blocked(`device:${deviceId}:${kind}`);
  }

  /** «Neu teilen lassen»: asks the laptop to share the screen of `source` again. */
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
          ? `${source.label} ist nicht verbunden. Bitte direkt am Gerät neu teilen.`
          : `Bitte an ${source.label} geschickt: «Bildschirm erneut teilen»`,
      );
    }
    return sent;
  }

  /** «Kamera wechseln» (front/back) on a phone. */
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
          ? `${device.name} ist nicht verbunden. Die Kamera bleibt, wie sie ist.`
          : `${this.label(device)}: Kamera wird gewechselt`,
      );
    }
    return sent;
  }

  /** Regie-Chat: a short message (1–140 characters) that the device shows as a banner. */
  async sendMessage(device: DeviceDto, text: string): Promise<boolean> {
    const message = text.trim();
    if (!message || message.length > LIMITS.messageLength) {
      this.toasts.show(`Eine Nachricht hat 1 bis ${LIMITS.messageLength} Zeichen.`);
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
          ? `${device.name} ist nicht verbunden. Die Nachricht kommt nicht an.`
          : `Nachricht an ${device.name} geschickt: «${message}»`,
      );
    }
    return sent;
  }

  /** Renames the station (1–60 characters). */
  async rename(device: DeviceDto, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > LIMITS.deviceNameLength) {
      this.toasts.show(`Der Name braucht 1 bis ${LIMITS.deviceNameLength} Zeichen.`);
      return false;
    }
    return this.run(device, 'rename', (productionId) =>
      this.api.renameDevice(productionId, device.id, { name: trimmed }),
    );
  }

  /** «Gerät sperren»: disconnects the device at once; it cannot reconnect until unblocked. */
  async block(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'block', (productionId) =>
      this.api.blockDevice(productionId, device.id),
    );
    if (done) {
      this.toasts.show(`${this.label(device)} gesperrt und getrennt`);
    }
    return done;
  }

  /** «Entsperren»: the device may connect again. */
  async unblock(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'unblock', (productionId) =>
      this.api.unblockDevice(productionId, device.id),
    );
    if (done) {
      this.toasts.show(`${this.label(device)} entsperrt`);
    }
    return done;
  }

  /** «Entfernen»: deletes the device and its sources (items show «Quelle fehlt»). */
  async remove(device: DeviceDto): Promise<boolean> {
    const done = await this.run(device, 'remove', async (productionId) => {
      await this.api.deleteDevice(productionId, device.id);
      return true;
    });
    if (done) {
      this.toasts.show(`«${device.name}» entfernt`);
    }
    return done;
  }

  /**
   * «Gesehen»: acknowledges the recovered incidents of the station (shared by every Regie session). Incidents that are
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

  /** «K2» or «S1 S2» for toasts; the name for devices without slots. */
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
