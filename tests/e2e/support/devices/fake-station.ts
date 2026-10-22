import type { DeviceCredentialsDto, SlotState } from '../../../../packages/scene-model/src/contracts';
import { DeviceHub } from '../hubs';
import { sleep } from '../shell';
import { stackConfig } from '../env';

/**
 * A device hub stand-in with a state per slot, for tests that need many stations in different states without a browser per
 * station (ordering, accessible names): Hello, then a report every second with the slots in the state the test set. A
 * stand-in publishes no media, so the Regie shows no picture for it; the status rules of the API do not care (a slot that the
 * current session reports `live` with rtc connected is ok, spec 4.5).
 */
export class FakeStation {
  private hub: DeviceHub | undefined;
  private timer: NodeJS.Timeout | undefined;
  private slots = new Map<string, SlotState>();
  private readonly base = stackConfig().baseURL;

  constructor(readonly credentials: DeviceCredentialsDto) {}

  /** Connects, says Hello and starts reporting. `slots` is the state of every slot of the device. */
  async connect(slots: Record<string, SlotState> = {}): Promise<this> {
    this.slots = new Map(Object.entries(slots));
    this.hub = DeviceHub.connect(this.base, this.credentials);
    await this.hub.open();
    await this.report();
    this.timer = setInterval(() => void this.report().catch(() => undefined), 1000);
    return this;
  }

  /** The state of one slot from the next report on (and now). */
  async set(slot: string, state: SlotState): Promise<void> {
    this.slots.set(slot, state);
    await this.report();
  }

  private async report(): Promise<void> {
    if (!this.hub?.isConnected) return;
    await this.hub.report({
      rtc: 'connected',
      slots: [...this.slots].map(([slot, state]) => ({
        slot,
        state,
        width: state === 'live' ? 1280 : null,
        height: state === 'live' ? 720 : null,
        fps: state === 'live' ? 30 : null,
        bitrateKbps: state === 'live' ? 2500 : null,
        packetLossPct: state === 'live' ? 0 : null,
        codec: state === 'live' ? 'h264' : null,
      })),
    });
  }

  /** The connection ends (the phone's network is gone): what the API sees is a hub disconnect. */
  async disconnect(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    const hub = this.hub;
    this.hub = undefined;
    await hub?.stop();
  }

  /** Connects again with a new session (a phone that came back) and reports the given slots. */
  async reconnect(slots?: Record<string, SlotState>): Promise<void> {
    await this.disconnect();
    await sleep(50);
    await this.connect(slots ? slots : Object.fromEntries(this.slots));
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }
}
