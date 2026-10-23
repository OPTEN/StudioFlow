import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  formatClock,
  formatDuration,
  formatHm,
  incidentPlaceWord,
  incidentWord,
  logEntryText,
  type IncidentDto,
  type IncidentPlace,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { StudioMediaService } from '../../core/media/studio-media.service';
import { IncidentAckService } from '../../core/state/incident-ack.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { StationFocusService } from '../station-focus.service';

/** One incident segment of the message strip. */
interface IncidentRow {
  readonly incident: IncidentDto;
  readonly code: string;
  readonly name: string;
  readonly word: string;
  readonly bad: boolean;
  readonly recovered: boolean;
  readonly place: IncidentPlace;
  /** «war 9 s weg» for recovered incidents. */
  readonly downFor: string;
  /** «Neu teilen lassen» is offered (ended screen share of a device slot; never for a camera). */
  readonly reshare: boolean;
}

/** A connection banner segment (hub or media) before the incidents. */
interface ConnectionBanner {
  readonly tone: 'idle' | 'warn' | 'bad';
  readonly text: string;
  readonly action: 'media' | null;
}

/** Number of «Letzte Ereignisse» shown (prototype: 4). */
const LOG_ENTRIES = 4;

/**
 * The message strip below the header (prototype `.statusline`, DESIGN.md «Message strip»): every incident as its own
 * segment (sorted: open before recovered, red before amber, oldest first) with icon, code, name, state word, where
 * it is on air, a timer and its direct action («Neu teilen lassen», «Gesehen»); without incidents «Keine offenen
 * Meldungen» and the last four log entries. A calm banner segment first reports a lost server or media connection.
 */
@Component({
  selector: 'sf-status-line',
  imports: [IconComponent],
  templateUrl: './status-line.component.html',
  styleUrl: './status-line.component.scss',
  host: { role: 'region', 'aria-label': 'Meldungen' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusLineComponent {
  protected readonly placeWord = incidentPlaceWord;
  protected readonly store = inject(ProductionStoreService);
  protected readonly media = inject(StudioMediaService);
  private readonly clock = inject(ClockService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly stationFocus = inject(StationFocusService);
  private readonly acks = inject(IncidentAckService);

  /** Incidents with an action request in flight (double-click protection). */
  protected readonly pending = signal<ReadonlySet<string>>(new Set());

  protected readonly rows = computed<readonly IncidentRow[]>(() =>
    this.store.sortedIncidents().map((incident) => {
      const source = this.store.sourceById(incident.sourceId);
      const recovered = incident.endedAt !== null;
      const seconds = recovered
        ? Math.max(
            1,
            Math.round(
              (Date.parse(incident.endedAt ?? '') - Date.parse(incident.startedAt)) / 1000,
            ) || 1,
          )
        : 0;
      return {
        incident,
        code: incident.code,
        name: source?.label ?? 'Quelle fehlt',
        word: incidentWord(incident.kind, source?.kind),
        bad: incident.kind !== 'reconnecting',
        recovered,
        place: this.store.incidentPlace(incident.sourceId),
        downFor: `war ${seconds} s weg`,
        reshare:
          !recovered &&
          incident.kind === 'ended' &&
          source?.kind === 'screen' &&
          !!source.deviceId &&
          !!source.slot,
      };
    }),
  );

  protected readonly logEntries = computed(() =>
    this.store
      .log()
      .slice(0, LOG_ENTRIES)
      .map((entry, index) => ({
        key: `${entry.at}-${index}`,
        time: formatHm(new Date(entry.at)),
        text: logEntryText(entry),
      })),
  );

  /** Server or media connection problem, or null. */
  protected readonly banner = computed<ConnectionBanner | null>(() => {
    const discoveryError = this.store.discoveryError();
    if (discoveryError) {
      return { tone: 'warn', text: discoveryError, action: null };
    }
    const status = this.store.status();
    if (status === 'offline') {
      const lastSync = this.store.lastSyncAt();
      const since = lastSync ? ` Letzter Stand ${formatClock(new Date(lastSync))}.` : '';
      return {
        tone: 'warn',
        text: `Keine Verbindung zum Server, die Regie verbindet neu …${since}`,
        action: null,
      };
    }
    if (status === 'connecting' && !this.store.state()) {
      return { tone: 'idle', text: 'Verbindet mit dem Server …', action: null };
    }
    if (this.media.unavailable()) {
      return {
        tone: 'bad',
        text: 'Keine Videoverbindung: die Monitore zeigen kein Bild.',
        action: 'media',
      };
    }
    if (this.media.degraded()) {
      return { tone: 'warn', text: 'Videoverbindung unterbrochen, verbindet neu …', action: null };
    }
    return null;
  });

  /** Running outage timer «mm:ss» (ticks with the shared clock). */
  protected timer(incident: IncidentDto): string {
    return formatDuration(this.store.elapsedSince(incident.startedAt, this.clock.now()));
  }

  protected show(row: IncidentRow): void {
    this.stationFocus.showSource(row.incident.sourceId);
  }

  /** «Gesehen» (only offered for recovered incidents; see {@link IncidentAckService}). */
  protected acknowledge(row: IncidentRow): Promise<void> {
    return this.withPending(row.incident.id, (productionId) =>
      this.acks.acknowledge(productionId, [row.incident.id]),
    );
  }

  protected reshare(row: IncidentRow): Promise<void> {
    const source = this.store.sourceById(row.incident.sourceId);
    if (!source?.deviceId || !source.slot) {
      return Promise.resolve();
    }
    const deviceId = source.deviceId;
    const slot = source.slot;
    return this.withPending(row.incident.id, async (productionId) => {
      await this.api.sendDeviceCommand(productionId, deviceId, {
        kind: 'reshare',
        slot,
        text: null,
      });
      const device = this.store.deviceById(deviceId);
      this.toasts.show(
        device?.connection === 'offline'
          ? `${row.name} ist nicht verbunden. Bitte direkt am Gerät neu teilen.`
          : `Bitte an ${row.name} geschickt: «Bildschirm erneut teilen»`,
      );
    });
  }

  private async withPending(
    id: string,
    action: (productionId: string) => Promise<void>,
  ): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.pending().has(id)) {
      return;
    }
    if (!this.store.canCommand()) {
      this.toasts.show('Keine Verbindung zum Server. Bitte gleich nochmals versuchen.');
      return;
    }
    this.pending.update((set) => new Set([...set, id]));
    try {
      await action(productionId);
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.pending.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }
}
