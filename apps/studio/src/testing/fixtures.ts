/**
 * Builders for wire objects in the Regie specs. Test-only (imported by *.spec.ts files only).
 */
import {
  DEFAULT_TEXT_THEME,
  type AuditEntryDto,
  type DeviceDto,
  type IncidentDto,
  type LogEntryDto,
  type ProductionChangesDto,
  type ProductionDto,
  type ProductionEvent,
  type ProductionSnapshot,
  type SceneDto,
  type SceneItemDto,
  type SourceDto,
  type SourceKind,
  type SourceStatus,
  type TextSourceDto,
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
    standbySlate: { title: 'Starting soon', subtitle: 'Webinar', backgroundAssetId: null },
    endSlate: { title: 'Thanks for watching', subtitle: null, backgroundAssetId: null },
    textTheme: DEFAULT_TEXT_THEME,
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
    label: `Device ${code}`,
    deviceId,
    slot,
    assetId: null,
    status,
    statusSince: null,
    text: null,
    ...overrides,
  };
}

/** A text source (lower third by default) as the API sends it: the content sits in `text`, the label is line 1. */
export function textSourceFixture(
  id: string,
  code: string,
  overrides: Partial<TextSourceDto> = {},
): SourceDto {
  const text: TextSourceDto = {
    id,
    code,
    line1: 'Mia Meier',
    line2: 'Moderator',
    style: 'lowerThird',
    align: 'left',
    ...overrides,
  };
  return {
    id,
    code,
    kind: 'text',
    label: text.line1,
    deviceId: null,
    slot: null,
    assetId: null,
    status: 'ok',
    statusSince: null,
    text,
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

/** An entry of the audit log: the scene `scene` went live (override anything else). */
export function auditEntryFixture(
  id: number,
  overrides: Partial<AuditEntryDto> = {},
): AuditEntryDto {
  return {
    id,
    at: `2026-10-26T14:03:${String(id % 60).padStart(2, '0')}.000+00:00`,
    actor: 'admin',
    action: 'scene.live',
    category: 'production',
    productionId: PRODUCTION_ID,
    productionName: 'Webinar',
    code: 'sceneLive',
    params: { scene: 'Break' },
    text: 'Scene “Break” is live',
    details: { scene: 'Break', via: 'take' },
    ...overrides,
  };
}

/** Default scenes: Welcome (K1), Presentation (S1 + K1), Break (empty). */
export function defaultScenes(): SceneDto[] {
  return [
    sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera')]),
    sceneFixture('scn_b', 'Presentation', 1, [
      itemFixture('itm_b1', 'dev_bbbbbbbbbbbbbbbb/screen-1', {
        x: 40,
        y: 40,
        w: 1360,
        h: 765,
        fit: 'contain',
      }),
      itemFixture('itm_b2', 'dev_aaaaaaaaaaaaaaaa/camera', { x: 1440, y: 40, w: 440, h: 248 }),
    ]),
    sceneFixture('scn_c', 'Break', 2),
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
      sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Phone stage left' }),
      sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea · Slides' }),
    ],
    devices: [
      deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Phone stage left'),
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
