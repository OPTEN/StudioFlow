import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS } from '@studioflow/scene-model';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { MediaPreviewDirective } from '../shared/media-preview.directive';
import { describeCameraProblem, type CameraProblem } from './camera-problem';
import { ConnectionStatusComponent } from './connection-status.component';
import { DeviceSessionService, type StationSlot } from './device-session.service';
import { slotNumber } from './device-messages';
import { MicPanelComponent } from './mic-panel.component';
import { actionErrorText } from './slot-errors';
import { TallyTagComponent } from './tally-tag.component';

const BUSY = new Set(['starting', 'live', 'paused']);

/** A consequential action of a card that waits for its confirmation. */
interface PendingAsk {
  readonly slot: string;
  readonly action: 'stop' | 'remove';
}

/** State line of a slot, in the active language. */
export function slotStateText(slot: StationSlot): string {
  const screen = slot.kind === 'screen';
  switch (slot.state) {
    case 'starting':
      return t(
        screen ? 'sender.station.slot.startingScreen' : 'sender.station.slot.startingCamera',
      );
    case 'live':
      return t(screen ? 'sender.station.slot.liveScreen' : 'sender.station.slot.liveCamera');
    case 'paused':
      return t('sender.station.slot.paused');
    case 'ended':
      return t('sender.station.slot.ended');
    case 'failed':
      return t(screen ? 'sender.station.slot.failedScreen' : 'sender.station.slot.failedCamera');
    default:
      return t(screen ? 'sender.station.slot.idleScreen' : 'sender.station.slot.idleCamera');
  }
}

/**
 * Laptop with screens (plan “Laptop with screens”): a centred column with one card per source (thumbnail, code and
 * name, Live/Preview, state, and the primary action next to it): “Share screen”, “Stop sharing” or a large “Share
 * again” after an ended share or a request of the control room, which highlights its card. “With sound” sits next to
 * the next share action. Rare and destructive actions live in a ⋯ menu per card (“Smooth motion”, “Remove from the
 * control room…”, confirmed in the card); stopping a live source asks first. “Share another screen”, “Add camera” and
 * “Add microphone” are the secondary actions below the cards.
 */
