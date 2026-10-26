/**
 * Builders for wire objects used by the specs of the shared packages. Test-only: not exported from the package
 * index, so it never reaches an application bundle.
 */
import type {
  AssetDto,
  DeviceDto,
  DeviceTelemetryDto,
  IncidentDto,
  IncidentKind,
  InviteDto,
  LogEntryDto,
  OutputSnapshot,
  OutputStatusDto,
  PairingRequestDto,
  ProductionDto,
  ProductionSnapshot,
  SceneDto,
  SceneItemDto,
  SourceDto,
  SourceKind,
  SourceStatus,
} from '../contracts';

/** Fixed server time of all fixtures. */
export const FIXTURE_TIME = '2026-10-22T10:00:00.000Z';

/** A production in standby with the given program and preview. */
export function productionFixture(overrides: Partial<ProductionDto> = {}): ProductionDto {
  return {
    id: 'prd_aaaaaaaaaaaaaaaa',
    tenantId: 'opten',
    name: 'Webinar',
    slug: 'webinar',
    isActive: true,
    broadcast: 'standby',
    liveSince: null,
    endedAt: null,
    programSceneId: 'scn_a',
    previewSceneId: null,
    lastTransition: { kind: 'cut', durationMs: 0 },
    lastSwitchAt: null,
    standbySlate: { title: 'Starting soon', subtitle: 'Webinar', backgroundAssetId: null },
    endSlate: { title: 'Thanks for watching', subtitle: null, backgroundAssetId: null },
    textTheme: { accent: '#1f6feb', background: '#0d1117', foreground: '#ffffff' },
    ...overrides,
  };
}

/** A visible 600 × 338 item showing `source`. */
export function itemFixture(
  id: string,
  source: string,
  overrides: Partial<SceneItemDto> = {},
): SceneItemDto {
  return {
    id,
    source,
    x: 100,
    y: 100,
    w: 600,
    h: 338,
    fit: 'cover',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 12,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: 3000, fallbackSource: null },
    ...overrides,
  };
}

/** A free-layout scene. */
export function sceneFixture(
  id: string,
  sortOrder: number,
  items: SceneItemDto[] = [],
  overrides: Partial<SceneDto> = {},
): SceneDto {
  return {
    id,
    name: `Scene ${id}`,
    sortOrder,
    version: 1,
    layoutMode: 'free',
    background: { color: '#0a0d12', assetId: null },
    items,
    ...overrides,
  };
}

/** A device slot source (`{deviceId}/{slot}`). */
export function deviceSourceFixture(
  deviceId: string,
  slot: string,
  code: string,
  status: SourceStatus = 'ok',
  overrides: Partial<SourceDto> = {},
): SourceDto {
  const kind: SourceKind = slot === 'camera' ? 'camera' : 'screen';
  return {
    id: `${deviceId}/${slot}`,
    code,
    kind,
    label: `${deviceId} · ${slot}`,
    deviceId,
    slot,
    assetId: null,
    status,
    statusSince: null,
    text: null,
    ...overrides,
  };
}

/** A media source for an asset. */
export function assetSourceFixture(
  assetId: string,
  code: string,
  kind: SourceKind = 'image',
): SourceDto {
  return {
    id: assetId,
    code,
    kind,
    label: `Medium ${code}`,
    deviceId: null,
    slot: null,
    assetId,
    status: 'ok',
    statusSince: null,
    text: null,
  };
}

/** An uploaded image. */
export function assetFixture(
  id: string,
  code: string,
  overrides: Partial<AssetDto> = {},
): AssetDto {
  return {
    id,
    code,
    kind: 'image',
    name: `Bild ${code}`,
    contentType: 'image/png',
    sizeBytes: 1024,
    width: 1920,
    height: 1080,
    createdAt: FIXTURE_TIME,
    contentUrl: `/api/assets/${id}/content`,
    ...overrides,
  };
}

/** Telemetry received at `at`. */
export function telemetryFixture(
  at: string,
  overrides: Partial<DeviceTelemetryDto> = {},
): DeviceTelemetryDto {
  return {
    at,
    rtc: 'connected',
    batteryPct: 80,
    charging: false,
    network: 'wifi',
    rttMs: 20,
    slots: [],
    ...overrides,
  };
}

/** An active, online phone. */
export function deviceFixture(
  id: string,
  name: string,
  overrides: Partial<DeviceDto> = {},
): DeviceDto {
  return {
    id,
    name,
    kind: 'phone',
    platform: 'iPhone · Safari',
    state: 'active',
    pairedAt: FIXTURE_TIME,
    lastSeenAt: FIXTURE_TIME,
    pairingMethod: 'qr',
    connection: 'online',
    connectionSince: FIXTURE_TIME,
    techCheck: null,
    telemetry: null,
    ...overrides,
  };
}

/** An incident; open unless `endedAt` is given. */
export function incidentFixture(
  id: string,
  sourceId: string,
  code: string,
  kind: IncidentKind,
  endedAt: string | null = null,
): IncidentDto {
  return { id, sourceId, code, kind, startedAt: FIXTURE_TIME, endedAt };
}

/** A pending knock created at `createdAt`. */
export function pairingRequestFixture(id: string, createdAt: string): PairingRequestDto {
  return {
    id,
    name: `Laptop ${id}`,
    kind: 'laptop',
    platform: 'Windows · Edge',
    checkCode: '4712',
    createdAt,
    expiresAt: createdAt,
  };
}

/** A phone QR invite. */
export function inviteFixture(id: string): InviteDto {
  return {
    id,
    kind: 'phoneQr',
    url: `https://studioflow.test/join/i/${id}`,
    createdAt: FIXTURE_TIME,
    expiresAt: FIXTURE_TIME,
  };
}

/** No output connected. */
export function outputStatusFixture(overrides: Partial<OutputStatusDto> = {}): OutputStatusDto {
  return {
    state: 'none',
    consumers: 0,
    addresses: [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
    ...overrides,
  };
}

/** A Regie snapshot with two scenes (`scn_a` program, `scn_b`) and no devices. */
export function snapshotFixture(overrides: Partial<ProductionSnapshot> = {}): ProductionSnapshot {
  return {
    revision: 100,
    serverTime: FIXTURE_TIME,
    production: productionFixture(),
    scenes: [sceneFixture('scn_a', 0), sceneFixture('scn_b', 1)],
    sources: [],
    devices: [],
    assets: [],
    pairingRequests: [],
    invites: [],
    incidents: [],
    outputStatus: outputStatusFixture(),
    recentLog: [],
    operatorsOnline: 1,
    ...overrides,
  };
}

/** The output variant of {@link snapshotFixture}. */
export function outputSnapshotFixture(overrides: Partial<OutputSnapshot> = {}): OutputSnapshot {
  return {
    revision: 100,
    serverTime: FIXTURE_TIME,
    production: productionFixture(),
    scenes: [sceneFixture('scn_a', 0), sceneFixture('scn_b', 1)],
    sources: [],
    assets: [],
    ...overrides,
  };
}

/** A log entry of "Recent events" (the code and parameters of a scene going live by default). */
export function logFixture(text: string, overrides: Partial<LogEntryDto> = {}): LogEntryDto {
  return { at: FIXTURE_TIME, code: 'sceneLive', params: { scene: text }, text, ...overrides };
}
