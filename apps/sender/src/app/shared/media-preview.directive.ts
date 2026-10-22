import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Shows a local `MediaStream` in a `<video>` (sets `srcObject`, never `src`). The element must be `muted`,
 * `playsinline` and `autoplay` so phones play it without a gesture.
 */
@Directive({
  selector: 'video[fsMediaPreview]',
  host: {
    '[muted]': 'true',
    '[attr.playsinline]': '""',
    '[attr.autoplay]': '""',
  },
})
export class MediaPreviewDirective {
  /** The stream to show; null clears the element. */
  readonly fsMediaPreview = input<MediaStream | null>(null);

  private readonly element = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;

  constructor() {
    effect(() => {
      const stream = this.fsMediaPreview();
      if (this.element.srcObject === stream) {
        return;
      }
      this.element.muted = true;
      this.element.srcObject = stream;
      if (stream !== null) {
        this.element.play()?.catch(() => undefined);
      }
    });
  }
}
