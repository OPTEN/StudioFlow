import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { StudioAudioService } from '../../core/audio/studio-audio.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';

/** Id of the headphones popover of the Audio dock. */
export const AUDIO_MONITOR_POPOVER = 'audio-monitor';

/** One output device of the browser. */
interface OutputDevice {
  readonly id: string;
  readonly label: string;
}

/** The default output as `enumerateDevices` names it. */
const DEFAULT_DEVICE = 'default';

/** The output device the headphones play on, kept while the Regie is open (the popover shows the real choice). */
@Injectable({ providedIn: 'root' })
export class MonitorOutputService {
  readonly device = signal(DEFAULT_DEVICE);
}

/**
 * What the operator hears in this browser (spec 9.1, issue #7): nothing (the default after every reload), the program
 * mix, or one channel before its fader and mute ("Listen" in a row; shown here with a "Stop listening" button). There is
 * no preview mix in Studio Mode; Listen is the way to check a source before it goes on air. In Chromium the headphones
 * can play on another output device with `AudioContext.setSinkId`; other browsers play on the default output. The
 * warning about speakers is shown while nothing plays yet, as a hint for the next choice.
 */
@Component({
  selector: 'sf-audio-monitor-popover',
  imports: [IconComponent, PopoverDirective],
  template: `
    <div
      class="c-pop c-audio-pop"
      role="dialog"
      [attr.aria-label]="t('regie.audio.monitor.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h c-audio-pop__title">{{ t('regie.audio.monitor.title') }}</div>
      <div
        class="c-seg c-audio-pop__seg"
        role="group"
        [attr.aria-label]="t('regie.audio.monitor.choice')"
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
        <div class="c-audio-pop__channel">
          <svg sfIcon="headphones" [size]="14"></svg>
          <span class="c-audio-pop__channel-name" data-testid="monitor-channel">{{
            t('regie.audio.monitor.channel', { name })
          }}</span>
          <button
            class="c-btn c-btn--sm c-btn--plain"
            type="button"
            (click)="audio.setMonitor({ kind: 'off' })"
          >
            {{ t('regie.audio.monitor.stop') }}
          </button>
        </div>
      } @else if (audio.monitor().kind === 'off') {
        <div class="c-pop-note">{{ t('regie.audio.monitor.offNote') }}</div>
      }
      <div class="c-menu-sep"></div>
      @if (audio.canChooseOutputDevice) {
        <label class="c-audio-pop__label" for="sf-audio-device">{{
          t('regie.audio.monitor.device')
        }}</label>
        <select
          class="c-select c-audio-pop__select"
          id="sf-audio-device"
          data-testid="monitor-device"
          (change)="chooseDevice($event)"
        >
          <option value="default" [selected]="output.device() === 'default'">
            {{ t('regie.audio.monitor.deviceDefault') }}
          </option>
          @for (entry of devices(); track entry.id) {
            <option [value]="entry.id" [selected]="output.device() === entry.id">
              {{ entry.label }}
            </option>
          }
        </select>
      } @else {
        <div class="c-pop-note">{{ t('regie.audio.monitor.deviceUnsupported') }}</div>
      }
      <div class="c-pop-note c-audio-pop__hint">
        <svg sfIcon="info" [size]="13"></svg>{{ t('regie.audio.monitor.hint') }}
      </div>
    </div>
  `,
  styles: `
    .c-audio-pop {
      width: 300px;
    }

    .c-audio-pop__title {
      color: var(--text);
      font-size: var(--fs-body);
    }

    .c-audio-pop__seg {
      display: grid;
      margin: 4px 10px 8px;
    }

    .c-audio-pop__channel {
      align-items: center;
      color: var(--text-2);
      display: flex;
      font-size: var(--fs-footnote);
      gap: 6px;
      padding: 0 6px 6px 10px;

      .c-icon {
        color: var(--blue);
      }
    }

    .c-audio-pop__channel-name {
      flex: 1 1 auto;
      min-width: 0;
    }

    .c-audio-pop__label {
      color: var(--text-2);
      display: block;
      font-size: var(--fs-footnote);
      font-weight: 500;
      margin: 6px 10px 0;
    }

    .c-audio-pop__select {
      margin: 4px 10px 8px;
      width: calc(100% - 20px);
    }

    .c-audio-pop__hint {
      align-items: flex-start;
      display: flex;
      gap: 6px;

      .c-icon {
        flex: none;
        margin-top: 1px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioMonitorPopoverComponent {
  protected readonly audio = inject(StudioAudioService);
  protected readonly output = inject(MonitorOutputService);
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);

  protected readonly popoverId = AUDIO_MONITOR_POPOVER;
  protected readonly t = t;
  protected readonly devices = signal<readonly OutputDevice[]>([]);

  constructor() {
    void this.loadDevices();
  }

  /** Name of the channel listened to, or null. */
  protected channelName(): string | null {
    const monitor = this.audio.monitor();
    if (monitor.kind !== 'channel') {
      return null;
    }
    const source = this.store.sourceById(monitor.sourceId);
    return source ? `${source.code} ${source.label}` : monitor.sourceId;
  }

  protected async chooseDevice(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    if (await this.audio.setOutputDevice(id)) {
      this.output.device.set(id);
    } else {
      select.value = this.output.device();
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
