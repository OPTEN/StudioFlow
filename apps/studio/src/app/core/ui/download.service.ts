import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Where the download link lives while it is clicked, and the file type. */
export interface SaveTextOptions {
  readonly mimeType?: string;
  /**
   * The element the download link is put into for the click (default: the body). Pass an element of the open popover
   * or dialog that offered the download: a click inside it does not count as a click outside, so it stays open.
   */
  readonly container?: HTMLElement;
}

/** Saves text the Regie built itself (nothing is sent anywhere) as a file the browser downloads. */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly document = inject(DOCUMENT);

  /** Starts the download of `text` as `fileName`; the object URL is released right after the click. */
  saveText(fileName: string, text: string, options: SaveTextOptions = {}): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const url = view.URL.createObjectURL(
      new Blob([text], { type: options.mimeType ?? 'application/json' }),
    );
    const link = this.document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    (options.container ?? this.document.body).append(link);
    link.click();
    link.remove();
    view.URL.revokeObjectURL(url);
  }
}
