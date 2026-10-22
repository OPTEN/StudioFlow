import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TallyState } from '@flowstudio/scene-model';

/**
 * Tally around the whole viewport (plan «Tally auf dem Gerät»): red frame and «LIVE» while in the program, green
 * frame and «Als Nächstes» while in the preview, nothing otherwise. Screen readers get the state as text.
 */
@Component({
  selector: 'fs-tally-frame',
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
        return 'Als Nächstes';
      default:
        return null;
    }
  });

  /** Announced text (aria-live). */
  protected readonly spoken = computed(() => {
    switch (this.state()) {
      case 'program':
        return 'Live: Dieses Gerät ist jetzt im Program.';
      case 'preview':
        return 'Als Nächstes: Dieses Gerät ist in der Preview.';
      default:
        return 'Nicht auf Sendung.';
    }
  });
}
