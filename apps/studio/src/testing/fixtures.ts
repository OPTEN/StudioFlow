/**
 * Builders for wire objects in the Regie specs. Test-only (imported by *.spec.ts files only).
 */
import type {
  DeviceDto,
  IncidentDto,
  LogEntryDto,
  ProductionChangesDto,
  ProductionDto,
  ProductionEvent,
  ProductionSnapshot,
  SceneDto,
  SceneItemDto,
  SourceDto,
  SourceKind,
  SourceStatus,
} from '@studioflow/scene-model';

/** Production id of the fixtures. */
export const PRODUCTION_ID = 'prd_aaaaaaaaaaaaaaaa';

/** A production in standby with program scene `scn_a`. */
export function productionFixture(overrides: Partial<ProductionDto> = {}): ProductionDto {
  return {
    id: PRODUCTION_ID,
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
    standbySlate: { title: "Gleich geht's los", subtitle: 'Webinar', backgroundAssetId: null },
    endSlate: { title: 'Danke fürs Zuschauen', subtitle: null, backgroundAssetId: null },
    ...overrides,
  };
}

/** A visible 600 × 338 item. */
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

/** A scene. */
export function sceneFixture(
  id: string,
  name: string,
  sortOrder: number,
  items: SceneItemDto[] = [],
  overrides: Partial<SceneDto> = {},
): SceneDto {
  return {
    id,
    name,
    sortOrder,
    version: 1,
    layoutMode: 'free',
    background: { color: '#000000', assetId: null },
    items,
    ...overrides,
  };
}

/** A device source `{deviceId}/{slot}`. */
export function sourceFixture(
  deviceId: string,
  slot: string,
  code: string,
  overrides: Partial<SourceDto> = {},
): SourceDto {
  const kind: SourceKind = slot === 'camera' ? 'camera' : 'screen';
  const status: SourceStatus = 'ok';
  return {
    id: `${deviceId}/${slot}`,
    code,
    kind,
    label: `Gerät ${code}`,
    deviceId,
    slot,
    assetId: null,
    status,
    statusSince: null,
    ...overrides,
  };
}

/** A paired, online device. */
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
    pairedAt: '2026-10-22T09:00:00.000Z',
    lastSeenAt: '2026-10-22T10:00:00.000Z',
    pairingMethod: 'qr',
    connection: 'online',
    connectionSince: '2026-10-22T09:00:00.000Z',
    techCheck: null,
    telemetry: null,
    ...overrides,
  };
}

/** An incident of a source. */
export function incidentFixture(
  id: string,
  sourceId: string,
  code: string,
  overrides: Partial<IncidentDto> = {},
): IncidentDto {
  return {
    id,
    sourceId,
    code,
    kind: 'reconnecting',
    startedAt: '2026-10-22T09:59:50.000Z',
    endedAt: null,
    ...overrides,
  };
}

/** A log entry: the scene `name` went live. */
export function logFixture(text: string, at = '2026-10-22T09:30:00.000Z'): LogEntryDto {
  return { at, code: 'sceneLive', params: { scene: text }, text: `Scene “${text}” is live` };
}

/** Default scenes: Begrüssung (K1), Präsentation (S1 + K1), Pause (empty). */
export function defaultScenes(): SceneDto[] {
  return [
    sceneFixture('scn_a', 'Begrüssung', 0, [itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera')]),
    sceneFixture('scn_b', 'Präsentation', 1, [
      itemFixture('itm_b1', 'dev_bbbbbbbbbbbbbbbb/screen-1', {
        x: 40,
        y: 40,
        w: 1360,
        h: 765,
        fit: 'contain',
      }),
      itemFixture('itm_b2', 'dev_aaaaaaaaaaaaaaaa/camera', { x: 1440, y: 40, w: 440, h: 248 }),
    ]),
    sceneFixture('scn_c', 'Pause', 2),
  ];
}

/** A snapshot with three scenes, two devices and their sources at revision 100. */
export function snapshotFixture(overrides: Partial<ProductionSnapshot> = {}): ProductionSnapshot {
  return {
    revision: 100,
    serverTime: new Date().toISOString(),
    production: productionFixture(),
    scenes: defaultScenes(),
    sources: [
      sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Handy Bühne links' }),
      sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea · Folien' }),
    ],
    devices: [
      deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Handy Bühne links'),
      deviceFixture('dev_bbbbbbbbbbbbbbbb', 'Laptop Lea', {
        kind: 'laptop',
        platform: 'Windows · Edge',
      }),
    ],
    assets: [],
    pairingRequests: [],
    invites: [],
    incidents: [],
    outputStatus: {
      state: 'none',
      consumers: 0,
      addresses: [],
      latencyMs: null,
      fps: null,
      lastReportAt: null,
    },
    recentLog: [],
    operatorsOnline: 1,
    ...overrides,
  };
}

/** A subscribe answer carrying a snapshot. */
export function snapshotChanges(snapshot: ProductionSnapshot): ProductionChangesDto {
  return { revision: snapshot.revision, events: null, snapshot };
}

/** A subscribe answer carrying a delta. */
export function deltaChanges(revision: number, events: ProductionEvent[]): ProductionChangesDto {
  return { revision, events, snapshot: null };
}
