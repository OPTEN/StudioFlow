import type { DeviceCredentialsDto, ProductionEvent } from '../../../packages/scene-model/src/contracts';
import { applyEvent, applyOutputChanges, type ProductionState } from '../../../packages/scene-model/src/production-state';
import { DeviceHub, OutputHub } from './hubs';
import { sleep } from './shell';

/**
 * A Node stand-in for the sender app: a device hub that reconnects forever (0/300/600/... ms), says Hello again after
 * every reconnect and reports its slots live every second - what the real sender does on the control connection.
 */
export class SenderSim {
  private timer: NodeJS.Timeout | undefined;
  stopped = false;
  hellos = 0;
  reconnects = 0;
  lastError: unknown;

  private constructor(
    readonly hub: DeviceHub,
    readonly slots: string[],
  ) {}

  static async start(base: string, credentials: DeviceCredentialsDto, options: { slots?: string[]; headers?: Record<string, string>; reportMs?: number } = {}): Promise<SenderSim> {
    const hub = DeviceHub.connect(base, credentials, { headers: options.headers, reconnect: true });
    const sim = new SenderSim(hub, options.slots ?? ['camera']);
    hub.onReconnected(() => {
      sim.reconnects += 1;
      void sim.sayHello();
    });
    await hub.start();
    await sim.sayHello();
    sim.timer = setInterval(() => {
      if (sim.stopped || !hub.isConnected) return;
      void hub.reportLive(sim.slots).catch((error) => (sim.lastError = error));
    }, options.reportMs ?? 1000);
    return sim;
  }

  private async sayHello(): Promise<void> {
    try {
      await this.hub.hello();
      this.hellos += 1;
      await this.hub.reportLive(this.slots);
    } catch (error) {
      this.lastError = error;
    }
  }

  /** Stops reporting and the reconnect loop (the phone is switched off). */
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.hub.stop();
  }

  /** Stops the periodic report only (the connection stays). */
  pauseReports(): void {
    this.stopped = true;
  }
}

/** The output page's synchronisation: SubscribeOutput(local revision) after every reconnect, product reducer. */
export class OutputSim {
  state: ProductionState | null = null;
  lastSync: 'delta' | 'snapshot' | null = null;
  reconnects = 0;
  private pending = false;
  private buffer: ProductionEvent[] = [];
  private reporter: NodeJS.Timeout | undefined;

  private constructor(readonly hub: OutputHub) {
    hub.connection.on('event', (event: ProductionEvent) => this.onEvent(event));
    hub.onReconnected(() => {
      this.reconnects += 1;
      void this.resubscribe();
    });
  }

  static async start(base: string, key: string): Promise<OutputSim> {
    const hub = OutputHub.connect(base, key, { reconnect: true });
    const sim = new OutputSim(hub);
    await hub.start();
    await sim.resubscribe();
    sim.reporter = setInterval(() => {
      if (hub.isConnected) void hub.report({ rendering: true }).catch(() => undefined);
    }, 2000);
    return sim;
  }

  async resubscribe(): Promise<void> {
    this.pending = true;
    try {
      const changes = await this.hub.subscribe(this.state?.revision ?? null);
      const outcome = applyOutputChanges(this.state, changes);
      this.state = outcome.state;
      this.lastSync = outcome.result === 'snapshot' ? 'snapshot' : 'delta';
      const buffered = this.buffer;
      this.buffer = [];
      this.pending = false;
      for (const event of buffered) this.onEvent(event);
      if (outcome.result === 'gap') await this.resubscribe();
    } finally {
      this.pending = false;
    }
  }

  private onEvent(event: ProductionEvent): void {
    if (this.pending || !this.state) {
      this.buffer.push(event);
      return;
    }
    const outcome = applyEvent(this.state, event);
    if (outcome.result === 'applied') this.state = outcome.state;
    else if (outcome.result === 'gap') {
      this.buffer.push(event);
      void this.resubscribe();
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.reporter);
    await this.hub.stop();
  }
}

/** Resolves true as soon as `check` is true or false after the timeout (never throws). */
export async function eventually(check: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (await check()) return Date.now() - started;
    await sleep(intervalMs);
  }
  return null;
}

/** Calls `probe` until it returns something defined; resolves to that value or undefined after the timeout. */
export async function eventuallyValue<T>(probe: () => Promise<T | undefined> | T | undefined, timeoutMs: number, intervalMs = 500): Promise<T | undefined> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch {
      // the stack is still recovering
    }
    await sleep(intervalMs);
  }
  return undefined;
}
