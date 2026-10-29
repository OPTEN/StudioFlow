import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { SwitcherService } from '../../stage/switcher.service';

/**
 * The capsule that says where a scene is: the filled red "Live" while it is the Program, the green "Preview" while it is
 * in the Preview of Studio Mode, nothing otherwise. Used next to the scene name in the Sources and Properties docks,
 * the same capsules as on the scene rows.
 */
@Component({
  selector: 'sf-scene-tag',
  template: `
    @if (place() === 'program') {
      <span class="c-tag c-tag--pgm">{{ t('regie.scenes.row.live') }}</span>
    } @else if (place() === 'preview') {
      <span class="c-tag c-tag--pvw">{{ t('regie.scenes.row.preview') }}</span>
    }
  `,
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneTagComponent {
  /** The scene whose place is shown. */
  readonly sceneId = input.required<string | null>();

  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);

  protected readonly t = t;
  protected readonly place = computed<'program' | 'preview' | null>(() => {
    const id = this.sceneId();
    if (id === null) {
      return null;
    }
    if (id === this.store.programSceneId()) {
      return 'program';
    }
    return this.switcher.studioMode() && id === this.store.previewSceneId() ? 'preview' : null;
  });
}
