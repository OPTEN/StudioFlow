import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { requestPixelRatio, watchVisibility } from '@studioflow/scene-renderer';
import { StudioMediaService } from '../../core/media/studio-media.service';

/** Thumbnail size in CSS px (prototype `.st-thumb`: 56 px, 16:9). */
const THUMB_WIDTH = 56;
const THUMB_HEIGHT = 31.5;

let consumerCount = 0;

/** Rounds a device-pixel length up to a multiple of 16 (layer selection granularity). */
function toLayerPixels(cssPixels: number, ratio: number): number {
  return Math.max(16, Math.ceil((cssPixels * ratio) / 16) * 16);
}

/**
 * The small live picture of a station row (prototype `canvas.st-thumb`): a muted `<video>` registered with the
 * Regie's source provider, which sets its `srcObject` and keeps the last frame on loss. It requests a tiny layer
 * (56 × 32 CSS px × device pixel ratio, at most 1.5), so many station thumbnails cost little bandwidth. While the thumbnail
 * cannot be seen (the Stations dock is hidden, its section is collapsed, the row is scrolled away, the tab is in the
 * background) it asks for nothing, so the source is paused after a short while. Without media connection it stays an
 * empty well; a down source is dimmed.
 */
@Component({
  selector: 'sf-station-thumb',
  template: `
    <video
      #video
      class="c-station-thumb__video"
      autoplay
      playsinline
      disablepictureinpicture
      aria-hidden="true"
    ></video>
    @if (dimmed()) {
      <span class="c-station-thumb__dim"></span>
    }
  `,
  styles: `
    :host {
      aspect-ratio: 16 / 9;
      background: var(--well);
      border-radius: var(--radius-screen);
      display: block;
      overflow: hidden;
      position: relative;
      width: 56px;
    }

    .c-station-thumb__video {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }

    .c-station-thumb__dim {
      background: color-mix(in srgb, var(--well) 50%, transparent);
      inset: 0;
      position: absolute;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationThumbComponent {
  /** Device source to show (`{deviceId}/{slot}`), or null. */
  readonly sourceId = input<string | null>(null);
  /** Dim the picture (source down). */
  readonly dimmed = input(false);

  private readonly media = inject(StudioMediaService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly consumerId = `station-thumb-${++consumerCount}`;
  /** On screen and in the foreground; true until the observer says otherwise. */
  private readonly shown = signal(true);

  constructor() {
    const visibility = watchVisibility(this.host, (visible) => this.shown.set(visible));
    this.shown.set(visibility.visible());
    inject(DestroyRef).onDestroy(() => visibility.dispose());
    effect((onCleanup) => {
      const provider = this.media.provider();
      const sourceId = this.sourceId();
      const video = this.video().nativeElement;
      if (!provider || !sourceId) {
        return;
      }
      untracked(() => {
        // The muted property (not only the attribute) is what lets the browser autoplay the stream.
        video.muted = true;
        provider.attach(sourceId, video);
      });
      onCleanup(() => provider.detach(sourceId, video));
    });
    effect((onCleanup) => {
      const provider = this.media.provider();
      const sourceId = this.sourceId();
      if (!provider || !sourceId || !this.shown()) {
        return;
      }
      const ratio = requestPixelRatio();
      provider.setDesiredSize(sourceId, this.consumerId, {
        width: toLayerPixels(THUMB_WIDTH, ratio),
        height: toLayerPixels(THUMB_HEIGHT, ratio),
      });
      onCleanup(() => provider.setDesiredSize(sourceId, this.consumerId, null));
    });
  }
}
