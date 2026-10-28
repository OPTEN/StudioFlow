import net from 'node:net';
import tls from 'node:tls';
import type { HttpRequestOptions, HttpResponse } from './http';

/**
 * Sends a large body like curl does: `Expect: 100-continue`, the body in chunks, and a stop as soon as the server
 * answers (413 on an oversize body). node:http loses that early response when the server resets the connection with
 * unread data (Windows drops the already received bytes), so this talks HTTP/1.1 over the socket itself.
 * Responses must have a Content-Length or a chunked body.
 */
export function sendLarge(options: HttpRequestOptions, headers: Record<string, string | string[]>, body: Buffer): Promise<HttpResponse> {
  const url = new URL(options.url);
  const isTls = url.protocol === 'https:';
  const port = Number(url.port || (isTls ? 443 : 80));
  const CRLF = '\r\n';
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let received = Buffer.alloc(0);
    let bodyStarted = false;
    let finished = false;
    // A Host header of the caller (the direct API port is called with the Host of the public address) replaces the one of the
    // URL: two Host headers are a malformed request, which Kestrel answers with an empty 400.
    const ownHost = Object.keys(headers).some((name) => name.toLowerCase() === 'host') ? [] : [`Host: ${url.host}`];
    const lines = [`${options.method ?? 'POST'} ${url.pathname}${url.search} HTTP/1.1`, ...ownHost, 'Connection: close', 'Expect: 100-continue'];
    for (const [name, value] of Object.entries(headers)) {
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
    }
    const head = `${lines.join(CRLF)}${CRLF}${CRLF}`;
    const socket: net.Socket = isTls
      ? tls.connect({ host: url.hostname, port, servername: net.isIP(url.hostname) ? undefined : url.hostname, rejectUnauthorized: false }, () => socket.write(head))
      : net.connect({ host: url.hostname, port }, () => socket.write(head));
    const timer = setTimeout(() => {
      socket.destroy();
      if (!finished) {
        finished = true;
        reject(new Error(`request timed out: ${options.method ?? 'POST'} ${options.url}`));
      }
    }, options.timeoutMs ?? 30_000);

    const build = (status: number, headText: string, payload: Buffer): HttpResponse => {
      const rawHeaders: string[] = [];
      const map: Record<string, string> = {};
      const cookies: string[] = [];
      for (const line of headText.split(CRLF).slice(1)) {
        const index = line.indexOf(':');
        if (index < 0) continue;
        const name = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        rawHeaders.push(name, value);
        if (name.toLowerCase() === 'set-cookie') cookies.push(value);
        else map[name.toLowerCase()] = map[name.toLowerCase()] === undefined ? value : `${map[name.toLowerCase()]}, ${value}`;
      }
      return {
        status,
        statusText: (headText.split(CRLF)[0] ?? '').split(' ').slice(2).join(' '),
        headers: map,
        rawHeaders,
        setCookies: cookies,
        body: payload,
        text: () => payload.toString('utf8'),
        json: <T>() => JSON.parse(payload.toString('utf8')) as T,
        header: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookies[0] : map[name.toLowerCase()]),
        headerAll: (name: string) => {
          const result: string[] = [];
          for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i]!.toLowerCase() === name.toLowerCase()) result.push(rawHeaders[i + 1]!);
          return result;
        },
        durationMs: Date.now() - started,
      };
    };

    /** The final response when it is complete (or when the connection is closed: `atClose`). */
    const parse = (atClose: boolean): HttpResponse | undefined => {
      let rest = received;
      for (;;) {
        const end = rest.indexOf(CRLF + CRLF);
        if (end < 0) return undefined;
        const headText = rest.subarray(0, end).toString('latin1');
        const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(headText)?.[1] ?? 0);
        if (status >= 100 && status < 200) {
          rest = rest.subarray(end + 4);
          continue;
        }
        const lengthMatch = /\r\ncontent-length:\s*(\d+)/i.exec(headText);
        const chunked = /\r\ntransfer-encoding:\s*chunked/i.test(headText);
        let payload = rest.subarray(end + 4);
        if (chunked) {
          const parts: Buffer[] = [];
          let cursor = payload;
          for (;;) {
            const lineEnd = cursor.indexOf(CRLF);
            if (lineEnd < 0) return atClose ? build(status, headText, Buffer.concat(parts)) : undefined;
            const size = parseInt(cursor.subarray(0, lineEnd).toString('latin1'), 16);
            if (size === 0) return build(status, headText, Buffer.concat(parts));
            if (cursor.length < lineEnd + 2 + size + 2) return atClose ? build(status, headText, Buffer.concat(parts)) : undefined;
            parts.push(cursor.subarray(lineEnd + 2, lineEnd + 2 + size));
            cursor = cursor.subarray(lineEnd + 2 + size + 2);
          }
        }
        if (lengthMatch) {
          const length = Number(lengthMatch[1]);
          if (payload.length < length && !atClose) return undefined;
          payload = payload.subarray(0, length);
          return build(status, headText, payload);
        }
        return atClose ? build(status, headText, payload) : undefined;
      }
    };

    const complete = (response: HttpResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(response);
    };

    const pump = () => {
      if (bodyStarted) return;
      bodyStarted = true;
      let offset = 0;
      const write = () => {
        while (offset < body.length && !finished) {
          const chunk = body.subarray(offset, Math.min(body.length, offset + 64 * 1024));
          offset += chunk.length;
          if (!socket.write(chunk)) {
            socket.once('drain', write);
            return;
          }
        }
      };
      write();
    };

    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const text = received.toString('latin1', 0, 16);
      if (!bodyStarted && text.startsWith('HTTP/1.1 100')) pump();
      const response = parse(false);
      if (response) complete(response);
      // A final response without 100 Continue: the server did not wait for the body (nothing to send any more).
      else if (!bodyStarted && /^HTTP\/1\.[01] [2-5]\d\d/.test(text)) bodyStarted = true;
    });
    socket.on('close', () => {
      if (finished) return;
      const response = parse(true);
      if (response) {
        complete(response);
      } else {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`connection closed without a response: ${options.method ?? 'POST'} ${options.url}`));
      }
    });
    socket.on('error', () => undefined);
  });
}
