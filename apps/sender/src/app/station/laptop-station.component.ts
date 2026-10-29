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
import { ConfirmSheetComponent } from '../shared/confirm-sheet.component';
import { IconComponent, type IconName } from '../shared/icon.component';
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

/** One command of a card's ⋯ menu. A `checked` value makes it a checkable item. */
interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly hint?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly testId?: string;
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
 * the next share action. A ⋯ menu per card (also opened by a right-click on the card) holds every command of the
 * source: share, stop or share again, “Smooth motion” and “Remove from the control room…”. Removing, and stopping a
 * source while it is live, ask first in a confirm sheet (Enter confirms, Escape cancels). The page binds no other keys:
 * a presenter's keyboard belongs to the presentation. “Share another screen”, “Add camera” and “Add microphone” are the
 * secondary actions below the cards.
 */
@Component({
  selector: 'sf-laptop-station',
  imports: [
    BrandMarkComponent,
    ConfirmSheetComponent,
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

  /** The commands of a card's ⋯ menu, in the order of the card: the primary action first, removal last. */
  protected menuEntries(slot: StationSlot): readonly MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (slot.kind === 'camera') {
      entries.push(
        this.busy(slot)
          ? {
              id: 'stop',
              label: t('sender.station.laptop.stopCamera'),
              icon: 'stop',
              run: () => this.fromMenu(() => this.stopCamera(slot)),
            }
          : {
              id: 'start',
              label:
                slot.state === 'failed'
                  ? t('sender.station.laptop.tryAgain')
                  : t('sender.station.laptop.startCamera'),
              icon: 'camera',
              run: () => this.fromMenu(() => this.session.startCamera()),
            },
      );
    } else {
      if (this.busy(slot)) {
        entries.push({
          id: 'stop',
          label: t('sender.station.laptop.stopSharing'),
          icon: 'stop',
          run: () => this.fromMenu(() => this.stopShare(slot)),
        });
      } else {
        // Synchronous inside the click, so the browser's share dialog still counts it as the user's gesture.
        entries.push({
          id: 'share',
          label:
            slot.state === 'idle'
              ? t('sender.station.laptop.shareScreen')
              : t('sender.station.laptop.shareAgain'),
          icon: slot.state === 'idle' ? 'screen' : 'refresh',
          disabled: !this.canShareScreen,
          run: () => this.fromMenu(() => this.share(slot)),
        });
      }
      entries.push({
        id: 'smooth',
        label: t('sender.station.laptop.smooth'),
        hint: t('sender.station.laptop.smoothHint'),
        icon: 'check',
        checked: this.videoScreen(slot),
        testId: 'video-screen',
        run: () => this.toggleVideoScreen(slot),
      });
    }
    if (slot.code !== null) {
      entries.push({
        id: 'remove',
        label: t('sender.station.laptop.remove'),
        icon: 'trash',
        danger: true,
        run: () => this.ask(slot, 'remove'),
      });
    }
    return entries;
  }

  protected confirmTitle(pending: PendingAsk): string {
    const name = this.labelOf(pending.slot);
    return pending.action === 'remove'
      ? t('sender.station.laptop.removeTitle', { name })
      : t('sender.station.laptop.stopTitle', { name });
  }

  protected confirmText(pending: PendingAsk): string {
    const name = this.labelOf(pending.slot);
    return pending.action === 'remove'
      ? t('sender.station.laptop.removeConfirm', { name })
      : t('sender.station.laptop.stopLive', { name });
  }

  /** The confirming button names the action itself. */
  protected confirmLabel(pending: PendingAsk): string {
    if (pending.action === 'remove') {
      return t('common.remove');
    }
    return this.find(pending.slot)?.kind === 'camera'
      ? t('sender.station.laptop.stopCamera')
      : t('sender.station.laptop.stopSharing');
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

  /** Opens the confirm sheet of a consequential action. */
  protected ask(slot: StationSlot, action: PendingAsk['action']): void {
    this.closeMenu(false);
    this.asking.set({ slot: slot.slot, action });
  }

  protected confirmAsk(): void {
    const pending = this.asking();
    this.asking.set(null);
    if (pending === null) {
      return;
    }
    if (pending.action === 'remove') {
      void this.session.removeSlot(pending.slot);
      this.focusLater('.c-column__title');
      return;
    }
    if (this.find(pending.slot)?.kind === 'camera') {
      this.session.stopCamera();
    } else {
      this.session.endShare(pending.slot);
    }
    this.focusLater(`[data-testid="slot-${pending.slot}"] .c-source__actions button`);
  }

  /** “Cancel”, Escape or a tap beside the sheet: nothing changes, the focus goes back to the card. */
  protected cancelAsk(): void {
    const pending = this.asking();
    this.asking.set(null);
    if (pending !== null) {
      this.focusLater(`[data-testid="slot-${pending.slot}"] .c-source__actions button`);
    }
  }

  /** A right-click on a card opens its ⋯ menu instead of the browser's menu (not on a field or a link). */
  protected openMenuAt(event: MouseEvent, slot: StationSlot): void {
    const target = event.target as Element | null;
    if (target?.closest('input, select, textarea, a[href]') != null) {
      return;
    }
    event.preventDefault();
    if (this.menuFor() !== slot.slot) {
      this.toggleMenu(slot.slot);
    }
  }

  protected toggleMenu(slot: string): void {
    if (this.menuFor() === slot) {
      this.closeMenu(true);
      return;
    }
    this.menuFor.set(slot);
    this.focusLater('.c-menu [role^="menuitem"]:not(:disabled)');
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
    const items = [
      ...this.host.querySelectorAll<HTMLElement>('.c-menu [role^="menuitem"]:not(:disabled)'),
    ];
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

  /** Runs a menu command after closing the menu (synchronously, for the share dialog's user gesture). */
  private fromMenu(command: () => void): void {
    this.closeMenu(true);
    command();
  }

  private find(slot: string): StationSlot | undefined {
    return [...this.screens(), this.camera()].find(
      (entry): entry is StationSlot => entry?.slot === slot,
    );
  }

  private labelOf(slot: string): string {
    const found = this.find(slot);
    return found === undefined ? '' : this.label(found);
  }

  /** Focuses an element once the view shows it. */
  private focusLater(selector: string): void {
    setTimeout(() => this.host.querySelector<HTMLElement>(selector)?.focus());
  }
}
