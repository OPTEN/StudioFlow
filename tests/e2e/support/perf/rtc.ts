import type { Frame, Page } from '@playwright/test';

/**
 * WebRTC statistics for the performance harness (issue #12): per inbound video stream what the decoder is (software or
 * hardware, `decoderImplementation` / `powerEfficientDecoder`), how much it costs (`totalDecodeTime`) and what it drops;
 * per outbound video stream what the encoder is, its cost and the reason for a quality limit
 * (`qualityLimitationReason: 'cpu'`). Read through the peer connections the init script tracks (`window.__sfNet.peers`),
 * on any page: output, Regie, sender.
 */

export interface InboundStream {
  /** Track SID (`TR_...`) of the publication, from the remote description; '' when not found. */
  sid: string;
  mid: string;
  codec: string | null;
  decoderImplementation: string | null;
  powerEfficientDecoder: boolean | null;
  /** `MediaCapabilities.decodingInfo().powerEfficient` for this codec and size: what Chromium reports without the stats (those are hidden from pages that do not capture). */
  capabilityPowerEfficient: boolean | null;
  frameWidth: number;
  frameHeight: number;
  framesDecoded: number;
  framesDropped: number;
  framesReceived: number;
  keyFramesDecoded: number;
  totalDecodeTime: number;
  bytesReceived: number;
  freezeCount: number;
}

export interface OutboundStream {
  /** Simulcast layer (`q`, `h`, `f`) or null. */
  rid: string | null;
  ssrc: number;
  mid: string;
  codec: string | null;
  encoderImplementation: string | null;
  powerEfficientEncoder: boolean | null;
  /** `MediaCapabilities.encodingInfo().powerEfficient` for this codec and size. */
  capabilityPowerEfficient: boolean | null;
  qualityLimitationReason: string | null;
  frameWidth: number;
  frameHeight: number;
  framesEncoded: number;
  framesSent: number;
  keyFramesEncoded: number;
  totalEncodeTime: number;
  bytesSent: number;
  active: boolean;
  /** Seconds spent in each limitation state so far (`none`, `cpu`, `bandwidth`, `other`). */
  qualityLimitationDurations: Record<string, number>;
}

export interface RtcSnapshot {
  at: number;
  inbound: InboundStream[];
  outbound: OutboundStream[];
}

