import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { REPO_ROOT, stackConfig } from './env';
import { percentile } from './helpers';

/**
 * livekit-client inside Chromium pages, against the real stack (docs/testing.md 1.2.5 `pairPhone`/`clock` and the
 * publisher helper of the research): a "blank" page on the stack origin (served by Playwright, so no CSP of the app
 * gets in the way and the signalling goes through Caddy like the apps do), the UMD build of livekit-client and the
 * latency stamp codec. The page publishes a stamped canvas (known content, known time) or the fake camera, or
 * subscribes and decodes the stamp to measure glass-to-glass latency.
 */

const LK_UMD = fs.readFileSync(path.join(REPO_ROOT, 'node_modules/livekit-client/dist/livekit-client.umd.js'), 'utf8');
const CODEC = fs.readFileSync(path.join(__dirname, 'browser', 'latency-codec.js'), 'utf8');

export type TrackSourceName = 'camera' | 'screen_share';

export interface RoomEventRecord {
  t: number;
  type: string;
  detail?: string;
}

export interface PublishOptions {
  url: string;
  token: string;
  /** Track name = slot name (`camera`, `screen-1`). */
  name?: string;
  source?: TrackSourceName;
  fps?: number;
  width?: number;
  height?: number;
  videoCodec?: 'vp8' | 'h264' | 'vp9' | 'av1';
  simulcast?: boolean;
}

export interface MeasureResult {
  frames: number;
  badFrames: number;
  width: number;
  height: number;
  latencies: number[];
  p50: number;
  p95: number;
  max: number;
  /** Decoded stamps strictly increasing? */
  monotonic: boolean;
}

export class LiveKitPage {
  private constructor(
    readonly page: Page,
    readonly label: string,
  ) {}

