import type { SourceMediaProvider } from '@studioflow/scene-renderer';

/** What the audio mix needs to know about the videos on the stage. */
export interface AssetVideoSink {
  assetVideo(sourceId: string, video: HTMLVideoElement, attached: boolean): void;
}

/**
 * The provider of a renderer that also tells the audio mix which `<video>` shows a video asset, so the Regie's copy of the
 * mix can measure its sound (issue #7). Everything else is the wrapped provider.
 */
export function withAssetAudio(
  provider: SourceMediaProvider,
  sink: AssetVideoSink,
): SourceMediaProvider {
  return {
    attach: (sourceId, video) => provider.attach(sourceId, video),
    detach: (sourceId, video) => provider.detach(sourceId, video),
    availability: (sourceId) => provider.availability(sourceId),
    onChange: (listener) => provider.onChange(listener),
    setDesiredSize: (sourceId, consumerId, size) =>
      provider.setDesiredSize(sourceId, consumerId, size),
    assetUrl: (assetId) => provider.assetUrl(assetId),
    attachAsset: (sourceId, video) => {
      provider.attachAsset?.(sourceId, video);
      sink.assetVideo(sourceId, video, true);
    },
    detachAsset: (sourceId, video) => {
      provider.detachAsset?.(sourceId, video);
      sink.assetVideo(sourceId, video, false);
    },
  };
}
