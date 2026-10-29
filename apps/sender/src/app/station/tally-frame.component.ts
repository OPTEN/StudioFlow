import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { TallyState } from '@studioflow/scene-model';

/**
 * Tally around the whole viewport (plan “Tally on the device”): a red frame while the device is live (in the program),
 * a green frame while it is in the preview, nothing otherwise. The words (“Live”, “Preview”) sit in the status bar of
 * each station; screen readers hear every change once. The first state after loading is announced only when the
 * device is live or in the preview, so a station that opens off air does not say “Not live”.
 */
@Component({
  selector: 'sf-tally-frame',
  templateUrl: './tally-frame.component.html',
  styleUrl: './tally-frame.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TallyFrameComponent {
  readonly state = input.required<TallyState>();
  /** Thin frame (the phone's screen is off). */
  readonly thin = input(false);
  /** Narrower frame for the laptop and the audio station. */
  readonly compact = input(false);

  /** Announced text (aria-live): every change, and the first state only when it is not off. */
  protected readonly spoken = linkedSignal<TallyState, string>({
    source: this.state,
    computation: (state, previous) => {
      if (previous === undefined && state === 'off') {
        return '';
      }
      return TallyFrameComponent.words(state);
    },
  });

  private static words(state: TallyState): string {
    switch (state) {
      case 'program':
        return t('sender.station.tally.spokenProgram');
      case 'preview':
        return t('sender.station.tally.spokenPreview');
      default:
        return t('sender.station.tally.spokenOff');
    }
  }
}
