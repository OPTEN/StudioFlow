import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  LIMITS,
  formatPercent,
  isDown,
  type DeviceDto,
  type DeviceKind,
  type SourceDto,
} from '@studioflow/scene-model';
import { StudioMediaService } from '../../core/media/studio-media.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent, type IconName } from '../../core/ui/icon.component';
import { ElapsedComponent } from '../shared/elapsed.component';
import { CameraPanelComponent } from './camera-panel.component';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { messageParts } from '../shared/message-parts';
import { toneClass, type StateTone } from '../shared/source-view';
import { MessageComposerComponent } from './message-composer.component';
import { PlaceholderOfferComponent } from './placeholder-offer.component';
import { StationCommandsService } from './station-commands.service';
import { StationThumbComponent } from './station-thumb.component';
import {
  decodingEntries,
  stationDetails,
  techLamps,
  type DetailEntry,
  type StationView,
} from './station-view';

/** How often the open technical details ask the media provider how this Regie decodes the device's pictures. */
const DECODING_POLL_MS = 3000;

/** The tabs of the details: camera settings, the message composer and the technical details. */
type DetailTab = 'camera' | 'message' | 'details';

/** The one panel of "Manage device" that is open: rename or a confirmation. */
type Panel = 'rename' | 'block' | 'remove';

/** Tab order (Camera | Message | Details) with the icon of each tab. */
const DETAIL_TABS: readonly { readonly id: DetailTab; readonly icon: IconName }[] = [
  { id: 'camera', icon: 'sliders' },
  { id: 'message', icon: 'send' },
  { id: 'details', icon: 'info' },
];

/** Icon of each kind of device (next to its slot codes). */
const KIND_ICON: Readonly<Record<DeviceKind, IconName>> = {
  phone: 'phone',
  laptop: 'laptop',
  audioStation: 'mic',
};

/**
 * One device of the Devices dock: a clean strip with the live thumbnail, the name with its Live / Preview capsule, the
 * kind icon with the slot codes and the state line (lamp, state word, timer, or "sending" with the upload rate and the
 * delay). Below it, in place, the things that ask for a reaction: "Ask to share again" for an ended screen, "Dismiss"
 * for a device that came back, and the placeholder offer of a copied production.
 *
 * The row opens with a 240 ms reveal into the details: the tabs Camera (Switch camera and the camera settings of a
 * phone), Message (the composer) and Details (the technical details, the default), then "Manage device" (Rename,
 * Unblock, Block device, Remove; the last two behind a confirmation). Closing the details resets the tab and the panel.
 *
 * A right click on the strip (or the context-menu key) offers the commands of the device; F2 on the row renames it and
 * Delete asks to remove it. Every command of the menu also has a visible button in the details or the strips.
 *
 * The row button holds only the name, so its accessible name ("K1 Stage phone, on Program, reconnecting") contains its
 * visible text (WCAG 2.5.3); a pseudo-element stretches its hit area over the whole strip, and the state line is its
 * description.
 */
