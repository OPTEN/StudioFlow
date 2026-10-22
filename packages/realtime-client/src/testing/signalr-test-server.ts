/**
 * Minimal in-process SignalR server (negotiate + WebSockets + JSON hub protocol) for integration specs with the real
 * `@microsoft/signalr` client. Test-only and deliberately small: no fragmentation, no other transports.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

const RECORD_SEPARATOR = '\u001e';
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;
const MESSAGE_INVOCATION = 1;
const MESSAGE_COMPLETION = 3;
const MESSAGE_PING = 6;
const MESSAGE_CLOSE = 7;
const PING_INTERVAL_MS = 1000;

interface Frame {
  readonly opcode: number;
  readonly payload: Buffer;
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Parses complete (masked, client → server) frames; returns them and the unparsed rest. */
function decodeFrames(input: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let buffer = input;
  for (;;) {
    if (buffer.length < 2) {
      break;
    }
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) {
        break;
      }
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) {
        break;
      }
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) {
      break;
    }
    const mask = buffer.subarray(offset, offset + maskLength);
    const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    frames.push({ opcode, payload });
    buffer = buffer.subarray(offset + maskLength + length);
  }
  return { frames, rest: buffer };
}

/** One connected hub client as seen by the server. */
export class TestHubClient {
  private handshakeDone = false;
  private text = '';
  private readonly pingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly socket: Duplex,
    private readonly server: TestSignalRServer,
  ) {
    this.pingTimer = setInterval(() => {
      if (this.server.sendPings && this.handshakeDone) {
        this.write({ type: MESSAGE_PING });
      }
    }, PING_INTERVAL_MS);
    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const frame of frames) {
        this.handleFrame(frame);
      }
    });
    socket.on('close', () => this.dispose());
    socket.on('error', () => this.dispose());
  }

  /** Server → client invocation. */
  send(target: string, ...args: unknown[]): void {
    this.write({ type: MESSAGE_INVOCATION, target, arguments: args });
  }

  /** Kills the TCP connection without a close handshake (network loss). */
  drop(): void {
    this.socket.destroy();
  }

  private write(message: object): void {
    if (!this.socket.destroyed) {
      this.socket.write(
        encodeFrame(OPCODE_TEXT, Buffer.from(JSON.stringify(message) + RECORD_SEPARATOR)),
      );
    }
  }

  private handleFrame(frame: Frame): void {
    if (frame.opcode === OPCODE_CLOSE) {
      this.socket.end(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)));
      return;
    }
    if (frame.opcode === OPCODE_PING) {
      this.socket.write(encodeFrame(OPCODE_PONG, frame.payload));
      return;
    }
    if (frame.opcode !== OPCODE_TEXT) {
      return;
    }
    this.text += frame.payload.toString('utf8');
    let separator = this.text.indexOf(RECORD_SEPARATOR);
    while (separator >= 0) {
      const message = this.text.slice(0, separator);
      this.text = this.text.slice(separator + 1);
      this.handleMessage(message);
      separator = this.text.indexOf(RECORD_SEPARATOR);
    }
  }

  private handleMessage(raw: string): void {
    if (!this.handshakeDone) {
      this.handshakeDone = true;
      this.socket.write(encodeFrame(OPCODE_TEXT, Buffer.from(`{}${RECORD_SEPARATOR}`)));
      return;
    }
    const message = JSON.parse(raw) as {
      type: number;
      invocationId?: string;
      target?: string;
      arguments?: unknown[];
    };
    if (message.type === MESSAGE_CLOSE) {
      this.socket.end();
      return;
    }
    if (message.type !== MESSAGE_INVOCATION || !message.target) {
      return;
    }
    const { invocationId, target } = message;
    void Promise.resolve()
      .then(() => this.server.onInvoke(target, message.arguments ?? [], this))
      .then(
        (result) => {
          if (invocationId !== undefined) {
            this.write({ type: MESSAGE_COMPLETION, invocationId, result: result ?? null });
          }
        },
        (error: unknown) => {
          if (invocationId !== undefined) {
            this.write({ type: MESSAGE_COMPLETION, invocationId, error: String(error) });
          }
        },
      );
  }

  private dispose(): void {
    clearInterval(this.pingTimer);
    this.server.clients.delete(this);
  }
}

/** The test server; tests flip its switches to simulate outages, refusals and silent servers. */
export class TestSignalRServer {
  readonly clients = new Set<TestHubClient>();
  /** HTTP status of negotiate (200 accepts). */
  negotiateStatus = 200;
  /** False simulates a server that is down: every TCP connection is reset. */
  accepting = true;
  /** False simulates a hung server that stops sending keep-alives. */
  sendPings = true;
  /** HTTP requests received, including refused ones (connection attempts). */
  requests = 0;
  negotiations = 0;
  lastAuthorization: string | undefined;
  onInvoke: (target: string, args: unknown[], client: TestHubClient) => unknown = () => null;
  private readonly server: Server;
  private readonly sockets = new Set<Duplex>();

  constructor() {
    this.server = createServer((request, response) => this.handleRequest(request, response));
    this.server.on('upgrade', (request: IncomingMessage, socket: Duplex) =>
      this.handleUpgrade(request, socket),
    );
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  /** Base URL, e.g. `http://127.0.0.1:12345`. */
  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Sends an invocation to every connected client. */
  broadcast(target: string, ...args: unknown[]): void {
    for (const client of this.clients) {
      client.send(target, ...args);
    }
  }

  /** Drops every client connection (network loss for all). */
  dropAll(): void {
    for (const client of [...this.clients]) {
      client.drop();
    }
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    this.requests += 1;
    if (!this.accepting) {
      request.socket.destroy();
      return;
    }
    if (request.method === 'POST' && request.url?.includes('/negotiate')) {
      this.negotiations += 1;
      this.lastAuthorization = request.headers.authorization;
      response.statusCode = this.negotiateStatus;
      if (this.negotiateStatus !== 200) {
        response.end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          negotiateVersion: 1,
          connectionId: `c${this.negotiations}`,
          connectionToken: `t${this.negotiations}`,
          availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const key = request.headers['sec-websocket-key'];
    if (!this.accepting || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(key + WEBSOCKET_GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    this.clients.add(new TestHubClient(socket, this));
  }
}
