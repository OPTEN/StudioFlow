import { resolveSource, isSameSource, type ResolvedSource } from './source-resolver';
import { isGridAvailable, normalizeHoldMs, sourceState } from './source-state';
import { CAMERA, IMAGE } from './testing/fixtures';

const device: ResolvedSource = { kind: 'device', sourceId: CAMERA };

describe('sourceState', () => {
  it('maps availability of device sources', () => {
    expect(sourceState(device, { state: 'live' }, 3000, true, 0)).toEqual({ kind: 'live' });
    expect(sourceState(device, { state: 'pending' }, 3000, true, 0)).toEqual({ kind: 'pending' });
  });

  it('holds until exactly since + holdMs, then is held', () => {
    expect(sourceState(device, { state: 'lost', since: 1000 }, 3000, true, 3999)).toEqual({
      kind: 'holding',
      since: 1000,
      expiresAt: 4000,
    });
    expect(sourceState(device, { state: 'lost', since: 1000 }, 3000, true, 4000)).toEqual({
      kind: 'held',
      since: 1000,
    });
  });

  it('never escalates with holdMs null', () => {
    expect(sourceState(device, { state: 'lost', since: 0 }, null, true, 1e9)).toEqual({
      kind: 'holding',
      since: 0,
      expiresAt: null,
    });
  });

  it('is held at once with holdMs 0', () => {
    expect(sourceState(device, { state: 'lost', since: 50 }, 0, true, 50).kind).toBe('held');
  });

  it('treats a malformed lost time as lost just now', () => {
    expect(sourceState(device, { state: 'lost', since: Number.NaN }, 3000, true, 10)).toEqual({
      kind: 'holding',
      since: 10,
      expiresAt: 3010,
    });
  });

  it('treats malformed availability as pending', () => {
    expect(sourceState(device, { state: 'weird' } as never, 3000, true, 0)).toEqual({
      kind: 'pending',
    });
  });

  it('marks unknown device sources and missing assets as missing, media as media', () => {
    expect(sourceState(device, { state: 'live' }, 3000, false, 0)).toEqual({ kind: 'missing' });
    expect(
      sourceState({ kind: 'missing', sourceId: 'x' }, { state: 'live' }, 3000, true, 0),
    ).toEqual({
      kind: 'missing',
    });
    expect(
      sourceState(
        { kind: 'image', sourceId: IMAGE, url: '/a.png' },
        { state: 'pending' },
        3000,
        false,
        0,
      ),
    ).toEqual({ kind: 'media' });
  });
});

describe('isGridAvailable', () => {
  it('places media, live and holding sources only', () => {
    expect(isGridAvailable({ kind: 'media' })).toBe(true);
    expect(isGridAvailable({ kind: 'live' })).toBe(true);
    expect(isGridAvailable({ kind: 'holding', since: 0, expiresAt: null })).toBe(true);
    expect(isGridAvailable({ kind: 'held', since: 0 })).toBe(false);
    expect(isGridAvailable({ kind: 'pending' })).toBe(false);
    expect(isGridAvailable({ kind: 'missing' })).toBe(false);
  });
});

describe('normalizeHoldMs', () => {
  it.each([
    [null, null],
    [0, 0],
    [3000, 3000],
    [-5, 0],
    [9_999_999, 600_000],
    [Number.NaN, 3000],
    [undefined, 3000],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeHoldMs(input)).toBe(expected);
  });
});

describe('resolveSource', () => {
  const lookup = {
    assetUrl: (id: string) =>
      id === IMAGE ? '/media/image.png' : id === 'ast_clip0001' ? '/media/clip.mp4' : null,
    assetKind: (id: string) => (id === 'ast_clip0001' ? ('video' as const) : undefined),
  };

  it('resolves device slots, images, videos and missing references', () => {
    expect(resolveSource(CAMERA, lookup)).toEqual({ kind: 'device', sourceId: CAMERA });
    expect(resolveSource(IMAGE, lookup)).toEqual({
      kind: 'image',
      sourceId: IMAGE,
      url: '/media/image.png',
    });
    expect(resolveSource('ast_clip0001', lookup)).toEqual({
      kind: 'video',
      sourceId: 'ast_clip0001',
      url: '/media/clip.mp4',
    });
    expect(resolveSource('ast_unknown01', lookup).kind).toBe('missing');
    expect(resolveSource('not a ref', lookup).kind).toBe('missing');
    expect(resolveSource('dev_phone001/printer', lookup).kind).toBe('missing');
    expect(resolveSource(42 as unknown as string, lookup)).toEqual({
      kind: 'missing',
      sourceId: '42',
    });
  });

  it('compares kind, source and URL', () => {
    const image: ResolvedSource = { kind: 'image', sourceId: IMAGE, url: '/a.png' };
    expect(isSameSource(image, { ...image })).toBe(true);
    expect(isSameSource(image, { ...image, url: '/b.png' })).toBe(false);
    expect(isSameSource(image, { kind: 'video', sourceId: IMAGE, url: '/a.png' })).toBe(false);
    expect(isSameSource(device, { kind: 'device', sourceId: CAMERA })).toBe(true);
    expect(isSameSource(device, { kind: 'missing', sourceId: CAMERA })).toBe(false);
  });
});
