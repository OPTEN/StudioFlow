import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent, type IconName } from '../../core/ui/icon.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';

/** What the status line says, or nothing while editing is safe. */
interface EditStatus {
  readonly icon: IconName;
  readonly text: string;
  /** Edits go on air while the broadcast runs: red (colour is state), otherwise a neutral note. */
  readonly onAir: boolean;
}

/**
 * The status line at the top of the editing docks (Sources, Properties): why nothing can be edited (no connection, or
 * the live scene in Studio Mode with Preview = Program), or that every edit goes on air at once (the live scene without
 * Studio Mode). That last note is red only while the broadcast is on air, otherwise neutral, like "Changes go live
 * immediately" on the stage. Nothing is shown while the Preview scene is edited in Studio Mode. A plain paragraph, not a
 * live region: it follows every scene switch and would otherwise be announced each time.
 */
@Component({
  selector: 'sf-edit-status',
  imports: [IconComponent],
  template: `
    @if (status(); as status) {
      <p class="c-edit-status" [class.is-on-air]="status.onAir">
        <svg [sfIcon]="status.icon" [size]="14"></svg><span>{{ status.text }}</span>
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .c-edit-status {
      align-items: flex-start;
      border-radius: var(--radius-sm);
      color: var(--muted);
      display: flex;
      font-size: var(--fs-footnote);
      gap: 6px;
      line-height: 1.35;
      margin: 0;
      padding: 5px 8px;

      .c-icon {
        flex: none;
        margin-top: 1px;
      }
    }

    .c-edit-status.is-on-air {
      background: var(--red-wash);
      color: var(--red);
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditStatusComponent {
  private readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);

  protected readonly status = computed<EditStatus | null>(() => {
    if (this.store.state() === null || this.editor.editScene() === null) {
      return null;
    }
    if (!this.store.canCommand()) {
      return { icon: 'alert', text: t('regie.sources.status.offline'), onAir: false };
    }
    if (this.editor.editLocked()) {
      return { icon: 'lock', text: t('regie.sources.status.locked'), onAir: false };
    }
    if (!this.switcher.studioMode()) {
      return {
        icon: 'alert',
        text: t('regie.sources.status.live'),
        onAir: this.store.broadcast() === 'live',
      };
    }
    return null;
  });
}
