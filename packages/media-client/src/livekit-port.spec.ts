import { ConnectionState, Room, RoomEvent, type RoomEventCallbacks } from 'livekit-client';
import { createLiveKitRoom, listenTo, type MediaRoomEvents } from './livekit-port';
import { roomOptionsFor } from './room-options';

/** For every port event: can the port handler be registered where livekit calls its own callback type? */
type Conformance = {
  [K in keyof MediaRoomEvents]: MediaRoomEvents[K] extends RoomEventCallbacks[K] ? true : false;
};

describe('livekit port', () => {
  it('matches the callback signatures of livekit-client (compile-time check)', () => {
    expectTypeOf<Conformance>().toEqualTypeOf<{ [K in keyof MediaRoomEvents]: true }>();
  });

  it('creates real livekit rooms with the role options', () => {
    const room = createLiveKitRoom(roomOptionsFor('output'));
    expect(room).toBeInstanceOf(Room);
    expect(room.state).toBe(ConnectionState.Disconnected);
    expect((room as Room).options.adaptiveStream).toBe(false);
    expect((room as Room).options.stopLocalTrackOnUnpublish).toBe(false);
  });

  it('attaches typed handlers to a real room, isolates their errors and removes them together', () => {
    const room = createLiveKitRoom(roomOptionsFor('studio')) as Room;
    const baseline =
      room.listenerCount(RoomEvent.Disconnected) + room.listenerCount(RoomEvent.Reconnected);
    const onError = vi.fn();
    const reconnected = vi.fn();
    const group = listenTo(room, onError)
      .on(RoomEvent.Disconnected, () => {
        throw new Error('handler bug');
      })
      .on(RoomEvent.Reconnected, reconnected);

    expect(() => room.emit(RoomEvent.Disconnected)).not.toThrow();
    room.emit(RoomEvent.Reconnected);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledTimes(1);

    group.dispose();
    group.dispose();
    expect(
      room.listenerCount(RoomEvent.Disconnected) + room.listenerCount(RoomEvent.Reconnected),
    ).toBe(baseline);
  });
});
