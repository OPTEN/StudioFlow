/**
 * One LiveKit connection that stays up forever (spec 8.4): SDK resume/reconnect first; when the SDK gives up or the
 * room is lost otherwise, the session waits with the shared backoff, fetches a fresh token and joins with a new `Room`.
 */
import { backoffDelay } from '@flowstudio/realtime-client';
import type { LiveKitTokenDto, RtcState } from '@flowstudio/scene-model';
import {
  ConnectionState,
  RoomEvent,
  type DisconnectReason,
  type RoomOptions,
} from 'livekit-client';
import { systemClock, withTimeout, type Clock, type TimerHandle } from './clock';
import { disconnectOutcome, disconnectReasonName, isAuthorizationError } from './disconnect-reason';
import { Listeners } from './listeners';
import {
  createLiveKitRoom,
  listenTo,
  type MediaRoom,
  type RoomFactory,
  type RoomListenerGroup,
} from './livekit-port';
import { consoleLogger, errorContext, type MediaLogger } from './logger';
import { watchPageLifecycle, type PageLifecycle } from './page-lifecycle';
import { roomOptionsFor, type MediaRole } from './room-options';

/**
 * Session state.
 * - `connecting`: first connect of this run; `reconnecting`: SDK resume/full reconnect or a rejoin after a loss;
 *   `waiting`: backoff pause between attempts.
 * - Terminal (no automatic reconnect): `stopped` (stop() was called), `replaced` (same identity joined elsewhere),
 *   `removed` (kicked or room deleted), `unauthorized` (token endpoint answered 401/403). `restart()` leaves them.
 */
export type MediaSessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'waiting'
  | 'stopped'
  | 'replaced'
  | 'removed'
  | 'unauthorized';

const TERMINAL_STATES: ReadonlySet<MediaSessionState> = new Set<MediaSessionState>([
  'stopped',
  'replaced',
  'removed',
  'unauthorized',
]);

