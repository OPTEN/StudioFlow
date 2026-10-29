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
import { Router, RouterLink } from '@angular/router';
import { formatDateTime, t, tm, type Msg } from '@studioflow/i18n';
import {
  DEFAULT_CANVAS_FORMAT,
  canvasSizeLabel,
  formatPercent,
  formatRatioLabel,
  type OutputLinkDto,
  type OutputSettingsDto,
  type OutputState,
} from '@studioflow/scene-model';
import { toUserMsg } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective, PopoverService } from '../../core/ui/popover.directive';
import { OBS_FPS } from './obs-scene-collection';
import { outputLoad } from './output-load';
import { maskOutputUrl } from './output-url';

/** Id of the output popover. */
export const OUTPUT_POPOVER = 'output';

/** One line of the link list: the link, its state in a word and a colour, and its masked URL. */
interface LinkRow {
  readonly link: OutputLinkDto;
  readonly state: string;
  readonly stateClass: string;
  readonly lamp: string;
  readonly url: string;
  readonly title: string | null;
}

/** The state of a link in a word. */
export function linkStateText(state: OutputState): string {
  switch (state) {
    case 'connected':
      return t('regie.output.link.connected');
    case 'stale':
      return t('regie.output.link.stale');
    default:
      return t('regie.output.link.none');
  }
}

/**
 * Output popover (spec 4.8, 9.1): the live status of the output (state, latency, where it is connected from, format,
 * decoding, dropped frames, blocked sound with its remedy in words) and the named output links, each with its own
 * lamp, state, masked URL and a copy button. Everything that changes a link lives on the settings page "Output links"
 * ("Manage output links…"). Loads the links when it opens and again whenever a link changes its state.
 */
