import { DisconnectReason, RoomEvent } from 'livekit-client';
import { DecoderCapability } from './decoder-info';
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

/** Somebody needs a picture of the sources (a source nobody asks for is paused, see "desired sizes"). */
function need(provider: LiveKitSourceProvider, ...sources: string[]): void {
  for (const source of sources) {
    provider.setDesiredSize(source, 'test', { width: 640, height: 360 });
  }
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
      need(provider, CAMERA);
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
      need(provider, SCREEN);
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
      need(provider, CAMERA);
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
    it('requests the largest consumer size and pauses the source 5 s after the last consumer left', () => {
      const { room, provider } = setup('output');
      provider.setDesiredSize(CAMERA, 'program', { width: 960, height: 540 });
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).toHaveBeenLastCalledWith(true);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 960, height: 540 });

      provider.setDesiredSize(CAMERA, 'debug', { width: 1920, height: 400 });
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 1920, height: 540 });

      provider.setDesiredSize(CAMERA, 'debug', null);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 960, height: 540 });
      provider.setDesiredSize(CAMERA, 'program', null);
      expect(publication.setVideoQuality).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4_999);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      vi.advanceTimersByTime(1);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);
    });

    it('pauses a track nobody asked for 1.5 s after it arrives (the output decodes only what it shows or prepares)', () => {
      const { room, provider } = setup('output');
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_499);
      expect(publication.setEnabled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(publication.setEnabled).toHaveBeenCalledTimes(1);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);
      expect(publication.setVideoDimensions).not.toHaveBeenCalled();
      // The source is still known and live: switching to a scene that shows it needs only a picture, not a subscription.
      expect(provider.availability(CAMERA)).toEqual({ state: 'live' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not pause a new track whose consumer registers right after it arrives (a page that is loading)', () => {
      const { room, provider } = setup('output');
      const { publication } = room.subscribe(DEVICE, 'camera');
      vi.advanceTimersByTime(400);
      provider.setDesiredSize(CAMERA, 'program', { width: 1280, height: 720 });
      vi.advanceTimersByTime(60_000);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 1280, height: 720 });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resumes a paused source when a consumer asks, with the size it asks for', () => {
      const { room, provider } = setup('output');
      const { publication } = room.subscribe(DEVICE, 'camera');
      vi.advanceTimersByTime(1_500);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);
      provider.setDesiredSize(CAMERA, 'program', { width: 1280, height: 720 });
      expect(publication.setEnabled).toHaveBeenLastCalledWith(true);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 1280, height: 720 });
    });

    it('keeps a source whose consumer comes back within the grace time (a scene cycle must not stop and start it)', () => {
      const { room, provider } = setup('output');
      provider.setDesiredSize(CAMERA, 'program', { width: 640, height: 360 });
      const { publication } = room.subscribe(DEVICE, 'camera');
      provider.setDesiredSize(CAMERA, 'program', null);
      vi.advanceTimersByTime(3_000);
      provider.setDesiredSize(CAMERA, 'preview', { width: 640, height: 360 });
      vi.advanceTimersByTime(60_000);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('shows no picture of a paused source: elements are emptied, stay empty on attach and get the stream on resume', () => {
      const { room, provider } = setup('output');
      const shown = video();
      provider.attach(CAMERA, shown);
      provider.setDesiredSize(CAMERA, 'program', { width: 640, height: 360 });
      const { track } = room.subscribe(DEVICE, 'camera');
      expect(streamTrack(shown)).toBe(track.mediaStreamTrack);

      provider.setDesiredSize(CAMERA, 'program', null);
      vi.advanceTimersByTime(5_000);
      // The frame from before the pause is gone: it may be minutes old.
      expect(shown.srcObject).toBeNull();
      const late = video();
      provider.attach(CAMERA, late);
      expect(late.srcObject).toBeNull();

      provider.setDesiredSize(CAMERA, 'program', { width: 640, height: 360 });
      expect(streamTrack(shown)).toBe(track.mediaStreamTrack);
      expect(streamTrack(late)).toBe(track.mediaStreamTrack);
      expect(shown.srcObject).toBe(late.srcObject);
    });

    it('is not paused any more after a resubscription (a new publication is enabled)', () => {
      const { room, provider } = setup('output');
      room.subscribe(DEVICE, 'camera');
      room.unsubscribe(DEVICE, 'camera');
      provider.setDesiredSize(CAMERA, 'program', { width: 640, height: 360 });
      const element = video();
      provider.attach(CAMERA, element);
      const { track, publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).toHaveBeenLastCalledWith(true);
      expect(streamTrack(element)).toBe(track.mediaStreamTrack);
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
      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      provider.setDesiredSize(CAMERA, 'monitor', null);
      vi.advanceTimersByTime(9_999);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      vi.advanceTimersByTime(1);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);

      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      expect(publication.setEnabled).toHaveBeenLastCalledWith(true);
      expect(publication.setVideoDimensions).toHaveBeenLastCalledWith({ width: 480, height: 270 });
      expect(publication.setVideoQuality).not.toHaveBeenCalled();
    });

    it('pauses a track nobody asked for 1.5 s after it arrives', () => {
      const { room } = setup('studio');
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setEnabled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_500);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);
    });

    it('honours disableUnusedAfterMs', () => {
      const { room, provider } = setup('studio', { disableUnusedAfterMs: 1_000 });
      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      const { publication } = room.subscribe(DEVICE, 'camera');
      provider.setDesiredSize(CAMERA, 'monitor', null);
      vi.advanceTimersByTime(999);
      expect(publication.setEnabled).not.toHaveBeenCalledWith(false);
      vi.advanceTimersByTime(1);
      expect(publication.setEnabled).toHaveBeenLastCalledWith(false);
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
      const { room, provider } = setup('studio');
      provider.setDesiredSize(CAMERA, 'monitor', { width: 480, height: 270 });
      room.subscribe(DEVICE, 'camera');
      provider.setDesiredSize(CAMERA, 'monitor', null);
      expect(vi.getTimerCount()).toBe(1);
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
      need(provider, CAMERA);
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
      need(provider, CAMERA);
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

    /** Receiver statistics of a stream with the decoder counters. */
    function decodedStats(options: {
      readonly decoded: number;
      readonly dropped?: number;
      readonly received?: number;
      readonly powerEfficient?: boolean;
      readonly codec?: string;
      readonly width?: number;
    }): Map<string, unknown> {
      return new Map<string, unknown>([
        [
          'IT',
          {
            type: 'inbound-rtp',
            kind: 'video',
            frameWidth: options.width ?? 1280,
            frameHeight: 720,
            framesDecoded: options.decoded,
            framesDropped: options.dropped ?? 0,
            framesReceived: options.received ?? options.decoded,
            codecId: 'C',
            ...(options.powerEfficient === undefined
              ? {}
              : { powerEfficientDecoder: options.powerEfficient }),
          },
        ],
        ['C', { type: 'codec', mimeType: `video/${options.codec ?? 'H264'}` }],
      ]);
    }

    it('tells hardware or software decoding from the stats, else from the capabilities', async () => {
      const decodingInfo = vi.fn(async () => ({ supported: true, powerEfficient: false }));
      const { room, provider } = setup('output', {
        decoderCapability: new DecoderCapability({ decodingInfo }),
      });
      const hidden = new FakeRemoteTrack();
      hidden.stats = decodedStats({ decoded: 10 });
      room.subscribe(DEVICE, 'camera', { track: hidden });
      // The browser hides the decoder from this page: it says what it would decode with.
      await expect(provider.getStats(CAMERA)).resolves.toMatchObject({ decoder: 'software' });
      expect(decodingInfo).toHaveBeenCalledWith({
        type: 'webrtc',
        video: expect.objectContaining({
          contentType: expect.stringContaining('video/H264'),
          width: 1280,
          height: 720,
        }),
      });

      const told = new FakeRemoteTrack();
      told.stats = decodedStats({ decoded: 10, powerEfficient: true, codec: 'VP9' });
      room.subscribe(DEVICE, 'screen-1', { track: told });
      await expect(provider.getStats(SCREEN)).resolves.toMatchObject({
        decoder: 'hardware',
        powerEfficientDecoder: true,
      });
    });

    it('reports no decoder when nothing tells', async () => {
      const { room, provider } = setup('output', {
        decoderCapability: new DecoderCapability(undefined),
      });
      const track = new FakeRemoteTrack();
      track.stats = decodedStats({ decoded: 10 });
      room.subscribe(DEVICE, 'camera', { track });
      const stats = await provider.getStats(CAMERA);
      expect(stats).not.toBeNull();
      expect(stats).not.toHaveProperty('decoder');
    });

    it('sums up the decoders: streams that decode, those in software, dropped and received frames per interval', async () => {
      const { room, provider } = setup('output', {
        decoderCapability: new DecoderCapability({
          decodingInfo: async ({ video }) => ({
            supported: true,
            powerEfficient: video.contentType.startsWith('video/H264'),
          }),
        }),
      });
      need(provider, CAMERA, SCREEN, 'dev_dddddddddddddddd/camera');
      const camera = new FakeRemoteTrack();
      const screen = new FakeRemoteTrack();
      const idle = new FakeRemoteTrack();
      camera.stats = decodedStats({ decoded: 300, dropped: 3, received: 310 });
      screen.stats = decodedStats({ decoded: 90, dropped: 0, received: 90, codec: 'VP9' });
      idle.stats = decodedStats({ decoded: 0 });
      room.subscribe(DEVICE, 'camera', { track: camera });
      room.subscribe(DEVICE, 'screen-1', { track: screen });
      room.subscribe('dev_dddddddddddddddd', 'camera', { track: idle });
      // A source nobody needs is paused and decodes nothing, whatever its counters say.
      room.subscribe('dev_eeeeeeeeeeeeeeee', 'camera', { track: decodedTrack(5000) });
      vi.advanceTimersByTime(1_500);

      await expect(provider.decoderSummary()).resolves.toEqual({
        decoding: 2,
        software: 1,
        framesDropped: 3,
        framesReceived: 400,
      });

      // The next interval counts only what was added; the screen decodes nothing more.
      camera.stats = decodedStats({ decoded: 330, dropped: 5, received: 345 });
      await expect(provider.decoderSummary()).resolves.toEqual({
        decoding: 1,
        software: 0,
        framesDropped: 2,
        framesReceived: 35,
      });
    });

    function decodedTrack(decoded: number): FakeRemoteTrack {
      const track = new FakeRemoteTrack();
      track.stats = decodedStats({ decoded });
      return track;
    }

    it('counts nothing without sources and survives failing stats', async () => {
      const { room, provider } = setup('output');
      await expect(provider.decoderSummary()).resolves.toEqual({
        decoding: 0,
        software: 0,
        framesDropped: 0,
        framesReceived: 0,
      });
      need(provider, CAMERA);
      const track = new FakeRemoteTrack();
      track.getRTCStatsReport.mockRejectedValue(new Error('closed'));
      room.subscribe(DEVICE, 'camera', { track });
      await expect(provider.decoderSummary()).resolves.toMatchObject({ decoding: 0 });
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
      need(provider, CAMERA, SCREEN, 'dev_dddddddddddddddd/camera', 'dev_eeeeeeeeeeeeeeee/camera');
      room.subscribe(DEVICE, 'camera', { track: withStats(0.02, 0.05) });
      room.subscribe(DEVICE, 'screen-1', { track: withStats(0.04, 0.03) });
      room.subscribe('dev_dddddddddddddddd', 'camera', { track: new FakeRemoteTrack() });
      room.subscribe('dev_eeeeeeeeeeeeeeee', 'camera', { track: withStats(1, 1) });
      room.unsubscribe('dev_eeeeeeeeeeeeeeee', 'camera');
      // A paused source is not part of the average either.
      room.subscribe('dev_ffffffffffffffff', 'camera', { track: withStats(2, 2) });
      vi.advanceTimersByTime(1_500);
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
