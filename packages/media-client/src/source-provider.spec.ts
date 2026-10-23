import { DisconnectReason, RoomEvent, VideoQuality } from 'livekit-client';
import type { Clock } from './clock';
import type { MediaRoom } from './livekit-port';
import { silentLogger } from './logger';
import { MediaSession, type RoomSource } from './media-session';
import type { MediaRole } from './room-options';
import { LiveKitSourceProvider, type LiveKitSourceProviderOptions } from './source-provider';
import {
  FakeLifecycle,
  FakeMediaStream,
  FakeRemoteTrack,
  FakeRoom,
  fakeCreateStream,
  fakeToken,
  flushMicrotasks,
} from './testing/fake-livekit';

const DEVICE = 'dev_aaaaaaaaaaaaaaaa';
const CAMERA = `${DEVICE}/camera`;
const SCREEN = `${DEVICE}/screen-1`;

class FakeRoomSource implements RoomSource {
  room: MediaRoom | null;
  readonly #listeners = new Set<(room: MediaRoom | null) => void>();

  constructor(
    readonly role: MediaRole,
    room: FakeRoom | null,
  ) {
    this.room = room;
  }

  onRoom(listener: (room: MediaRoom | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  switchTo(room: FakeRoom | null): void {
    this.room = room;
    for (const listener of this.#listeners) {
      listener(room);
    }
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}

const testClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

function setup(role: MediaRole = 'output', options: Partial<LiveKitSourceProviderOptions> = {}) {
  const room = new FakeRoom();
  const source = new FakeRoomSource(role, room);
  const provider = new LiveKitSourceProvider(source, {
    assetUrl: (assetId) => `/api/assets/${assetId}/content`,
    logger: silentLogger,
    clock: testClock,
    createStream: fakeCreateStream,
    ...options,
  });
  const changes: string[] = [];
  provider.onChange((sourceId) => changes.push(sourceId));
  return { room, source, provider, changes };
}

function video(): HTMLVideoElement {
  const element = document.createElement('video');
  vi.spyOn(element, 'play').mockResolvedValue(undefined);
  return element;
}

function streamTrack(element: HTMLVideoElement): MediaStreamTrack | undefined {
  return (element.srcObject as unknown as FakeMediaStream | null)?.track;
}

describe('LiveKitSourceProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('attach and availability', () => {
    it('is pending for unknown sources', () => {
      const { provider } = setup();
      expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
      expect(provider.availability('garbage')).toEqual({ state: 'pending' });
    });

    it('attaches an element registered before the track arrives', () => {
      const { room, provider, changes } = setup();
      const element = video();
      provider.attach(CAMERA, element);
      expect(element.srcObject).toBeNull();
      expect(element.muted).toBe(true);
      expect(element.playsInline).toBe(true);

      const { track } = room.subscribe(DEVICE, 'camera');
      expect(streamTrack(element)).toBe(track.mediaStreamTrack);
      expect(element.play).toHaveBeenCalled();
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(changes).toEqual([CAMERA]);
    });

    it('attaches an element registered after the track arrived, sharing one stream', () => {
      const { room, provider } = setup();
      const { track } = room.subscribe(DEVICE, 'screen-1');
      const first = video();
      const second = video();
      provider.attach(SCREEN, first);
      provider.attach(SCREEN, second);
      expect(streamTrack(first)).toBe(track.mediaStreamTrack);
      expect(second.srcObject).toBe(first.srcObject);
    });

    it('never throws when play() rejects or throws', async () => {
      const { room, provider } = setup();
      const rejecting = document.createElement('video');
      vi.spyOn(rejecting, 'play').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
      const throwing = document.createElement('video');
      vi.spyOn(throwing, 'play').mockImplementation(() => {
        throw new Error('old engine');
      });
      provider.attach(CAMERA, rejecting);
      provider.attach(CAMERA, throwing);
      expect(() => room.subscribe(DEVICE, 'camera')).not.toThrow();
      await flushMicrotasks();
    });

    it('ignores tracks that are not StudioFlow video slots', () => {
      const { room, provider, changes } = setup();
      room.subscribe(DEVICE, 'microphone');
      room.subscribe(DEVICE, 'screen-10');
      room.subscribe(DEVICE, 'camera', { track: new FakeRemoteTrack('audio') });
      expect(changes).toEqual([]);
      expect(provider.availability(`${DEVICE}/microphone`)).toEqual({ state: 'pending' });
      expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
    });

    it('keeps a muted publication pending until it unmutes', () => {
      const { room, provider } = setup();
      const { publication, participant } = room.subscribe(DEVICE, 'camera', { muted: true });
      expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
      publication.isMuted = false;
      room.emit(RoomEvent.TrackUnmuted, publication, participant);
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
    });

    it('stops updating a detached element', () => {
      const { room, provider } = setup();
      const element = video();
      provider.attach(CAMERA, element);
      provider.detach(CAMERA, element);
      room.subscribe(DEVICE, 'camera');
      expect(element.srcObject).toBeNull();
      expect(() => provider.detach('unknown', element)).not.toThrow();
    });
  });

  describe('track loss (hold frame)', () => {
    it.each([
      ['TrackUnsubscribed', (room: FakeRoom) => room.unsubscribe(DEVICE, 'camera')],
      [
        'ParticipantDisconnected',
        (room: FakeRoom) =>
          room.emit(RoomEvent.ParticipantDisconnected, room.remoteParticipants.get(DEVICE)),
      ],
      [
        'TrackUnpublished',
        (room: FakeRoom) =>
          room.emit(
            RoomEvent.TrackUnpublished,
            room.remoteParticipants.get(DEVICE)?.trackPublications.get('camera'),
            room.remoteParticipants.get(DEVICE),
          ),
      ],
      [
        'TrackMuted',
        (room: FakeRoom) =>
          room.emit(
            RoomEvent.TrackMuted,
            room.remoteParticipants.get(DEVICE)?.trackPublications.get('camera'),
            room.remoteParticipants.get(DEVICE),
          ),
      ],
    ])('marks the source lost on %s and keeps srcObject', (_event, loseTrack) => {
      const { room, provider, changes } = setup();
      const element = video();
      provider.attach(CAMERA, element);
      room.subscribe(DEVICE, 'camera');
      const shown = element.srcObject;
      vi.advanceTimersByTime(500);

      loseTrack(room);
      expect(provider.availability(CAMERA)).toEqual({ state: 'lost', since: 1_000_500 });
      expect(element.srcObject).toBe(shown);
      expect(changes).toEqual([CAMERA, CAMERA]);
    });

    it('keeps the first loss time through the synthesized departures of a full reconnect', () => {
      const { room, provider, changes } = setup();
      room.subscribe(DEVICE, 'camera');
      const participant = room.remoteParticipants.get(DEVICE);
      room.emit(RoomEvent.ParticipantDisconnected, participant);
      vi.advanceTimersByTime(100);
      room.unsubscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'lost', since: 1_000_000 });
      expect(changes).toEqual([CAMERA, CAMERA]);
    });

    it('goes live again with the new track of a resubscription', () => {
      const { room, provider } = setup();
      const element = video();
      provider.attach(CAMERA, element);
      room.subscribe(DEVICE, 'camera');
      room.unsubscribe(DEVICE, 'camera');
      const { track } = room.subscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(streamTrack(element)).toBe(track.mediaStreamTrack);
    });

    it('ignores departures of other tracks and duplicate subscriptions', () => {
      const { room, provider, changes } = setup();
      const { track, publication, participant } = room.subscribe(DEVICE, 'camera');
      room.emit(RoomEvent.TrackSubscribed, track, publication, participant);
      room.emit(RoomEvent.TrackUnsubscribed, new FakeRemoteTrack(), publication, participant);
      room.emit(RoomEvent.TrackUnpublished, { trackName: 'camera', kind: 'video' }, participant);
      room.emit(RoomEvent.TrackMuted, { trackName: 'camera', kind: 'video' }, participant);
      room.emit(RoomEvent.ParticipantDisconnected, {
        identity: 'dev_bbbbbbbbbbbbbbbb',
        trackPublications: new Map(),
      });
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(changes).toEqual([CAMERA]);
    });

    it('unsubscribing a never-live source keeps it pending', () => {
      const { room, provider } = setup();
      room.subscribe(DEVICE, 'camera', { muted: true });
      room.unsubscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
    });
  });

  describe('desired sizes (output)', () => {
    it('requests LOW without consumers and the largest consumer size otherwise', () => {
      const { room, provider } = setup('output');
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.LOW);

      provider.setDesiredSize(CAMERA, 'program', { width: 960, height: 540 });
      provider.setDesiredSize(CAMERA, 'debug', { width: 1920, height: 400 });
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 1920, height: 540 });

      provider.setDesiredSize(CAMERA, 'debug', null);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 960, height: 540 });
      provider.setDesiredSize(CAMERA, 'program', null);
      expect(publication.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.LOW);
      expect(publication.setEnabled).not.toHaveBeenCalled();
    });

    it('applies sizes requested before the track and re-applies them after a resubscription', () => {
      const { room, provider } = setup('output');
      provider.setDesiredSize(CAMERA, 'program', { width: 1280, height: 720 });
      const first = room.subscribe(DEVICE, 'camera').publication;
      expect(first.setVideoDimensions).toHaveBeenCalledWith({ width: 1280, height: 720 });
      room.unsubscribe(DEVICE, 'camera');
      const second = room.subscribe(DEVICE, 'camera').publication;
      expect(second).not.toBe(first);
      expect(second.setVideoDimensions).toHaveBeenCalledWith({ width: 1280, height: 720 });
    });

    it('survives SDK calls that throw', () => {
      const { room, provider } = setup('output');
      const { publication } = room.subscribe(DEVICE, 'camera', { emit: false });
      publication.setVideoDimensions.mockImplementation(() => {
        throw new Error('cannot update track settings when not subscribed');
      });
      room.emit(
        RoomEvent.TrackSubscribed,
        publication.track,
        publication,
        room.remoteParticipants.get(DEVICE),
      );
      expect(() =>
        provider.setDesiredSize(CAMERA, 'program', { width: 640, height: 360 }),
      ).not.toThrow();
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
    });
  });

  describe('desired sizes (studio)', () => {
    it('enables and sizes needed sources, pauses unused ones after 10 s and resumes at once', () => {
      const { room, provider } = setup('studio');
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(9_999);
      expect(publication.setEnabled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);

      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      expect(publication.setEnabled).toHaveBeenLastCalledWith(true);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 480, height: 270 });
      expect(publication.setVideoQuality).not.toHaveBeenCalled();
    });

    it('does not pause a source whose consumer comes back within 10 s', () => {
      const { room, provider } = setup('studio');
      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      const { publication } = room.subscribe(DEVICE, 'camera');
      provider.setDesiredSize(CAMERA, 'monitor', null);
      vi.advanceTimersByTime(5_000);
      provider.setDesiredSize(CAMERA, 'thumbnail', { width: 128, height: 72 });
      vi.advanceTimersByTime(20_000);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels the pause timer when the track goes away', () => {
      const { room } = setup('studio');
      room.subscribe(DEVICE, 'camera');
      room.unsubscribe(DEVICE, 'camera');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('playout delay', () => {
    it('targets zero delay in the Regie', () => {
      const { room } = setup('studio');
      const { track } = room.subscribe(DEVICE, 'camera');
      expect(track.setPlayoutDelay).toHaveBeenCalledWith(0);
      expect(track.receiver?.jitterBufferTarget).toBe(0);
    });

    it('targets 50 ms on the output', () => {
      const { room } = setup('output');
      const { track } = room.subscribe(DEVICE, 'camera');
      expect(track.setPlayoutDelay).toHaveBeenCalledWith(0.05);
      expect(track.receiver?.jitterBufferTarget).toBe(50);
    });

    it('tolerates browsers without playout APIs', () => {
      const { room, provider } = setup('output');
      const track = new FakeRemoteTrack();
      track.receiver = undefined;
      Object.assign(track, { setPlayoutDelay: undefined });
      room.subscribe(DEVICE, 'camera', { track });
      const other = new FakeRemoteTrack();
      other.receiver = {};
      other.setPlayoutDelay.mockImplementation(() => {
        throw new RangeError('out of range');
      });
      room.subscribe(DEVICE, 'screen-1', { track: other });
      expect(other.receiver).toEqual({});
      expect(provider.availability(SCREEN)).toEqual({ state: 'live' });
    });
  });

  describe('rooms', () => {
    it('rebinds to a new room: old tracks are lost, new tracks live', () => {
      const { room, source, provider } = setup();
      const element = video();
      provider.attach(CAMERA, element);
      room.subscribe(DEVICE, 'camera');
      const oldStream = element.srcObject;

      source.switchTo(null);
      expect(provider.availability(CAMERA)).toMatchObject({ state: 'lost' });
      expect(room.listenerCount()).toBe(0);
      expect(element.srcObject).toBe(oldStream);

      const next = new FakeRoom();
      source.switchTo(next);
      const { track } = next.subscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(streamTrack(element)).toBe(track.mediaStreamTrack);
    });

    it('ignores a repeated announcement of the bound room', () => {
      const { room, source, provider } = setup();
      room.subscribe(DEVICE, 'camera');
      source.switchTo(room);
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(room.listenerCount(RoomEvent.TrackSubscribed)).toBe(1);
    });

    it('picks up tracks subscribed before it was created', () => {
      const room = new FakeRoom();
      room.subscribe(DEVICE, 'camera');
      room.subscribe(DEVICE, 'screen-1', { muted: true });
      room.subscribe('dev_cccccccccccccccc', 'camera', { emit: false });
      const pub = room.remoteParticipants
        .get('dev_cccccccccccccccc')
        ?.trackPublications.get('camera');
      if (pub !== undefined) {
        pub.isSubscribed = false;
      }
      const provider = new LiveKitSourceProvider(new FakeRoomSource('output', room), {
        assetUrl: () => null,
        logger: silentLogger,
        createStream: fakeCreateStream,
      });
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(provider.availability(SCREEN)).toEqual({ state: 'pending' });
      expect(provider.availability('dev_cccccccccccccccc/camera')).toEqual({ state: 'pending' });
    });

    it('follows a real MediaSession through a rejoin', async () => {
      const rooms: FakeRoom[] = [];
      const session = new MediaSession({
        role: 'output',
        tokenProvider: async () => fakeToken(),
        roomFactory: () => {
          const room = new FakeRoom(true);
          rooms.push(room);
          return room;
        },
        logger: silentLogger,
        random: () => 0,
        pageLifecycle: () => new FakeLifecycle(),
      });
      const provider = new LiveKitSourceProvider(session, {
        assetUrl: () => null,
        logger: silentLogger,
        createStream: fakeCreateStream,
      });
      const element = video();
      provider.attach(CAMERA, element);
      session.start();
      await flushMicrotasks();
      rooms[0].subscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });

      rooms[0].serverDisconnect(undefined);
      expect(provider.availability(CAMERA)).toMatchObject({ state: 'lost' });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.state).toBe('connected');
      const { track } = rooms[1].subscribe(DEVICE, 'camera');
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(streamTrack(element)).toBe(track.mediaStreamTrack);

      rooms[1].serverDisconnect(DisconnectReason.PARTICIPANT_REMOVED);
      expect(provider.availability(CAMERA)).toMatchObject({ state: 'lost' });
      provider.dispose();
    });
  });

  describe('stats', () => {
    it('returns null for sources without a subscribed track', async () => {
      const { room, provider } = setup();
      await expect(provider.getStats(CAMERA)).resolves.toBeNull();
      room.subscribe(DEVICE, 'camera');
      room.unsubscribe(DEVICE, 'camera');
      await expect(provider.getStats(CAMERA)).resolves.toBeNull();
    });

    it('reports resolution, fps, codec, loss, buffer delay, RTT and bitrate', async () => {
      const { room, provider } = setup();
      const track = new FakeRemoteTrack();
      track.currentBitrate = 2_456_000;
      track.stats = new Map<string, unknown>([
        [
          'IT',
          {
            type: 'inbound-rtp',
            kind: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 30,
            packetsLost: 0,
            packetsReceived: 500,
            jitterBufferDelay: 2,
            jitterBufferEmittedCount: 100,
            codecId: 'C',
          },
        ],
        ['C', { type: 'codec', mimeType: 'video/H264' }],
        ['P', { type: 'candidate-pair', selected: true, currentRoundTripTime: 0.012 }],
      ]);
      room.subscribe(DEVICE, 'camera', { track });
      await expect(provider.getStats(CAMERA)).resolves.toEqual({
        width: 1920,
        height: 1080,
        fps: 30,
        packetLossPct: 0,
        jitterBufferDelayMs: 20,
        codec: 'h264',
        rttMs: 12,
        bitrateKbps: 2456,
      });
    });

    it('degrades to the bitrate when stats fail', async () => {
      const { room, provider } = setup();
      const track = new FakeRemoteTrack();
      track.currentBitrate = 1000;
      track.getRTCStatsReport.mockRejectedValue(new Error('closed'));
      room.subscribe(DEVICE, 'camera', { track });
      await expect(provider.getStats(CAMERA)).resolves.toEqual({ bitrateKbps: 1 });
      track.getRTCStatsReport.mockResolvedValue(undefined);
      await expect(provider.getStats(CAMERA)).resolves.toEqual({ bitrateKbps: 1 });
    });

    it('estimates latency as the average of RTT/2 + jitter buffer over live sources', async () => {
      const { room, provider } = setup();
      await expect(provider.estimateLatencyMs()).resolves.toBeNull();
      const withStats = (rtt: number, buffer: number): FakeRemoteTrack => {
        const track = new FakeRemoteTrack();
        track.stats = new Map<string, unknown>([
          [
            'IT',
            {
              type: 'inbound-rtp',
              kind: 'video',
              jitterBufferDelay: buffer,
              jitterBufferEmittedCount: 1,
            },
          ],
          ['P', { type: 'candidate-pair', selected: true, currentRoundTripTime: rtt }],
        ]);
        return track;
      };
      room.subscribe(DEVICE, 'camera', { track: withStats(0.02, 0.05) });
      room.subscribe(DEVICE, 'screen-1', { track: withStats(0.04, 0.03) });
      room.subscribe('dev_dddddddddddddddd', 'camera', { track: new FakeRemoteTrack() });
      room.subscribe('dev_eeeeeeeeeeeeeeee', 'camera', { track: withStats(1, 1) });
      room.unsubscribe('dev_eeeeeeeeeeeeeeee', 'camera');
      // camera: 10 + 50 = 60, screen: 20 + 30 = 50, the track without stats and the lost one are ignored.
      await expect(provider.estimateLatencyMs()).resolves.toBe(55);
    });
  });

  describe('assets and lifecycle', () => {
    it('delegates asset URLs and survives a failing resolver', () => {
      const { provider } = setup();
      expect(provider.assetUrl('ast_aaaaaaaaaaaaaaaa')).toBe(
        '/api/assets/ast_aaaaaaaaaaaaaaaa/content',
      );
      const failing = new LiveKitSourceProvider(new FakeRoomSource('output', null), {
        assetUrl: () => {
          throw new Error('no key');
        },
        logger: silentLogger,
      });
      expect(failing.assetUrl('ast_aaaaaaaaaaaaaaaa')).toBeNull();
    });

    it('isolates a throwing change listener', () => {
      const { room, provider, changes } = setup();
      provider.onChange(() => {
        throw new Error('renderer bug');
      });
      expect(() => room.subscribe(DEVICE, 'camera')).not.toThrow();
      expect(changes).toEqual([CAMERA]);
    });

    it('releases everything on dispose', () => {
      const { room, source, provider, changes } = setup('studio');
      const element = video();
      provider.attach(CAMERA, element);
      room.subscribe(DEVICE, 'camera');
      provider.dispose();
      provider.dispose();

      expect(room.listenerCount()).toBe(0);
      expect(source.listenerCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(provider.availability(CAMERA)).toEqual({ state: 'pending' });
      provider.attach(SCREEN, video());
      provider.setDesiredSize(SCREEN, 'x', { width: 1, height: 1 });
      source.switchTo(new FakeRoom());
      expect(changes).toEqual([CAMERA]);
    });
  });
});