/** Reads every video RTP stream of the page's open peer connections. */
export async function readRtc(scope: Page | Frame): Promise<RtcSnapshot> {
  return scope.evaluate(async () => {
    const peers = [...(window as unknown as { __sfNet: { peers: Set<RTCPeerConnection> } }).__sfNet.peers];
    const inbound: Array<Record<string, unknown>> = [];
    const outbound: Array<Record<string, unknown>> = [];
    const mimeOf: Record<string, string> = { vp8: 'video/VP8', vp9: 'video/VP9', h264: 'video/H264;profile-level-id=42e01f', av1: 'video/AV1' };
    const cache = new Map<string, boolean | null>();
    const efficient = async (kind: 'decoding' | 'encoding', codec: string | null, width: number, height: number): Promise<boolean | null> => {
      const contentType = codec ? mimeOf[codec] : undefined;
      if (!contentType || width <= 0 || height <= 0) return null;
      const key = `${kind}:${codec}:${width}x${height}`;
      if (cache.has(key)) return cache.get(key) ?? null;
      let result: boolean | null = null;
      try {
        const configuration = { type: 'webrtc' as const, video: { contentType, width, height, bitrate: 2_000_000, framerate: 30 } };
        const info = kind === 'decoding' ? await navigator.mediaCapabilities.decodingInfo(configuration) : await navigator.mediaCapabilities.encodingInfo(configuration);
        result = info.powerEfficient;
      } catch {
        result = null;
      }
      cache.set(key, result);
      return result;
    };
    for (const peer of peers) {
      if (peer.connectionState === 'closed') continue;
      const sidByMid = new Map<string, string>();
      for (const section of (peer.remoteDescription?.sdp ?? '').split(/\r?\nm=/).slice(1)) {
        const mid = /a=mid:(\S+)/.exec(section)?.[1];
        const msid = /a=msid:(\S+)/.exec(section)?.[1];
        if (mid && msid) sidByMid.set(mid, msid.split('|')[1] ?? msid);
      }
      const report = await peer.getStats();
      const codecOf = (entry: Record<string, unknown>): string | null => {
        const codec = entry['codecId'] ? (report.get(entry['codecId'] as string) as Record<string, unknown> | undefined) : undefined;
        const mime = codec?.['mimeType'];
        return typeof mime === 'string' ? mime.split('/')[1]!.toLowerCase() : null;
      };
      for (const raw of report.values()) {
        const entry = raw as Record<string, unknown>;
        if (entry['kind'] !== 'video') continue;
        if (entry['type'] === 'inbound-rtp') {
          const codec = codecOf(entry);
          inbound.push({
            capabilityPowerEfficient: await efficient('decoding', codec, (entry['frameWidth'] as number | undefined) ?? 0, (entry['frameHeight'] as number | undefined) ?? 0),
            sid: sidByMid.get(String(entry['mid'] ?? '')) ?? '',
            mid: String(entry['mid'] ?? ''),
            codec,
            decoderImplementation: (entry['decoderImplementation'] as string | undefined) ?? null,
            powerEfficientDecoder: (entry['powerEfficientDecoder'] as boolean | undefined) ?? null,
            frameWidth: (entry['frameWidth'] as number | undefined) ?? 0,
            frameHeight: (entry['frameHeight'] as number | undefined) ?? 0,
            framesDecoded: (entry['framesDecoded'] as number | undefined) ?? 0,
            framesDropped: (entry['framesDropped'] as number | undefined) ?? 0,
            framesReceived: (entry['framesReceived'] as number | undefined) ?? 0,
            keyFramesDecoded: (entry['keyFramesDecoded'] as number | undefined) ?? 0,
            totalDecodeTime: (entry['totalDecodeTime'] as number | undefined) ?? 0,
            bytesReceived: (entry['bytesReceived'] as number | undefined) ?? 0,
            freezeCount: (entry['freezeCount'] as number | undefined) ?? 0,
          });
        } else if (entry['type'] === 'outbound-rtp') {
          const codec = codecOf(entry);
          outbound.push({
            capabilityPowerEfficient: await efficient('encoding', codec, (entry['frameWidth'] as number | undefined) ?? 0, (entry['frameHeight'] as number | undefined) ?? 0),
            rid: (entry['rid'] as string | undefined) ?? null,
            ssrc: (entry['ssrc'] as number | undefined) ?? 0,
            mid: String(entry['mid'] ?? ''),
            codec,
            encoderImplementation: (entry['encoderImplementation'] as string | undefined) ?? null,
            powerEfficientEncoder: (entry['powerEfficientEncoder'] as boolean | undefined) ?? null,
            qualityLimitationReason: (entry['qualityLimitationReason'] as string | undefined) ?? null,
            frameWidth: (entry['frameWidth'] as number | undefined) ?? 0,
            frameHeight: (entry['frameHeight'] as number | undefined) ?? 0,
            framesEncoded: (entry['framesEncoded'] as number | undefined) ?? 0,
            framesSent: (entry['framesSent'] as number | undefined) ?? 0,
            keyFramesEncoded: (entry['keyFramesEncoded'] as number | undefined) ?? 0,
            totalEncodeTime: (entry['totalEncodeTime'] as number | undefined) ?? 0,
            bytesSent: (entry['bytesSent'] as number | undefined) ?? 0,
            active: (entry['active'] as boolean | undefined) ?? true,
            qualityLimitationDurations: (entry['qualityLimitationDurations'] as Record<string, number> | undefined) ?? {},
          });
        }
      }
    }
    return { at: Date.now(), inbound, outbound };
  }) as unknown as Promise<RtcSnapshot>;
}

/** One decoded stream over a window. */
export interface DecodedStream {
  sid: string;
  codec: string | null;
  decoder: string | null;
  powerEfficient: boolean | null;
  width: number;
  height: number;
  framesPerSecond: number;
  /** Mean decode time per frame in ms. */
  decodeMsPerFrame: number;
  /** CPU seconds the decoder used per wall-clock second (decode time per frame x frames per second). */
  decodeLoad: number;
  /** Decoded megapixels per second. */
  megapixelsPerSecond: number;
  droppedFrames: number;
  bitrateKbps: number;
}

export interface DecodeWindow {
  seconds: number;
  /** Streams that decoded at least one frame in the window. */
  streams: DecodedStream[];
  /** Number of inbound video streams that exist (decoding or paused). */
  subscribed: number;
  decodedStreams: number;
  softwareStreams: number;
  decodeLoad: number;
  megapixelsPerSecond: number;
  /** Sum of the picture sizes of the decoding streams in megapixels: the decoding work per frame cycle, independent of the frame rate the machine manages. */
  framePixels: number;
  droppedFrames: number;
  /** Dropped frames as a share of the frames received. */
  droppedShare: number;
}

