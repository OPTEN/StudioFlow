import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { SourceDto, SourceKind } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { KIND_ICON, sourceStateView, toneClass } from '../shared/source-view';
import { PlaceholderCommandsService } from './placeholder-commands.service';
import { assignableGroups, placeholderRows, type PlaceholderRowView } from './placeholder-view';

/**
 * "Missing sources" in the Sources dock (issue #14): the cameras and screens of the production this one was copied from,
 * which no device has taken over yet. Each row shows the code and name of the original, where it is used, and
 * "Assign…": the list of cameras, screens and media opens below the row, and one click on a source makes every scene
 * show it in place of the placeholder (a new phone that no scene uses yet becomes K1 itself). "Remove from all scenes…"
 * deletes the placeholder and the items that show it, behind a dashed red confirmation. The list is empty (and the
 * section absent) in a production that was not copied.
 */
@Component({
  selector: 'sf-placeholder-list',
  imports: [ConfirmBoxComponent, ContextMenuDirective, IconComponent],
  templateUrl: './placeholder-list.component.html',
  styleUrl: './placeholder-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderListComponent {
  protected readonly commands = inject(PlaceholderCommandsService);
  private readonly store = inject(ProductionStoreService);

  protected readonly t = t;
  /** The row whose source list is open. */
  protected readonly picking = signal<string | null>(null);
  /** The row whose removal asks for a confirmation. */
  protected readonly removing = signal<string | null>(null);

  protected readonly rows = computed(() =>
    placeholderRows(this.store.placeholders(), this.store.scenes()),
  );
  protected readonly groups = computed(() => assignableGroups(this.store.sources()));

  protected icon(kind: SourceKind): (typeof KIND_ICON)[SourceKind] {
    return KIND_ICON[kind];
  }

  protected stateOf(source: SourceDto): { word: string; className: string } | null {
    const state = sourceStateView(source);
    return state ? { word: state.word, className: toneClass(state.tone) } : null;
  }

  /** Right click on a row: the same two commands as its "Assign…" list. */
  protected rowMenu(row: PlaceholderRowView): () => readonly ContextMenuEntry[] {
    return () => [
      {
        label: t('regie.placeholders.assign.button'),
        icon: 'link',
        disabled: this.commands.blocked(row.id),
        run: () => {
          this.removing.set(null);
          this.picking.set(row.id);
        },
      },
      'separator',
      {
        label: t('regie.placeholders.assign.remove'),
        icon: 'trash',
        danger: true,
        disabled: this.commands.blocked(row.id),
        run: () => {
          this.picking.set(row.id);
          this.removing.set(row.id);
        },
      },
    ];
  }

  /** Opens or closes the list of sources of the row; the removal confirmation closes. */
  protected toggle(row: PlaceholderRowView): void {
    this.removing.set(null);
    this.picking.update((id) => (id === row.id ? null : row.id));
  }

  protected askRemove(row: PlaceholderRowView): void {
    this.removing.set(row.id);
  }

  protected async assign(row: PlaceholderRowView, source: SourceDto): Promise<void> {
    const placeholder = this.store.placeholders().find((entry) => entry.id === row.id);
    if (placeholder && (await this.commands.assign(placeholder, source))) {
      this.picking.set(null);
    }
  }

  protected async remove(row: PlaceholderRowView): Promise<void> {
    const placeholder = this.store.placeholders().find((entry) => entry.id === row.id);
    if (placeholder && (await this.commands.remove(placeholder))) {
      this.removing.set(null);
      this.picking.set(null);
    }
  }
}
