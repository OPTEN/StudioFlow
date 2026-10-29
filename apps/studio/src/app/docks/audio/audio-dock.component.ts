import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { StudioAudioService } from '../../core/audio/studio-audio.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { LiveAnnouncerService } from '../../core/ui/live-announcer.service';
import { PopoverService, PopoverTriggerDirective } from '../../core/ui/popover.directive';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { AudioCommandsService } from './audio-commands.service';
import {
  AUDIO_MONITOR_POPOVER,
  AudioMonitorPopoverComponent,
} from './audio-monitor-popover.component';
import { AudioRowComponent } from './audio-row.component';
import { audioRowViews } from './audio-rows';

/**
 * The Audio dock (spec 9.1, issue #7): the global mixer of the production. One row per channel – the audio station and
 * microphones, screens that share sound, videos with sound – with meter, fader, mute, mode, sync offset and Listen;
 * undo and redo of the mixer changes; the "Headphones" button, which says what this browser plays ("Headphones:
 * Program", "Headphones: A1") and opens the headphones popover (off, program, output device).
 *
 * The M key mutes the selected channel; Ctrl+Z and Ctrl+Shift+Z act on the mixer while the focus is inside the dock and
 * on the scene being edited otherwise. A channel that is audible but silent for 10 seconds shows an amber state word
 * and is announced once (a warning, not an incident).
 */
@Component({
  selector: 'sf-audio-dock',
  imports: [
    DockFrameComponent,
    IconComponent,
    AudioRowComponent,
    AudioMonitorPopoverComponent,
    PopoverTriggerDirective,
  ],
  templateUrl: './audio-dock.component.html',
  styleUrl: './audio-dock.component.scss',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioDockComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(AudioCommandsService);
  protected readonly audio = inject(StudioAudioService);
  protected readonly popovers = inject(PopoverService);
  private readonly keyboard = inject(KeyboardService);
  private readonly announcer = inject(LiveAnnouncerService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly t = t;
  protected readonly monitorPopover = AUDIO_MONITOR_POPOVER;
  protected readonly loading = computed(() => this.store.state() === null);
  protected readonly rows = computed(() => {
    const state = this.store.state();
    return state ? audioRowViews(state, this.commands.channels(), this.audio.sounding()) : [];
  });
  protected readonly monitoring = computed(() => this.audio.monitor().kind !== 'off');
  /** "Headphones", "Headphones: Program" or "Headphones: A1" (the channel listened to). */
  protected readonly headphonesLabel = computed(() => {
    const monitor = this.audio.monitor();
    switch (monitor.kind) {
      case 'off':
        return t('regie.audio.dock.headphones');
      case 'program':
        return t('regie.audio.dock.headphonesOn', { what: t('regie.audio.monitor.program') });
      case 'channel':
        return t('regie.audio.dock.headphonesOn', {
          what: this.store.sourceById(monitor.sourceId)?.code ?? '…',
        });
    }
  });

  constructor() {
    const offMute = this.keyboard.register('mute', () => this.commands.toggleSelectedMute());
    const offUndo = this.keyboard.register('undo', () => this.insideDock() && this.commands.undo());
    const offRedo = this.keyboard.register('redo', () => this.insideDock() && this.commands.redo());
    inject(DestroyRef).onDestroy(() => {
      offMute();
      offUndo();
      offRedo();
    });
    this.announceSilence();
  }

  /** True while the focus is inside this dock: undo and redo then belong to the mixer. */
  private insideDock(): boolean {
    const active = this.document.activeElement;
    const dock = this.host.closest('[data-dock="audio"]') ?? this.host;
    return active !== null && dock.contains(active);
  }

  /** A channel that starts to be silent is announced once. */
  private announceSilence(): void {
    let known: ReadonlySet<string> = new Set();
    effect(() => {
      const silent = this.audio.silent();
      untracked(() => {
        for (const sourceId of silent) {
          if (!known.has(sourceId)) {
            const source = this.store.sourceById(sourceId);
            this.announcer.announce(
              `${source?.code ?? ''} ${source?.label ?? ''} ${t('regie.audio.state.silent')}`.trim(),
            );
          }
        }
        known = silent;
      });
    });
  }
}