@Component({
  selector: 'sf-laptop-station',
  imports: [
    BrandMarkComponent,
    ConnectionStatusComponent,
    IconComponent,
    MediaPreviewDirective,
    MicPanelComponent,
    NgTemplateOutlet,
    TallyTagComponent,
  ],
  templateUrl: './laptop-station.component.html',
  styleUrl: './laptop-station.component.scss',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaptopStationComponent {
  protected readonly session = inject(DeviceSessionService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** “Tech check” was pressed. */
  readonly openTechCheck = output<void>();

  protected readonly t = t;
  protected readonly canShareScreen = this.environment.canShareScreen();
  protected readonly self = this.session.self;
  protected readonly screens = this.session.screens;
  protected readonly camera = this.session.camera;
  protected readonly mic = this.session.mic;
  protected readonly tally = computed(() => this.session.tally().overall);
  protected readonly shareAudio = computed(() => this.session.settings().shareScreenAudio);
  protected readonly facing = this.session.facing;
  /** The slot whose ⋯ menu is open. */
  protected readonly menuFor = signal<string | null>(null);
  /** The card that asks for a confirmation (stop while live, remove). */
  protected readonly asking = signal<PendingAsk | null>(null);

  /** “Share another screen” is offered while there is room for one more. */
  protected readonly showAddScreen = computed(() => {
    const count = this.screens().length;
    return this.canShareScreen && count > 0 && count < LIMITS.screensPerDevice;
  });
  /** …and it is enabled once every screen is in use (a ready screen is shared first). */
  protected readonly canAddScreen = computed(
    () => this.showAddScreen() && this.screens().every((slot) => BUSY.has(slot.state)),
  );
  /**
   * Where “With sound” sits: next to the next share action, the first screen that is not shared, else the add bar.
   * Exactly one place, because the option applies to the next share.
   */
  protected readonly soundHost = computed(() => {
    if (!this.canShareScreen) {
      return null;
    }
    const ready = this.screens().find((slot) => !BUSY.has(slot.state));
    if (ready !== undefined) {
      return ready.slot;
    }
    return this.screens().length === 0 || this.canAddScreen() ? 'add' : null;
  });
  protected readonly techLevel = computed(() => this.session.techCheck()?.overall ?? 'unknown');
  /** Error of the last action in the active language. */
  protected readonly actionError = computed(() => {
    const error = this.session.actionError();
    return error === null ? null : actionErrorText(error);
  });

  protected readonly stateText = slotStateText;

  protected label(slot: StationSlot): string {
    return slot.kind === 'camera'
      ? t('sender.station.slot.camera')
      : t('sender.station.slot.screen', { number: slotNumber(slot.slot) });
  }

  protected busy(slot: StationSlot): boolean {
    return BUSY.has(slot.state);
  }

  protected preview(slot: StationSlot): MediaStream | null {
    return this.busy(slot) ? this.session.preview(slot.slot) : null;
  }

  protected cameraProblem(slot: StationSlot): CameraProblem | null {
    return slot.kind === 'camera' && slot.state === 'failed'
      ? describeCameraProblem(slot.failure, slot.messageKey, this.environment.userAgent())
      : null;
  }

  protected videoScreen(slot: StationSlot): boolean {
    return this.session.videoScreen(slot.slot);
  }

  /** “Smooth motion”: 30 instead of 15 frames per second for this screen. */
  protected toggleVideoScreen(slot: StationSlot): void {
    this.session.setVideoScreen(slot.slot, !this.session.videoScreen(slot.slot));
    this.closeMenu(true);
  }

  protected hasSound(slot: StationSlot): boolean {
    return this.session.screenHasAudio(slot.slot);
  }

  protected setShareAudio(event: Event): void {
    this.session.setShareScreenAudio((event.target as HTMLInputElement).checked);
  }

  /** Must stay synchronous: the browser's share dialog needs the click (user gesture). */
  protected share(slot: StationSlot): void {
    this.session.shareScreen(slot.slot);
  }

  /** Must stay synchronous for the same reason. */
  protected addScreen(): void {
    this.session.addScreen();
  }

  /** “Stop sharing”: at once off air, after a confirmation while the screen is live. */
  protected stopShare(slot: StationSlot): void {
    if (slot.tally === 'program') {
      this.ask(slot, 'stop');
    } else {
      this.session.endShare(slot.slot);
    }
  }

  /** “Stop camera”: at once off air, after a confirmation while the camera is live. */
  protected stopCamera(slot: StationSlot): void {
    if (slot.tally === 'program') {
      this.ask(slot, 'stop');
    } else {
      this.session.stopCamera();
    }
  }

  /** Shows the confirmation in the card and moves focus to its safe choice (“Cancel”). */
  protected ask(slot: StationSlot, action: PendingAsk['action']): void {
    this.closeMenu(false);
    this.asking.set({ slot: slot.slot, action });
    this.focusLater(`[data-testid="slot-${slot.slot}"] [data-cancel]`);
  }

  protected confirmAsk(): void {
    const pending = this.asking();
    this.asking.set(null);
    if (pending === null) {
      return;
    }
    const slot = [...this.screens(), this.camera()].find((entry) => entry?.slot === pending.slot);
    if (pending.action === 'remove') {
      void this.session.removeSlot(pending.slot);
    } else if (slot?.kind === 'camera') {
      this.session.stopCamera();
    } else {
      this.session.endShare(pending.slot);
    }
  }

  protected cancelAsk(): void {
    const pending = this.asking();
    this.asking.set(null);
    if (pending !== null) {
      this.focusLater(`[data-testid="slot-${pending.slot}"] .c-source__actions button`);
    }
  }

  protected toggleMenu(slot: string): void {
    if (this.menuFor() === slot) {
      this.closeMenu(true);
      return;
    }
    this.menuFor.set(slot);
    this.focusLater('.c-menu [role^="menuitem"]');
  }

  /** Closes the open ⋯ menu; `restore` puts focus back on its button. */
  protected closeMenu(restore: boolean): void {
    const slot = this.menuFor();
    if (slot === null) {
      return;
    }
    this.menuFor.set(null);
    if (restore) {
      this.focusLater(`[data-testid="slot-${slot}"] .c-source__more > .c-ibtn`);
    }
  }

  /** Arrow keys, Home and End move between the items of the open menu. */
  protected menuKey(event: KeyboardEvent): void {
    const items = [...this.host.querySelectorAll<HTMLElement>('.c-menu [role^="menuitem"]')];
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(event.target as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : event.key === 'ArrowUp'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      this.closeMenu(false);
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.menuFor() === null) {
      return;
    }
    const target = event.target as Element | null;
    if (target === null || target.closest('.c-menu-wrap') === null) {
      this.closeMenu(false);
    }
  }

  /** Focuses an element once the view shows it. */
  private focusLater(selector: string): void {
    setTimeout(() => this.host.querySelector<HTMLElement>(selector)?.focus());
  }
}
