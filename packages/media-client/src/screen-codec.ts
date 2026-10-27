/**
 * Codec of a screen share, chosen by what the sender's browser can encode efficiently (issue #12, spec section 7).
 *
 * VP9 compresses screen content best, but on many laptops it is encoded in software and then takes a large part of the
 * CPU (and is decoded in software by the Regie and the output as well). H.264 is encoded and decoded in hardware on
 * practically every laptop, and its software encoder (OpenH264) is far cheaper than libvpx. So VP9 is used only when
 * the browser says the VP9 encoder is power efficient (`MediaCapabilities.encodingInfo`, i.e. hardware); in every other
 * case, including a browser that cannot tell, the screen is sent as H.264.
 */

import { WEBRTC_CONTENT_TYPES } from './webrtc-codecs';

/** Codecs a screen share is published with. */
export type ScreenCodec = 'vp9' | 'h264';

/** What `MediaCapabilities.encodingInfo` says about one codec; null when the browser could not answer. */
export interface EncoderCapability {
  readonly supported: boolean;
  /** True for a hardware encoder (Chromium: `powerEfficient`). */
  readonly powerEfficient: boolean;
}

/** Answers of the probe per codec. */
export interface ScreenCodecProbe {
  readonly vp9: EncoderCapability | null;
  readonly h264: EncoderCapability | null;
}

/** The picture a screen share is probed for: the capture ceiling, at the default frame rate. */
export interface ScreenProbeFormat {
  readonly width: number;
  readonly height: number;
  readonly framerate: number;
  readonly bitrate: number;
}

/** The part of `MediaCapabilities` the probe uses (injectable in tests). */
export interface EncodingCapabilities {
  encodingInfo(configuration: {
    type: 'webrtc';
    video: {
      contentType: string;
      width: number;
      height: number;
      bitrate: number;
      framerate: number;
    };
  }): Promise<{ supported: boolean; powerEfficient: boolean }>;
}

/** Picks the codec from a probe: VP9 only with a power-efficient (hardware) encoder, otherwise H.264. */
export function chooseScreenCodec(probe: ScreenCodecProbe): ScreenCodec {
  return probe.vp9 !== null && probe.vp9.supported && probe.vp9.powerEfficient ? 'vp9' : 'h264';
}

async function probeOne(
  capabilities: EncodingCapabilities,
  codec: ScreenCodec,
  format: ScreenProbeFormat,
): Promise<EncoderCapability | null> {
  try {
    const info = await capabilities.encodingInfo({
      type: 'webrtc',
      video: { contentType: WEBRTC_CONTENT_TYPES[codec], ...format },
    });
    return { supported: info.supported === true, powerEfficient: info.powerEfficient === true };
  } catch {
    return null;
  }
}

/** Asks the browser about both encoders. Never rejects: a browser without the API answers null for both. */
export async function probeScreenCodecs(
  capabilities: EncodingCapabilities | undefined,
  format: ScreenProbeFormat,
): Promise<ScreenCodecProbe> {
  if (capabilities === undefined || typeof capabilities.encodingInfo !== 'function') {
    return { vp9: null, h264: null };
  }
  const [vp9, h264] = await Promise.all([
    probeOne(capabilities, 'vp9', format),
    probeOne(capabilities, 'h264', format),
  ]);
  return { vp9, h264 };
}

/** `navigator.mediaCapabilities` where it exists. */
export function browserCapabilities(): EncodingCapabilities | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator.mediaCapabilities as EncodingCapabilities | undefined);
}
