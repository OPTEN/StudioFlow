/**
 * The media test of the first-run wizard and the "Server settings" (issue #27): can this browser exchange data with
 * LiveKit over WebRTC through the address the server announces? Two throw-away participants join one room; the first
 * sends a message, the second answers it, and the answer must arrive. That needs the signalling connection (through
 * the same origin as the page, `/rtc`) and a working WebRTC transport to the announced address (ICE over UDP or TCP),
 * which is exactly what pictures and sound need later. The tokens are the ones of `POST /api/settings/media/test`.
 */
import { ConnectionErrorReason, Room, RoomEvent, type RoomOptions } from 'livekit-client';

/** The narrow slice of `Room` the test uses; tests pass small fakes. */
export interface MediaTestRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  readonly localParticipant: {
    publishData(data: Uint8Array, options?: { reliable?: boolean }): Promise<void>;
  };
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
}

/** Creates one room of the test. Its type annotation is the compile-time proof that `Room` satisfies {@link MediaTestRoom}. */
export type MediaTestRoomFactory = () => MediaTestRoom;

const TEST_ROOM_OPTIONS: RoomOptions = { adaptiveStream: false, dynacast: false };

/** Production room factory. */
export const createMediaTestRoom: MediaTestRoomFactory = () => new Room(TEST_ROOM_OPTIONS);

/** What the test needs: where to connect and the tokens of the two participants. */
export interface MediaTestInput {
  /** `wss://host:port` of the page (LiveKit's client appends `/rtc`). */
  readonly url: string;
  readonly firstToken: string;
  readonly secondToken: string;
  /** Upper limit of the whole test in milliseconds (default 25 000). */
  readonly timeoutMs?: number;
}

/** Where a failed test stopped. */
export type MediaTestStage =
  /** The signalling connection (`/rtc`) was refused or did not come up: the proxy or the media server. */
  | 'signal'
  /** The WebRTC transport did not come up: the announced address or the media ports (firewall, wrong address). */
  | 'transport'
  /** Connected, but the message did not make the round trip. */
  | 'data';

/** The outcome of the test. */
export type MediaTestResult =
  | { readonly ok: true; readonly roundTripMs: number }
  | { readonly ok: false; readonly stage: MediaTestStage; readonly detail: string };

const PING = 'studioflow-media-test-ping';
const PONG = 'studioflow-media-test-pong';
const DEFAULT_TIMEOUT_MS = 25_000;

/** Raised inside the test when the time is up. */
class TestTimeout extends Error {
  constructor(readonly stage: MediaTestStage) {
    super('The media test timed out.');
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number, stage: MediaTestStage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => reject(new TestTimeout(stage)), remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Which stage a failed `connect` belongs to: a failure of the WebRTC transport or of the signalling. */
export function connectFailureStage(error: unknown): MediaTestStage {
  if (error instanceof TestTimeout) {
    return error.stage;
  }
  const reason = (error as { reason?: unknown } | null)?.reason;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (reason === ConnectionErrorReason.Timeout || message.includes('pc connection')) {
    return 'transport';
  }
  return 'signal';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Runs the round trip. Never throws: a problem is the result. Both rooms are disconnected at the end, whatever happened.
 * `createRoom` is injected for tests.
 */
export async function runMediaRoundTrip(
  input: MediaTestInput,
  createRoom: MediaTestRoomFactory = createMediaTestRoom,
  now: () => number = () => performance.now(),
): Promise<MediaTestResult> {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const rooms: MediaTestRoom[] = [];
  try {
    const first = createRoom();
    const second = createRoom();
    rooms.push(first, second);

    let answered!: () => void;
    const answer = new Promise<void>((resolve) => {
      answered = resolve;
    });
    second.on(RoomEvent.DataReceived, ((payload: Uint8Array) => {
      if (decoder.decode(payload) === PING) {
        void second.localParticipant.publishData(encoder.encode(PONG), { reliable: true });
      }
    }) as (...args: never[]) => void);
    first.on(RoomEvent.DataReceived, ((payload: Uint8Array) => {
      if (decoder.decode(payload) === PONG) {
        answered();
      }
    }) as (...args: never[]) => void);

    try {
      await withDeadline(
        Promise.all([
          first.connect(input.url, input.firstToken),
          second.connect(input.url, input.secondToken),
        ]),
        deadline,
        'transport',
      );
    } catch (error) {
      return { ok: false, stage: connectFailureStage(error), detail: describe(error) };
    }

    const started = now();
    try {
      await withDeadline(
        first.localParticipant.publishData(encoder.encode(PING), { reliable: true }),
        deadline,
        'data',
      );
      await withDeadline(answer, deadline, 'data');
    } catch (error) {
      return { ok: false, stage: 'data', detail: describe(error) };
    }
    return { ok: true, roundTripMs: Math.max(0, Math.round(now() - started)) };
  } finally {
    await Promise.allSettled(rooms.map((room) => room.disconnect()));
  }
}
