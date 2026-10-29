import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { TallyState } from '@studioflow/scene-model';

/**
 * The on-air capsule next to a name: a filled red “Live” while the source is in the program, a green “Preview” while
 * the control room has it ready to go live next, nothing otherwise. The same words and shapes as the Regie's tags.
 */
@Component({
  selector: 'sf-tally-tag',
  template: `
    @switch (state()) {
      @case ('program') {
        <span class="c-tag c-tag--pgm" [attr.data-testid]="testId()">{{
          t('sender.station.tally.live')
        }}</span>
      }
      @case ('preview') {
        <span
          class="c-tag c-tag--pvw"
          [attr.data-testid]="testId()"
          [title]="t('sender.station.tally.previewHint')"
          >{{ t('sender.station.tally.preview') }}</span
        >
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TallyTagComponent {
  readonly state = input.required<TallyState>();
  /** `data-testid` of the capsule (the station's own capsule is `tally-tag`). */
  readonly testId = input<string | null>(null);

  protected readonly t = t;
}
