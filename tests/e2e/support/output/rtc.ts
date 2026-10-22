import type { Frame } from '@playwright/test';
import { livekitAdmin } from '../livekit';
import type { Production } from '../production';

/**
 * WebRTC statistics of the output page (through the peer connections the init script tracks, `window.__fsNet.peers`)
 * mapped to sources: the remote SDP of the subscriber connection names every m-section after the track
 * (`a=msid:PA_...|TR_...`), the LiveKit admin API (Twirp ListParticipants) lists the track SIDs per participant and track
 * name, so `{deviceId}/{slot}` finds its inbound RTP stream (`inbound-rtp.mid` -> m-section).
 */

export interface InboundVideo {
  mid: string;
  /** Track SID (`TR_...`) of the publication, from the remote description; '' when not found. */
  sid: string;
  frameWidth: number;
  frameHeight: number;
  framesPerSecond: number | null;
  framesDecoded: number;
  framesDropped: number;
  freezeCount: number;
  totalFreezesDuration: number;
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

/** Every inbound video RTP stream of the page's peer connections. */
export async function inboundVideo(frame: Frame): Promise<InboundVideo[]> {
  return frame.evaluate(async () => {
    const peers = [...(window as unknown as { __fsNet: { peers: Set<RTCPeerConnection> } }).__fsNet.peers];
    const out: Array<Record<string, unknown>> = [];
    for (const peer of peers) {
      if (peer.connectionState === 'closed') continue;
      const sidByMid = new Map<string, string>();
      const sdp = peer.remoteDescription?.sdp ?? '';
      for (const section of sdp.split(/\r?\nm=/).slice(1)) {
        const mid = /a=mid:(\S+)/.exec(section)?.[1];
        const msid = /a=msid:(\S+)/.exec(section)?.[1];
        if (mid && msid) sidByMid.set(mid, msid.split('|')[1] ?? msid);
      }
      for (const entry of (await peer.getStats()).values()) {
        if (entry.type !== 'inbound-rtp' || entry.kind !== 'video') continue;
        out.push({
          mid: String(entry.mid ?? ''),
          sid: sidByMid.get(String(entry.mid ?? '')) ?? '',
          frameWidth: entry.frameWidth ?? 0,
          frameHeight: entry.frameHeight ?? 0,
          framesPerSecond: entry.framesPerSecond ?? null,
          framesDecoded: entry.framesDecoded ?? 0,
          framesDropped: entry.framesDropped ?? 0,
          freezeCount: entry.freezeCount ?? 0,
          totalFreezesDuration: entry.totalFreezesDuration ?? 0,
          bytesReceived: entry.bytesReceived ?? 0,
          packetsReceived: entry.packetsReceived ?? 0,
          packetsLost: entry.packetsLost ?? 0,
          jitterBufferDelay: entry.jitterBufferDelay ?? 0,
          jitterBufferEmittedCount: entry.jitterBufferEmittedCount ?? 0,
        });
      }
    }
    return out;
  }) as unknown as Promise<InboundVideo[]>;
}

/** Number of audio RTP streams that received packets. */
export async function audioFlowing(frame: Frame): Promise<number> {
  return frame.evaluate(async () => {
    const peers = [...(window as unknown as { __fsNet: { peers: Set<RTCPeerConnection> } }).__fsNet.peers];
    let flowing = 0;
    for (const peer of peers) {
      for (const entry of (await peer.getStats()).values()) {
        if (entry.type === 'inbound-rtp' && entry.kind === 'audio' && (entry.packetsReceived ?? 0) > 0) flowing += 1;
      }
    }
    return flowing;
  });
}

/** Track SIDs of the published video tracks per source reference (`{deviceId}/{trackName}`), from the LiveKit admin API. */
export async function trackSids(production: Pick<Production, 'id'>): Promise<Map<string, string>> {
  const participants = await livekitAdmin.listParticipants(production.id);
  const sids = new Map<string, string>();
  for (const participant of participants)
    for (const track of participant.tracks) sids.set(`${participant.identity}/${track.name}`, track.sid);
  return sids;
}

/** The inbound video stream of a source, or undefined when the page receives nothing for it. */
export async function inboundOf(frame: Frame, production: Pick<Production, 'id'>, source: string): Promise<InboundVideo | undefined> {
  const sid = (await trackSids(production)).get(source);
  if (!sid) return undefined;
  return (await inboundVideo(frame)).find((stream) => stream.sid === sid);
}
