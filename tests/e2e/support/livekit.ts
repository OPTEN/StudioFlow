import { SignJWT } from 'jose';
import { stackConfig } from './env';
import { send } from './http';

export interface LiveKitGrants {
  roomJoin?: boolean;
  room?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  canPublishSources?: string[];
  hidden?: boolean;
  roomAdmin?: boolean;
  roomList?: boolean;
}

export interface TokenOptions {
  identity?: string;
  name?: string;
  grants: LiveKitGrants;
  /** Seconds the token is valid (negative: already expired). Default 600. */
  ttlSeconds?: number;
  secret?: string;
  apiKey?: string;
}

/** Signs a LiveKit access token with the API secret of the stack (or any other secret, for negative tests). */
export async function signLiveKitToken(options: TokenOptions): Promise<string> {
  const config = stackConfig();
  const now = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? 600;
  const jwt = new SignJWT({ name: options.name ?? options.identity, video: options.grants })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(options.apiKey ?? config.livekit.apiKey)
    .setNotBefore(ttl < 0 ? now - 3600 : now - 5)
    .setExpirationTime(ttl < 0 ? now + ttl : now + ttl);
  if (options.identity) jwt.setSubject(options.identity);
  return jwt.sign(new TextEncoder().encode(options.secret ?? config.livekit.apiSecret));
}

export interface ParticipantInfo {
  sid: string;
  identity: string;
  state?: string;
  name?: string;
  tracks: Array<{ sid: string; name: string; type: string; source?: string; muted?: boolean }>;
  [key: string]: unknown;
}

/** Room service (Twirp) on the test-published LiveKit port; never exposed by the product stack. */
export const livekitAdmin = {
  async twirp<T>(method: string, body: Record<string, unknown>, room?: string): Promise<{ status: number; body: T }> {
    const token = await signLiveKitToken({ identity: 'e2e-admin', grants: { roomAdmin: true, roomList: true, ...(room ? { room } : {}) }, ttlSeconds: 60 });
    const response = await send({
      method: 'POST',
      url: `${stackConfig().livekitAdmin}/twirp/livekit.RoomService/${method}`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      json: body,
    });
    let parsed: unknown = undefined;
    try {
      parsed = response.json();
    } catch {
      parsed = response.text();
    }
    return { status: response.status, body: parsed as T };
  },
  async listParticipants(room: string): Promise<ParticipantInfo[]> {
    const result = await livekitAdmin.twirp<{ participants?: ParticipantInfo[] }>('ListParticipants', { room }, room);
    if (result.status === 404) return [];
    if (result.status !== 200) throw new Error(`ListParticipants ${result.status}: ${JSON.stringify(result.body)}`);
    return result.body.participants ?? [];
  },
  async removeParticipant(room: string, identity: string): Promise<number> {
    return (await livekitAdmin.twirp('RemoveParticipant', { room, identity }, room)).status;
  },
  async listRooms(): Promise<Array<{ name: string; num_participants?: number }>> {
    const result = await livekitAdmin.twirp<{ rooms?: Array<{ name: string; num_participants?: number }> }>('ListRooms', {});
    return result.body.rooms ?? [];
  },
};
