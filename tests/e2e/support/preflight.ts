import dgram from 'node:dgram';
import net from 'node:net';
import { SETTINGS, type StackSettings } from './env';
import { exec } from './shell';
import { docker } from './stack';

/**
 * Checks that run before a stack starts, so two stacks on one machine fail with a message that names the clash
 * instead of a Docker error halfway through `compose up`: host ports (the ones Docker publishes for this stack) and the
 * compose subnet. `assertFfmpeg` checks the one tool the harness needs on the host.
 */

interface PortCheck {
  what: string;
  port: number;
  protocol: 'tcp' | 'udp';
  /** The address Docker publishes on (loopback for the test-only ports). */
  host: string;
}

export function portChecks(settings: StackSettings = SETTINGS): PortCheck[] {
  return [
    {
      what: 'Caddy https (E2E_HTTPS_PORT)',
      port: settings.httpsPort,
      protocol: 'tcp',
      host: '0.0.0.0',
    },
    {
      what: 'Caddy https/UDP (E2E_HTTPS_PORT)',
      port: settings.httpsPort,
      protocol: 'udp',
      host: '0.0.0.0',
    },
    {
      what: 'LiveKit media TCP (E2E_RTC_TCP_PORT)',
      port: settings.rtcTcpPort,
      protocol: 'tcp',
      host: '0.0.0.0',
    },
    {
      what: 'LiveKit media UDP (E2E_RTC_UDP_PORT)',
      port: settings.rtcUdpPort,
      protocol: 'udp',
      host: '0.0.0.0',
    },
    {
      what: 'direct API (E2E_API_PORT)',
      port: settings.apiPort,
      protocol: 'tcp',
      host: '127.0.0.1',
    },
    {
      what: 'LiveKit signalling (E2E_LIVEKIT_PORT)',
      port: settings.livekitPort,
      protocol: 'tcp',
      host: '127.0.0.1',
    },
    {
      what: 'PostgreSQL (E2E_POSTGRES_PORT)',
      port: settings.postgresPort,
      protocol: 'tcp',
      host: '127.0.0.1',
    },
  ];
}

function tcpFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function udpFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    socket.once('error', () => {
      socket.close();
      resolve(false);
    });
    socket.bind({ port, address: host, exclusive: true }, () => socket.close(() => resolve(true)));
  });
}

/** The checks whose port is taken right now. */
export async function portsInUse(settings: StackSettings = SETTINGS): Promise<PortCheck[]> {
  const taken: PortCheck[] = [];
  for (const check of portChecks(settings)) {
    const free =
      check.protocol === 'tcp'
        ? await tcpFree(check.port, check.host)
        : await udpFree(check.port, check.host);
    if (!free) taken.push(check);
  }
  return taken;
}

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
}

/** [first, last] address of an IPv4 CIDR as numbers, or undefined for anything else (IPv6). */
export function cidrRange(cidr: string): [number, number] | undefined {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!match) return undefined;
  const bits = Number(match[2]);
  const size = 2 ** (32 - bits);
  const first = Math.floor(ipv4ToInt(match[1]!) / size) * size;
  return [first, first + size - 1];
}

/** Docker networks whose subnet overlaps `subnet` (a network of this stack's own project is not a clash). */
export async function overlappingNetworks(
  subnet: string,
  project: string,
): Promise<Array<{ name: string; subnet: string }>> {
  const wanted = cidrRange(subnet);
  if (!wanted) return [];
  const ids = (await docker(['network', 'ls', '-q'])).stdout.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return [];
  const inspected = await docker(['network', 'inspect', ...ids]);
  if (inspected.code !== 0) return [];
  const networks = JSON.parse(inspected.stdout) as Array<{
    Name: string;
    Labels?: Record<string, string>;
    IPAM?: { Config?: Array<{ Subnet?: string }> };
  }>;
  const clashes: Array<{ name: string; subnet: string }> = [];
  for (const network of networks) {
    if (network.Labels?.['com.docker.compose.project'] === project) continue;
    for (const entry of network.IPAM?.Config ?? []) {
      const range = entry.Subnet ? cidrRange(entry.Subnet) : undefined;
      if (range && range[0] <= wanted[1] && wanted[0] <= range[1])
        clashes.push({ name: network.Name, subnet: entry.Subnet! });
    }
  }
  return clashes;
}

/** Throws a message that names every clash (ports and subnet) of the stack that is about to start. */
export async function assertStackFree(settings: StackSettings = SETTINGS): Promise<void> {
  // Ports of a stack that was just taken down are released a moment later (Docker Desktop's port proxy).
  let taken = await portsInUse(settings);
  for (let attempt = 0; attempt < 10 && taken.length > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    taken = await portsInUse(settings);
  }
  const problems: string[] = [];
  for (const check of taken)
    problems.push(
      `port ${check.port}/${check.protocol} (${check.what}) is already in use on ${check.host}`,
    );
  for (const clash of await overlappingNetworks(settings.subnet, settings.project))
    problems.push(
      `subnet ${settings.subnet} (E2E_SUBNET) overlaps the Docker network ${clash.name} (${clash.subnet})`,
    );
  if (problems.length > 0) {
    const list = problems.map((problem) => ` - ${problem}`).join('\n');
    throw new Error(
      `Stack ${settings.project} cannot start:\n${list}\nStop what holds them, or use another stack (E2E_STACK=1..4) or move the values with E2E_*_PORT / E2E_SUBNET (tests/e2e/README.md, "Parallel stacks").`,
    );
  }
}

/** The encoders that make the sample media (`MEDIA_SAMPLES` in media-samples.ts): H.264, VP8 and WebP are options of an ffmpeg build. */
export const FFMPEG_ENCODERS = ['libx264', 'libvpx', 'libwebp_anim'] as const;

/**
 * Throws unless `ffmpeg` runs and has the encoders of {@link FFMPEG_ENCODERS}. The harness generates its sample media with
 * it; without it the tests would run on stubs that prove nothing (a 1x1 picture, a clip without frames).
 */
export async function assertFfmpeg(): Promise<void> {
  const install = 'Install ffmpeg (Linux: sudo apt-get install ffmpeg, macOS: brew install ffmpeg, Windows: winget install Gyan.FFmpeg) and run again (docs/testing.md 6.6).';
  let encoders: string;
  try {
    const version = await exec('ffmpeg', ['-hide_banner', '-version'], { timeoutMs: 30_000 });
    if (version.code !== 0) throw new Error(`ffmpeg -version exited with ${version.code}: ${version.output.trim().slice(-300)}`);
    encoders = (await exec('ffmpeg', ['-hide_banner', '-encoders'], { timeoutMs: 30_000 })).stdout;
  } catch (error) {
    throw new Error(`The E2E harness needs ffmpeg for its sample media, but it cannot run it: ${(error as Error).message}\n${install}`);
  }
  const missing = FFMPEG_ENCODERS.filter((name) => !new RegExp(`^\\s*[VAS][.\\w]{5}\\s+${name}\\s`, 'm').test(encoders));
  if (missing.length > 0) throw new Error(`The ffmpeg on this machine lacks the encoders ${missing.join(', ')}, which the E2E harness needs for its sample media.\n${install}`);
}
