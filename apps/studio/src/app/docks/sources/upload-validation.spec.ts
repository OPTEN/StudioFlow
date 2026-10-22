import { UPLOAD_LIMITS, uploadKindOf, validateUpload } from './upload-validation';

describe('upload validation', () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it('accepts PNG, JPEG, WebP, MP4 and WebM by MIME type', () => {
    expect(validateUpload(file('a.png', 'image/png'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.jpg', 'image/jpeg'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.webp', 'image/webp'))).toEqual({ ok: true, kind: 'image' });
    expect(validateUpload(file('a.mp4', 'video/mp4'))).toEqual({ ok: true, kind: 'video' });
    expect(validateUpload(file('a.webm', 'video/webm'))).toEqual({ ok: true, kind: 'video' });
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(uploadKindOf({ name: 'Pause.JPEG', type: '' })).toBe('image');
    expect(uploadKindOf({ name: 'intro.webm', type: '' })).toBe('video');
    expect(uploadKindOf({ name: 'ohne-endung', type: '' })).toBeNull();
  });

  it('rejects SVG, GIF and a type that contradicts the extension', () => {
    const svg = validateUpload(file('logo.svg', 'image/svg+xml'));
    expect(svg).toEqual({
      ok: false,
      message:
        '«logo.svg»: Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
    });
    expect(validateUpload(file('bild.png', 'image/gif')).ok).toBe(false);
  });

  it('rejects empty and too large files with the limit in the message', () => {
    expect(validateUpload(file('a.png', 'image/png', 0))).toEqual({
      ok: false,
      message: '«a.png» ist leer.',
    });
    const image = validateUpload(file('gross.png', 'image/png', UPLOAD_LIMITS.imageBytes + 1));
    expect(image.ok ? '' : image.message).toBe(
      '«gross.png» ist zu gross. Bilder dürfen höchstens 25 MB gross sein.',
    );
    expect(validateUpload(file('ok.png', 'image/png', UPLOAD_LIMITS.imageBytes)).ok).toBe(true);
    const video = validateUpload(file('lang.mp4', 'video/mp4', UPLOAD_LIMITS.videoBytes + 1));
    expect(video.ok ? '' : video.message).toContain('Videos dürfen höchstens 1 GB');
  });
});
