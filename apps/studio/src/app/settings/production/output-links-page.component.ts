import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDateTime, t, tm, type Msg } from '@studioflow/i18n';
import type { OutputLinkDto, OutputSettingsDto } from '@studioflow/scene-model';
import { toUserMsg } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import {
  ContextMenuDirective,
  ContextMenuService,
  type ContextMenuEntry,
} from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { isTypingTarget } from '../../core/ui/keyboard.service';
import { ToastService } from '../../core/ui/toast.service';
import {
  LINK_NAME_MAX,
  OutputLinkComponent,
  requiredName,
} from '../../shell/header/output-link.component';
import { linkStateText } from '../../shell/header/output-popover.component';
import { DEFAULT_LINK_OPTIONS, maskOutputUrl, outputLinkUrl } from '../../shell/header/output-url';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { moveRowFocus } from './tab-keys';

/** Width of the row menu, to right-align it to the "⋯" button. */
const MENU_WIDTH = 220;

/** One line of the link list: the link, its lamp and what its state is in words. */
interface LinkRow {
  readonly link: OutputLinkDto;
  readonly lamp: string;
  readonly state: string;
  readonly detail: string | null;
}

/**
 * Settings › Production › Output links (`/settings/output`): every named output link of the production with its lamp,
 * its state and when it was last seen; a row opens the link below it (`sf-output-link`: name, link and options, access,
 * use as camera, new link, revoke). The last row adds a link. The websites that may embed the output are shown read
 * only, with the way to the server setting. Reloads whenever a link changes its state, so "last seen" stays current.
 * A row has a right-click menu and a "⋯" button with the same commands (copy, show, rename, new link, revoke); on a
 * focused row F2 renames, Delete or Backspace asks to revoke, ↑/↓ move to the neighbouring link.
 */
