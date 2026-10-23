import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LIMITS, isDown, type DeviceDto, type SourceDto } from '@studioflow/scene-model';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ElapsedComponent } from '../shared/elapsed.component';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { toneClass, type StateTone } from '../shared/source-view';
import { MessageComposerComponent } from './message-composer.component';
import { StationCommandsService } from './station-commands.service';
import { StationThumbComponent } from './station-thumb.component';
import { stationDetails, techLamps, type StationView } from './station-view';

/** Which confirmation box is open. */
type Confirmation = 'block' | 'remove' | null;

/**
 * One station of the Stationen dock (prototype `.st`): the row button (lamp, codes, name, PGM/PVW tag, state line
 * with timer or metrics, small live picture, chevron), the «Gesehen» strip for a recovered station and the details
 * that open with a 200 ms grid-row reveal: device facts, technical check and the actions «Neu teilen lassen»,
 * «Kamera wechseln», «Nachricht senden», «Umbenennen», «Gerät sperren» / «Entsperren» and «Entfernen» (risky actions
 * behind a dashed red confirmation). Closing the details resets confirmations, composer and rename.
 */
@Component({
  selector: 'sf-station-row',
  imports: [
    ConfirmBoxComponent,
    ElapsedComponent,
    IconComponent,
    InlineEditComponent,
    MessageComposerComponent,
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
  private readonly station = viewChild.required<ElementRef<HTMLElement>>('station');

  protected readonly maxNameLength = LIMITS.deviceNameLength;
  protected readonly confirm = signal<Confirmation>(null);
  protected readonly composing = signal(false);
  protected readonly renaming = signal(false);

  protected readonly detailId = computed(() => `sf-station-${this.view().id}`);
  protected readonly down = computed(() => isDown(this.view().status));
  protected readonly label = computed(() =>
    this.view().codes.length > 0 ? this.view().codes.join(' ') : this.view().name,
  );
  protected readonly details = computed(() =>
    stationDetails(this.device(), this.sources(), this.view().status, Date.now()),
  );
  protected readonly tech = computed(() => techLamps(this.device().techCheck));

  constructor() {
    effect(() => {
      if (!this.open()) {
        untracked(() => {
          this.confirm.set(null);
          this.composing.set(false);
          this.renaming.set(false);
        });
      }
    });
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

  /** Shows one confirmation box at a time; the composer and rename close. */
  protected askConfirm(kind: 'block' | 'remove'): void {
    this.composing.set(false);
    this.renaming.set(false);
    this.confirm.set(kind);
  }

  protected toggleComposer(): void {
    this.confirm.set(null);
    this.renaming.set(false);
    this.composing.update((value) => !value);
  }

  protected startRename(): void {
    this.confirm.set(null);
    this.composing.set(false);
    this.renaming.set(true);
  }

  protected async rename(name: string): Promise<void> {
    this.renaming.set(false);
    await this.commands.rename(this.device(), name);
  }

  protected acknowledge(): void {
    void this.commands.acknowledge(this.device(), this.view().recovered);
  }

  protected async block(): Promise<void> {
    if (await this.commands.block(this.device())) {
      this.confirm.set(null);
    }
  }

  protected unblock(): void {
    void this.commands.unblock(this.device());
  }

  protected async remove(): Promise<void> {
    if (await this.commands.remove(this.device())) {
      this.confirm.set(null);
    }
  }
}
