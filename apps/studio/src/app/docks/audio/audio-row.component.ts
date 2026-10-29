import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  AUDIO_LIMITS,
  faderPosition,
  faderValue,
  formatDb,
  type AudioMode,
} from '@studioflow/scene-model';
import { StudioAudioService } from '../../core/audio/studio-audio.service';
import { IconComponent } from '../../core/ui/icon.component';
import { AudioCommandsService } from './audio-commands.service';
import { meterFill, modeHint, modeLabel, rowStateWord, type AudioRowView } from './audio-rows';

/** Meter share from which a peak is close to clipping: −3 dBFS on the −60 … 0 dBFS scale (DESIGN.md). */
const HOT_FILL = 0.95;

/**
 * One channel of the Audio dock: code, name, role and mode as words ("Audio station · Always"), the state word (muted,
 * not sending, silent for 10 s), the Live capsule while it is audible on air, and the icon buttons Listen (headphones;
 * pre-fader listening in this browser) and Mute (speaker / speaker off), both toggle buttons with `aria-pressed` and a
 * constant name. Below, the level meter (a thin neutral bar) sits above the fader, whose round knob is clearly a
 * control and never a level; a notch marks 0 dB. The details behind the chevron change the mode (segmented control,
 * each mode explained) and the sync offset. A click or focus inside selects the channel (the target of the M key).
 *
 * The meter turns red only for a peak close to full scale, the one meaning that colour has for a level. The silence
 * warning is the amber state word, never an incident.
 */
@Component({
  selector: 'sf-audio-row',
  imports: [IconComponent],
  templateUrl: './audio-row.component.html',
  styleUrl: './audio-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioRowComponent {
  /** The channel and what the row says about it. */
  readonly row = input.required<AudioRowView>();
  /** The channel is audible but has had no signal for 10 seconds. */
  readonly silent = input(false);

  protected readonly commands = inject(AudioCommandsService);
  protected readonly audio = inject(StudioAudioService);
  protected readonly t = t;
  protected readonly limits = AUDIO_LIMITS;
  protected readonly modeLabel = modeLabel;
  protected readonly modeHint = modeHint;
  protected readonly open = signal(false);
  /** Fader position of 0 dB, for the notch under the track. */
  protected readonly unity = faderPosition(0);

  protected readonly selected = computed(() => this.commands.selected() === this.row().sourceId);
  protected readonly muted = computed(() => this.row().channel.muted);
  protected readonly listening = computed(() => {
    const monitor = this.audio.monitor();
    return monitor.kind === 'channel' && monitor.sourceId === this.row().sourceId;
  });
  protected readonly stateWord = computed(() => rowStateWord(this.row(), this.silent()));
  protected readonly level = computed(() => this.audio.levels().get(this.row().sourceId));
  protected readonly fill = computed(() => meterFill(this.level()));
  protected readonly hot = computed(() => this.fill() >= HOT_FILL);
  protected readonly valueText = computed(() =>
    t('regie.audio.row.faderText', { value: formatDb(this.row().channel.gainDb) }),
  );
  protected readonly detailId = computed(() => `sf-audio-detail-${this.row().sourceId}`);
  protected readonly modeLabelId = computed(() => `sf-audio-mode-${this.row().sourceId}`);
  protected readonly syncId = computed(() => `sf-audio-sync-${this.row().sourceId}`);

  protected modeHintId(mode: AudioMode): string {
    return `sf-audio-mode-${this.row().sourceId}-${mode}`;
  }
  /** A fader gesture is running (a pointer drag fires `input` many times before one `change`). */
  private gesture = false;

  protected select(): void {
    this.commands.select(this.row().sourceId);
  }

  protected onFader(event: Event): void {
    const position = Number((event.target as HTMLInputElement).value);
    const id = this.row().sourceId;
    if (!this.gesture) {
      this.gesture = true;
      this.commands.beginFader(id);
    }
    this.commands.moveFader(id, faderValue(position));
  }

  protected onFaderCommit(event: Event): void {
    const position = Number((event.target as HTMLInputElement).value);
    this.gesture = false;
    this.commands.endFader(this.row().sourceId, faderValue(position));
  }

  protected resetFader(): void {
    this.commands.resetFader(this.row().sourceId);
  }

  protected toggleMute(): void {
    this.commands.toggleMute(this.row().sourceId);
  }

  protected togglePfl(): void {
    this.audio.togglePfl(this.row().sourceId);
  }

  protected setMode(mode: AudioMode): void {
    this.commands.setMode(this.row().sourceId, mode);
  }

  protected onSync(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number.parseFloat(input.value);
    if (Number.isFinite(value)) {
      this.commands.setSyncOffset(this.row().sourceId, value);
    }
    input.value = String(this.row().channel.syncOffsetMs);
  }
}
