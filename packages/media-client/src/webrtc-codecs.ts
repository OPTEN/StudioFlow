/**
 * MIME types of the video codecs StudioFlow sends and receives, in the form `MediaCapabilities` takes for
 * `type: 'webrtc'` (H.264 with the constrained baseline profile every browser offers).
 */
export const WEBRTC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  h264: 'video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  vp8: 'video/VP8',
  vp9: 'video/VP9',
  av1: 'video/AV1',
};
