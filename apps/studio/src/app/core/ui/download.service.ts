import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Saves text the Regie built itself (nothing is sent anywhere) as a file the browser downloads. */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly document = inject(DOCUMENT);

  /** Starts the download of `text` as `fileName`; the object URL is released right after the click. */
  saveText(fileName: string, text: string, mimeType = 'application/json'): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const url = view.URL.createObjectURL(new Blob([text], { type: mimeType }));
    const link = this.document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    this.document.body.append(link);
    link.click();
    link.remove();
    view.URL.revokeObjectURL(url);
  }
}
