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

/** The one panel of the details that is open: camera settings, message, rename or a confirmation. */
type Panel = 'camera' | 'message' | 'rename' | 'block' | 'remove';

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
 * The row opens with a 240 ms reveal into the details: the actions (Send message, Camera settings, Switch camera), one
 * panel at a time right below them, the technical details behind a disclosure and "Manage device" (Rename, Unblock,
 * Block device, Remove; the last two behind a confirmation). Closing the details resets every panel.
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
  /** The panel open below the actions or in "Manage device". */
  protected readonly panel = signal<Panel | null>(null);
  /** "Technical details" is open. */
  protected readonly technical = signal(false);
  /** How this Regie decodes the device's pictures (hardware or software), read while the technical details are open. */
  protected readonly decoding = signal<readonly DetailEntry[]>([]);

  protected readonly detailId = computed(() => `sf-station-${this.view().id}`);
  protected readonly lineId = computed(() => `sf-station-line-${this.view().id}`);
  protected readonly cameraPanelId = computed(() => `sf-camera-${this.view().id}`);
  protected readonly composerId = computed(() => `sf-composer-${this.view().id}`);
  protected readonly technicalId = computed(() => `sf-station-tech-${this.view().id}`);
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
          this.technical.set(false);
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

  /** Opens a panel (closing the one that was open), or closes it when it is open already. */
  protected togglePanel(panel: Panel): void {
    this.panel.update((open) => (open === panel ? null : panel));
  }

  protected closePanel(): void {
    this.panel.set(null);
  }

  protected toggleTechnical(): void {
    this.technical.update((open) => !open);
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

  /** Reads how this Regie decodes the pictures while the technical details are open (every 3 s). */
  private pollDecoding(): void {
    effect((onCleanup) => {
      const provider = this.media.provider();
      const sources = this.sources();
      if (!this.open() || !this.technical() || !provider || sources.length === 0) {
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

  /** The camera panel is tall: once it opens, the dock scrolls so that it can be seen. */
  private revealCameraPanel(): void {
    effect(() => {
      if (this.panel() !== 'camera') {
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