@Component({
  selector: 'sf-output-popover',
  imports: [ContextMenuDirective, IconComponent, PopoverDirective, RouterLink],
  templateUrl: './output-popover.component.html',
  styleUrl: './output-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPopoverComponent {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly popovers = inject(PopoverService);
  private readonly clipboard = inject(ClipboardService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private lastStateKey: string | null = null;

  protected readonly popoverId = OUTPUT_POPOVER;
  protected readonly t = t;
  protected readonly tm = tm;
  /** "1080 × 1920 · 9:16 · 30 fps": the canvas of the production and the nominal frame rate. */
  protected readonly format = computed(() => {
    const ratio = formatRatioLabel(this.store.production()?.canvas.format ?? DEFAULT_CANVAS_FORMAT);
    return `${canvasSizeLabel(this.store.canvas())} · ${ratio} · ${OBS_FPS} fps`;
  });
  protected readonly settings = signal<OutputSettingsDto | null>(null);
  protected readonly loadError = signal<Msg | null>(null);
  /** The link whose real URL is shown because copying failed (it is selected for Ctrl+C). */
  protected readonly revealedId = signal<string | null>(null);

  protected readonly status = this.store.outputStatus;
  protected readonly rows = computed<LinkRow[]>(() =>
    (this.settings()?.links ?? []).map((link) => {
      const entry = this.status()?.links.find((candidate) => candidate.linkId === link.id);
      const state = entry?.state ?? 'none';
      const blocked = state === 'connected' && entry?.audio?.state === 'blocked';
      return {
        link,
        state: blocked
          ? `${linkStateText(state)} · ${t('regie.audio.output.blocked')}`
          : linkStateText(state),
        stateClass:
          state === 'connected' && !blocked
            ? 'c-state--ok'
            : state === 'none'
              ? ''
              : 'c-state--warn',
        lamp: state === 'connected' ? '' : state === 'stale' ? 'is-warn' : 'is-idle',
        url: this.revealedId() === link.id ? link.url : maskOutputUrl(link.url),
        title: state === 'none' ? this.lastSeenText(link) : null,
      };
    }),
  );
  protected readonly stateText = computed(() => {
    const status = this.status();
    switch (status?.state) {
      case 'connected':
        return t('regie.header.output.stateConnected', { count: status.consumers });
      case 'stale':
        return t('regie.header.output.stateStale');
      default:
        return t('regie.header.output.stateNone');
    }
  });
  protected readonly stateClass = computed(() => {
    switch (this.status()?.state) {
      case 'connected':
        return 'c-state--ok';
      case 'stale':
        return 'c-state--warn';
      default:
        return 'c-output-pop__muted';
    }
  });
  protected readonly addresses = computed(() => {
    const addresses = this.status()?.addresses ?? [];
    return addresses.length > 0 ? addresses.join(', ') : '–';
  });
  protected readonly latency = computed(() => {
    const latency = this.status()?.latencyMs;
    return latency === null || latency === undefined ? null : `${Math.round(latency)} ms`;
  });
  private readonly playback = computed(() => outputLoad(this.status()));
  /** "3 streams · 2 in software": what the output page decodes; null while it reports nothing. */
  protected readonly decoding = computed(() => {
    const { decodedStreams, softwareStreams } = this.playback();
    if (decodedStreams === null) {
      return null;
    }
    const streams = t('regie.load.output.streams', { count: decodedStreams });
    return softwareStreams
      ? `${streams} · ${t('regie.load.output.inSoftware', { count: softwareStreams })}`
      : streams;
  });
  /** Software decoding is worth a look (orange); hardware decoding or none is calm. */
  protected readonly decodingClass = computed(() =>
    (this.playback().softwareStreams ?? 0) > 0 ? 'c-state--warn' : '',
  );
  /** "12 %": the share of dropped frames; null while the page reports nothing. */
  protected readonly dropped = computed(() => {
    const { droppedPct } = this.playback();
    return droppedPct === null ? null : formatPercent(droppedPct);
  });
  protected readonly droppedClass = computed(() =>
    this.playback().dropping ? 'c-state--warn' : '',
  );
  /** What to do about dropped frames, in words (instead of a tooltip only); null while the page keeps up. */
  protected readonly droppingHint = computed(() => {
    const { dropping, droppedPct } = this.playback();
    return dropping && droppedPct !== null
      ? t('regie.load.output.droppingHint', { percent: formatPercent(droppedPct) })
      : null;
  });
  /** A connected output page cannot play sound yet (the browser waits for a click). */
  protected readonly audioBlocked = computed(() =>
    (this.status()?.links ?? []).some(
      (link) => link.state === 'connected' && link.audio?.state === 'blocked',
    ),
  );
  /** Changes whenever a link appears, goes, is renamed or changes its state. */
  private readonly stateKey = computed(() =>
    (this.status()?.links ?? [])
      .map((link) => `${link.linkId}:${link.name}:${link.state}`)
      .join('|'),
  );

  constructor() {
    void this.load();
    effect(() => {
      const key = this.stateKey();
      untracked(() => {
        if (this.lastStateKey !== null && key !== this.lastStateKey) {
          void this.load();
        }
        this.lastStateKey = key;
      });
    });
  }

  /** (Re)loads the links. */
  protected async load(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId) {
      return;
    }
    this.loadError.set(null);
    try {
      this.settings.set(await this.api.getOutputSettings(productionId));
    } catch (error) {
      this.loadError.set(toUserMsg(error));
    }
  }

  /** Copies the full URL of a link; where the clipboard is refused, its real URL is shown and selected. */
  protected async copy(link: OutputLinkDto): Promise<void> {
    const copied = await this.clipboard.copy(link.url, { label: maskOutputUrl(link.url) });
    if (!copied) {
      this.revealedId.set(link.id);
      afterNextRender(
        () =>
          this.clipboard.selectContents(
            this.host.nativeElement.querySelector<HTMLElement>(`[data-url="${link.id}"]`),
          ),
        { injector: this.injector },
      );
    }
  }

  /**
   * The right-click menu of a link: copy it, or manage it in the settings window. The click on the menu closes the
   * popover; when the clipboard refuses, the popover opens again, where the copy button shows the real link.
   */
  protected readonly menuOf = (link: OutputLinkDto) => (): readonly ContextMenuEntry[] => [
    { label: t('regie.output.menu.copy'), icon: 'copy', run: () => void this.copyFromMenu(link) },
    'separator',
    {
      label: t('regie.output.pop.manage'),
      icon: 'sliders',
      run: () => {
        this.close();
        void this.router.navigateByUrl('/settings/output');
      },
    },
  ];

  private async copyFromMenu(link: OutputLinkDto): Promise<void> {
    if (!(await this.clipboard.copy(link.url, { label: maskOutputUrl(link.url) }))) {
      // The popover's own copy button shows the real link to copy by hand.
      this.popovers.open(this.popoverId);
    }
  }

  /** "Manage output links…" leads to the settings window; the popover closes on the way. */
  protected close(): void {
    this.popovers.close(this.popoverId);
  }

  private lastSeenText(link: OutputLinkDto): string {
    return link.lastSeenAt
      ? t('regie.output.link.lastSeen', { time: formatDateTime(new Date(link.lastSeenAt)) })
      : t('regie.output.link.neverSeen');
  }
}
