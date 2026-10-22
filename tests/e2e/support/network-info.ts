import dgram from 'node:dgram';
import os from 'node:os';

const VIRTUAL = /vethernet|wsl|docker|hyper-v|virtualbox|vmware|loopback|tailscale|zerotier|bluetooth|default switch/i;

/**
 * The host's primary LAN IPv4: the source address of the default route (no packet is sent), else the first private
 * address of a physical-looking adapter, else 127.0.0.1. Firefox needs the LAN address for ICE (research 2026-10-22).
 */
export async function detectLanIPv4(): Promise<string> {
  const override = process.env['E2E_NODE_IP'];
  if (override) return override;
  try {
    const socket = dgram.createSocket('udp4');
    const address = await new Promise<string>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(53, '192.0.2.1', () => {
        try {
          resolve(socket.address().address);
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.close();
    if (address && address !== '0.0.0.0' && !address.startsWith('169.254.')) return address;
  } catch {
    // fall through to the adapter list
  }
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) return entry.address;
    }
  }
  return '127.0.0.1';
}
