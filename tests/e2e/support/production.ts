import { AdminApi, DeviceApi, OutputApi, PublicApi, inviteToken, parseOutputUrl, type DeviceCredentialsDto, type ProductionDto, type SceneDto } from './api';
import type { SourceDto } from '../../../packages/scene-model/src/contracts';
import { stackConfig } from './env';
import { OutputHub } from './hubs';
import { sleep } from './shell';

/** Fake client addresses for the direct API port (X-Forwarded-For), so rate limits are per test, not per machine. */
let ipCounter = (Date.now() % 60_000) + Math.floor(Math.random() * 1000);
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${200 + (Math.floor(ipCounter / 65_536) % 50)}.${Math.floor(ipCounter / 256) % 256}.${(ipCounter % 254) + 1}`;
}

/** What the test harness knows about the stack it runs against (worker scope). */
export interface Stack {
  baseURL: string;
  direct: string;
  /** The direct API port honours X-Forwarded-For (it is inside the trusted proxy network). */
  forwardedForWorks: boolean;
  /** Base URL for anonymous, rate-limited calls: the direct port with a unique client IP when possible. */
  anonymousBase: string;
}

let probed: boolean | undefined;

/**
 * Finds out whether the API honours X-Forwarded-For on its published port (the Docker gateway is inside
 * FORWARDEDHEADERS__KNOWNNETWORKS__0). The output hub reports the address it saw in the output status.
 */
export async function probeForwardedFor(admin: AdminApi): Promise<boolean> {
  if (probed !== undefined) return probed;
  const config = stackConfig();
  const fake = '198.51.100.23';
  try {
    const active = (await admin.getActiveProduction()).body;
    const settings = (await admin.getOutputSettings(active.id)).body;
    const { key } = parseOutputUrl(settings.url);
    const hub = OutputHub.connect(config.apiDirect, key, { headers: { 'X-Forwarded-For': fake } });
    try {
      await hub.open();
      await sleep(300);
      const snapshot = (await admin.getSnapshot(active.id)).body;
      probed = snapshot.outputStatus.addresses.includes(fake);
    } finally {
      await hub.stop();
    }
  } catch {
    probed = false;
  }
  return probed;
}

export interface Production {
  id: string;
  slug: string;
  name: string;
  outputUrl: string;
  outputKey: string;
  /** Scene ids in order (the three default scenes plus those added by seed()). */
  sceneIds: string[];
  api: AdminApi;
  /** Output REST client through Caddy with the production's key. */
  output(key?: string): OutputApi;
  /** Renames the default scenes and adds more; returns the scenes. */
  seed(names: string[]): Promise<SceneDto[]>;
  snapshot(): Promise<ReturnType<AdminApi['getSnapshot']> extends Promise<infer R> ? (R extends { body: infer B } ? B : never) : never>;
  refreshOutput(): Promise<void>;
  /** Pairing requests created through this helper, cancelled in cleanup. */
  pendingRequests: Array<{ requestId: string; pollToken: string }>;
}

/** Creates and activates a production (the active one is where /join pairs into, so tests are serial). */
export async function createProduction(api: AdminApi, label: string): Promise<Production> {
  const name = `e2e ${label} ${Math.random().toString(36).slice(2, 8)}`.slice(0, 80);
  const created = await api.createProduction({ name });
  if (created.status !== 201) throw new Error(`createProduction failed: ${created.status} ${created.raw.text()}`);
  const dto = created.body as ProductionDto;
  const activated = await api.activateProduction(dto.id);
  if (activated.status !== 200) throw new Error(`activateProduction failed: ${activated.status} ${activated.raw.text()}`);
  const snapshot = (await api.getSnapshot(dto.id)).body;
  const settings = (await api.getOutputSettings(dto.id)).body;
  const parsed = parseOutputUrl(settings.url);
  const production: Production = {
    id: dto.id,
    slug: dto.slug,
    name: dto.name,
    outputUrl: settings.url,
    outputKey: parsed.key,
    sceneIds: snapshot.scenes.map((scene) => scene.id),
    api,
    pendingRequests: [],
    output: (key) => new OutputApi(stackConfig().baseURL, dto.slug, key ?? production.outputKey),
    async seed(names) {
      const scenes = (await api.getSnapshot(dto.id)).body.scenes;
      const result: SceneDto[] = [];
      for (let index = 0; index < names.length; index++) {
        const existing = scenes[index];
        if (existing) {
          const renamed = await api.updateScene(dto.id, existing.id, { name: names[index] });
          if (renamed.status !== 200) throw new Error(`rename scene failed: ${renamed.status} ${renamed.raw.text()}`);
          result.push(renamed.body);
        } else {
          const added = await api.createScene(dto.id, { name: names[index]!, cloneFromSceneId: null });
          if (added.status !== 201) throw new Error(`create scene failed: ${added.status} ${added.raw.text()}`);
          result.push(added.body);
        }
      }
      production.sceneIds = (await api.getSnapshot(dto.id)).body.scenes.map((scene) => scene.id);
      return result;
    },
    snapshot: async () => (await api.getSnapshot(dto.id)).body as never,
    async refreshOutput() {
      const refreshed = (await api.getOutputSettings(dto.id)).body;
      production.outputUrl = refreshed.url;
      production.outputKey = parseOutputUrl(refreshed.url).key;
    },
  };
  return production;
}

/** Best-effort reset after a test: broadcast, devices, IP list, pending knocks. */
export async function cleanupProduction(production: Production): Promise<void> {
  const { api, id } = production;
  const config = stackConfig();
  try {
    await api.resetBroadcast(id);
    const snapshot = (await api.getSnapshot(id)).body;
    for (const device of snapshot.devices ?? []) await api.deleteDevice(id, device.id);
    if ((await api.getOutputSettings(id)).body.allowedIps?.length) await api.updateOutputAccess(id, { allowedIps: [] });
    const publicApi = new PublicApi(config.apiDirect);
    for (const request of production.pendingRequests) await publicApi.cancelPairingRequest(request.requestId, request.pollToken);
  } catch {
    // The stack may be down (disruptive tests); the next test creates its own production.
  }
}

// --- pairing helpers ---------------------------------------------------------------------------------------------

export interface PairedDevice {
  id: string;
  credentials: DeviceCredentialsDto;
  name: string;
  kind: 'phone' | 'laptop';
  method: 'qr' | 'code' | 'link';
  /** Device REST client (through `base`). */
  api: DeviceApi;
  /** `{deviceId}.{secret}` */
  bearer: string;
  /** Slot -> code from GET /api/device/me. */
  codes: Record<string, string>;
  /** Source id of a slot: `{deviceId}/{slot}` */
  sourceId(slot?: string): string;
}

export interface PairContext {
  production: Production;
  /** Base URL for the anonymous calls and the device client; default: the direct port with a unique client IP. */
  stack: Stack;
}

function makeDevice(credentials: DeviceCredentialsDto, name: string, kind: 'phone' | 'laptop', method: PairedDevice['method'], base: string, forwardedFor: string | undefined, codes: Record<string, string>): PairedDevice {
  const api = new DeviceApi(base, credentials, forwardedFor);
  return {
    id: credentials.deviceId,
    credentials,
    name,
    kind,
    method,
    api,
    bearer: api.bearer,
    codes,
    sourceId: (slot = kind === 'phone' ? 'camera' : 'screen-1') => `${credentials.deviceId}/${slot}`,
  };
}

async function describeSlots(api: DeviceApi): Promise<Record<string, string>> {
  const self = await api.getDeviceSelf();
  const codes: Record<string, string> = {};
  for (const slot of self.body.slots ?? []) codes[slot.slot] = slot.code;
  return codes;
}

/** QR flow: phone invite -> redeem. */
export async function pairPhone(context: PairContext, options: { name?: string; clientId?: string; platform?: string } = {}): Promise<PairedDevice> {
  const { production, stack } = context;
  const invite = await production.api.getPhoneInvite(production.id);
  if (invite.status !== 200) throw new Error(`getPhoneInvite failed: ${invite.status} ${invite.raw.text()}`);
  const ip = stack.forwardedForWorks ? uniqueIp() : undefined;
  const publicApi = new PublicApi(stack.anonymousBase, ip);
  const redeemed = await publicApi.redeemInvite(inviteToken(invite.body.url), {
    clientId: options.clientId ?? `cli-${Math.random().toString(36).slice(2, 12)}`,
    name: options.name,
    kind: 'phone',
    platform: options.platform ?? 'Pixel 7 · Chrome',
  });
  if (redeemed.status !== 200) throw new Error(`redeem failed: ${redeemed.status} ${redeemed.raw.text()}`);
  const device = makeDevice(redeemed.body, options.name ?? 'Phone', 'phone', 'qr', stack.anonymousBase, ip, {});
  device.codes = await describeSlots(device.api);
  const self = await device.api.getDeviceSelf();
  device.name = self.body.name;
  return device;
}

/** Link flow: laptopLink invite -> redeem. */
export async function pairLaptopByLink(context: PairContext, options: { name?: string; clientId?: string } = {}): Promise<PairedDevice> {
  const { production, stack } = context;
  const invite = await production.api.createInvite(production.id, { kind: 'laptopLink' });
  if (invite.status !== 201) throw new Error(`createInvite failed: ${invite.status} ${invite.raw.text()}`);
  const ip = stack.forwardedForWorks ? uniqueIp() : undefined;
  const publicApi = new PublicApi(stack.anonymousBase, ip);
  const redeemed = await publicApi.redeemInvite(inviteToken(invite.body.url), {
    clientId: options.clientId ?? `cli-${Math.random().toString(36).slice(2, 12)}`,
    name: options.name,
    kind: 'laptop',
    platform: 'Windows · Chrome',
  });
  if (redeemed.status !== 200) throw new Error(`redeem failed: ${redeemed.status} ${redeemed.raw.text()}`);
  const device = makeDevice(redeemed.body, options.name ?? 'Laptop', 'laptop', 'link', stack.anonymousBase, ip, {});
  device.codes = await describeSlots(device.api);
  device.name = (await device.api.getDeviceSelf()).body.name;
  return device;
}

/** Check-code flow: knock -> poll -> approve -> poll returns the credentials. */
export async function pairLaptopByCode(context: PairContext, options: { name?: string; platform?: string } = {}): Promise<PairedDevice> {
  const { production, stack } = context;
  const ip = stack.forwardedForWorks ? uniqueIp() : undefined;
  const publicApi = new PublicApi(stack.anonymousBase, ip);
  const name = options.name ?? 'Laptop Anna';
  const knock = await publicApi.createPairingRequest({ name, kind: 'laptop', platform: options.platform ?? 'Windows · Edge' });
  if (knock.status !== 201) throw new Error(`createPairingRequest failed: ${knock.status} ${knock.raw.text()}`);
  production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
  const approved = await production.api.approvePairingRequest(production.id, knock.body.requestId);
  if (approved.status !== 200) throw new Error(`approve failed: ${approved.status} ${approved.raw.text()}`);
  const poll = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
  if (poll.body.status !== 'approved' || !poll.body.credentials) throw new Error(`poll after approve: ${JSON.stringify(poll.body)}`);
  const device = makeDevice(poll.body.credentials, name, 'laptop', 'code', stack.anonymousBase, ip, {});
  device.codes = await describeSlots(device.api);
  return device;
}

/** Waits until the snapshot shows a source with the given id that satisfies `predicate`. */
export async function waitForSource(
  api: AdminApi,
  productionId: string,
  sourceId: string,
  predicate: (source: SourceDto) => boolean,
  timeoutMs = 10_000,
): Promise<SourceDto> {
  const deadline = Date.now() + timeoutMs;
  let last: SourceDto | undefined;
  for (;;) {
    last = (await api.getSnapshot(productionId)).body.sources.find((source) => source.id === sourceId);
    if (last && predicate(last)) return last;
    if (Date.now() > deadline) throw new Error(`source ${sourceId} did not reach the expected state within ${timeoutMs} ms; last: ${JSON.stringify(last)}`);
    await sleep(150);
  }
}
