import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { TitleStrategy } from '@angular/router';
import { t } from '@studioflow/i18n';
import { StudioMediaService } from '../core/media/studio-media.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { StudioTitleStrategy } from '../core/ui/studio-title.strategy';
import { EditorService } from '../stage/editor.service';
import { SwitcherService } from '../stage/switcher.service';
import { HeaderComponent } from './header/header.component';
import { StatusLineComponent } from './status-line/status-line.component';
import { WorkspaceComponent } from './workspace/workspace.component';

/**
 * The control room `/` (prototype `.app`): toolbar, activity bar and workspace as one window separated by 1 px hairlines
 * (grid gap on the seam colour). Starts the production store (the media session follows once the store is live) and
 * registers the Regie shortcuts (1–9, Space, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, Escape; the toolbar adds ?).
 *
 * The document title carries the state of the room ("● On air · 2 issues · Webinar"), so a tab in the background still
 * tells that the broadcast runs or that a device has a problem.
 *
 * The host carries `is-studio` while Studio Mode is on, for styles in child components
 * (`:host-context(.is-studio)`).
 */
@Component({
  selector: 'sf-studio-page',
  imports: [HeaderComponent, StatusLineComponent, WorkspaceComponent],
  template: `
    <sf-header />
    <sf-status-line />
    <sf-workspace />
  `,
  styleUrl: './studio-page.component.scss',
  host: {
    '[class.is-studio]': 'switcher.studioMode()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioPageComponent {
  protected readonly switcher = inject(SwitcherService);
  private readonly store = inject(ProductionStoreService);

  /** "● On air · 2 issues · Webinar": the part of the document title in front of the app name. */
  protected readonly titleStatus = computed(() => {
    const parts: string[] = [];
    if (this.store.broadcast() === 'live') {
      parts.push(t('regie.core.title.onAir'));
    }
    const issues = this.store.openIncidents().length;
    if (issues > 0) {
      parts.push(t('regie.core.title.issues', { count: issues }));
    }
    const name = this.store.production()?.name;
    if (name) {
      parts.push(name);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  });

  constructor() {
    this.store.start();
    // Created here so the media session starts as soon as the store is live.
    inject(StudioMediaService);
    const editor = inject(EditorService);
    const offSwitcher = this.switcher.registerShortcuts();
    const offEditor = editor.registerShortcuts();
    const titles = inject(TitleStrategy, { optional: true });
    if (titles instanceof StudioTitleStrategy) {
      effect(() => titles.setStatus(this.titleStatus()));
    }
    inject(DestroyRef).onDestroy(() => {
      offSwitcher();
      offEditor();
      if (titles instanceof StudioTitleStrategy) {
        titles.setStatus(null);
      }
    });
  }
}
