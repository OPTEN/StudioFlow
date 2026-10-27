import type { SourceMediaProvider } from '@studioflow/scene-renderer';
import { withAssetAudio } from './asset-audio-provider';

function inner(): SourceMediaProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    attach: (id) => void calls.push(`attach ${id}`),
    detach: (id) => void calls.push(`detach ${id}`),
    availability: () => ({ state: 'live' }),
    onChange: () => () => undefined,
    setDesiredSize: (id, consumer) => void calls.push(`size ${id} ${consumer}`),
    assetUrl: (id) => `/media/${id}`,
    attachAsset: (id) => void calls.push(`attachAsset ${id}`),
    detachAsset: (id) => void calls.push(`detachAsset ${id}`),
  };
}

describe('withAssetAudio', () => {
  it('passes everything through and tells the sink about video assets', () => {
    const provider = inner();
    const seen: [string, boolean][] = [];
    const wrapped = withAssetAudio(provider, {
      assetVideo: (sourceId, _video, attached) => void seen.push([sourceId, attached]),
    });
    const video = document.createElement('video');

    wrapped.attach('dev_aaaaaaaaaaaaaaaa/camera', video);
    wrapped.detach('dev_aaaaaaaaaaaaaaaa/camera', video);
    wrapped.setDesiredSize('dev_aaaaaaaaaaaaaaaa/camera', 'c1', null);
    wrapped.attachAsset?.('ast_aaaaaaaaaaaaaaaa', video);
    wrapped.detachAsset?.('ast_aaaaaaaaaaaaaaaa', video);

    expect(provider.calls).toEqual([
      'attach dev_aaaaaaaaaaaaaaaa/camera',
      'detach dev_aaaaaaaaaaaaaaaa/camera',
      'size dev_aaaaaaaaaaaaaaaa/camera c1',
      'attachAsset ast_aaaaaaaaaaaaaaaa',
      'detachAsset ast_aaaaaaaaaaaaaaaa',
    ]);
    expect(seen).toEqual([
      ['ast_aaaaaaaaaaaaaaaa', true],
      ['ast_aaaaaaaaaaaaaaaa', false],
    ]);
    expect(wrapped.assetUrl('ast_aaaaaaaaaaaaaaaa')).toBe('/media/ast_aaaaaaaaaaaaaaaa');
    expect(wrapped.availability('x')).toEqual({ state: 'live' });
  });

  it('works on a provider that does not know about assets', () => {
    const plain: SourceMediaProvider = {
      attach: () => undefined,
      detach: () => undefined,
      availability: () => ({ state: 'pending' }),
      onChange: () => () => undefined,
      setDesiredSize: () => undefined,
      assetUrl: () => null,
    };
    const seen: boolean[] = [];
    const wrapped = withAssetAudio(plain, {
      assetVideo: (_id, _video, attached) => void seen.push(attached),
    });
    expect(() =>
      wrapped.attachAsset?.('ast_aaaaaaaaaaaaaaaa', document.createElement('video')),
    ).not.toThrow();
    expect(seen).toEqual([true]);
  });
});