/** True for states the session never leaves by itself. */
export function isTerminalState(state: MediaSessionState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Maps the session state to the `RtcState` a sender reports to the API. */
export function toRtcState(state: MediaSessionState): RtcState {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
    case 'reconnecting':
    case 'waiting':
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

/** What a source provider needs from a session: the current room and a signal when it is replaced. */
export interface RoomSource {
  readonly role: MediaRole;
  /** The current room (connecting or connected), null between rooms. */
  readonly room: MediaRoom | null;
  /** Fires with the new room before it connects (so listeners miss nothing) and with null when it is released. */
  onRoom(listener: (room: MediaRoom | null) => void): () => void;
}

/** What a publisher additionally needs: the connection state. */
export interface SessionStateSource extends RoomSource {
  readonly state: MediaSessionState;
  onStateChange(listener: (state: MediaSessionState) => void): () => void;
}

/** Construction options of {@link MediaSession}. */
export interface MediaSessionOptions {
  readonly role: MediaRole;
  /** Fetches a LiveKit token from the API; called for every join. Reject with `{ status: 401 | 403 }` to stop. */
  readonly tokenProvider: () => Promise<LiveKitTokenDto>;
  /** Merged over the role defaults of {@link roomOptionsFor}. */
  readonly roomOptions?: RoomOptions;
  readonly roomFactory?: RoomFactory;
  readonly logger?: MediaLogger;
  readonly clock?: Clock;
  /** Jitter source of the backoff (tests). */
  readonly random?: () => number;
  /** Page lifecycle watcher factory (tests); default listens to window/document. */
  readonly pageLifecycle?: () => PageLifecycle;
  /** Upper bound for one token request (default 15 s). */
  readonly tokenTimeoutMs?: number;
  /** Upper bound for one `room.connect()` (default 45 s; the SDK's own signal + ICE timeouts are 15 s each). */
  readonly connectTimeoutMs?: number;
}

interface CurrentRoom {
  readonly room: MediaRoom;
  readonly events: RoomListenerGroup;
  /** True once `connect()` resolved; before that, failures are handled by the connect attempt itself. */
  established: boolean;
}

const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 45_000;

/**
 * Keeps one LiveKit room connected for a role. Never runs two connect attempts at once; every async continuation is
 * tied to a «run» and becomes a no-op once `stop()`/`restart()`/a terminal reason ended that run.
 */
export class MediaSession implements SessionStateSource {
  readonly role: MediaRole;

  readonly #tokenProvider: () => Promise<LiveKitTokenDto>;
  readonly #roomOptions: RoomOptions;
  readonly #roomFactory: RoomFactory;
  readonly #logger: MediaLogger;
  readonly #clock: Clock;
  readonly #random: () => number;
  readonly #createLifecycle: () => PageLifecycle;
  readonly #tokenTimeoutMs: number;
  readonly #connectTimeoutMs: number;
  readonly #stateListeners: Listeners<[MediaSessionState]>;
  readonly #roomListeners: Listeners<[MediaRoom | null]>;

  #state: MediaSessionState = 'idle';
  #run = 0;
  #attempt = 0;
  #everConnected = false;
  #current: CurrentRoom | null = null;
  #lifecycle: PageLifecycle | null = null;
  #waiting = false;
  #retryTimer: TimerHandle | null = null;

  constructor(options: MediaSessionOptions) {
    this.role = options.role;
    this.#tokenProvider = options.tokenProvider;
    this.#random = options.random ?? Math.random;
    this.#roomOptions = roomOptionsFor(options.role, options.roomOptions, this.#random);
    this.#roomFactory = options.roomFactory ?? createLiveKitRoom;
    this.#logger = options.logger ?? consoleLogger;
    this.#clock = options.clock ?? systemClock;
    this.#createLifecycle = options.pageLifecycle ?? (() => watchPageLifecycle());
    this.#tokenTimeoutMs = options.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const onListenerError = (error: unknown): void =>
      this.#logger.warn('media session listener failed', errorContext(error));
    this.#stateListeners = new Listeners(onListenerError);
    this.#roomListeners = new Listeners(onListenerError);
  }

  /** Current state. */
  get state(): MediaSessionState {
    return this.#state;
  }

  /** The current room (connecting or connected), null while waiting, stopped or idle. */
  get room(): MediaRoom | null {
    return this.#current?.room ?? null;
  }

  /** Notifies about state changes (not called for the current state on subscription). */
  onStateChange(listener: (state: MediaSessionState) => void): () => void {
    return this.#stateListeners.add(listener);
  }

  /** Notifies when a new room becomes current (before it connects) or the current one is released (null). */
  onRoom(listener: (room: MediaRoom | null) => void): () => void {
    return this.#roomListeners.add(listener);
  }

  /** Starts connecting. Only acts in state `idle`; use {@link restart} to leave a terminal state. */
  start(): void {
    if (this.#state === 'idle') {
      this.#beginRun();
    }
  }

  /** Ends the current run (if any) and starts a fresh one, e.g. «Hier weitermachen» after `replaced`. */
  restart(): void {
    this.#endRun();
    this.#beginRun();
  }

  /** Disconnects for good (state `stopped`). Safe in every phase; keeps an earlier terminal reason. */
  stop(): void {
    if (isTerminalState(this.#state)) {
      return;
    }
    this.#endRun();
    this.#setState('stopped');
  }

  #beginRun(): void {
    const run = ++this.#run;
    this.#attempt = 0;
    this.#everConnected = false;
    const lifecycle = this.#createLifecycle();
    lifecycle.onWake(() => this.#onWake(run));
    this.#lifecycle = lifecycle;
    void this.#connect(run);
  }

  #endRun(): void {
    this.#run++;
    this.#cancelRetry();
    this.#lifecycle?.dispose();
    this.#lifecycle = null;
    this.#releaseRoom();
  }

  async #connect(run: number): Promise<void> {
    this.#setState(this.#everConnected ? 'reconnecting' : 'connecting');
    if (run !== this.#run) {
      return;
    }
    const token = await this.#fetchToken(run);
    if (token === null) {
      return;
    }
    const room = this.#openRoom(run);
    if (room === null) {
      return;
    }
    try {
      const connecting = room.connect(token.url, token.token, {
        autoSubscribe: this.role !== 'sender',
      });
      await withTimeout(connecting, this.#connectTimeoutMs, this.#clock);
    } catch (error) {
      if (run === this.#run) {
        this.#logger.warn('LiveKit connect failed', {
          attempt: this.#attempt,
          ...errorContext(error),
        });
        this.#releaseRoom();
        this.#scheduleRetry(run);
      }
      return;
    }
    if (run === this.#run) {
      this.#onConnected(run, room);
    }
  }

  /** Returns a usable token, or null after handling the failure (retry scheduled or terminal state set). */
  async #fetchToken(run: number): Promise<LiveKitTokenDto | null> {
    try {
      const token = await withTimeout(
        Promise.resolve().then(this.#tokenProvider),
        this.#tokenTimeoutMs,
        this.#clock,
      );
      if (
        typeof token?.url !== 'string' ||
        token.url === '' ||
        typeof token.token !== 'string' ||
        token.token === ''
      ) {
        throw new TypeError('malformed LiveKit token response');
      }
      return run === this.#run ? token : null;
    } catch (error) {
      if (run !== this.#run) {
        return null;
      }
      if (isAuthorizationError(error)) {
        this.#logger.warn('LiveKit token refused', errorContext(error));
        this.#terminate('unauthorized');
        return null;
      }
      this.#logger.warn('LiveKit token request failed', {
        attempt: this.#attempt,
        ...errorContext(error),
      });
      this.#scheduleRetry(run);
      return null;
    }
  }

  /** Creates the room of this attempt and announces it; null if creation failed or a listener ended the run. */
  #openRoom(run: number): MediaRoom | null {
    let room: MediaRoom;
    try {
      room = this.#roomFactory(this.#roomOptions);
    } catch (error) {
      this.#logger.warn('LiveKit room creation failed', errorContext(error));
      this.#scheduleRetry(run);
      return null;
    }
    const onReconnecting = (): void => {
      if (this.#isEstablished(room)) {
        this.#setState('reconnecting');
      }
    };
    const events = listenTo(room, (error) =>
      this.#logger.warn('media session room handler failed', errorContext(error)),
    )
      .on(RoomEvent.SignalReconnecting, onReconnecting)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, () => {
        if (this.#isEstablished(room)) {
          this.#setState('connected');
        }
      })
      .on(RoomEvent.Disconnected, (reason) => this.#onDisconnected(run, room, reason));
    this.#current = { room, events, established: false };
    this.#roomListeners.emit(room);
    return run === this.#run ? room : null;
  }

  #onConnected(run: number, room: MediaRoom): void {
    const current = this.#current;
    if (current?.room !== room) {
      return;
    }
    if (room.state === ConnectionState.Disconnected) {
      // Lost between the resolved connect() and this continuation; its Disconnected event was not yet ours to handle.
      this.#releaseRoom();
      this.#scheduleRetry(run);
      return;
    }
    current.established = true;
    this.#attempt = 0;
    this.#everConnected = true;
    this.#setState(room.state === ConnectionState.Connected ? 'connected' : 'reconnecting');
  }

  #onDisconnected(run: number, room: MediaRoom, reason: DisconnectReason | undefined): void {
    if (run !== this.#run || !this.#isEstablished(room)) {
      return;
    }
    const outcome = disconnectOutcome(reason);
    this.#logger.debug('LiveKit room disconnected', {
      reason: disconnectReasonName(reason),
      outcome,
    });
    if (outcome === 'rejoin') {
      this.#releaseRoom();
      this.#scheduleRetry(run);
    } else {
      this.#terminate(outcome);
    }
  }

  #isEstablished(room: MediaRoom): boolean {
    return this.#current?.room === room && this.#current.established;
  }

  #scheduleRetry(run: number): void {
    const delay = backoffDelay(this.#attempt, this.#random);
    this.#attempt += 1;
    this.#waiting = true;
    this.#retryTimer = this.#clock.setTimeout(() => {
      this.#retryTimer = null;
      this.#retryNow(run);
    }, delay);
    this.#setState('waiting');
  }

  #onWake(run: number): void {
    if (this.#waiting) {
      this.#retryNow(run);
    }
  }

  /** Starts the next attempt unless the run ended or the page is suspended (a wake signal retries later). */
  #retryNow(run: number): void {
    if (run !== this.#run || !this.#waiting || this.#lifecycle?.suspended === true) {
      return;
    }
    this.#cancelRetry();
    void this.#connect(run);
  }

  #cancelRetry(): void {
    this.#waiting = false;
    if (this.#retryTimer !== null) {
      this.#clock.clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  /** Detaches the session from the current room and disconnects it (keeping local tracks: the publisher owns them). */
  #releaseRoom(): void {
    const current = this.#current;
    if (current === null) {
      return;
    }
    this.#current = null;
    current.events.dispose();
    if (current.room.state !== ConnectionState.Disconnected) {
      try {
        current.room
          .disconnect(false)
          .catch((error: unknown) =>
            this.#logger.warn('LiveKit disconnect failed', errorContext(error)),
          );
      } catch (error) {
        this.#logger.warn('LiveKit disconnect failed', errorContext(error));
      }
    }
    this.#roomListeners.emit(null);
  }

  #terminate(state: MediaSessionState): void {
    this.#endRun();
    this.#setState(state);
  }

  #setState(state: MediaSessionState): void {
    if (this.#state !== state) {
      this.#state = state;
      this.#stateListeners.emit(state);
    }
  }
}
