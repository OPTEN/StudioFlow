import * as signalR from '@microsoft/signalr';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import type {
  DeviceCommandDto,
  DeviceCredentialsDto,
  DeviceHelloDto,
  DeviceReportDto,
  DeviceSelfDto,
  DeviceSessionDto,
  OutputChangesDto,
  OutputReport,
  ProductionChangesDto,
  ProductionEvent,
  TallyDto,
} from '../../../packages/scene-model/src/contracts';
import { send } from './http';
import { sleep } from './shell';

export interface Received {
  /** Date.now() on arrival. */
  at: number;
  method: string;
  args: unknown[];
}

const SERVER_TO_CLIENT = ['event', 'telemetry', 'presence', 'resync', 'tally', 'command', 'self', 'sessionReplaced'] as const;

export interface HubOptions {
  /** Cookie header (studio hub). */
  cookie?: string;
  /** Bearer for device/output hubs; sent as access_token on the WebSocket URL like browsers do. */
  accessToken?: string;
  /** Extra headers (X-Forwarded-For on the direct API port, Origin). */
  headers?: Record<string, string>;
  /** SignalR client timeouts; the product clients use 6000/2000 (spec 6, 5000 after GAP-12). */
  serverTimeoutMs?: number;
  keepAliveMs?: number;
  /** Reconnect forever with the 0/300/600/… backoff of the product; default: no automatic reconnect. */
  reconnect?: boolean;
  logLevel?: signalR.LogLevel;
}

/** A SignalR connection that records every server message with its arrival time. */
export class HubSession {
  readonly received: Received[] = [];
  closedAt: number | undefined;
  closeError: Error | undefined;
  readonly startedAt = Date.now();
  reconnectedAt: number[] = [];
  reconnectingAt: number[] = [];

  constructor(
    readonly connection: signalR.HubConnection,
    readonly url: string,
  ) {
    for (const method of SERVER_TO_CLIENT) {
      connection.on(method, (...args: unknown[]) => {
        this.received.push({ at: Date.now(), method, args });
      });
    }
    connection.onclose((error) => {
      this.closedAt = Date.now();
      this.closeError = error ?? undefined;
    });
    connection.onreconnecting(() => this.reconnectingAt.push(Date.now()));
    connection.onreconnected(() => this.reconnectedAt.push(Date.now()));
  }

