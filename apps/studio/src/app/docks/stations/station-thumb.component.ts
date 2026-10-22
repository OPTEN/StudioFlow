import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
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
 * (56 × 32 CSS px × device pixel ratio), so many station thumbnails cost little bandwidth. Without media connection
 * it stays an empty well; a down source is dimmed.
 */
@Component({
  selector: 'fs-station-thumb',
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
      background: rgba(5, 7, 10, 0.5);
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
  private readonly consumerId = `station-thumb-${++consumerCount}`;

  constructor() {
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
        const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
        provider.attach(sourceId, video);
        provider.setDesiredSize(sourceId, this.consumerId, {
          width: toLayerPixels(THUMB_WIDTH, ratio),
          height: toLayerPixels(THUMB_HEIGHT, ratio),
        });
      });
      onCleanup(() => {
        provider.setDesiredSize(sourceId, this.consumerId, null);
        provider.detach(sourceId, video);
      });
    });
  }
}
