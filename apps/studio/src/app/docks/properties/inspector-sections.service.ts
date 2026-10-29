import { Injectable, inject, signal } from '@angular/core';
import { BROWSER_STORAGE } from '../../core/ui/preferences.service';

/** Storage key of the collapsed inspector sections (this browser only). */
const STORAGE_KEY = 'studioflow.inspector';

/** The sections of the scene and element inspector. */
export type InspectorSectionId =
  'text' | 'layout' | 'background' | 'geometry' | 'fit' | 'style' | 'failure' | 'layer';

/** The tabs of the element inspector: Text (texts only), Layout, Style and When it fails (pictures only). */
export type InspectorTab = 'text' | 'layout' | 'style' | 'failure';

/**
 * Which sections of the Properties dock are collapsed, remembered in this browser: an operator who never crops can fold
 * "Fit & crop" away once. Every section starts open. A convenience only: unavailable or corrupt storage falls back to
 * everything open, and nothing here ever throws.
 */
@Injectable({ providedIn: 'root' })
export class InspectorSectionsService {
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly collapsed = signal<ReadonlySet<InspectorSectionId>>(this.read());
  private readonly tabSignal = signal<InspectorTab | null>(null);

  /**
   * The tab of the element inspector the operator chose last, or null (the first tab). Kept for this page only, so
   * selecting another item stays on "Style" while the operator styles one source after the other.
   */
  readonly tab = this.tabSignal.asReadonly();

  setTab(tab: InspectorTab): void {
    this.tabSignal.set(tab);
  }

  /** True while the section is open (reactive). */
  isOpen(id: InspectorSectionId): boolean {
    return !this.collapsed().has(id);
  }

  /** Opens or collapses a section and remembers it. */
  setOpen(id: InspectorSectionId, open: boolean): void {
    if (open === this.isOpen(id)) {
      return;
    }
    const next = new Set(this.collapsed());
    if (open) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.collapsed.set(next);
    this.write(next);
  }

  private read(): ReadonlySet<InspectorSectionId> {
    try {
      const parsed: unknown = JSON.parse(this.storage()?.getItem(STORAGE_KEY) ?? '[]');
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((entry): entry is InspectorSectionId => typeof entry === 'string')
          : [],
      );
    } catch {
      return new Set();
    }
  }

  private write(collapsed: ReadonlySet<InspectorSectionId>): void {
    try {
      this.storage()?.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Full or blocked storage: the sections still open and close, they are just not remembered.
    }
  }
}
