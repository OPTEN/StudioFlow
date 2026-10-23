import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { DeviceDto, IncidentDto, SourceDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ViewportService } from '../../core/ui/viewport.service';
import { StationFocusService } from '../../shell/station-focus.service';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { DockLayoutService } from '../../shell/workspace/dock-layout.service';
import { SwitcherService } from '../../stage/switcher.service';
import { KnockCardComponent } from '../pairing/knock-card.component';
import { PairingRequestsService } from '../pairing/pairing-requests.service';
import { StationRowComponent } from './station-row.component';
import { stationView, type StationView } from './station-view';

/** How long a new outage makes its station lamp pulse (prototype: once, 1.2 s). */
const PULSE_MS = 1300;

/** One station of the list. */
interface StationEntry {
  readonly device: DeviceDto;
  readonly sources: readonly SourceDto[];
  readonly view: StationView;
}

/** A cached entry with the inputs it was computed from. */
interface CachedEntry {
  readonly entry: StationEntry;
  readonly incidents: readonly IncidentDto[];
  readonly studioMode: boolean;
  readonly tallies: string;
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The Stationen dock (prototype «Stationen»): knock cards of waiting laptops (while the pairing dock is closed), then
 * every paired device in station order (outages first) with its row and expandable details. The header counts the
 * stations and toggles the pairing dock («Gerät koppeln»). A request from the header or the message strip
 * (`StationFocusService`) opens the station, scrolls it into view and flashes it; a new outage pulses its lamp once.
 */
@Component({
  selector: 'sf-stations-dock',
  imports: [DockFrameComponent, IconComponent, KnockCardComponent, StationRowComponent],
  templateUrl: './stations-dock.component.html',
  styleUrl: './stations-dock.component.scss',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationsDockComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly layout = inject(DockLayoutService);
  private readonly switcher = inject(SwitcherService);
  private readonly requests = inject(PairingRequestsService);
  private readonly focusService = inject(StationFocusService);
  private readonly viewport = inject(ViewportService);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly pairButton = viewChild<ElementRef<HTMLButtonElement>>('pairButton');

  protected readonly openId = signal<string | null>(null);
  private readonly flashRequest = signal<{ deviceId: string; seq: number } | null>(null);
  protected readonly pulsing = signal<ReadonlySet<string>>(new Set());

  protected readonly loading = computed(() => this.store.state() === null);
  /** Entries of the last computation per device, reused while nothing of the station changed. */
  private readonly entryCache = new Map<string, CachedEntry>();
  protected readonly entries = computed<readonly StationEntry[]>(() => {
    const incidents = this.store.incidents();
    const studioMode = this.switcher.studioMode();
    const devices = this.store.stations();
    const next = devices.map((device) => {
      const sources = this.store.deviceSources(device.id);
      const tallies = sources.map((source) => this.store.tallyOf(source.id)).join(',');
      const cached = this.entryCache.get(device.id);
      // Telemetry changes one device every 2 s: the other rows keep their objects and are not re-rendered.
      if (
        cached &&
        cached.entry.device === device &&
        cached.incidents === incidents &&
        cached.studioMode === studioMode &&
        cached.tallies === tallies &&
        sameItems(cached.entry.sources, sources)
      ) {
        return cached.entry;
      }
      const entry: StationEntry = {
        device,
        sources,
        view: stationView(device, {
          sources,
          incidents,
          studioMode,
          tallyOf: (sourceId) => this.store.tallyOf(sourceId),
        }),
      };
      this.entryCache.set(device.id, { entry, incidents, studioMode, tallies });
      return entry;
    });
    for (const id of [...this.entryCache.keys()]) {
      if (!devices.some((device) => device.id === id)) {
        this.entryCache.delete(id);
      }
    }
    return next;
  });
  /** Knock cards: in the pairing dock while it is open, here otherwise. */
  protected readonly knocks = computed(() =>
    this.layout.pairingOpen() ? [] : this.requests.pending(),
  );

  constructor() {
    this.followFocusRequests();
    this.pulseNewOutages();
    this.returnFocusFromPairing();
  }

  protected toggle(deviceId: string): void {
    this.openId.update((open) => (open === deviceId ? null : deviceId));
  }

  protected flashFor(deviceId: string): number {
    const request = this.flashRequest();
    return request?.deviceId === deviceId ? request.seq : 0;
  }

  /** Header chip and message strip: open, scroll into view and flash the station (prototype `showStation`). */
  private followFocusRequests(): void {
    effect(() => {
      const request = this.focusService.request();
      if (!request) {
        return;
      }
      untracked(() => {
        this.openId.set(request.deviceId);
        this.flashRequest.set({ deviceId: request.deviceId, seq: request.seq });
        afterNextRender(
          () => {
            const row = this.host.querySelector<HTMLElement>(
              `[data-device="${CSS.escape(request.deviceId)}"]`,
            );
            row?.scrollIntoView({
              block: 'nearest',
              behavior: this.viewport.reducedMotion() ? 'auto' : 'smooth',
            });
          },
          { injector: this.injector },
        );
      });
    });
  }

  /** A newly opened incident makes the lamp of its station pulse once (prototype `pulseStation`). */
  private pulseNewOutages(): void {
    let known: ReadonlySet<string> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    effect(() => {
      const open = this.store.openIncidents();
      if (!this.store.state()) {
        return;
      }
      const ids = new Set(open.map((incident) => incident.id));
      if (known === null) {
        // Outages that exist when the Regie opens do not pulse.
        known = ids;
        return;
      }
      const fresh = open.filter((incident) => !known?.has(incident.id));
      known = ids;
      const devices = fresh
        .map((incident) => untracked(() => this.store.sourceById(incident.sourceId)?.deviceId))
        .filter((deviceId): deviceId is string => !!deviceId);
      if (devices.length === 0) {
        return;
      }
      untracked(() => this.pulsing.update((set) => new Set([...set, ...devices])));
      const timer = setTimeout(() => {
        timers.delete(timer);
        this.pulsing.update((set) => new Set([...set].filter((id) => !devices.includes(id))));
      }, PULSE_MS);
      timers.add(timer);
    });
    inject(DestroyRef).onDestroy(() => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    });
  }

  /** Closing the pairing dock puts the focus back on «Gerät koppeln» (prototype `closePair`). */
  private returnFocusFromPairing(): void {
    let wasOpen = false;
    effect(() => {
      const open = this.layout.pairingOpen();
      if (wasOpen && !open) {
        afterNextRender(
          () => {
            const active = this.document.activeElement;
            if (!active || active === this.document.body) {
              this.pairButton()?.nativeElement.focus();
            }
          },
          { injector: this.injector },
        );
      }
      wasOpen = open;
    });
  }
}
