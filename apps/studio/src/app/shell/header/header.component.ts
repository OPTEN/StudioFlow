import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { t } from '@studioflow/i18n';
import { audioExpected, formatClock, formatPercent } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { KeyboardService } from '../../core/ui/keyboard.service';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { BroadcastControlComponent } from './broadcast-control.component';
import { LAYOUT_POPOVER, LayoutPopoverComponent } from './layout-popover.component';
import { outputLoad } from './output-load';
import { OUTPUT_POPOVER, OutputPopoverComponent, linkStateText } from './output-popover.component';
import { ProductionMenuComponent } from './production-menu.component';
import { ShortcutsSheetComponent } from './shortcuts-sheet.component';

/** Id of the presence popover. */
export const PRESENCE_POPOVER = 'presence';

/** What the output capsule says next to "Output": one word for its state, or the latency while all is well. */
export interface OutputChipState {
  readonly text: string;
  /** Amber: attention, but the output still works (no picture, frames dropped, sound blocked). */
  readonly warn: boolean;
  /** Which warning it is, for the test hooks (`.c-header__out-warn`, `data-testid="audio-blocked"`). */
  readonly kind: 'latency' | 'connected' | 'none' | 'stale' | 'dropping' | 'audio';
}

/**
 * The toolbar of the Regie (spec 4, DESIGN.md "Toolbar"), three columns on a 52 px bar: on the left the mark and the
 * production switcher; in the centre the broadcast capsule (state word, runtime, the one action); on the right the
 * output capsule (lamp, "Output", latency or a warning word; opens the output popover), "Layout" (show and hide docks,
 * reset, keyboard shortcuts), the gear that leads to the settings window, the presence button with its count and the
 * clock. Owns the keyboard shortcuts sheet (also on the ? key).
 */
@Component({
  selector: 'sf-header',
  imports: [
    BroadcastControlComponent,
    IconComponent,
    LayoutPopoverComponent,
    OutputPopoverComponent,
    PopoverDirective,
    PopoverTriggerDirective,
    ProductionMenuComponent,
    RouterLink,
    ShortcutsSheetComponent,
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly clock = inject(ClockService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly layoutTrigger = viewChild<ElementRef<HTMLButtonElement>>('layoutTrigger');

  protected readonly outputPopover = OUTPUT_POPOVER;
  protected readonly layoutPopover = LAYOUT_POPOVER;
  protected readonly presencePopover = PRESENCE_POPOVER;
  protected readonly t = t;

  /** The keyboard shortcuts sheet is open. */
  protected readonly shortcutsOpen = signal(false);
  /** Where the focus goes back to when the sheet closes. */
  private shortcutsReturn: HTMLElement | null = null;

  /** Toolbar clock "HH:MM:SS" (local time). */
  protected readonly clockText = computed(() => formatClock(new Date(this.clock.now())));

  /** What the connected output pages report about their computer (dropped frames, software decoding). */
  protected readonly load = computed(() => outputLoad(this.store.outputStatus()));

  /** Lamp of the output capsule: green connected, amber stale or dropping frames, muted none. */
  protected readonly outputLamp = computed(() => {
    switch (this.store.outputStatus()?.state) {
      case 'connected':
        return this.load().dropping || this.audioBlocked() ? 'is-warn' : '';
      case 'stale':
        return 'is-warn';
      default:
        return 'is-idle';
    }
  });
  /**
   * A connected output page cannot play sound (the browser waits for a click) while the mixer expects sound: the capsule
   * says "Audio blocked" (issue #7). Nothing is blocked when no channel could be heard.
   */
  protected readonly audioBlocked = computed(() => {
    const state = this.store.state();
    if (!state || !audioExpected(state)) {
      return false;
    }
    return (this.store.outputStatus()?.links ?? []).some(
      (link) => link.state === 'connected' && link.audio?.state === 'blocked',
    );
  });
  /**
   * The one word after "Output", in a slot of fixed width so the capsule does not jump: a warning when there is one
   * (sound blocked before dropped frames, since a silent webinar is worse than a stutter), else the latency, else the
   * state ("Not connected", "No picture").
   */
  protected readonly outputState = computed<OutputChipState>(() => {
    const status = this.store.outputStatus();
    switch (status?.state) {
      case 'connected': {
        if (this.audioBlocked()) {
          return { text: t('regie.header.outputChip.audioBlocked'), warn: true, kind: 'audio' };
        }
        if (this.load().dropping) {
          return { text: t('regie.header.outputChip.dropping'), warn: true, kind: 'dropping' };
        }
        const latency = status.latencyMs;
        return latency === null || latency === undefined
          ? { text: t('regie.header.outputChip.connected'), warn: false, kind: 'connected' }
          : { text: `${Math.round(latency)} ms`, warn: false, kind: 'latency' };
      }
      case 'stale':
        return { text: t('regie.header.outputChip.stale'), warn: true, kind: 'stale' };
      default:
        return { text: t('regie.header.outputChip.none'), warn: false, kind: 'none' };
    }
  });
  /** Tooltip of the capsule: every link with its state ("Proxy · connected"), why it warns and why the audio is blocked. */
  protected readonly outputTitle = computed(() => {
    const links = this.store.outputStatus()?.links ?? [];
    const lines = links.map((link) =>
      t('regie.output.link.line', { name: link.name, state: linkStateText(link.state) }),
    );
    const { dropping, droppedPct } = this.load();
    if (dropping && droppedPct !== null) {
      lines.push(t('regie.load.output.droppingHint', { percent: formatPercent(droppedPct) }));
    }
    if (this.audioBlocked()) {
      lines.push(t('regie.audio.output.blockedHint'));
    }
    return lines.length > 0 ? lines.join('\n') : null;
  });

  protected readonly operators = computed(() => Math.max(1, this.store.operatorsOnline()));
  protected readonly presenceText = computed(() =>
    t('regie.header.presence.long', { count: this.operators() }),
  );

  constructor() {
    const unregister = inject(KeyboardService).register('help', () => {
      this.openShortcuts(this.document.activeElement as HTMLElement | null);
      return true;
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  /** Opens the keyboard shortcuts sheet; the focus returns to `from` (or to the Layout button) when it closes. */
  protected openShortcuts(from: HTMLElement | null = null): void {
    this.popovers.closeAll();
    this.shortcutsReturn =
      from && from !== this.document.body ? from : (this.layoutTrigger()?.nativeElement ?? null);
    this.shortcutsOpen.set(true);
  }

  protected closeShortcuts(): void {
    this.shortcutsOpen.set(false);
    const target = this.shortcutsReturn;
    this.shortcutsReturn = null;
    afterNextRender(
      () => {
        if (target?.isConnected) {
          target.focus();
        }
      },
      { injector: this.injector },
    );
  }
}
