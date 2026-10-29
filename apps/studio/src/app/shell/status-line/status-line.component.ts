import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { StationFocusService } from '../station-focus.service';

/** Id of the issues popover of the activity bar. */
export const ISSUES_POPOVER = 'issues';

/** Key for the pending set while "Mark all as seen" runs. */
const ALL = 'all';

/** One incident of the activity bar (the lead one inline, every one in the issues popover). */
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

/** A connection banner (hub or media); it takes the row while it lasts. */
interface ConnectionBanner {
  readonly tone: 'idle' | 'warn' | 'bad';
  readonly text: string;
  readonly action: 'media' | null;
}

/** The health button: lamp tone and words. */
interface Health {
  readonly tone: 'idle' | 'ok' | 'warn' | 'bad';
  readonly text: string;
}

/**
 * The activity bar below the toolbar (DESIGN.md "Activity bar"): one row of fixed height that never wraps, so a burst of
 * outages never pushes the monitors down.
 * - Left: the health button ("All 4 devices OK", "2 issues", "No devices yet") opens the issues popover with every
 *   incident (sorted: open before recovered, red before amber, oldest first), each with its direct action, plus "Mark
 *   all as seen" and "Open monitoring". Next to it the most severe incident inline (code, name, state word, where it is
 *   on air, timer, action) and "+N more".
 * - Right: the latest event in the active language (`logEntryText`, with the English text of the API as fallback for a
 *   code this client does not know) and the link to the activity log.
 * - A lost server or media connection takes the row first.
 *
 * A right click on an incident (or Shift+F10 on it) offers "Show device", "Ask to share again" where it applies and
 * "Dismiss" (only once the device is back); every one of them is also a button on the incident.
 *
 * The issues list stays in the DOM while the popover is closed (hidden), like a disclosure, so its rows keep their
 * timers and the popover opens without a load.
 */
@Component({
  selector: 'sf-status-line',
  imports: [
    ContextMenuDirective,
    IconComponent,
    NgTemplateOutlet,
    PopoverDirective,
    PopoverTriggerDirective,
    RouterLink,
  ],
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
  protected readonly popovers = inject(PopoverService);
  private readonly clock = inject(ClockService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly stationFocus = inject(StationFocusService);
  private readonly acks = inject(IncidentAckService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly issuesPopover = ISSUES_POPOVER;
  protected readonly issuesId = this.popovers.domId(ISSUES_POPOVER);
  protected readonly issuesOpen = computed(() => this.popovers.isOpen(ISSUES_POPOVER));

  /** Incidents with an action request in flight (double-click protection); `all` while "Mark all as seen" runs. */
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

  /** The most severe incident, shown inline. */
  protected readonly lead = computed(() => this.rows()[0] ?? null);
  /** Incidents behind "+N more". */
  protected readonly more = computed(() => Math.max(0, this.rows().length - 1));
  /** Recovered incidents waiting for "Dismiss" ("Mark all as seen" acknowledges them together). */
  protected readonly recovered = computed(() => this.rows().filter((row) => row.recovered));

  /** Devices that count for the health (blocked ones do not send and do not count). */
  private readonly deviceCount = computed(
    () => [...this.store.devices().values()].filter((device) => device.state !== 'blocked').length,
  );

  protected readonly health = computed<Health>(() => {
    if (!this.store.state()) {
      return { tone: 'idle', text: t('regie.statusline.health.loading') };
    }
    const open = this.store.openIncidents();
    if (open.length > 0) {
      return {
        tone: open.some((incident) => incident.kind !== 'reconnecting') ? 'bad' : 'warn',
        text: t('regie.statusline.health.issues', { count: open.length }),
      };
    }
    const devices = this.deviceCount();
    return devices === 0
      ? { tone: 'idle', text: t('regie.statusline.health.none') }
      : { tone: 'ok', text: t('regie.statusline.health.ok', { count: devices }) };
  });

  /** The latest log entry, in the active language. */
  protected readonly latest = computed(() => {
    const entry = this.store.log()[0];
    return entry ? { time: formatHm(new Date(entry.at)), text: logEntryText(entry) } : null;
  });

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

  constructor() {
    // The popover is a dialog: when it opens, the focus moves to its first control (Escape brings it back).
    effect(() => {
      if (!this.issuesOpen()) {
        return;
      }
      untracked(() =>
        afterNextRender(
          () =>
            this.host
              .querySelector<HTMLElement>(
                `#${this.issuesId} button:not([disabled]), #${this.issuesId} a[href]`,
              )
              ?.focus(),
          { injector: this.injector },
        ),
      );
    });
  }

  /** Menus per incident row, built once per row object (the rows are recomputed when anything changes). */
  private readonly menus = new WeakMap<IncidentRow, () => readonly ContextMenuEntry[]>();

  /** The right-click menu of an incident. */
  protected menuFor(row: IncidentRow): () => readonly ContextMenuEntry[] {
    let menu = this.menus.get(row);
    if (!menu) {
      menu = () => {
        const busy = this.pending().has(row.incident.id) || this.pending().has(ALL);
        const entries: ContextMenuEntry[] = [
          {
            label: t('regie.statusline.incident.showDevice'),
            icon: 'phone',
            run: () => this.show(row),
          },
        ];
        if (row.reshare && !row.recovered) {
          entries.push({
            label: t('regie.statusline.incident.reshare'),
            icon: 'send',
            disabled: busy,
            run: () => void this.reshare(row),
          });
        }
        entries.push('separator', {
          label: row.recovered
            ? t('regie.statusline.incident.dismiss')
            : t('regie.statusline.incident.dismissLater'),
          icon: 'check',
          disabled: !row.recovered || busy,
          run: () => void this.acknowledge(row),
        });
        return entries;
      };
      this.menus.set(row, menu);
    }
    return menu;
  }

  /** Running outage timer "mm:ss" (ticks with the shared clock). */
  protected timer(incident: IncidentDto): string {
    return formatDuration(this.store.elapsedSince(incident.startedAt, this.clock.now()));
  }

  /** "+N more": opens the issues popover (the health button toggles it as well). */
  protected openIssues(): void {
    this.popovers.open(ISSUES_POPOVER);
  }

  protected show(row: IncidentRow): void {
    this.popovers.close(ISSUES_POPOVER);
    this.stationFocus.showSource(row.incident.sourceId);
  }

  /** "Dismiss" (only offered for recovered incidents; see {@link IncidentAckService}). */
  protected acknowledge(row: IncidentRow): Promise<void> {
    return this.withPending(row.incident.id, (productionId) =>
      this.acks.acknowledge(productionId, [row.incident.id]),
    );
  }

  /** "Mark all as seen": acknowledges every recovered incident. */
  protected acknowledgeAll(): Promise<void> {
    const ids = this.recovered().map((row) => row.incident.id);
    return this.withPending(ALL, (productionId) => this.acks.acknowledge(productionId, ids));
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
      if (device?.connection === 'offline') {
        this.toasts.show(t('regie.statusline.incident.reshareOffline', { name: row.name }));
      } else {
        this.toasts.success(t('regie.statusline.incident.reshareSent', { name: row.name }));
      }
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
