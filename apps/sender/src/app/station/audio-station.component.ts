import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService } from './device-session.service';
import { MicPanelComponent } from './mic-panel.component';

/**
 * The audio station (issue #7): a laptop at the mixing desk that sends the desk's feed as the one audio source of the
 * production. No picture, no screen: the microphone panel with the input, the level and the “Mic live” tag. The page
 * starts the sound by itself, so a restart of the browser brings the desk back without anyone pressing a button.
 */
@Component({
  selector: 'sf-audio-station',
  imports: [BrandMarkComponent, ConnectionStatusComponent, MicPanelComponent],
  templateUrl: './audio-station.component.html',
  styleUrl: './audio-station.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioStationComponent {
  protected readonly session = inject(DeviceSessionService);

  /** “Technik-Check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly self = this.session.self;
  protected readonly techLevel = computed(() => this.session.techCheck()?.overall ?? 'unknown');
}
