import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { StudioMediaService } from '../core/media/studio-media.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { EditorService } from '../stage/editor.service';
import { SwitcherService } from '../stage/switcher.service';
import { HeaderComponent } from './header/header.component';
import { StatusLineComponent } from './status-line/status-line.component';
import { WorkspaceComponent } from './workspace/workspace.component';

/**
 * The Regie page `/` (prototype `.app`): header, message strip and workspace as one continuous console separated by
 * 1 px hairlines (grid gap on the seam colour). Starts the production store (the media session follows once the store
 * is live) and registers the Regie shortcuts (1–9, Space, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, Escape).
 *
 * The host carries `is-studio` while Studio-Modus is on, for styles in child components
 * (`:host-context(.is-studio)`).
 */
@Component({
  selector: 'fs-studio-page',
  imports: [HeaderComponent, StatusLineComponent, WorkspaceComponent],
  template: `
    <fs-header />
    <fs-status-line />
    <fs-workspace />
  `,
  styleUrl: './studio-page.component.scss',
  host: {
    lang: 'de-CH',
    '[class.is-studio]': 'switcher.studioMode()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudioPageComponent {
  protected readonly switcher = inject(SwitcherService);

  constructor() {
    inject(ProductionStoreService).start();
    // Created here so the media session starts as soon as the store is live.
    inject(StudioMediaService);
    const editor = inject(EditorService);
    const offSwitcher = this.switcher.registerShortcuts();
    const offEditor = editor.registerShortcuts();
    inject(DestroyRef).onDestroy(() => {
      offSwitcher();
      offEditor();
    });
  }
}
