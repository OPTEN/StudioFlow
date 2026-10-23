import { tm } from '@studioflow/i18n';
import { UPLOAD_LIMITS, uploadKindOf, validateUpload } from './upload-validation';

describe('upload validation', () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });
  const message = (check: ReturnType<typeof validateUpload>): string =>
    check.ok ? '' : tm(check.message);

  it('accepts PNG, JPEG, WebP, MP4 and WebM by MIME type', () => {
    expect(validateUpload(file('a.png', 'image/png'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.jpg', 'image/jpeg'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.webp', 'image/webp'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.mp4', 'video/mp4'))).toEqual({ ok: true, kind: 'video' });
    expect(validateUpload(file('a.webm', 'video/webm'))).toEqual({ ok: true, kind: 'video' });
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(uploadKindOf({ name: 'Break.JPEG', type: '' })).toBe('image');
    expect(uploadKindOf({ name: 'intro.webm', type: '' })).toBe('video');
    expect(uploadKindOf({ name: 'no-extension', type: '' })).toBeNull();
  });

  it('rejects SVG, GIF and a type that contradicts the extension', () => {
    expect(message(validateUpload(file('logo.svg', 'image/svg+xml')))).toBe(
      '“logo.svg”: This file type is not allowed. Allowed are PNG, JPEG, WebP, MP4 and WebM.',
    );
    expect(validateUpload(file('image.png', 'image/gif')).ok).toBe(false);
  });

  it('rejects empty and too large files with the limit in the message', () => {
    expect(message(validateUpload(file('a.png', 'image/png', 0)))).toBe('“a.png” is empty.');
    expect(
      message(validateUpload(file('big.png', 'image/png', UPLOAD_LIMITS.imageBytes + 1))),
    ).toBe('“big.png” is too large. Images may be at most 25 MB.');
    expect(validateUpload(file('ok.png', 'image/png', UPLOAD_LIMITS.imageBytes)).ok).toBe(true);
    expect(
      message(validateUpload(file('long.mp4', 'video/mp4', UPLOAD_LIMITS.videoBytes + 1))),
    ).toContain('Videos may be at most 1 GB');
  });

  it('keeps the message a key that follows the language', () => {
    const check = validateUpload(file('a.png', 'image/png', 0));
    expect(check.ok).toBe(false);
    expect(check.ok ? null : check.message.key).toBe('regie.media.validation.empty');
  });
});
