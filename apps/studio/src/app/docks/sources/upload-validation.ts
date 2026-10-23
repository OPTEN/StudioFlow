import { msg, type Msg } from '@studioflow/i18n';

/**
 * Client-side pre-check of media uploads (spec 4.7). The server verifies the real type by magic bytes; this check
 * only rejects obvious mistakes early, with a message in the active language, before a 1 GB request starts.
 */

/** Kind of an uploaded medium. */
export type UploadKind = 'image' | 'video';

/** Size limits (server defaults `Media:MaxImageBytes` 25 MiB, `Media:MaxVideoBytes` 1 GiB). */
export const UPLOAD_LIMITS = {
  imageBytes: 25 * 1024 * 1024,
  videoBytes: 1024 * 1024 * 1024,
} as const;

/** `accept` attribute of the file input. */
export const UPLOAD_ACCEPT =
  'image/png,image/jpeg,image/webp,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.mp4,.webm';

const MIME_KINDS: Readonly<Record<string, UploadKind>> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
};

const EXTENSION_KINDS: Readonly<Record<string, UploadKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
};

/** The parts of a `File` the check needs. */
export interface UploadCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/** Result of {@link validateUpload}; the message stays correct when the language changes while it is shown. */
export type UploadCheck =
  { readonly ok: true; readonly kind: UploadKind } | { readonly ok: false; readonly message: Msg };

/**
 * Kind of a file by its MIME type, or by its extension when the browser reports no type. Null for every other
 * type (SVG, GIF, …): the MIME type wins over the extension, so "image.png" with type `image/gif` is rejected.
 */
export function uploadKindOf(file: Pick<UploadCandidate, 'name' | 'type'>): UploadKind | null {
  const type = file.type.trim().toLowerCase();
  if (type) {
    return MIME_KINDS[type] ?? null;
  }
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return EXTENSION_KINDS[extension] ?? null;
}

/** Checks type and size of a file before the upload starts. */
export function validateUpload(file: UploadCandidate): UploadCheck {
  const kind = uploadKindOf(file);
  if (!kind) {
    return { ok: false, message: msg('regie.media.validation.type', { name: file.name }) };
  }
  if (file.size <= 0) {
    return { ok: false, message: msg('regie.media.validation.empty', { name: file.name }) };
  }
  if (kind === 'image' && file.size > UPLOAD_LIMITS.imageBytes) {
    return { ok: false, message: msg('regie.media.validation.imageTooLarge', { name: file.name }) };
  }
  if (kind === 'video' && file.size > UPLOAD_LIMITS.videoBytes) {
    return { ok: false, message: msg('regie.media.validation.videoTooLarge', { name: file.name }) };
  }
  return { ok: true, kind };
}

/** True when a drag carries files (not text or a dock). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
