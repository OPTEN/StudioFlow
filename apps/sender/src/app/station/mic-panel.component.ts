import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { IconComponent } from '../shared/icon.component';
import { DeviceSessionService } from './device-session.service';
import { InputLevelComponent } from './input-level.component';

const BUSY = new Set(['starting', 'live', 'paused']);

/**
 * The microphone of this device: the audio input, on/off, the level and the “Mic live” tag. The audio station shows it
 * as its only content (the sound of the mixing desk, stereo and untouched); a phone or laptop offers it as an extra
 * source that is off until the person switches it on (decision #7: microphones exist but are muted in the mixer).
 */
@Component({
  selector: 'sf-mic-panel',
  imports: [IconComponent, InputLevelComponent],
  templateUrl: './mic-panel.component.html',
  styleUrl: './mic-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicPanelComponent {
  protected readonly session = inject(DeviceSessionService);

  protected readonly t = t;
  protected readonly slot = this.session.mic;
  protected readonly station = computed(() => this.session.kind() === 'audioStation');
  protected readonly running = computed(() => BUSY.has(this.slot()?.state ?? 'idle'));
  protected readonly stream = computed(() => (this.running() ? this.session.micStream() : null));
  protected readonly silent = signal(false);
  protected readonly selected = computed(() => {
    const wanted = this.session.settings().micInput;
    return wanted !== null && this.session.micInputs().some((input) => input.id === wanted)
      ? wanted
      : '';
  });
  protected readonly inputs = computed(() =>
    this.session.micInputs().map((input, index) => ({
      id: input.id,
      label:
        input.label === '' ? t('sender.audio.input.unnamed', { number: index + 1 }) : input.label,
    })),
  );
  protected readonly stateText = computed(() => {
    switch (this.slot()?.state ?? 'idle') {
      case 'starting':
        return t('sender.audio.state.starting');
      case 'live':
        return t('sender.audio.state.live');
      case 'paused':
        return t('sender.audio.state.paused');
      case 'ended':
        return t('sender.audio.state.ended');
      case 'failed':
        return t('sender.audio.state.failed');
      default:
        return t('sender.audio.state.idle');
    }
  });

  constructor() {
    void this.session.refreshMicInputs();
  }

  protected toggle(): void {
    if (this.running()) {
      this.session.stopMic();
    } else {
      void this.session.startMic();
    }
  }

  protected choose(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.session.setMicInput(value === '' ? null : value);
  }

  protected refresh(): void {
    void this.session.refreshMicInputs();
  }
}
