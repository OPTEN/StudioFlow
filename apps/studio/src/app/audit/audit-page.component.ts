import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { formatDateTime, getLocale, msg, t, tm } from '@studioflow/i18n';
import {
  logEntryText,
  type AuditCategory,
  type AuditEntryDto,
  type ProductionSummaryDto,
} from '@studioflow/scene-model';
import { toUserMessage } from '../core/api/api-error';
import { StudioApiService, type AuditQuery } from '../core/api/studio-api.service';
import { IconComponent } from '../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../core/ui/popover.directive';
import { ToastService } from '../core/ui/toast.service';
import { SettingsPageHeadComponent } from '../settings/pages/settings-page-head.component';
import {
  AUDIT_CATEGORIES,
  BROADCAST_QUERY,
  NO_FILTERS,
  NO_PRODUCTION,
  auditQuery,
  hasFilters,
  isCustomRangeInvalid,
  lastBroadcastRange,
  type AuditFilters,
  type AuditRange,
  type BroadcastRange,
} from './audit-filters';
import { AuditLogStore } from './audit-log.store';
import { AUDIT_CATEGORY_KEYS, actorLabel, detailRows, productionLabel } from './audit-view';
import { FILE_SAVER } from './save-file';

/** Pause after the last key before the search text is applied. */
export const SEARCH_DEBOUNCE_MS = 300;

/** How often the page looks for new entries while it is open. */
export const AUDIT_REFRESH_MS = 15_000;

/** Id of the export menu (PopoverService). */
export const EXPORT_MENU = 'audit-export';

/**
 * The activity log `/audit` (issue #17) in the settings window: who did what and when. Newest entries first, loaded
 * page by page (a button, and automatically when it scrolls into view). The filters sit on one row (time range,
 * production, search) with the categories as toggle chips below; "Last broadcast" names the production and the times
 * it shows. The details of an entry open on demand with plain labels (when, who, event code) before the raw values,
 * and the "Export" menu saves the filtered entries as CSV or JSON. New entries are added at the top while the page is
 * open. Read only.
 */
