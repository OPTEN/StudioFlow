import type { SceneDto } from '../api';
import { DeviceHub } from '../hubs';
import { pairLaptopByLink, pairPhone, uniqueIp, type PairedDevice, type PairContext } from '../production';
import { SenderSim } from '../sim';

/**
 * Seeds a production with what a busy console looks like (docs/testing.md DEV-01: 7 scenes, 5 stations, one incident):
 * the default scenes plus four more, three phones and two laptops connected to the device hub (a stand-in that reports
 * its slots live every second), elements in the first two scenes, and optionally one incident.
 */

export const SEED_SCENES = ['Begrüssung', 'Präsentation', 'Pause', 'Interview', 'Podium', 'Rückblick', 'Abspann'] as const;

export interface SeedOptions {
  /** Scene names (default {@link SEED_SCENES}, seven). */
  scenes?: readonly string[];
  /** Number of stations, 0-5 (phones K1-K3 first, then laptops S1, S2). */
  stations?: number;
  /** The incident: the third phone's camera «verbindet neu» (paused) or the second laptop's screen «Teilen beendet» (ended). */
  incident?: 'reconnecting' | 'ended' | null;
  /** Put elements (the sources of the first stations) into the first two scenes (default true). */
  items?: boolean;
}

export interface Station {
  device: PairedDevice;
  name: string;
  /** The slot the station reports, e.g. `camera` or `screen-1`. */
  slot: string;
  /** Slot code, e.g. `K1`. */
  code: string;
}

export interface SeededConsole {
  scenes: SceneDto[];
  stations: Station[];
  /** The station that carries the incident, if any. */
  incident: Station | null;
}

const NAMES = ['Handy Bühne', 'Handy Saal', 'Handy Eingang', 'Laptop Mia', 'Laptop Ben'];

function headersFor(stack: PairContext['stack']): Record<string, string> {
  return stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {};
}

const slotReport = (slot: string, state: 'live' | 'paused' | 'ended') => ({
  slot,
  state,
  width: 1280,
  height: 720,
  fps: 30,
  bitrateKbps: 2500,
  packetLossPct: 0,
  codec: 'h264',
});

async function until(check: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${what} did not happen within ${timeoutMs} ms`);
}

export async function seedBusyConsole(
  context: PairContext,
  onCleanup: (fn: () => Promise<unknown> | unknown) => void,
  options: SeedOptions = {},
): Promise<SeededConsole> {
  const { production, stack } = context;
  const names = options.scenes ?? SEED_SCENES;
  const scenes = await production.seed([...names]);
  const count = Math.min(5, options.stations ?? 5);
  const stations: Station[] = [];
  let incident: Station | null = null;
  const api = production.api;
  const sceneList = (await api.getSnapshot(production.id)).body.scenes;

  for (let index = 0; index < count; index++) {
    const phone = index < 3;
    const name = NAMES[index]!;
    const device = phone
      ? await pairPhone(context, { name, platform: index === 1 ? 'iPhone 15 · Safari' : 'Pixel 7 · Chrome' })
      : await pairLaptopByLink(context, { name });
    // A laptop is paired with its first screen slot (`screen-1`, code S1); a phone with its camera.
    const slot = phone ? 'camera' : 'screen-1';
    const code = device.codes[slot] ?? '';
    const station: Station = { device, name, slot, code };
    const carriesIncident =
      (options.incident === 'reconnecting' && index === 2) || (options.incident === 'ended' && index === 4);
    if (!carriesIncident) {
      const sim = await SenderSim.start(stack.anonymousBase, device.credentials, { slots: [slot], headers: headersFor(stack) });
      onCleanup(() => sim.stop());
    } else {
      const hub = DeviceHub.connect(stack.anonymousBase, device.credentials, { headers: headersFor(stack), reconnect: true });
      onCleanup(() => hub.stop());
      await hub.open();
      await hub.reportLive([slot]);
      await until(
        async () => (await api.getSnapshot(production.id)).body.sources.find((source) => source.id === device.sourceId(slot))?.status === 'ok',
        `source ${code} becoming ok`,
      );
      const state = options.incident === 'ended' ? 'ended' : 'paused';
      const send = () => hub.report({ rtc: 'connected', slots: [slotReport(slot, state)] }).catch(() => undefined);
      await send();
      const timer = setInterval(() => void send(), 1000);
      onCleanup(() => clearInterval(timer));
      incident = station;
    }
    stations.push(station);
    if (options.items !== false && index < 3) {
      const target = sceneList[index === 0 ? 0 : 1]!;
      const placed = await api.addSceneItem(production.id, target.id, {
        source: device.sourceId(slot),
        x: index === 2 ? 1280 : 0,
        y: index === 2 ? 720 : 0,
        w: index === 2 ? 600 : 1920,
        h: index === 2 ? 338 : 1080,
        fit: 'cover',
      });
      if (placed.status !== 200) throw new Error(`addSceneItem failed: ${placed.status} ${placed.raw.text()}`);
    }
  }
  return { scenes, stations, incident };
}
