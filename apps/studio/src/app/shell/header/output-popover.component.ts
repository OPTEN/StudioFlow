import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { formatDateTime, t, tm, type Msg } from '@studioflow/i18n';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type OutputLinkDto,
  type OutputSettingsDto,
  type OutputState,
} from '@studioflow/scene-model';
import { toUserMsg } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { LINK_NAME_MAX, OutputLinkComponent, requiredName } from './output-link.component';
import { OBS_FPS } from './obs-scene-collection';

/** Id of the output popover. */
export const OUTPUT_POPOVER = 'output';

/** One line of the link list: the link, its state and the text under its name. */
interface LinkRow {
  readonly link: OutputLinkDto;
  readonly state: OutputState;
  readonly stateText: string;
  readonly detail: string | null;
  readonly lamp: string;
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
 * Output popover (prototype `renderOutPop`, spec 4.8, 9.1): the summary of the output (state, consumers, format,
 * latency), the named output links with their own state ("Proxy · connected"), "Create link", and the selected link with
 * its URL, IP restriction, "Use as camera …", regenerate and revoke (`sf-output-link`). Loads the output settings when
 * it opens and again whenever a link changes its state, so "last seen" stays current.
 */
@Component({
  selector: 'sf-output-popover',
  imports: [OutputLinkComponent, PopoverDirective, ReactiveFormsModule],
  templateUrl: './output-popover.component.html',
  styleUrl: './output-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPopoverComponent {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);
  private lastStateKey: string | null = null;

  protected readonly popoverId = OUTPUT_POPOVER;
  protected readonly t = t;
  protected readonly tm = tm;
  protected readonly format = `${CANVAS_WIDTH} × ${CANVAS_HEIGHT} · ${OBS_FPS} fps`;
  protected readonly nameMax = LINK_NAME_MAX;
  protected readonly settings = signal<OutputSettingsDto | null>(null);
  protected readonly loadError = signal<Msg | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly newName = new FormControl('', {
    nonNullable: true,
    validators: [
      requiredName,
      Validators.maxLength(LINK_NAME_MAX),
      (control: AbstractControl<string>): ValidationErrors | null => this.takenName(control.value),
    ],
  });

  protected readonly status = this.store.outputStatus;
  protected readonly links = computed(() => this.settings()?.links ?? []);
  protected readonly selected = computed<OutputLinkDto | null>(
    () => this.links().find((link) => link.id === this.selectedId()) ?? this.links()[0] ?? null,
  );
  /** The selected link as a list: one `sf-output-link` per selected link, so its drafts never carry over to another link. */
  protected readonly selectedList = computed(() => {
    const selected = this.selected();
    return selected ? [selected] : [];
  });
  protected readonly atLimit = computed(() => {
    const settings = this.settings();
    return settings !== null && settings.links.length >= settings.maxLinks;
  });
  protected readonly rows = computed<LinkRow[]>(() =>
    this.links().map((link) => {
      const state = this.status()?.links.find((entry) => entry.linkId === link.id)?.state ?? 'none';
      return {
        link,
        state,
        stateText: linkStateText(state),
        detail: state === 'none' ? this.lastSeenText(link) : null,
        lamp: state === 'connected' ? '' : state === 'stale' ? 'is-warn' : 'is-idle',
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

  /** (Re)loads the links, the limit and the frame ancestors. */
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

  protected async addLink(event: Event): Promise<void> {
    event.preventDefault();
    const productionId = this.store.productionId();
    const name = this.newName.value.trim();
    if (!productionId || this.adding() || this.atLimit()) {
      return;
    }
    if (!name || this.newName.invalid) {
      this.newName.markAsTouched();
      return;
    }
    this.adding.set(true);
    try {
      const created = await this.api.createOutputLink(productionId, { name });
      this.settings.update((settings) =>
        settings ? { ...settings, links: [...settings.links, created] } : settings,
      );
      this.selectedId.set(created.id);
      this.newName.reset('');
      this.toasts.show(t('regie.output.link.created', { name: created.name }));
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.adding.set(false);
    }
  }

  protected onUpdated(updated: OutputLinkDto): void {
    this.settings.update((settings) =>
      settings
        ? {
            ...settings,
            links: settings.links.map((link) => (link.id === updated.id ? updated : link)),
          }
        : settings,
    );
  }

  protected onRevoked(linkId: string): void {
    this.settings.update((settings) =>
      settings
        ? { ...settings, links: settings.links.filter((link) => link.id !== linkId) }
        : settings,
    );
    this.selectedId.set(null);
  }

  private takenName(value: string): ValidationErrors | null {
    const name = value.trim().toLowerCase();
    return name && this.links().some((link) => link.name.toLowerCase() === name)
      ? { taken: true }
      : null;
  }

  private lastSeenText(link: OutputLinkDto): string {
    return link.lastSeenAt
      ? t('regie.output.link.lastSeen', { time: formatDateTime(new Date(link.lastSeenAt)) })
      : t('regie.output.link.neverSeen');
  }
}
