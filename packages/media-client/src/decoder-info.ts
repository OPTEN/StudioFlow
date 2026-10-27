/**
 * Hardware or software decoding of a received stream (issue #12, spec section 7).
 *
 * Chromium states it in the receiver statistics (`powerEfficientDecoder`, `decoderImplementation`), but hides both from a
 * page that is not capturing camera or microphone and is not cross-origin isolated, which is the case of the Regie and of
 * the output page. They are then answered from what the browser says about decoding that codec at that size
 * (`MediaCapabilities.decodingInfo`): the same question the browser asks itself when it picks a decoder.
 */

import { WEBRTC_CONTENT_TYPES } from './webrtc-codecs';

/** Hardware (GPU, media engine) or software (CPU) decoding. */
export type DecoderKind = 'hardware' | 'software';

const SOFTWARE_IMPLEMENTATION = /libvpx|libaom|dav1d|openh264|ffmpeg|software/i;
const HARDWARE_IMPLEMENTATION =
  /videotoolbox|mediafoundation|d3d11|d3d12|dxva|vaapi|v4l2|mediacodec|nvdec|qsv|externaldecoder|hardware/i;

/** What the receiver statistics say about the decoder; null when they say nothing (hidden from this page). */
export function kindFromStats(stats: {
  readonly implementation?: string;
  readonly powerEfficient?: boolean;
}): DecoderKind | null {
  if (typeof stats.powerEfficient === 'boolean') {
    return stats.powerEfficient ? 'hardware' : 'software';
  }
  const name = stats.implementation;
  if (name === undefined || name === '') {
    return null;
  }
  if (SOFTWARE_IMPLEMENTATION.test(name)) {
    return 'software';
  }
  return HARDWARE_IMPLEMENTATION.test(name) ? 'hardware' : null;
}

/** The part of `MediaCapabilities` the probe uses (injectable in tests). */
export interface DecodingCapabilities {
  decodingInfo(configuration: {
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

/**
 * Asks the browser whether it decodes a codec at a size with hardware, once per codec and size (the answer does not
 * change while the page runs).
 */
export class DecoderCapability {
  readonly #answers = new Map<string, Promise<DecoderKind | null>>();

  constructor(
    private readonly capabilities: DecodingCapabilities | undefined = typeof navigator ===
    'undefined'
      ? undefined
      : (navigator.mediaCapabilities as DecodingCapabilities | undefined),
  ) {}

  /** `hardware` or `software` for the codec (`h264`, `vp9` ...) at the size; null when the browser cannot tell. */
  kindOf(codec: string | undefined, width: number, height: number): Promise<DecoderKind | null> {
    const contentType = codec === undefined ? undefined : WEBRTC_CONTENT_TYPES[codec];
    if (
      contentType === undefined ||
      this.capabilities === undefined ||
      typeof this.capabilities.decodingInfo !== 'function' ||
      !(width > 0) ||
      !(height > 0)
    ) {
      return Promise.resolve(null);
    }
    const key = `${codec}:${Math.round(width)}x${Math.round(height)}`;
    let answer = this.#answers.get(key);
    if (answer === undefined) {
      const capabilities = this.capabilities;
      answer = capabilities
        .decodingInfo({
          type: 'webrtc',
          video: { contentType, width, height, bitrate: 2_000_000, framerate: 30 },
        })
        .then((info): DecoderKind | null =>
          info.supported ? (info.powerEfficient ? 'hardware' : 'software') : null,
        )
        .catch(() => null);
      this.#answers.set(key, answer);
    }
    return answer;
  }
}
