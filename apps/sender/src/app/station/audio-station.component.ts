import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { MicPanelComponent } from './mic-panel.component';
import { TallyTagComponent } from './tally-tag.component';

/**
 * The audio station (issue #7): a laptop at the mixing desk that sends the desk's feed as the one audio source of the
 * production. No picture, no screen: a calm page with one card (the state, a scaled level meter, the input and
 * start/stop) and the “Live” capsule in the header while the control room lets the sound through. The page starts the
 * sound by itself, so a restart of the browser brings the desk back without anyone pressing a button.
 */
@Component({
  selector: 'sf-audio-station',
  imports: [BrandMarkComponent, ConnectionStatusComponent, MicPanelComponent, TallyTagComponent],
  templateUrl: './audio-station.component.html',
  styleUrl: './audio-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioStationComponent {
  protected readonly session = inject(DeviceSessionService);

  /** “Tech check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly self = this.session.self;
  protected readonly techLevel = computed(() => this.session.techCheck()?.overall ?? 'unknown');
  /** The audio station is live while the control room lets its sound through. */
  protected readonly tally = computed(() => this.session.tally().slots['mic'] ?? 'off');
}
