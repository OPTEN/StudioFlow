import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { t, tm } from '@studioflow/i18n';
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
  /** "was gone for 9 s" for recovered incidents. */
  readonly downFor: string;
  /** "Ask to share again" is offered (ended screen share of a device slot; never for a camera). */
  readonly reshare: boolean;
}

/** A connection banner segment (hub or media) before the incidents. */
interface ConnectionBanner {
  readonly tone: 'idle' | 'warn' | 'bad';
  readonly text: string;
  readonly action: 'media' | null;
}

/** Number of "Recent events" shown (prototype: 4). */
const LOG_ENTRIES = 4;

/**
 * The message strip below the header (prototype `.statusline`, DESIGN.md "Message strip"): every incident as its own
 * segment (sorted: open before recovered, red before amber, oldest first) with icon, code, name, state word, where
 * it is on air, a timer and its direct action ("Ask to share again", "Seen"); without incidents "No open messages"
 * and the last four log entries, each in the active language from its code (`logEntryText`, with the English text of
 * the API as fallback for a code this client does not know). A calm banner segment first reports a lost server or
 * media connection.
 */
@Component({
  selector: 'sf-status-line',
  imports: [IconComponent],
  templateUrl: './status-line.component.html',
  styleUrl: './status-line.component.scss',
  host: { role: 'region', '[attr.aria-label]': "t('regie.statusline.label')" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusLineComponent {
  protected readonly t = t;
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
        name: source?.label ?? t('model.scene.sourceMissing'),
        word: incidentWord(incident.kind, source?.kind),
        bad: incident.kind !== 'reconnecting',
        recovered,
        place: this.store.incidentPlace(incident.sourceId),
        downFor: t('regie.statusline.incident.goneFor', { seconds }),
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
      return { tone: 'warn', text: tm(discoveryError), action: null };
    }
    const status = this.store.status();
    if (status === 'offline') {
      const lastSync = this.store.lastSyncAt();
      return {
        tone: 'warn',
        text: lastSync
          ? t('regie.statusline.banner.offlineSince', { time: formatClock(new Date(lastSync)) })
          : t('regie.statusline.banner.offline'),
        action: null,
      };
    }
    if (status === 'connecting' && !this.store.state()) {
      return { tone: 'idle', text: t('regie.statusline.banner.connecting'), action: null };
    }
    if (this.media.unavailable()) {
      return {
        tone: 'bad',
        text: t('regie.statusline.banner.mediaUnavailable'),
        action: 'media',
      };
    }
    if (this.media.degraded()) {
      return {
        tone: 'warn',
        text: t('regie.statusline.banner.mediaDegraded'),
        action: null,
      };
    }
    return null;
  });

  /** Running outage timer "mm:ss" (ticks with the shared clock). */
  protected timer(incident: IncidentDto): string {
    return formatDuration(this.store.elapsedSince(incident.startedAt, this.clock.now()));
  }

  protected show(row: IncidentRow): void {
    this.stationFocus.showSource(row.incident.sourceId);
  }

  /** "Seen" (only offered for recovered incidents; see {@link IncidentAckService}). */
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
          ? t('regie.statusline.incident.reshareOffline', { name: row.name })
          : t('regie.statusline.incident.reshareSent', { name: row.name }),
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
      this.toasts.show(t('regie.statusline.offline'));
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