@Component({
  selector: 'sf-output-links-page',
  imports: [
    ContextMenuDirective,
    IconComponent,
    OutputLinkComponent,
    ReactiveFormsModule,
    RouterLink,
    SettingsPageHeadComponent,
  ],
  templateUrl: './output-links-page.component.html',
  styleUrl: './output-links-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputLinksPageComponent {
  private readonly api = inject(StudioApiService);
  protected readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);
  private readonly clipboard = inject(ClipboardService);
  private readonly menus = inject(ContextMenuService);
  private readonly injector = inject(Injector);
  private readonly details = viewChildren(OutputLinkComponent);
  private lastStateKey: string | null = null;
  private loadedFor: string | null = null;

  protected readonly t = t;
  protected readonly tm = tm;
  protected readonly nameMax = LINK_NAME_MAX;
  protected readonly settings = signal<OutputSettingsDto | null>(null);
  protected readonly loadError = signal<Msg | null>(null);
  /** Links whose detail is open below their row. */
  protected readonly open = signal<ReadonlySet<string>>(new Set());
  protected readonly adding = signal(false);
  protected readonly newName = new FormControl('', {
    nonNullable: true,
    validators: [
      requiredName,
      Validators.maxLength(LINK_NAME_MAX),
      (control: AbstractControl<string>): ValidationErrors | null => this.takenName(control.value),
    ],
  });

  protected readonly links = computed(() => this.settings()?.links ?? []);
  protected readonly atLimit = computed(() => {
    const settings = this.settings();
    return settings !== null && settings.links.length >= settings.maxLinks;
  });
  protected readonly rows = computed<LinkRow[]>(() => {
    const status = this.store.outputStatus();
    return this.links().map((link) => {
      const entry = status?.links.find((candidate) => candidate.linkId === link.id);
      const state = entry?.state ?? 'none';
      const words = [linkStateText(state)];
      if (state === 'connected' && entry) {
        words.push(t('regie.output.link.pages', { count: entry.consumers }));
        if (entry.audio?.state === 'blocked') {
          words.push(t('regie.audio.output.blocked'));
        }
      }
      return {
        link,
        lamp: state === 'connected' ? '' : state === 'stale' ? 'is-warn' : 'is-idle',
        state: words.join(' · '),
        detail: state === 'none' ? this.lastSeenText(link) : null,
      };
    });
  });
  /** The websites allowed to frame the output, `'self'` in words. */
  protected readonly ancestors = computed(() =>
    (this.settings()?.frameAncestors ?? []).map((origin) =>
      origin === "'self'" ? t('regie.output.embed.self') : origin,
    ),
  );
  /** Changes whenever a link appears, goes, is renamed or changes its state. */
  private readonly stateKey = computed(() =>
    (this.store.outputStatus()?.links ?? [])
      .map((link) => `${link.linkId}:${link.name}:${link.state}`)
      .join('|'),
  );

  constructor() {
    // Loads the links of the active production, and again when a link changes its state.
    effect(() => {
      const productionId = this.store.productionId();
      const key = this.stateKey();
      untracked(() => {
        if (productionId !== this.loadedFor) {
          this.loadedFor = productionId;
          this.lastStateKey = key;
          void this.load(true);
        } else if (key !== this.lastStateKey) {
          this.lastStateKey = key;
          void this.load(false);
        }
      });
    });
  }

  /** (Re)loads the links, the limit and the frame ancestors; the first load opens the first link. */
  protected async load(first = false): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId) {
      return;
    }
    this.loadError.set(null);
    try {
      const settings = await this.api.getOutputSettings(productionId);
      this.settings.set(settings);
      if (first && settings.links[0]) {
        this.open.set(new Set([settings.links[0].id]));
      }
    } catch (error) {
      this.loadError.set(toUserMsg(error));
    }
  }

  protected isOpen(linkId: string): boolean {
    return this.open().has(linkId);
  }

  protected toggle(linkId: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(linkId)) {
        next.add(linkId);
      }
      return next;
    });
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
      this.open.update((open) => new Set([...open, created.id]));
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
    this.open.update((open) => new Set([...open].filter((id) => id !== linkId)));
  }

  /** The commands of a link, for its right-click menu and its "⋯" button. */
  protected readonly menuOf = (link: OutputLinkDto) => (): readonly ContextMenuEntry[] => {
    const online = this.store.canCommand();
    const revealed = this.detailOf(link.id)?.revealed() ?? false;
    return [
      { label: t('regie.output.menu.copy'), icon: 'copy', run: () => void this.copy(link) },
      {
        label: t(revealed ? 'regie.output.detail.hide' : 'regie.output.detail.show'),
        icon: revealed ? 'eye-off' : 'eye',
        run: () =>
          revealed
            ? this.detailOf(link.id)?.revealed.set(false)
            : this.withDetail(link.id, (detail) => detail.reveal()),
      },
      'separator',
      {
        label: t('regie.output.link.rename'),
        icon: 'pencil',
        shortcut: 'F2',
        disabled: !online,
        run: () => this.withDetail(link.id, (detail) => detail.startRename()),
      },
      {
        label: t('regie.output.renew.button'),
        icon: 'refresh',
        disabled: !online,
        run: () => this.withDetail(link.id, (detail) => detail.askRenew()),
      },
      'separator',
      {
        label: t('regie.output.revoke.button'),
        icon: 'trash',
        shortcut: t('regie.output.menu.deleteKey'),
        danger: true,
        disabled: !online,
        run: () => this.withDetail(link.id, (detail) => detail.askRevoke()),
      },
    ];
  };

  /** "⋯": the same menu, below the button and right-aligned to it. */
  protected openMenuAt(event: MouseEvent, link: OutputLinkDto): void {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.menus.open(
      this.menuOf(link)(),
      { x: Math.max(8, rect.right - MENU_WIDTH), y: rect.bottom + 4 },
      { label: t('regie.output.link.keyLabel', { name: link.name }), returnFocus: button },
    );
  }

  /** F2 renames, Delete or Backspace asks to revoke, ↑/↓ move between the links (Enter and Space open the row). */
  protected onRowKeyDown(event: KeyboardEvent, link: OutputLinkDto): void {
    if (isTypingTarget(event.target as Element)) {
      return;
    }
    if (moveRowFocus(event, '.c-links__item', '.c-links__row')) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (!this.store.canCommand()) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.withDetail(link.id, (detail) => detail.startRename());
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.withDetail(link.id, (detail) => detail.askRevoke());
    }
  }

  /** Copies the link (with the options chosen in its open detail); when the clipboard refuses, the detail shows it. */
  protected async copy(link: OutputLinkDto): Promise<void> {
    const detail = this.detailOf(link.id);
    if (detail) {
      await detail.copy();
      return;
    }
    const url = outputLinkUrl(link.url, DEFAULT_LINK_OPTIONS);
    if (!(await this.clipboard.copy(url, { label: maskOutputUrl(url) }))) {
      this.withDetail(link.id, (open) => void open.copy());
    }
  }

  private detailOf(linkId: string): OutputLinkComponent | undefined {
    return this.details().find((detail) => detail.link().id === linkId);
  }

  /** Opens the detail of a link (if it is closed) and runs a command on it once it is there. */
  private withDetail(linkId: string, command: (detail: OutputLinkComponent) => void): void {
    const open = this.detailOf(linkId);
    if (open) {
      command(open);
      return;
    }
    this.open.update((ids) => new Set([...ids, linkId]));
    afterNextRender(
      () => {
        const detail = this.detailOf(linkId);
        if (detail) {
          command(detail);
        }
      },
      { injector: this.injector },
    );
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
