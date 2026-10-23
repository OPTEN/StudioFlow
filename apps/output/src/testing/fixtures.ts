/**
 * Wire objects for the output page specs. Test-only (never imported by application code).
 */
import {
  stateFromOutputSnapshot,
  type AssetDto,
  type OutputChangesDto,
  type OutputSnapshot,
  type ProductionDto,
  type ProductionEvent,
  type ProductionState,
  type SceneDto,
  type SceneItemDto,
  type SourceDto,
  type TransitionDto,
} from '@studioflow/scene-model';

export const FIXTURE_TIME = '2026-10-22T10:00:00.000Z';
export const KEY = 'k3yK3yK3yK3yK3yK3yK3yK3yK3yK3yK3yK3yK3yK3yA';
export const CAMERA = 'dev_aaaaaaaaaaaaaaaa/camera';
export const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';
export const IMAGE = 'ast_cccccccccccccccc';

export const CUT: TransitionDto = { kind: 'cut', durationMs: 0 };
export const FADE: TransitionDto = { kind: 'fade', durationMs: 500 };

export function production(overrides: Partial<ProductionDto> = {}): ProductionDto {
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
    lastTransition: CUT,
    lastSwitchAt: null,
    standbySlate: { title: "Gleich geht's los", subtitle: 'Webinar', backgroundAssetId: null },
    endSlate: { title: 'Danke fürs Zuschauen', subtitle: null, backgroundAssetId: null },
    ...overrides,
  };
}

export function item(
  id: string,
  source: string,
  overrides: Partial<SceneItemDto> = {},
): SceneItemDto {
  return {
    id,
    source,
    x: 0,
    y: 0,
    w: 960,
    h: 540,
    fit: 'cover',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 0,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: 3000, fallbackSource: null },
    ...overrides,
  };
}

export function scene(
  id: string,
  sortOrder: number,
  items: SceneItemDto[] = [],
  overrides: Partial<SceneDto> = {},
): SceneDto {
  return {
    id,
    name: `Szene ${id.slice(4).toUpperCase()}`,
    sortOrder,
    version: 1,
    layoutMode: 'free',
    background: { color: '#0a0d12', assetId: null },
    items,
    ...overrides,
  };
}

export function deviceSource(id: string, code: string, label: string): SourceDto {
  const [deviceId, slot] = id.split('/');
  return {
    id,
    code,
    kind: slot === 'camera' ? 'camera' : 'screen',
    label,
    deviceId,
    slot,
    assetId: null,
    status: 'ok',
    statusSince: null,
  };
}

export function asset(id: string, overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id,
    code: 'M1',
    kind: 'image',
    name: 'Pause.png',
    contentType: 'image/png',
    sizeBytes: 1024,
    width: 1920,
    height: 1080,
    createdAt: FIXTURE_TIME,
    contentUrl: `/api/productions/prd_aaaaaaaaaaaaaaaa/assets/${id}/content`,
    ...overrides,
  };
}

/** Three scenes: A (camera, program), B (screen + camera), C (image). */
export function snapshot(
  overrides: Partial<OutputSnapshot> = {},
  productionOverrides: Partial<ProductionDto> = {},
): OutputSnapshot {
  return {
    revision: 100,
    serverTime: FIXTURE_TIME,
    production: production(productionOverrides),
    scenes: [
      scene('scn_a', 0, [item('itm_a1', CAMERA)]),
      scene('scn_b', 1, [
        item('itm_b1', SCREEN),
        item('itm_b2', CAMERA, { x: 1400, w: 480, h: 270 }),
      ]),
      scene('scn_c', 2, [item('itm_c1', IMAGE, { w: 1920, h: 1080 })]),
    ],
    sources: [
      deviceSource(CAMERA, 'K1', 'Handy Lea'),
      deviceSource(SCREEN, 'S1', 'Laptop Tom · Screen 1'),
    ],
    assets: [asset(IMAGE)],
    ...overrides,
  };
}

export function state(
  overrides: Partial<OutputSnapshot> = {},
  productionOverrides: Partial<ProductionDto> = {},
): ProductionState {
  return stateFromOutputSnapshot(
    snapshot(overrides, productionOverrides),
    Date.parse(FIXTURE_TIME),
  );
}

/** Subscribe answer with a full snapshot. */
export function snapshotChanges(source: OutputSnapshot = snapshot()): OutputChangesDto {
  return {
    revision: source.revision,
    events: null,
    snapshot: source,
  } as unknown as OutputChangesDto;
}

/** Subscribe answer with events after `since`. */
export function deltaChanges(revision: number, events: ProductionEvent[] = []): OutputChangesDto {
  return { revision, events, snapshot: null } as unknown as OutputChangesDto;
}

export function programSwitched(
  revision: number,
  programSceneId: string,
  transition: TransitionDto = FADE,
  previousProgramSceneId: string | null = 'scn_a',
): ProductionEvent {
  return {
    type: 'programSwitched',
    programSceneId,
    previewSceneId: null,
    previousProgramSceneId,
    transition,
    at: FIXTURE_TIME,
    revision,
  };
}

export function productionChanged(
  revision: number,
  overrides: Partial<ProductionDto>,
): ProductionEvent {
  return { type: 'productionChanged', production: production(overrides), revision };
}

export function sceneUpserted(revision: number, upserted: SceneDto): ProductionEvent {
  return { type: 'sceneUpserted', scene: upserted, revision };
}
