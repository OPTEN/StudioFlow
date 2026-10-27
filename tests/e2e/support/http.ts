import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { sendLarge } from './http-large';

/**
 * A deliberately small HTTP client on node:http(s): no redirects, no cookie jar, no keep-alive, the response body and
 * the raw header list (duplicates!) exactly as received. Playwright's APIRequestContext hides too much for the
 * negative tests of this suite (duplicate headers, odd methods, HEAD, Range).
 */
export interface HttpResponse {
  status: number;
  statusText: string;
  /** Lower-case names; repeated headers are joined with ", " (set-cookie excluded: see setCookies). */
  headers: Record<string, string>;
  /** Alternating name/value list as received. */
  rawHeaders: string[];
  setCookies: string[];
  body: Buffer;
  text(): string;
  json<T = any>(): T;
  header(name: string): string | undefined;
  headerAll(name: string): string[];
  /** Milliseconds from sending the request to the end of the response. */
  durationMs: number;
}

export interface HttpRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Buffer | string;
  /** Serialised as JSON with Content-Type application/json unless a Content-Type header is given. */
  json?: unknown;
  timeoutMs?: number;
  /** Do not read the body after the headers (HEAD-like checks, streaming limits). */
  headersOnly?: boolean;
}

export function send(options: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(options.url);
  const isTls = url.protocol === 'https:';
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) headers[name] = value;
  }
  let body: Buffer | undefined;
  if (options.json !== undefined) {
    body = Buffer.from(JSON.stringify(options.json));
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  } else if (options.body !== undefined) {
    body = typeof options.body === 'string' ? Buffer.from(options.body) : options.body;
  }
  if (body && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-length')) headers['Content-Length'] = String(body.length);
  // Large bodies need a client that stops sending when the server answers early (see sendLarge).
  if (body !== undefined && body.length > 1024 * 1024) return sendLarge(options, headers, body);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    let headersReceived = false;
    const requester = isTls ? https.request : http.request;
    const request = requester(
      {
        method: options.method ?? 'GET',
        hostname: url.hostname,
        port: url.port || (isTls ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers,
        agent: false,
        rejectUnauthorized: false,
        // The server names are all "localhost"/127.0.0.1; SNI matters for the certificate Caddy picks.
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        timeout: options.timeoutMs ?? 30_000,
      },
      (response) => {
        headersReceived = true;
        const chunks: Buffer[] = [];
        const finish = () => {
          const raw = response.rawHeaders;
          const map: Record<string, string> = {};
          const cookies: string[] = [];
          for (let index = 0; index < raw.length; index += 2) {
            const name = raw[index]!.toLowerCase();
            const value = raw[index + 1]!;
            if (name === 'set-cookie') cookies.push(value);
            else map[name] = map[name] === undefined ? value : `${map[name]}, ${value}`;
          }
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: map,
            rawHeaders: raw,
            setCookies: cookies,
            body: bodyBuffer,
            text: () => bodyBuffer.toString('utf8'),
            json: <T>() => JSON.parse(bodyBuffer.toString('utf8')) as T,
            header: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookies[0] : map[name.toLowerCase()]),
            headerAll: (name: string) => {
              const result: string[] = [];
              for (let index = 0; index < raw.length; index += 2) if (raw[index]!.toLowerCase() === name.toLowerCase()) result.push(raw[index + 1]!);
              return result;
            },
            durationMs: Date.now() - started,
          });
        };
        if (options.headersOnly) {
          response.destroy();
          finish();
          return;
        }
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', finish);
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error(`request timed out: ${options.method ?? 'GET'} ${options.url}`)));
    // A bare "socket hang up" says nothing about which request of a burst it was: name it, and say how far it got.
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (!error.message.startsWith('request timed out')) {
        error.message = `${error.message} [${error.code ?? 'no code'}] on ${options.method ?? 'GET'} ${options.url} after ${Date.now() - started} ms, ${headersReceived ? 'after' : 'before'} the response headers`;
      }
      reject(error);
    });
    if (body) request.write(body);
    request.end();
  });
}

export interface RawResult {
  /** Everything received until the socket closed or `readMs` passed. */
  data: Buffer;
  statusLine: string;
  status: number;
  headersText: string;
  closed: boolean;
}

/**
 * Sends raw bytes over TCP or TLS and returns what comes back (status line and headers are parsed). For requests the
 * HTTP client refuses to build: lying Content-Length, chunked bodies, headers only with a huge announced body.
 */
export function rawRequest(options: {
  host: string;
  port: number;
  tls?: boolean;
  servername?: string;
  bytes: string | Buffer;
  /** Written after `bytes` (for announced-but-unsent bodies leave empty). */
  readMs?: number;
  /** Wait this long, then write `after` (e.g. the body after the 413 would have arrived). */
  after?: { delayMs: number; bytes: string | Buffer };
  minTlsVersion?: tls.SecureVersion;
}): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let closed = false;
    const done = () => {
      const data = Buffer.concat(chunks);
      const text = data.toString('latin1');
      const headEnd = text.indexOf('\r\n\r\n');
      const head = headEnd >= 0 ? text.slice(0, headEnd) : text;
      const statusLine = head.split('\r\n')[0] ?? '';
      const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(statusLine)?.[1] ?? 0);
      resolve({ data, statusLine, status, headersText: head, closed });
    };
    const onConnect = (socket: net.Socket) => {
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('close', () => {
        closed = true;
        clearTimeout(timer);
        done();
      });
      socket.on('error', () => undefined);
      socket.write(options.bytes);
      if (options.after) setTimeout(() => socket.write(options.after!.bytes), options.after.delayMs);
      const timer: NodeJS.Timeout = setTimeout(() => {
        socket.destroy();
      }, options.readMs ?? 3000);
    };
    if (options.tls) {
      const socket = tls.connect({ host: options.host, port: options.port, servername: options.servername ?? options.host, rejectUnauthorized: false, minVersion: options.minTlsVersion }, () => onConnect(socket));
      socket.on('error', reject);
    } else {
      const socket = net.connect({ host: options.host, port: options.port }, () => onConnect(socket));
      socket.on('error', reject);
    }
  });
}

/** Builds a multipart/form-data body. File names are written like browsers do (", CR and LF percent-encoded). */
export function multipart(parts: Array<{ name: string; value?: string; fileName?: string; contentType?: string; data?: Buffer }>): { body: Buffer; contentType: string } {
  const boundary = `----sf-e2e-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.fileName !== undefined) head += `; filename="${part.fileName.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}"`;
    head += '\r\n';
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head, 'utf8'), part.data ?? Buffer.from(part.value ?? '', 'utf8'), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

