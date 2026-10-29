import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  textItemRect,
  type CanvasSize,
  type SceneDto,
  type SceneItemDto,
  type SlateDto,
  type TextSourceDto,
  type TextStyle,
  type TextThemeDto,
} from '@studioflow/scene-model';
import type { SceneRenderer } from '@studioflow/scene-renderer';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { PlaceholderMediaProvider } from '../../stage/placeholder-media-provider';
import { SCENE_RENDERER_FACTORY } from '../../stage/scene-view.component';

/** The largest box the picture may take; the canvas shape decides which side it fills. */
export interface PictureBox {
  readonly width: number;
  readonly height: number;
}

/** Background of the sample scene behind the texts: a mid grey, so both light and dark text boxes stand out. */
const SAMPLE_BACKGROUND = '#3a3a3f';

/** The three text styles of the sample, with the placeholder words the text editor uses. */
function sampleTexts(): Readonly<Record<string, TextSourceDto>> {
  const text = (id: string, style: TextStyle, line1: string, line2: string | null) => ({
    id,
    code: '',
    line1,
    line2,
    style,
    align: style === 'title' ? ('center' as const) : ('left' as const),
  });
  return {
    txt_sample_lower: text(
      'txt_sample_lower',
      'lowerThird',
      t('regie.text.placeholder.name'),
      t('regie.text.placeholder.role'),
    ),
    txt_sample_title: text('txt_sample_title', 'title', t('regie.text.placeholder.title'), null),
    txt_sample_note: text('txt_sample_note', 'note', t('regie.text.placeholder.note'), null),
  };
}

function sampleItem(source: string, style: TextStyle, canvas: CanvasSize): SceneItemDto {
  return {
    id: `itm_${source}`,
    source,
    ...textItemRect(style, canvas),
    fit: 'contain',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 0,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: 0, fallbackSource: null },
  };
}

/** A scene with a lower third, a title and a note where new texts of each style land. */
function sampleScene(canvas: CanvasSize): SceneDto {
  return {
    id: 'scn_textsample',
    name: '',
    sortOrder: 0,
    version: 1,
    layoutMode: 'free',
    background: { color: SAMPLE_BACKGROUND, assetId: null },
    items: [
      sampleItem('txt_sample_title', 'title', canvas),
      sampleItem('txt_sample_lower', 'lowerThird', canvas),
      sampleItem('txt_sample_note', 'note', canvas),
    ],
  };
}

/**
 * A small picture of the output, drawn by the real scene renderer in the canvas of the production, so a preview looks
 * exactly like the output page: a slate (`slate`, as the operator types it, with its background image) or, for the
 * text colours, a sample with a lower third, a title and a note (`textTheme`). The picture fits into `box`.
 */
@Component({
  selector: 'sf-picture-preview',
  template: '',
  styles: `
    :host {
      background: var(--well);
      border-radius: var(--radius-screen);
      box-shadow: 0 0 0 0.5px var(--seam-strong);
      display: block;
      flex: none;
      overflow: hidden;
      position: relative;
    }
  `,
  host: {
    '[style.width.px]': 'size().width',
    '[style.height.px]': 'size().height',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PicturePreviewComponent {
  /** The slate to show; null shows the text sample instead. */
  readonly slate = input<SlateDto | null>(null);
  /** The colours of the text sample. */
  readonly textTheme = input<TextThemeDto | null>(null);
  /** Accessible name of the picture (fixed once drawn). */
  readonly label = input.required<string>();
  /** The largest box the picture may take. */
  readonly box = input<PictureBox>({ width: 256, height: 144 });

  private readonly store = inject(ProductionStoreService);
  private readonly factory = inject(SCENE_RENDERER_FACTORY);
  private readonly provider = inject(PlaceholderMediaProvider);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private renderer: SceneRenderer | null = null;
  private texts: Readonly<Record<string, TextSourceDto>> = {};

  /** The box filled in the shape of the canvas. */
  protected readonly size = computed(() => {
    const { width, height } = this.store.canvas();
    const box = this.box();
    const scale = Math.min(box.width / width, box.height / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  });

  constructor() {
    effect(() => {
      const slate = this.slate();
      const theme = this.textTheme();
      const canvas = this.store.canvas();
      untracked(() => this.draw(slate, theme, canvas));
    });
    inject(DestroyRef).onDestroy(() => this.renderer?.destroy());
  }

  private draw(slate: SlateDto | null, theme: TextThemeDto | null, canvas: CanvasSize): void {
    if (!this.renderer) {
      this.texts = sampleTexts();
      this.renderer = this.factory(this.host, {
        mode: 'thumbnail',
        provider: this.provider,
        canvas,
        textOf: (sourceId) => this.texts[sourceId],
        textTheme: () => this.textTheme() ?? undefined,
        background: 'black',
        reducedMotion: true,
        label: this.label(),
        onError: (error) => console.warn('[StudioFlow] picture preview', error),
      });
    }
    this.renderer.setCanvas(canvas);
    if (slate) {
      this.renderer.show(null);
      this.renderer.showSlate(slate);
    } else {
      this.renderer.showSlate(null);
      this.renderer.show(theme ? sampleScene(canvas) : null);
    }
    this.renderer.refresh();
  }
}