  static create(url: string, options: HubOptions = {}): HubSession {
    const headers: Record<string, string> = { ...options.headers };
    if (options.cookie) headers['Cookie'] = options.cookie;
    const builder = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        headers,
        ...(options.accessToken ? { accessTokenFactory: () => options.accessToken! } : {}),
        transport: signalR.HttpTransportType.WebSockets,
      })
      .configureLogging(options.logLevel ?? signalR.LogLevel.None);
    if (options.reconnect) {
      builder.withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (context) => {
          if (/Status code '(401|403)'/.test(context.retryReason?.message ?? '')) return null;
          const base = context.previousRetryCount === 0 ? 0 : Math.min(5000, 300 * 2 ** (context.previousRetryCount - 1));
          return base + (context.previousRetryCount === 0 ? 0 : Math.floor(Math.random() * 250));
        },
      });
    }
    const connection = builder.build();
    connection.serverTimeoutInMilliseconds = options.serverTimeoutMs ?? 6000;
    connection.keepAliveIntervalInMilliseconds = options.keepAliveMs ?? 2000;
    return new HubSession(connection, url);
  }

  get state(): signalR.HubConnectionState {
    return this.connection.state;
  }
  get isConnected(): boolean {
    return this.connection.state === signalR.HubConnectionState.Connected;
  }

  start(): Promise<void> {
    return this.connection.start();
  }

  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    return this.connection.invoke<T>(method, ...args);
  }

  async stop(): Promise<void> {
    try {
      await this.connection.stop();
    } catch {
      // already closed
    }
  }

  of(method: string): Received[] {
    return this.received.filter((entry) => entry.method === method);
  }

  /** All `event` messages in arrival order. */
  events(): ProductionEvent[] {
    return this.of('event').map((entry) => entry.args[0] as ProductionEvent);
  }

  eventsOfType<T extends ProductionEvent['type']>(type: T): Array<Extract<ProductionEvent, { type: T }>> {
    return this.events().filter((event): event is Extract<ProductionEvent, { type: T }> => event.type === type);
  }

  /** Resolves with the first message (also one that already arrived) that satisfies `predicate`. */
  async waitFor<T = Received>(
    description: string,
    predicate: (entry: Received) => boolean,
    { timeoutMs = 10_000, from = 0 }: { timeoutMs?: number; from?: number } = {},
  ): Promise<Received> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.slice(from).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${description}; got ${this.received.slice(from).map((entry) => entry.method + ((entry.args[0] as { type?: string })?.type ? `:${(entry.args[0] as { type: string }).type}` : '')).join(', ') || 'nothing'}`);
      await sleep(25);
    }
  }

  /** Waits for an `event` of the given type that also satisfies `predicate`. */
  waitForEvent<TType extends ProductionEvent['type']>(
    type: TType,
    predicate: (event: Extract<ProductionEvent, { type: TType }>) => boolean = () => true,
    options: { timeoutMs?: number; from?: number } = {},
  ): Promise<Extract<ProductionEvent, { type: TType }>> {
    return this.waitFor(`event ${type}`, (entry) => entry.method === 'event' && (entry.args[0] as ProductionEvent).type === type && predicate(entry.args[0] as Extract<ProductionEvent, { type: TType }>), options).then(
      (entry) => entry.args[0] as Extract<ProductionEvent, { type: TType }>,
    );
  }

  async waitClosed(timeoutMs = 10_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closedAt === undefined) {
      if (Date.now() > deadline) throw new Error(`hub connection ${this.url} was not closed within ${timeoutMs} ms`);
      await sleep(25);
    }
    return this.closedAt;
  }
}

// --- role specific helpers --------------------------------------------------------------------------------------

export class StudioHub extends HubSession {
  static connect(base: string, cookie: string, options: HubOptions = {}): StudioHub {
    const session = HubSession.create(`${base}/hubs/studio`, { ...options, cookie });
    return new StudioHub(session.connection, session.url);
  }
  /** Connects and subscribes; returns the changes answer. */
  async open(productionId: string, sinceRevision: number | null = null): Promise<ProductionChangesDto> {
    await this.start();
    return this.subscribe(productionId, sinceRevision);
  }
  subscribe(productionId: string, sinceRevision: number | null = null): Promise<ProductionChangesDto> {
    return this.invoke<ProductionChangesDto>('Subscribe', productionId, sinceRevision);
  }
  presence(): number | undefined {
    const last = this.of('presence').at(-1);
    return last ? (last.args[0] as number) : undefined;
  }
}

export class DeviceHub extends HubSession {
  static connect(base: string, credentials: DeviceCredentialsDto, options: HubOptions = {}): DeviceHub {
    const session = HubSession.create(`${base}/hubs/device`, { ...options, accessToken: `${credentials.deviceId}.${credentials.deviceSecret}` });
    return new DeviceHub(session.connection, session.url);
  }
  sessionId = `tab-${Math.random().toString(36).slice(2, 10)}`;
  /** Connects and says Hello (the first message of a sender). */
  async open(hello: Partial<DeviceHelloDto> = {}): Promise<DeviceSessionDto> {
    await this.start();
    return this.hello(hello);
  }
  hello(hello: Partial<DeviceHelloDto> = {}): Promise<DeviceSessionDto> {
    return this.invoke<DeviceSessionDto>('Hello', { sessionId: this.sessionId, platform: 'Node · E2E', appVersion: 'e2e', ...hello });
  }
  report(report: Partial<DeviceReportDto> = {}): Promise<void> {
    return this.invoke<void>('Report', { rtc: 'connected', slots: [], batteryPct: null, charging: null, network: null, rttMs: null, techCheck: null, ...report });
  }
  /** Report with the given slots live (like a healthy sender every two seconds). */
  reportLive(slots: string[] = ['camera'], extra: Partial<DeviceReportDto> = {}): Promise<void> {
    return this.report({
      rtc: 'connected',
      slots: slots.map((slot) => ({ slot, state: 'live', width: 1280, height: 720, fps: 30, bitrateKbps: 2500, packetLossPct: 0, codec: 'h264' })),
      ...extra,
    });
  }
  tallies(): TallyDto[] {
    return this.of('tally').map((entry) => entry.args[0] as TallyDto);
  }
  selfMessages(): DeviceSelfDto[] {
    return this.of('self').map((entry) => entry.args[0] as DeviceSelfDto);
  }
  commands(): DeviceCommandDto[] {
    return this.of('command').map((entry) => entry.args[0] as DeviceCommandDto);
  }
}

export class OutputHub extends HubSession {
  static connect(base: string, key: string, options: HubOptions = {}): OutputHub {
    const session = HubSession.create(`${base}/hubs/output`, { ...options, accessToken: key });
    return new OutputHub(session.connection, session.url);
  }
  async open(sinceRevision: number | null = null): Promise<OutputChangesDto> {
    await this.start();
    return this.subscribe(sinceRevision);
  }
  subscribe(sinceRevision: number | null = null): Promise<OutputChangesDto> {
    return this.invoke<OutputChangesDto>('SubscribeOutput', sinceRevision);
  }
  report(report: Partial<OutputReport> = {}): Promise<void> {
    return this.invoke<void>('Report', { rendering: true, latencyMs: 40, fps: 30, programSceneId: null, ...report });
  }
}

// --- raw protocol access ----------------------------------------------------------------------------------------

export interface NegotiateResult {
  status: number;
  body: { connectionToken?: string; connectionId?: string; availableTransports?: unknown[]; error?: string } | string;
}

/** POST {hub}/negotiate with explicit credentials/origin. */
export async function negotiate(
  base: string,
  hub: 'studio' | 'device' | 'output',
  options: { cookie?: string; bearer?: string; accessTokenQuery?: string; origin?: string; headers?: Record<string, string> } = {},
): Promise<NegotiateResult> {
  const query = new URLSearchParams({ negotiateVersion: '1' });
  if (options.accessTokenQuery) query.set('access_token', options.accessTokenQuery);
  const response = await send({
    method: 'POST',
    url: `${base}/hubs/${hub}/negotiate?${query}`,
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
      ...options.headers,
    },
    body: '',
  });
  let body: NegotiateResult['body'];
  try {
    body = response.json();
  } catch {
    body = response.text();
  }
  return { status: response.status, body };
}

export interface RawSocket {
  /** HTTP status of the upgrade: 101 when the socket opened. */
  status: number;
  socket?: WebSocket;
  /** Frames received after the handshake, split at the 0x1e record separator. */
  frames: string[];
  /** Date.now() at which each frame arrived. */
  frameTimes: number[];
  closed?: { code: number; at: number };
  close(): void;
}

/**
 * Opens a WebSocket to a hub like a browser does (negotiate first, token in the query), with a custom Origin, and
 * performs the SignalR JSON handshake when it opens. The caller decides whether to answer pings.
 */
export async function openRawHub(
  base: string,
  hub: 'studio' | 'device' | 'output',
  options: { cookie?: string; accessToken?: string; origin?: string; negotiateOrigin?: string; headers?: Record<string, string>; handshake?: boolean } = {},
): Promise<RawSocket> {
  const negotiated = await negotiate(base, hub, { cookie: options.cookie, bearer: options.accessToken, origin: options.negotiateOrigin, headers: options.headers });
  const result: RawSocket = { status: negotiated.status, frames: [], frameTimes: [], close: () => undefined };
  if (negotiated.status !== 200 || typeof negotiated.body === 'string') return result;
  const token = negotiated.body.connectionToken ?? negotiated.body.connectionId;
  const query = new URLSearchParams({ id: token ?? '' });
  if (options.accessToken) query.set('access_token', options.accessToken);
  const wsUrl = `${base.replace(/^http/, 'ws')}/hubs/${hub}?${query}`;
  return new Promise<RawSocket>((resolve) => {
    const socket = new WebSocket(wsUrl, {
      headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
      ...(options.origin ? { origin: options.origin } : {}),
      rejectUnauthorized: false,
    });
    result.socket = socket;
    result.close = () => socket.terminate();
    socket.on('open', () => {
      result.status = 101;
      if (options.handshake !== false) socket.send('{"protocol":"json","version":1}\u001e');
      resolve(result);
    });
    socket.on('message', (data: WebSocket.Data) => {
      for (const frame of data.toString().split('\u001e')) {
        if (!frame) continue;
        result.frames.push(frame);
        result.frameTimes.push(Date.now());
      }
    });
    socket.on('close', (code: number) => {
      result.closed = { code, at: Date.now() };
    });
    socket.on('unexpected-response', (_request: unknown, response: IncomingMessage) => {
      result.status = response.statusCode ?? 0;
      response.resume();
      resolve(result);
    });
    socket.on('error', () => resolve(result));
  });
}

const RS = String.fromCharCode(0x1e);

/** Sends one SignalR JSON-protocol message (type 1 = invocation) on a raw socket. */
export function sendRaw(socket: RawSocket, message: Record<string, unknown>): void {
  socket.socket?.send(JSON.stringify(message) + RS);
}

/** Invokes a hub method on a raw socket and waits for its completion frame (type 3). */
export async function invokeRaw(socket: RawSocket, target: string, args: unknown[], timeoutMs = 10_000): Promise<{ result?: unknown; error?: string; frame: string }> {
  const id = String(Math.floor(Math.random() * 1e9));
  const before = socket.frames.length;
  sendRaw(socket, { type: 1, invocationId: id, target, arguments: args });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const frame of socket.frames.slice(before)) {
      if (!frame.startsWith('{')) continue;
      const parsed = JSON.parse(frame) as { type?: number; invocationId?: string; result?: unknown; error?: string };
      if (parsed.type === 3 && parsed.invocationId === id) return { result: parsed.result, error: parsed.error, frame };
    }
    if (Date.now() > deadline) throw new Error(`no completion for ${target} within ${timeoutMs} ms; frames: ${socket.frames.slice(before).map((frame) => frame.slice(0, 80)).join(' | ')}`);
    await sleep(20);
  }
}
