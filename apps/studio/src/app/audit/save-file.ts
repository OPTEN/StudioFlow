import { InjectionToken } from '@angular/core';

/** Byte order mark: Excel reads a CSV file as UTF-8, and shows umlauts correctly, only with it. */
const BYTE_ORDER_MARK = '﻿';

/** Hands a text to the browser as a download. A CSV text gets the byte order mark (the browser strips the one the server sent). */
export function saveTextFile(text: string, fileName: string): void {
  const csv = fileName.endsWith('.csv');
  const blob = new Blob([csv ? BYTE_ORDER_MARK + text : text], {
    type: csv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Saves a file for the export; replaced in tests. */
export const FILE_SAVER = new InjectionToken<typeof saveTextFile>('FILE_SAVER', {
  providedIn: 'root',
  factory: () => saveTextFile,
});