/** Difference of two snapshots of the same page, per inbound stream (matched by track SID, else by mid). */
export function decodeWindow(before: RtcSnapshot, after: RtcSnapshot): DecodeWindow {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  const key = (stream: InboundStream): string => stream.sid || `mid:${stream.mid}`;
  const previous = new Map(before.inbound.map((stream) => [key(stream), stream]));
  const streams: DecodedStream[] = [];
  let received = 0;
  let dropped = 0;
  for (const stream of after.inbound) {
    const old = previous.get(key(stream));
    const frames = stream.framesDecoded - (old?.framesDecoded ?? 0);
    received += stream.framesReceived - (old?.framesReceived ?? 0);
    dropped += stream.framesDropped - (old?.framesDropped ?? 0);
    if (frames <= 0) continue;
    const decodeSeconds = stream.totalDecodeTime - (old?.totalDecodeTime ?? 0);
    const fps = frames / seconds;
    streams.push({
      sid: stream.sid,
      codec: stream.codec,
      decoder: stream.decoderImplementation,
      powerEfficient: stream.powerEfficientDecoder ?? stream.capabilityPowerEfficient,
      width: stream.frameWidth,
      height: stream.frameHeight,
      framesPerSecond: fps,
      decodeMsPerFrame: (decodeSeconds / frames) * 1000,
      decodeLoad: decodeSeconds / seconds,
      megapixelsPerSecond: (frames * stream.frameWidth * stream.frameHeight) / seconds / 1e6,
      droppedFrames: stream.framesDropped - (old?.framesDropped ?? 0),
      bitrateKbps: ((stream.bytesReceived - (old?.bytesReceived ?? 0)) * 8) / seconds / 1000,
    });
  }
  return {
    seconds,
    streams,
    subscribed: after.inbound.length,
    decodedStreams: streams.length,
    softwareStreams: streams.filter((stream) => stream.powerEfficient !== true).length,
    decodeLoad: streams.reduce((sum, stream) => sum + stream.decodeLoad, 0),
    megapixelsPerSecond: streams.reduce((sum, stream) => sum + stream.megapixelsPerSecond, 0),
    framePixels: streams.reduce((sum, stream) => sum + (stream.width * stream.height) / 1e6, 0),
    droppedFrames: dropped,
    droppedShare: received > 0 ? dropped / received : 0,
  };
}

/** One encoded layer over a window. */
export interface EncodedLayer {
  rid: string | null;
  codec: string | null;
  encoder: string | null;
  powerEfficient: boolean | null;
  width: number;
  height: number;
  framesPerSecond: number;
  encodeMsPerFrame: number;
  /** CPU seconds the encoder used per wall-clock second. */
  encodeLoad: number;
  bitrateKbps: number;
  limitationReason: string | null;
  /** Seconds spent limited by the CPU during the window. */
  cpuLimitedSeconds: number;
}

export interface EncodeWindow {
  seconds: number;
  layers: EncodedLayer[];
  encodeLoad: number;
  cpuLimited: boolean;
  softwareLayers: number;
}

/** Difference of two snapshots of a sender page: the layers that encoded frames in the window. */
export function encodeWindow(before: RtcSnapshot, after: RtcSnapshot): EncodeWindow {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  const previous = new Map(before.outbound.map((stream) => [stream.ssrc, stream]));
  const layers: EncodedLayer[] = [];
  for (const stream of after.outbound) {
    const old = previous.get(stream.ssrc);
    const frames = stream.framesEncoded - (old?.framesEncoded ?? 0);
    if (frames <= 0) continue;
    const encodeSeconds = stream.totalEncodeTime - (old?.totalEncodeTime ?? 0);
    layers.push({
      rid: stream.rid,
      codec: stream.codec,
      encoder: stream.encoderImplementation,
      powerEfficient: stream.powerEfficientEncoder ?? stream.capabilityPowerEfficient,
      width: stream.frameWidth,
      height: stream.frameHeight,
      framesPerSecond: frames / seconds,
      encodeMsPerFrame: (encodeSeconds / frames) * 1000,
      encodeLoad: encodeSeconds / seconds,
      bitrateKbps: ((stream.bytesSent - (old?.bytesSent ?? 0)) * 8) / seconds / 1000,
      limitationReason: stream.qualityLimitationReason,
      cpuLimitedSeconds: (stream.qualityLimitationDurations['cpu'] ?? 0) - (old?.qualityLimitationDurations['cpu'] ?? 0),
    });
  }
  return {
    seconds,
    layers,
    encodeLoad: layers.reduce((sum, layer) => sum + layer.encodeLoad, 0),
    cpuLimited: layers.some((layer) => layer.limitationReason === 'cpu' || layer.cpuLimitedSeconds > 0),
    softwareLayers: layers.filter((layer) => layer.powerEfficient !== true).length,
  };
}
