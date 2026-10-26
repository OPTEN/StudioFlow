import { CLIP, IMAGE, mount, scene, sceneItem, type Mounted } from './testing/fixtures';

/** The sound of video assets (issue #7): the renderer tells the provider which element shows an asset. */
describe('scene renderer: video asset elements for the audio mix', () => {
  let mounted: Mounted;

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.restoreAllMocks();
  });

  it('registers the looping video of an asset, and only that', () => {
    mounted = mount({ assetKindOf: (id) => (id === CLIP ? 'video' : undefined) });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP), sceneItem('itm_i', IMAGE)]));

    const video = mounted.part('itm_v', 'video');
    expect(mounted.provider.assetAttachCalls).toEqual([{ sourceId: CLIP, video }]);
    expect(mounted.provider.attachCalls).toHaveLength(0);
  });

  it('keeps the registration while the same video stays on stage and ends it with the item', () => {
    mounted = mount({ assetKindOf: () => 'video' });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP)]));
    const video = mounted.part('itm_v', 'video');

    mounted.renderer.update(scene('scn_a', [sceneItem('itm_v', CLIP, { radius: 8 })]));
    expect(mounted.provider.assetAttachCalls).toHaveLength(1);
    expect(mounted.provider.assetDetachCalls).toHaveLength(0);

    mounted.renderer.update(scene('scn_a', []));
    expect(mounted.provider.assetDetachCalls).toEqual([{ sourceId: CLIP, video }]);
  });

  it('releases every registration on destroy', () => {
    mounted = mount({ assetKindOf: () => 'video' });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP)]));
    mounted.renderer.destroy();
    expect(mounted.provider.assetDetachCalls).toHaveLength(1);
    expect(mounted.errors).toEqual([]);
  });

  it('works with a provider that does not know about asset sound', () => {
    mounted = mount({ assetKindOf: () => 'video' });
    Object.assign(mounted.provider, { attachAsset: undefined, detachAsset: undefined });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_v', CLIP)]));
    mounted.renderer.update(scene('scn_a', []));
    expect(mounted.errors).toEqual([]);
  });
});
