import net from 'node:net';

/**
 * A TCP forwarder that can be switched to "blackhole": every byte in both directions is swallowed while the sockets
 * stay open. To both ends this looks like a network that silently stops delivering packets (no FIN, no RST) - the
 * closest software equivalent of a Wi-Fi drop that affects a single client, used for the silent-loss detection tests
 * (T-DETECT-SILENT) of one device hub connection without touching any other client of the API.
 */
export class TcpProxy {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  blackholed = false;
  port = 0;
  /** Bytes dropped while blackholed (diagnostics). */
  dropped = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async start(): Promise<this> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.targetPort, this.targetHost);
      this.sockets.add(client).add(upstream);
      const forward = (from: net.Socket, to: net.Socket) => {
        from.on('data', (chunk) => {
          if (this.blackholed) {
            this.dropped += chunk.length;
            return;
          }
          to.write(chunk);
        });
      };
      forward(client, upstream);
      forward(upstream, client);
      const closeBoth = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('close', closeBoth);
      upstream.on('close', closeBoth);
      client.on('error', () => undefined);
      upstream.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** From now on swallow everything in both directions. */
  blackhole(): void {
    this.blackholed = true;
  }

  /** Forward again (connections that survived continue). */
  resume(): void {
    this.blackholed = false;
  }

  /** Close all connections with a FIN/RST (a clean network failure). */
  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async stop(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
