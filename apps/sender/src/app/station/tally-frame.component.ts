import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { TallyState } from '@studioflow/scene-model';

/**
 * Tally around the whole viewport (plan “Tally on the device”): red frame and “LIVE” while in the program, green
 * frame and “Up next” while in the preview, nothing otherwise. Screen readers get the state as text.
 */
@Component({
  selector: 'sf-tally-frame',
  templateUrl: './tally-frame.component.html',
  styleUrl: './tally-frame.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TallyFrameComponent {
  readonly state = input.required<TallyState>();
  /** Thin frame without badge text size (dark mode). */
  readonly thin = input(false);
  /** Narrower frame for the laptop page. */
  readonly compact = input(false);

  protected readonly label = computed(() => {
    switch (this.state()) {
      case 'program':
        return 'LIVE';
      case 'preview':
        return t('sender.station.tally.preview');
      default:
        return null;
    }
  });

  /** Announced text (aria-live). */
  protected readonly spoken = computed(() => {
    switch (this.state()) {
      case 'program':
        return t('sender.station.tally.spokenProgram');
      case 'preview':
        return t('sender.station.tally.spokenPreview');
      default:
        return t('sender.station.tally.spokenOff');
    }
  });
}
