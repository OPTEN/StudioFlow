import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { StudioAudioService } from '../../core/audio/studio-audio.service';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';

/** Id of the monitoring popover of the Audio dock. */
export const AUDIO_MONITOR_POPOVER = 'audio-monitor';

/** One output device of the browser. */
interface OutputDevice {
  readonly id: string;
  readonly label: string;
}

/** The default output as `enumerateDevices` names it. */
const DEFAULT_DEVICE = 'default';

/**
 * What the operator listens to (spec 9.1, issue #7): nothing (the default after every reload), the program mix, or one
 * channel before its fader and mute (PFL, started with the PFL button of a row). There is no preview mix in Studio Mode;
 * PFL is the way to check a source before it goes on air. In Chromium the monitor can go to another output device
 * (headphones) with `AudioContext.setSinkId`; other browsers play it on the default output.
 */
@Component({
  selector: 'sf-audio-monitor-popover',
  imports: [PopoverDirective],
  template: `
    <div
      class="c-pop c-audio-pop"
      role="dialog"
      [attr.aria-label]="t('regie.audio.monitor.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h">{{ t('regie.audio.monitor.title') }}</div>
      <div
        class="c-seg c-audio-pop__seg"
        role="group"
        [attr.aria-label]="t('regie.audio.monitor.title')"
      >
        <button
          type="button"
          data-testid="monitor-off"
          [attr.aria-pressed]="audio.monitor().kind === 'off'"
          (click)="audio.setMonitor({ kind: 'off' })"
        >
          {{ t('regie.audio.monitor.off') }}
        </button>
        <button
          type="button"
          data-testid="monitor-program"
          [attr.aria-pressed]="audio.monitor().kind === 'program'"
          (click)="audio.setMonitor({ kind: 'program' })"
        >
          {{ t('regie.audio.monitor.program') }}
        </button>
      </div>
      @if (channelName(); as name) {
        <div class="c-pop-note" data-testid="monitor-channel">
          {{ t('regie.audio.monitor.channel', { name }) }}
        </div>
      }
      <div class="c-menu-sep"></div>
      @if (audio.canChooseOutputDevice) {
        <label class="c-label" for="sf-audio-device">{{ t('regie.audio.monitor.device') }}</label>
        <select
          class="c-select c-audio-pop__select"
          id="sf-audio-device"
          data-testid="monitor-device"
          (change)="chooseDevice($event)"
        >
          <option value="default" [selected]="device() === 'default'">
            {{ t('regie.audio.monitor.deviceDefault') }}
          </option>
          @for (entry of devices(); track entry.id) {
            <option [value]="entry.id" [selected]="device() === entry.id">{{ entry.label }}</option>
          }
        </select>
      } @else {
        <div class="c-pop-note">{{ t('regie.audio.monitor.deviceUnsupported') }}</div>
      }
      <div class="c-pop-note">{{ t('regie.audio.monitor.hint') }}</div>
    </div>
  `,
  styles: `
    .c-audio-pop {
      width: 300px;
    }

    .c-audio-pop__seg {
      margin: 4px 12px 8px;
      display: grid;
    }

    .c-audio-pop__select {
      margin: 4px 12px 8px;
      width: calc(100% - 24px);
    }

    .c-label {
      display: block;
      margin: 6px 12px 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioMonitorPopoverComponent {
  protected readonly audio = inject(StudioAudioService);
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);

  protected readonly popoverId = AUDIO_MONITOR_POPOVER;
  protected readonly t = t;
  protected readonly devices = signal<readonly OutputDevice[]>([]);
  protected readonly device = signal(DEFAULT_DEVICE);

  constructor() {
    void this.loadDevices();
  }

  /** Name of the channel in PFL, or null. */
  protected channelName(): string | null {
    const monitor = this.audio.monitor();
    if (monitor.kind !== 'channel') {
      return null;
    }
    const source = this.store.sourceById(monitor.sourceId);
    return source ? `${source.code} ${source.label}` : monitor.sourceId;
  }

  protected async chooseDevice(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    if (await this.audio.setOutputDevice(id)) {
      this.device.set(id);
    } else {
      this.toasts.show(t('regie.audio.monitor.deviceFailed'));
    }
  }

  private async loadDevices(): Promise<void> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      let number = 0;
      this.devices.set(
        all
          .filter((entry) => entry.kind === 'audiooutput' && entry.deviceId !== DEFAULT_DEVICE)
          .map((entry) => {
            number += 1;
            return {
              id: entry.deviceId,
              label: entry.label || t('regie.audio.monitor.deviceNamed', { number }),
            };
          }),
      );
    } catch {
      this.devices.set([]);
    }
  }
}
