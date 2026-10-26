/**
 * A session the test controls: the room, its state and the listeners of a `SessionStateSource`. Test-only module.
 */
import type { MediaRoom } from '../livekit-port';
import type { MediaSessionState, SessionStateSource } from '../media-session';
import { FakeRoom } from './fake-livekit';

export class FakeSession implements SessionStateSource {
  readonly role = 'sender' as const;
  room: MediaRoom | null = null;
  state: MediaSessionState = 'connecting';
  readonly #roomListeners = new Set<(room: MediaRoom | null) => void>();
  readonly #stateListeners = new Set<(state: MediaSessionState) => void>();

  onRoom(listener: (room: MediaRoom | null) => void): () => void {
    this.#roomListeners.add(listener);
    return () => this.#roomListeners.delete(listener);
  }

  onStateChange(listener: (state: MediaSessionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** New room announced, then connected (the MediaSession order). */
  connect(room: FakeRoom = new FakeRoom()): FakeRoom {
    this.room = room;
    this.#roomListeners.forEach((listener) => listener(room));
    this.setState('connected');
    return room;
  }

  /** The room is lost: the session waits for a new one. */
  lose(): void {
    this.room = null;
    this.#roomListeners.forEach((listener) => listener(null));
    this.setState('waiting');
  }

  setState(state: MediaSessionState): void {
    this.state = state;
    this.#stateListeners.forEach((listener) => listener(state));
  }

  get listenerCount(): number {
    return this.#roomListeners.size + this.#stateListeners.size;
  }
}