@Component({
  selector: 'sf-audit-page',
  imports: [IconComponent, PopoverDirective, PopoverTriggerDirective, SettingsPageHeadComponent],
  providers: [AuditLogStore],
  templateUrl: './audit-page.component.html',
  styleUrl: './audit-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPageComponent {
  protected readonly t = t;
  protected readonly log = inject(AuditLogStore);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly saveFile = inject(FILE_SAVER);
  protected readonly popovers = inject(PopoverService);
  protected readonly exportMenu = EXPORT_MENU;

  protected readonly categories = AUDIT_CATEGORIES;
  protected readonly categoryKeys = AUDIT_CATEGORY_KEYS;
  protected readonly ranges: readonly AuditRange[] = ['any', 'today', 'lastBroadcast', 'custom'];
  protected readonly noProduction = NO_PRODUCTION;

  /** The filters that are applied to the list; the search text follows the input after a pause. */
  protected readonly filters = signal<AuditFilters>(NO_FILTERS);
  protected readonly searchDraft = signal('');
  protected readonly productions = signal<readonly ProductionSummaryDto[]>([]);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly exporting = signal(false);
  /** A sentence under the filters when the range could not be resolved ("no broadcast yet"). */
  protected readonly rangeNote = signal<string | null>(null);
  /** The broadcast "Last broadcast" shows: its production and times, so the filter never changes silently. */
  private readonly broadcastShown = signal<{ production: string; range: BroadcastRange } | null>(
    null,
  );
  protected readonly broadcastText = computed(() => {
    const shown = this.broadcastShown();
    if (!shown) {
      return null;
    }
    const name =
      this.productions().find((production) => production.id === shown.production)?.name ??
      shown.production;
    const from = formatDateTime(new Date(shown.range.from));
    return shown.range.to === null
      ? t('regie.audit.range.broadcastLive', { name, from })
      : t('regie.audit.range.broadcast', {
          name,
          from,
          to: formatDateTime(new Date(shown.range.to)),
        });
  });

  protected readonly rangeInvalid = computed(() => isCustomRangeInvalid(this.filters()));
  protected readonly filtered = computed(() => hasFilters(this.filters()));
  protected readonly loadMoreAnchor = viewChild<ElementRef<HTMLElement>>('loadMoreAnchor');

  /** The request for the list of productions while it is on its way: "Last broadcast" needs it to find the active one. */
  private productionsPending: Promise<void> | null = this.loadProductions();
  private lastQuery: AuditQuery | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private resolution = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const filters = this.filters();
      untracked(() => void this.apply(filters));
    });

    const refresh = setInterval(() => {
      if (!document.hidden) {
        void this.log.refreshHead();
      }
    }, AUDIT_REFRESH_MS);
    destroyRef.onDestroy(() => {
      clearInterval(refresh);
      this.clearSearchTimer();
    });

    // The next page loads by itself when the button comes into view; the button stays for the keyboard.
    effect((onCleanup) => {
      const anchor = this.loadMoreAnchor()?.nativeElement;
      if (typeof IntersectionObserver === 'undefined' || anchor === undefined) {
        return;
      }
      const observer = new IntersectionObserver((hits) => {
        if (hits.some((hit) => hit.isIntersecting)) {
          void this.log.loadMore();
        }
      });
      observer.observe(anchor);
      onCleanup(() => observer.disconnect());
    });
  }

  protected entryText(entry: AuditEntryDto): string {
    return logEntryText(entry);
  }

  protected time(entry: AuditEntryDto): string {
    return formatDateTime(new Date(entry.at), { seconds: true });
  }

  /** The exact time in UTC, readable: "2026-10-26 11:00:00.250". */
  protected utc(entry: AuditEntryDto): string {
    const date = new Date(entry.at);
    return Number.isNaN(date.getTime())
      ? entry.at
      : date.toISOString().replace('T', ' ').replace('Z', '');
  }

  protected actor(entry: AuditEntryDto): string {
    return actorLabel(entry);
  }

  protected production(entry: AuditEntryDto): string {
    return productionLabel(entry);
  }

  protected details(entry: AuditEntryDto): readonly { key: string; value: string }[] {
    return detailRows(entry);
  }

  protected productionOptionName(production: ProductionSummaryDto): string {
    return production.isActive
      ? t('regie.audit.production.active', { name: production.name })
      : production.name;
  }

  protected isCategoryOn(category: AuditCategory): boolean {
    return this.filters().categories.includes(category);
  }

  protected isExpanded(entry: AuditEntryDto): boolean {
    return this.expanded().has(entry.id);
  }

  protected toggle(entry: AuditEntryDto): void {
    this.expanded.update((open) => {
      const next = new Set(open);
      if (!next.delete(entry.id)) {
        next.add(entry.id);
      }
      return next;
    });
  }

  protected toggleLabel(entry: AuditEntryDto): string {
    return t(this.isExpanded(entry) ? 'regie.audit.details.hide' : 'regie.audit.details.show', {
      time: this.time(entry),
    });
  }

  protected setRange(value: string): void {
    const range = this.ranges.find((candidate) => candidate === value);
    if (range !== undefined) {
      this.filters.update((filters) => ({ ...filters, range }));
    }
  }

  protected setCustomTime(field: 'from' | 'to', value: string): void {
    this.filters.update((filters) => ({ ...filters, [field]: value }));
  }

  protected setProduction(production: string): void {
    this.filters.update((filters) => ({ ...filters, production }));
  }

  protected toggleCategory(category: AuditCategory): void {
    this.filters.update((filters) => ({
      ...filters,
      categories: filters.categories.includes(category)
        ? filters.categories.filter((on) => on !== category)
        : [...filters.categories, category],
    }));
  }

  /** The text of the search box is applied after a short pause, so typing does not send a request per key. */
  protected search(text: string): void {
    this.searchDraft.set(text);
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.filters.update((filters) => ({ ...filters, text }));
    }, SEARCH_DEBOUNCE_MS);
  }

  protected clearFilters(): void {
    this.clearSearchTimer();
    this.searchDraft.set('');
    this.filters.set(NO_FILTERS);
  }

  protected retry(): void {
    void this.apply(this.filters());
  }

  protected loadMore(): void {
    void this.log.loadMore();
  }

  protected async exportAs(format: 'csv' | 'json'): Promise<void> {
    const query = this.lastQuery;
    this.popovers.close(EXPORT_MENU);
    if (!query || this.exporting()) {
      return;
    }
    this.exporting.set(true);
    try {
      const { limit: _limit, cursor: _cursor, ...filter } = query;
      const file = await this.api.exportAuditLog(format, {
        ...filter,
        separator: format === 'csv' && getLocale() === 'de-CH' ? 'semicolon' : undefined,
      });
      this.saveFile(file.text, file.fileName);
      this.toasts.show(t('regie.audit.export.done', { name: file.fileName }));
    } catch (error) {
      this.toasts.show(toUserMessage(error, { limit_reached: msg('regie.audit.export.tooLarge') }));
    } finally {
      this.exporting.set(false);
    }
  }

  /** Arrow keys move between the items of the export menu, as in a system menu. */
  protected menuKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const menu = event.currentTarget as HTMLElement;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
    event.preventDefault();
  }

  protected errorText(): string {
    const error = this.log.error();
    return error === null ? tm(msg('regie.audit.error.load')) : toUserMessage(error);
  }

  private async loadProductions(): Promise<void> {
    try {
      this.productions.set(await this.api.listProductions());
    } catch {
      // The filter then offers "All productions" only.
    } finally {
      this.productionsPending = null;
    }
  }

  /** Resolves the range of the filters and loads the first page for it. */
  private async apply(filters: AuditFilters): Promise<void> {
    const resolution = ++this.resolution;
    this.rangeNote.set(null);
    this.broadcastShown.set(null);
    if (isCustomRangeInvalid(filters)) {
      return;
    }
    let broadcast: BroadcastRange | null = null;
    if (filters.range === 'lastBroadcast') {
      if (filters.production === '') {
        if (this.productionsPending !== null) {
          // The operator was quicker than the list of productions: without it no production is active yet.
          await this.productionsPending;
          if (resolution !== this.resolution) {
            return;
          }
        }
        if (this.chooseActiveProduction()) {
          return;
        }
      }
      broadcast = await this.findLastBroadcast(filters.production);
      if (resolution !== this.resolution) {
        return;
      }
      if (broadcast === null) {
        this.showNothing();
        return;
      }
      this.broadcastShown.set({ production: filters.production, range: broadcast });
    }
    const query = auditQuery(filters, new Date(), broadcast);
    this.lastQuery = query;
    this.expanded.set(new Set());
    await this.log.load(query);
  }

  /** An empty list for a filter that cannot match, and nothing to export. */
  private showNothing(): void {
    this.lastQuery = null;
    this.log.clear();
  }

  /** "Last broadcast" without a production means the active one: chooses it, which applies the filters again. */
  private chooseActiveProduction(): boolean {
    const active = this.productions().find((production) => production.isActive);
    if (active === undefined) {
      this.rangeNote.set(t('regie.audit.range.noProduction'));
      this.showNothing();
      return false;
    }
    this.filters.update((filters) => ({ ...filters, production: active.id }));
    return true;
  }

  /** The range of the latest broadcast of a production; says why in {@link rangeNote} when there is none. */
  private async findLastBroadcast(production: string): Promise<BroadcastRange | null> {
    if (production === NO_PRODUCTION || production === '') {
      this.rangeNote.set(t('regie.audit.range.noProduction'));
      return null;
    }
    try {
      const page = await this.api.listAuditLog({ ...BROADCAST_QUERY, production });
      const range = lastBroadcastRange(page.entries);
      if (range === null) {
        this.rangeNote.set(t('regie.audit.range.noBroadcast'));
      }
      return range;
    } catch (error) {
      this.rangeNote.set(toUserMessage(error));
      return null;
    }
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }
}
