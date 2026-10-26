import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import type { SceneDto, SceneItemDto, TextSourceDto } from '@studioflow/scene-model';
import type { SceneRenderer } from '@studioflow/scene-renderer';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { PlaceholderMediaProvider } from '../../stage/placeholder-media-provider';
import { SCENE_RENDERER_FACTORY } from '../../stage/scene-view.component';

/**
 * Live preview of one text in the Properties dock: the real scene renderer draws the text with the production colours
 * and the item's rectangle on a neutral ground, whether the text is shown on the output or not. It shows the content as
 * it is typed (`text`), not the saved one, so the operator sees the result before the change reaches the output.
 */
@Component({
  selector: 'sf-text-preview',
  template: '',
  styles: `
    :host {
      aspect-ratio: 16 / 9;
      background: var(--slot);
      border: 1px solid var(--seam);
      border-radius: var(--radius-md);
      display: block;
      overflow: hidden;
      position: relative;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextPreviewComponent {
  /** The item the text is shown with (its rectangle decides where and how large the text is). */
  readonly item = input.required<SceneItemDto>();
  /** The content to draw: the draft of the editor. */
  readonly text = input.required<TextSourceDto>();

  private readonly store = inject(ProductionStoreService);
  private readonly factory = inject(SCENE_RENDERER_FACTORY);
  private readonly provider = inject(PlaceholderMediaProvider);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private renderer: SceneRenderer | null = null;

  constructor() {
    effect(() => {
      const item = this.item();
      // The effect redraws when the typed content or the production colours change.
      this.text();
      this.store.textTheme();
      untracked(() => this.draw(item));
    });
    inject(DestroyRef).onDestroy(() => this.renderer?.destroy());
  }

  private draw(item: SceneItemDto): void {
    this.renderer ??= this.factory(this.host, {
      mode: 'thumbnail',
      provider: this.provider,
      textOf: () => this.text(),
      textTheme: () => this.store.textTheme(),
      background: 'transparent',
      reducedMotion: true,
      label: t('regie.text.preview.label'),
      onError: (error) => console.warn('[StudioFlow] text preview', error),
    });
    const scene: SceneDto = {
      id: 'scn_textpreview',
      name: '',
      sortOrder: 0,
      version: 1,
      layoutMode: 'free',
      background: { color: '#000000', assetId: null },
      items: [{ ...item, hidden: false }],
    };
    this.renderer.show(scene);
    this.renderer.refresh();
  }
}
