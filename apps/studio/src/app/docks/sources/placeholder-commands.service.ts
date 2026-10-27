import { Injectable, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { SourceDto, SourcePlaceholderDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';
import { placeholderName } from './placeholder-view';

/**
 * The placeholder commands (issue #14): "Assign" (a source takes the place of the placeholder in every scene) and
 * "Remove" (the placeholder and the scene items that show it go). Each placeholder has its own lock ({@link busy}), the
 * commands go through {@link DockCommandService} (offline guard, error toasts in the active language) and confirm with a
 * toast. The scenes arrive over the hub as usual; nothing is changed locally.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderCommandsService {
  private readonly api = inject(StudioApiService);
  private readonly commands = inject(DockCommandService);
  private readonly toasts = inject(ToastService);

  /** True while a command for the placeholder runs. */
  busy(placeholderId: string): boolean {
    return this.commands.busy(this.key(placeholderId));
  }

  /** True when the buttons of the placeholder are disabled: a command runs, or the Regie is offline. */
  blocked(placeholderId: string): boolean {
    return this.commands.blocked(this.key(placeholderId));
  }

  /** "Use as K1": every item that shows the placeholder shows `source` from now on. */
  async assign(placeholder: SourcePlaceholderDto, source: SourceDto): Promise<boolean> {
    const done = await this.commands.run(this.key(placeholder.id), (productionId) =>
      this.api.assignPlaceholder(productionId, placeholder.id, { sourceId: source.id }),
    );
    if (done) {
      this.toasts.show(
        t('regie.placeholders.toast.assigned', {
          name: placeholderName(placeholder),
          target: source.label,
        }),
      );
    }
    return done !== undefined;
  }

  /** "Remove from all scenes": the placeholder and every item that shows it are deleted. */
  async remove(placeholder: SourcePlaceholderDto): Promise<boolean> {
    const done = await this.commands.run(this.key(placeholder.id), (productionId) =>
      this.api.removePlaceholder(productionId, placeholder.id),
    );
    if (done) {
      this.toasts.show(
        t('regie.placeholders.toast.removed', { name: placeholderName(placeholder) }),
      );
    }
    return done !== undefined;
  }

  private key(placeholderId: string): string {
    return `placeholder:${placeholderId}`;
  }
}