@Component({
  selector: 'sf-station-row',
  imports: [
    CameraPanelComponent,
    ConfirmBoxComponent,
    ContextMenuDirective,
    ElapsedComponent,
    IconComponent,
    InlineEditComponent,
    MessageComposerComponent,
    PlaceholderOfferComponent,
    StationThumbComponent,
  ],
  templateUrl: './station-row.component.html',
  styleUrl: './station-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationRowComponent {
  /** The device. */
  readonly device = input.required<DeviceDto>();
  /** Its sources, sorted by code. */
  readonly sources = input.required<readonly SourceDto[]>();
  /** Row model (see `stationView`). */
  readonly view = input.required<StationView>();
  /** Details are open. */
  readonly open = input(false);
  /** The lamp pulses once (new outage). */
  readonly pulse = input(false);
  /** Increment to flash the row once (focus request from the header or the message strip). */
  readonly flash = input(0);

  /** The row button was activated: the dock opens or closes the details. */
  readonly toggle = output<void>();

  protected readonly commands = inject(StationCommandsService);
  private readonly store = inject(ProductionStoreService);
  private readonly media = inject(StudioMediaService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly station = viewChild.required<ElementRef<HTMLElement>>('station');

  protected readonly t = t;
  protected readonly maxNameLength = LIMITS.deviceNameLength;
  /** The panel open in "Manage device". */
  protected readonly panel = signal<Panel | null>(null);
  /** The chosen tab of the details. */
  private readonly tab = signal<DetailTab>('details');
  /** The message composer takes the focus when it opens (not while the arrow keys move between the tabs). */
  protected readonly composerFocus = signal(true);
  /** How this Regie decodes the device's pictures (hardware or software), read while the technical details are open. */
  protected readonly decoding = signal<readonly DetailEntry[]>([]);

  protected readonly detailId = computed(() => `sf-station-${this.view().id}`);
  protected readonly lineId = computed(() => `sf-station-line-${this.view().id}`);
  protected readonly cameraPanelId = computed(() => `sf-camera-${this.view().id}`);
  protected readonly composerId = computed(() => `sf-composer-${this.view().id}`);
  protected readonly tabPanelId = computed(() => `sf-station-tab-${this.view().id}`);
  /** The tabs this device offers: Camera for a phone camera, Message unless blocked, Details always. */
  protected readonly tabs = computed(() =>
    DETAIL_TABS.filter(
      (tab) =>
        (tab.id !== 'camera' || this.view().canControlCamera) &&
        (tab.id !== 'message' || !this.view().blocked),
    ),
  );
  /** The shown tab (Details when the chosen one is not offered any more, e.g. after a block). */
  protected readonly currentTab = computed<DetailTab>(() => {
    const tab = this.tab();
    return this.tabs().some((entry) => entry.id === tab) ? tab : 'details';
  });
  protected readonly down = computed(() => isDown(this.view().status));
  protected readonly online = computed(() => this.store.canCommand());
  protected readonly kindIcon = computed(() => KIND_ICON[this.view().kind]);
  protected readonly kindText = computed(() => {
    switch (this.view().kind) {
      case 'phone':
        return t('regie.stations.kind.phone');
      case 'laptop':
        return t('regie.stations.kind.laptop');
      case 'audioStation':
        return t('regie.stations.kind.audioStation');
    }
  });
  protected readonly label = computed(() =>
    this.view().codes.length > 0 ? this.view().codes.join(' ') : this.view().name,
  );
  protected readonly details = computed(() =>
    stationDetails(this.device(), this.sources(), this.view().status, Date.now()),
  );
  protected readonly tech = computed(() => techLamps(this.device().techCheck));
  /** "was gone 9 s": the text around the mono seconds of a recovered device. */
  protected readonly wasGone = computed(() =>
    messageParts((mark) => t('regie.stations.line.wasGone', { seconds: mark })),
  );

  constructor() {
    effect(() => {
      if (!this.open()) {
        untracked(() => {
          this.panel.set(null);
          this.tab.set('details');
        });
      }
    });
    this.pollDecoding();
    this.revealCameraPanel();
    effect(() => {
      if (this.flash() > 0) {
        const element = this.station().nativeElement;
        element.classList.remove('is-flash');
        // Restart the animation for a repeated request.
        void element.offsetWidth;
        element.classList.add('is-flash');
      }
    });
  }

  protected toneClass(tone: StateTone): string {
    return toneClass(tone);
  }

  protected percentText(value: number): string {
    return formatPercent(value);
  }

  /** The command's button is disabled: it runs, or the Regie is offline. */
  protected busy(kind: string): boolean {
    return this.commands.blocked(this.device().id, kind);
  }

  protected reshare(source: SourceDto): void {
    void this.commands.reshare(this.device(), source);
  }

  protected switchCamera(): void {
    void this.commands.switchCamera(this.device());
  }

  protected tabId(tab: DetailTab): string {
    return `sf-station-${this.view().id}-tab-${tab}`;
  }

  protected tabLabel(tab: DetailTab): string {
    switch (tab) {
      case 'camera':
        return t('regie.stations.tab.camera');
      case 'message':
        return t('regie.stations.tab.message');
      case 'details':
        return t('regie.stations.tab.details');
    }
  }

  protected selectTab(tab: DetailTab, focusComposer = true): void {
    this.composerFocus.set(focusComposer);
    this.tab.set(tab);
  }

  /** Arrow keys, Home and End move between the tabs (roving tabindex). */
  protected onTabKeyDown(event: KeyboardEvent): void {
    const tabs = this.tabs().map((tab) => tab.id);
    const index = tabs.indexOf(this.currentTab());
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectTab(tabs[next], false);
    this.host.querySelector<HTMLElement>(`#${CSS.escape(this.tabId(tabs[next]))}`)?.focus();
  }

  /** F2 on the row renames the device, Delete or Backspace asks to remove it. */
  protected onRowKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.openWith(() => this.panel.set('rename'));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.openWith(() => this.panel.set('remove'));
    }
  }

  /** The commands of the right-click menu; each one also has a button in the details or the strips. */
  protected readonly menu = (): readonly ContextMenuEntry[] => {
    const v = this.view();
    const offline = !this.online();
    const entries: ContextMenuEntry[] = [];
    for (const source of v.endedScreens) {
      entries.push({
        label:
          v.endedScreens.length > 1
            ? t('regie.stations.action.reshareCode', { code: source.code })
            : t('regie.stations.action.reshare'),
        icon: 'screen',
        disabled: offline || this.busy('reshare:' + source.slot),
        run: () => this.reshare(source),
      });
    }
    if (v.recovered.length > 0) {
      entries.push({
        label: t('regie.stations.ack.dismiss'),
        icon: 'circle-check',
        disabled: offline || this.busy('ack'),
        run: () => this.acknowledge(),
      });
    }
    if (entries.length > 0) {
      entries.push('separator');
    }
    if (v.canControlCamera) {
      entries.push({
        label: t('regie.stations.menu.camera'),
        icon: 'sliders',
        run: () => this.openWith(() => this.selectTab('camera')),
      });
    }
    if (v.canSwitchCamera) {
      entries.push({
        label: t('regie.stations.action.switchCamera'),
        icon: 'refresh',
        disabled: offline || this.busy('camera'),
        run: () => this.switchCamera(),
      });
    }
    if (!v.blocked) {
      entries.push({
        label: t('regie.stations.menu.message'),
        icon: 'send',
        disabled: this.busy('message'),
        run: () => this.openWith(() => this.selectTab('message')),
      });
    }
    entries.push(
      {
        label: t('regie.stations.menu.details'),
        icon: 'info',
        run: () => this.openWith(() => this.selectTab('details')),
      },
      'separator',
      {
        label: t('regie.stations.menu.rename'),
        icon: 'pencil',
        shortcut: 'F2',
        disabled: this.busy('rename'),
        run: () => this.openWith(() => this.panel.set('rename')),
      },
    );
    if (v.blocked) {
      entries.push({
        label: t('regie.stations.action.unblock'),
        icon: 'unlock',
        disabled: offline || this.busy('unblock'),
        run: () => this.unblock(),
      });
    } else {
      entries.push({
        label: t('regie.stations.menu.block'),
        danger: true,
        disabled: this.busy('block'),
        run: () => this.openWith(() => this.panel.set('block')),
      });
    }
    entries.push({
      label: t('regie.stations.menu.remove'),
      shortcut: t('regie.stations.menu.deleteKey'),
      danger: true,
      disabled: this.busy('remove'),
      run: () => this.openWith(() => this.panel.set('remove')),
    });
    return entries;
  };

  /** Opens the details (when closed) and then shows a tab or a panel. */
  private openWith(show: () => void): void {
    if (!this.open()) {
      this.toggle.emit();
    }
    show();
  }

  /** Opens a panel (closing the one that was open), or closes it when it is open already. */
  protected togglePanel(panel: Panel): void {
    this.panel.update((open) => (open === panel ? null : panel));
  }

  protected closePanel(): void {
    this.panel.set(null);
  }

  protected async rename(name: string): Promise<void> {
    this.panel.set(null);
    await this.commands.rename(this.device(), name);
  }

  protected acknowledge(): void {
    void this.commands.acknowledge(this.device(), this.view().recovered);
  }

  protected async block(): Promise<void> {
    if (await this.commands.block(this.device())) {
      this.panel.set(null);
    }
  }

  protected unblock(): void {
    void this.commands.unblock(this.device());
  }

  protected async remove(): Promise<void> {
    if (await this.commands.remove(this.device())) {
      this.panel.set(null);
    }
  }

  /** Reads how this Regie decodes the pictures while the Details tab is shown (every 3 s). */
  private pollDecoding(): void {
    effect((onCleanup) => {
      const provider = this.media.provider();
      const sources = this.sources();
      if (!this.open() || this.currentTab() !== 'details' || !provider || sources.length === 0) {
        untracked(() => this.decoding.set([]));
        return;
      }
      let stopped = false;
      const read = async (): Promise<void> => {
        const stats = new Map(
          await Promise.all(
            sources.map(async (source) => {
              const entry = await provider.getStats(source.id).catch(() => null);
              return [source.id, entry] as const;
            }),
          ),
        );
        if (!stopped) {
          this.decoding.set(decodingEntries(sources, stats));
        }
      };
      void read();
      const timer = setInterval(() => void read(), DECODING_POLL_MS);
      onCleanup(() => {
        stopped = true;
        clearInterval(timer);
      });
    });
  }

  /** The camera settings are tall: once the Camera tab opens, the dock scrolls so that they can be seen. */
  private revealCameraPanel(): void {
    effect(() => {
      if (!this.open() || this.currentTab() !== 'camera') {
        return;
      }
      const id = untracked(() => this.cameraPanelId());
      afterNextRender(
        () =>
          this.host
            .querySelector(`#${CSS.escape(id)}`)
            ?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }),
        { injector: this.injector },
      );
    });
  }
}
