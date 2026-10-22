import http from 'node:http';
import net from 'node:net';

/**
 * An HTTP proxy (CONNECT only) in front of the stack for ONE browser context, so one phone's HTTPS traffic - pages, REST, the
 * device hub and LiveKit's signalling WebSocket - can be cut without touching any other client:
 *  - `blackhole()`: every byte in both directions is swallowed, the sockets stay open (no FIN, no RST): packets that silently
 *    stop arriving, the T-DETECT-SILENT case;
 *  - `drop()`: all tunnels are destroyed (a clean close) and, with `refuse`, new ones are refused until `resume()`;
 *  - `resume()`: forwards again (tunnels opened after this call work; swallowed tunnels stay dead).
 * WebRTC media uses UDP and does not go through an HTTP proxy, so it is not cut: the proxy models a failing control path.
 */
export class CutProxy {
  private server: http.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  blackholed = false;
  refusing = false;
  port = 0;
  /** CONNECT requests seen (diagnostics). */
  tunnels = 0;
  /** Bytes swallowed while blackholed. */
  dropped = 0;

  async start(): Promise<this> {
    this.server = http.createServer((_request, response) => {
      response.writeHead(405).end();
    });
    this.server.on('connect', (request, client: net.Socket, head) => {
      this.tunnels += 1;
      if (this.refusing) {
        client.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }
      const [host, portText] = (request.url ?? '').split(':');
      const upstream = net.connect(Number(portText), host === 'localhost' ? '127.0.0.1' : host);
      this.sockets.add(client).add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', close);
      upstream.on('error', close);
      client.on('close', close);
      upstream.on('close', close);
      upstream.on('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const forward = (from: net.Socket, to: net.Socket) =>
          from.on('data', (chunk) => {
            if (this.blackholed) this.dropped += chunk.length;
            else to.write(chunk);
          });
        forward(client, upstream);
        forward(upstream, client);
        if (head.length > 0 && !this.blackholed) upstream.write(head);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  blackhole(): void {
    this.blackholed = true;
  }

  resume(): void {
    this.blackholed = false;
    this.refusing = false;
  }

  drop(options: { refuse?: boolean } = {}): void {
    this.refusing = options.refuse ?? false;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async stop(): Promise<void> {
    this.drop();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