  /** A blank page on the stack origin with livekit-client and the latency codec loaded. */
  static async open(context: BrowserContext, label = 'lk'): Promise<LiveKitPage> {
    const base = stackConfig().baseURL;
    const page = await context.newPage();
    await page.route(`${base}/__e2e/blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>StudioFlow E2E</title><body></body>' }));
    await page.goto(`${base}/__e2e/blank`);
    await page.addScriptTag({ content: LK_UMD });
    await page.addScriptTag({ content: CODEC });
    await page.evaluate(() => {
      const w = window as unknown as { __events: unknown[]; __errors: unknown[] };
      w.__events = [];
      w.__errors = [];
      window.addEventListener('error', (event) => w.__errors.push(String(event.message)));
      window.addEventListener('unhandledrejection', (event) => w.__errors.push(String(event.reason)));
    });
    return new LiveKitPage(page, label);
  }

  /** Opens a context of its own in a browser (for tests that need isolation). */
  static async openIn(browser: Browser, label = 'lk'): Promise<{ context: BrowserContext; lk: LiveKitPage }> {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    return { context, lk: await LiveKitPage.open(context, label) };
  }

  /** Connects a room (no publishing) and records its events in `window.__events`. */
  async connect(options: { url: string; token: string }): Promise<{ identity: string; sid: string; room: string }> {
    return this.page.evaluate(async ({ url, token }) => {
      const LK = (window as any).LivekitClient;
      const events = (window as any).__events as unknown[];
      const room = new LK.Room({ adaptiveStream: false, dynacast: false });
      const record = (type: string, detail?: unknown) => events.push({ t: Date.now(), type, detail: detail === undefined ? undefined : String(detail) });
      room.on(LK.RoomEvent.Disconnected, (reason: unknown) => record('disconnected', reason));
      room.on(LK.RoomEvent.Reconnecting, () => record('reconnecting'));
      room.on(LK.RoomEvent.SignalReconnecting, () => record('signalReconnecting'));
      room.on(LK.RoomEvent.Reconnected, () => record('reconnected'));
      room.on(LK.RoomEvent.ParticipantConnected, (p: any) => record('participantConnected', p.identity));
      room.on(LK.RoomEvent.TrackSubscribed, (_t: unknown, _p: unknown, participant: any) => record('trackSubscribed', participant.identity));
      room.on(LK.RoomEvent.MediaDevicesError, (error: unknown) => record('mediaDevicesError', error));
      (window as any).__room = room;
      await room.connect(url, token);
      return { identity: room.localParticipant.identity as string, sid: room.localParticipant.sid as string, room: room.name as string };
    }, options);
  }

  /** Connects and publishes a canvas that carries the latency stamp (and a moving box so the encoder has motion). */
  async publishStamped(options: PublishOptions): Promise<{ identity: string; trackSid: string }> {
    const settings = { name: 'camera', source: 'camera', fps: 30, width: 640, height: 360, videoCodec: 'vp8', simulcast: false, ...options };
    await this.connect({ url: options.url, token: options.token });
    return this.page.evaluate(async (opts) => {
      const LK = (window as any).LivekitClient;
      const room = (window as any).__room;
      const canvas = Object.assign(document.createElement('canvas'), { width: opts.width, height: opts.height });
      const g = canvas.getContext('2d')!;
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as any;
      let phase = 0;
      const draw = () => {
        (window as any).LatencyCodec.drawStamp(g, undefined, (ctx: CanvasRenderingContext2D) => {
          phase = (phase + 6) % 360;
          ctx.fillStyle = `hsl(${phase} 80% 50%)`;
          ctx.fillRect(40 + (phase % 200), 120, 160, 120);
        });
        if (typeof track.requestFrame === 'function') track.requestFrame();
        else (stream as any).requestFrame();
      };
      const timer = setInterval(draw, 1000 / opts.fps);
      (window as any).__stampTimer = timer;
      draw();
      const publication = await room.localParticipant.publishTrack(track, {
        name: opts.name,
        source: opts.source === 'camera' ? LK.Track.Source.Camera : LK.Track.Source.ScreenShare,
        simulcast: opts.simulcast,
        videoCodec: opts.videoCodec,
        videoEncoding: { maxBitrate: 1_500_000, maxFramerate: opts.fps },
      });
      return { identity: room.localParticipant.identity as string, trackSid: publication.trackSid as string };
    }, settings);
  }

  /** Connects and publishes the Chromium fake camera (needs the fake media launch flags). */
  async publishFakeCamera(options: { url: string; token: string; name?: string; width?: number; height?: number }): Promise<{ identity: string; trackSid: string; settings: { width?: number; height?: number; frameRate?: number } }> {
    await this.connect({ url: options.url, token: options.token });
    return this.page.evaluate(async (opts) => {
      const LK = (window as any).LivekitClient;
      const room = (window as any).__room;
      const track = await LK.createLocalVideoTrack({ resolution: { width: opts.width ?? 1280, height: opts.height ?? 720, frameRate: 30 } });
      const publication = await room.localParticipant.publishTrack(track, { name: opts.name ?? 'camera', source: LK.Track.Source.Camera, simulcast: true });
      return { identity: room.localParticipant.identity as string, trackSid: publication.trackSid as string, settings: track.mediaStreamTrack.getSettings() };
    }, options);
  }

  /** Stops drawing and disconnects (a clean leave: LiveKit sends participant_left at once). */
  async leave(): Promise<void> {
    await this.page.evaluate(async () => {
      clearInterval((window as any).__stampTimer);
      const room = (window as any).__room;
      if (room) await room.disconnect();
    });
  }

  async events(): Promise<RoomEventRecord[]> {
    return this.page.evaluate(() => (window as any).__events as RoomEventRecord[]);
  }

  async waitForEvent(type: string, timeoutMs = 10_000): Promise<RoomEventRecord> {
    const handle = await this.page.waitForFunction(
      (wanted) => ((window as any).__events as RoomEventRecord[]).find((event) => event.type === wanted) ?? null,
      type,
      { timeout: timeoutMs, polling: 100 },
    );
    return (await handle.jsonValue()) as RoomEventRecord;
  }

  async roomState(): Promise<{ state: string; remote: string[]; local: string }> {
    return this.page.evaluate(() => {
      const room = (window as any).__room;
      return { state: String(room?.state), remote: [...(room?.remoteParticipants?.values?.() ?? [])].map((p: any) => p.identity as string), local: String(room?.localParticipant?.identity) };
    });
  }

  /**
   * Tries things a role must not be able to do and reports for each whether it was refused (an exception or a state
   * that shows nothing happened). Used by E2E-LK-01.
   */
  async probeGrants(): Promise<{ publishData: string; microphone: string; subscribedTracks: number; remoteTracksListed: number; canPublishFlag: boolean; canSubscribeFlag: boolean }> {
    return this.page.evaluate(async () => {
      const LK = (window as any).LivekitClient;
      const room = (window as any).__room;
      const result = { publishData: 'accepted', microphone: 'accepted', subscribedTracks: 0, remoteTracksListed: 0, canPublishFlag: false, canSubscribeFlag: false };
      try {
        await room.localParticipant.publishData(new TextEncoder().encode('hello'), { reliable: true });
        // The SDK does not wait for the server: a data message without the grant is dropped silently or raises later.
        await new Promise((resolve) => setTimeout(resolve, 800));
        result.publishData = room.state === 'connected' ? 'sent (not verifiable client side)' : 'disconnected';
      } catch (error) {
        result.publishData = `refused: ${String((error as Error).message ?? error)}`;
      }
      try {
        const publication = await room.localParticipant.setMicrophoneEnabled(true);
        result.microphone = publication ? 'accepted' : 'refused: no publication';
      } catch (error) {
        result.microphone = `refused: ${String((error as Error).message ?? error)}`;
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          result.remoteTracksListed += 1;
          if (publication.isSubscribed) result.subscribedTracks += 1;
        }
      }
      result.canPublishFlag = Boolean(room.localParticipant.permissions?.canPublish);
      result.canSubscribeFlag = Boolean(room.localParticipant.permissions?.canSubscribe);
      void LK;
      return result;
    });
  }

  /** Tries to publish a stamped canvas track; resolves with the outcome instead of throwing. */
  async tryPublish(source: TrackSourceName = 'camera', name = 'camera'): Promise<{ ok: boolean; error?: string }> {
    return this.page.evaluate(
      async ({ source: wanted, name: trackName }) => {
        const LK = (window as any).LivekitClient;
        const room = (window as any).__room;
        const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
        canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
        const track = canvas.captureStream(15).getVideoTracks()[0];
        try {
          await room.localParticipant.publishTrack(track, { name: trackName, source: wanted === 'camera' ? LK.Track.Source.Camera : LK.Track.Source.ScreenShare, simulcast: false });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String((error as Error).message ?? error) };
        }
      },
      { source, name },
    );
  }

  /** Tries to connect with a token and reports success or the error text. */
  async tryConnect(options: { url: string; token: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.connect(options);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String((error as Error).message ?? error) };
    }
  }

  /**
   * Subscribes to one remote track (identity + track name), attaches it to a muted <video> and decodes the latency
   * stamp of every presented frame for `durationMs`. The connection must already exist (connect() with a viewer token).
   */
  async measure(options: { identity: string; trackName: string; durationMs: number; warmupMs?: number }): Promise<MeasureResult> {
    const raw = await this.page.evaluate(async (opts) => {
      const LK = (window as any).LivekitClient;
      const room = (window as any).__room;
      const find = () => {
        for (const participant of room.remoteParticipants.values()) {
          if (participant.identity !== opts.identity) continue;
          for (const publication of participant.trackPublications.values()) if (publication.trackName === opts.trackName && publication.track) return publication.track;
        }
        return null;
      };
      const deadline = Date.now() + 15_000;
      let track = find();
      while (!track && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        track = find();
      }
      if (!track) throw new Error(`track ${opts.identity}/${opts.trackName} was not subscribed within 15 s`);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = new MediaStream([track.mediaStreamTrack]);
      document.body.append(video);
      await video.play().catch(() => undefined);
      const samples: number[] = [];
      const stamps: number[] = [];
      let bad = 0;
      let running = true;
      const start = performance.now() + (opts.warmupMs ?? 1500);
      const onFrame = () => {
        if (!running) return;
        if (performance.now() >= start) {
          const decoded = (window as any).LatencyCodec.decodeStamp(video);
          if (decoded.ok) {
            const latency = (window as any).LatencyCodec.latencyMs(decoded.ts);
            if (latency < 60_000) {
              samples.push(latency);
              stamps.push(decoded.ts);
            } else bad += 1;
          } else bad += 1;
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      await new Promise((resolve) => setTimeout(resolve, (opts.warmupMs ?? 1500) + opts.durationMs));
      running = false;
      const result = { samples, stamps, bad, width: video.videoWidth, height: video.videoHeight };
      video.remove();
      void LK;
      return result;
    }, options);
    const sorted = [...raw.samples];
    return {
      frames: raw.samples.length,
      badFrames: raw.bad,
      width: raw.width,
      height: raw.height,
      latencies: raw.samples,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted.length ? Math.max(...sorted) : NaN,
      monotonic: raw.stamps.every((stamp, index) => index === 0 || stamp >= raw.stamps[index - 1]!),
    };
  }

  /** inbound-rtp stats of the room's subscriber peer connection (packetsReceived, framesDecoded, bytes, freezes). */
  async inboundStats(): Promise<Array<{ kind: string; packetsReceived: number; bytesReceived: number; framesDecoded: number; frameWidth?: number; freezeCount?: number; totalFreezesDuration?: number; codec?: string }>> {
    return this.page.evaluate(async () => {
      const room = (window as any).__room;
      const pc: RTCPeerConnection | undefined = room?.engine?.pcManager?.subscriber?.pc ?? room?.engine?.pcManager?.publisher?.pc;
      const subscriber: RTCPeerConnection | undefined = room?.engine?.pcManager?.subscriber?.pc ?? pc;
      if (!subscriber) return [];
      const report = await subscriber.getStats();
      const codecs = new Map<string, string>();
      report.forEach((stat: any) => {
        if (stat.type === 'codec') codecs.set(stat.id, stat.mimeType);
      });
      const result: any[] = [];
      report.forEach((stat: any) => {
        if (stat.type === 'inbound-rtp') {
          result.push({ kind: stat.kind, packetsReceived: stat.packetsReceived, bytesReceived: stat.bytesReceived, framesDecoded: stat.framesDecoded, frameWidth: stat.frameWidth, freezeCount: stat.freezeCount, totalFreezesDuration: stat.totalFreezesDuration, codec: codecs.get(stat.codecId) });
        }
      });
      return result;
    });
  }

  /** outbound-rtp stats of the publisher peer connection (bytesSent, framesSent, rid layers, codec). */
  async outboundStats(): Promise<Array<{ kind: string; rid?: string; bytesSent: number; framesSent: number; frameWidth?: number; codec?: string }>> {
    return this.page.evaluate(async () => {
      const room = (window as any).__room;
      const publisher: RTCPeerConnection | undefined = room?.engine?.pcManager?.publisher?.pc;
      if (!publisher) return [];
      const report = await publisher.getStats();
      const codecs = new Map<string, string>();
      report.forEach((stat: any) => {
        if (stat.type === 'codec') codecs.set(stat.id, stat.mimeType);
      });
      const result: any[] = [];
      report.forEach((stat: any) => {
        if (stat.type === 'outbound-rtp') result.push({ kind: stat.kind, rid: stat.rid, bytesSent: stat.bytesSent, framesSent: stat.framesSent, frameWidth: stat.frameWidth, codec: codecs.get(stat.codecId) });
      });
      return result;
    });
  }

  /** currentRoundTripTime (seconds) of the nominated ICE pair of the room's peer connections; null when unknown. */
  async iceRtt(): Promise<number | null> {
    return this.page.evaluate(async () => {
      const room = (window as any).__room;
      const pcs: RTCPeerConnection[] = [room?.engine?.pcManager?.subscriber?.pc, room?.engine?.pcManager?.publisher?.pc].filter(Boolean);
      let best: number | null = null;
      for (const pc of pcs) {
        const report = await pc.getStats();
        report.forEach((stat: any) => {
          if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded' && typeof stat.currentRoundTripTime === 'number') {
            best = best === null ? stat.currentRoundTripTime : Math.max(best, stat.currentRoundTripTime);
          }
        });
      }
      return best;
    });
  }

  /**
   * Sum over the nominated ICE pairs of the STUN round trips so far (`totalRoundTripTime` in seconds, `responsesReceived`).
   * Unlike `currentRoundTripTime`, which the browser smooths over the last STUN responses (a delay that was removed
   * decays over several pings of 2.5-5 s and a busy runner never gets below a tight threshold), the difference of two
   * readings is the plain average RTT of the responses in between. Null when no pair is nominated.
   */
  async iceRttTotals(): Promise<{ totalSeconds: number; responses: number } | null> {
    return this.page.evaluate(async () => {
      const room = (window as any).__room;
      const pcs: RTCPeerConnection[] = [room?.engine?.pcManager?.subscriber?.pc, room?.engine?.pcManager?.publisher?.pc].filter(Boolean);
      let totals: { totalSeconds: number; responses: number } | null = null;
      for (const pc of pcs) {
        const report = await pc.getStats();
        report.forEach((stat: any) => {
          if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded' && typeof stat.totalRoundTripTime === 'number' && typeof stat.responsesReceived === 'number') {
            totals = { totalSeconds: (totals?.totalSeconds ?? 0) + stat.totalRoundTripTime, responses: (totals?.responses ?? 0) + stat.responsesReceived };
          }
        });
      }
      return totals;
    });
  }

  /** Selected ICE candidate pair description (protocol and remote address) for the diagnostics. */
  async iceDescription(): Promise<string> {
    return this.page.evaluate(async () => {
      const room = (window as any).__room;
      const pc: RTCPeerConnection | undefined = room?.engine?.pcManager?.subscriber?.pc ?? room?.engine?.pcManager?.publisher?.pc;
      if (!pc) return 'no peer connection';
      const report = await pc.getStats();
      const remotes = new Map<string, any>();
      report.forEach((stat: any) => {
        if (stat.type === 'remote-candidate') remotes.set(stat.id, stat);
      });
      let text = 'no nominated pair';
      report.forEach((stat: any) => {
        if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
          const remote = remotes.get(stat.remoteCandidateId);
          text = remote ? `${remote.protocol} ${remote.address}:${remote.port} (${remote.candidateType})` : 'pair without remote candidate';
        }
      });
      return text;
    });
  }

  async close(): Promise<void> {
    await this.page.evaluate(() => clearInterval((window as any).__stampTimer)).catch(() => undefined);
    await this.page.close().catch(() => undefined);
  }
}
