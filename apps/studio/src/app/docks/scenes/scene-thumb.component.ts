import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { SceneDto } from '@studioflow/scene-model';
import { SceneViewComponent } from '../../stage/scene-view.component';

/**
 * The 16:9 thumbnail of a scene row (prototype `.thumb canvas`): the stage's `SceneViewComponent` in thumbnail mode,
 * filling its host. Pictures come from the Regie's source provider (a small layer per source); until the media
 * connection exists the renderer shows the layout with dark placeholders and the real images.
 */
@Component({
  selector: 'sf-scene-thumb',
  imports: [SceneViewComponent],
  template: `<sf-scene-view
    class="c-scene-thumb__view"
    mode="thumbnail"
    [scene]="scene()"
    [label]="scene().name"
  />`,
  styles: `
    :host {
      border-radius: var(--radius-screen);
      display: block;
      inset: 0;
      // The renderer's layers stay below the keycap.
      isolation: isolate;
      overflow: hidden;
      position: absolute;
    }

    .c-scene-thumb__view {
      height: 100%;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneThumbComponent {
  /** The scene to show (with local drafts). */
  readonly scene = input.required<SceneDto>();
}
