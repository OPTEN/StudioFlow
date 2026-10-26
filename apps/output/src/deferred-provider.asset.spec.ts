import { DeferredSourceProvider } from './deferred-provider';

const CLIP = 'ast_aaaaaaaaaaaaaaaa';

describe('DeferredSourceProvider: video assets', () => {
  it('tells who shows a video asset, and remembers the elements for a late listener', () => {
    const provider = new DeferredSourceProvider(() => null);
    const first = document.createElement('video');
    provider.attachAsset(CLIP, first);
    const seen: [string, HTMLVideoElement, boolean][] = [];
    provider.onAssetVideosChange((sourceId, video, attached) =>
      seen.push([sourceId, video, attached]),
    );
    const second = document.createElement('video');
    provider.attachAsset(CLIP, second);

    expect(provider.assetVideos()).toEqual([
      [CLIP, first],
      [CLIP, second],
    ]);
    expect(seen).toEqual([[CLIP, second, true]]);

    provider.detachAsset(CLIP, first);
    provider.detachAsset(CLIP, first);
    expect(seen).toEqual([
      [CLIP, second, true],
      [CLIP, first, false],
    ]);
    expect(provider.assetVideos()).toEqual([[CLIP, second]]);
  });

  it('does not mix asset videos with device videos', () => {
    const provider = new DeferredSourceProvider(() => null);
    provider.attach('dev_aaaaaaaaaaaaaaaa/camera', document.createElement('video'));
    provider.attachAsset(CLIP, document.createElement('video'));
    expect(provider.videos()).toHaveLength(1);
    expect(provider.assetVideos()).toHaveLength(1);
  });

  it('survives a throwing listener and stops notifying after dispose', () => {
    const provider = new DeferredSourceProvider(() => null);
    const calls: boolean[] = [];
    provider.onAssetVideosChange(() => {
      throw new Error('mix bug');
    });
    provider.onAssetVideosChange((_id, _video, attached) => calls.push(attached));
    const video = document.createElement('video');
    expect(() => provider.attachAsset(CLIP, video)).not.toThrow();
    expect(calls).toEqual([true]);
    provider.dispose();
    provider.detachAsset(CLIP, video);
    expect(calls).toEqual([true]);
  });
});
