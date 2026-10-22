import {
  compareCodes,
  parseSourceRef,
  slotKind,
  type AssetDto,
  type ProductionDto,
  type SceneDto,
  type SourceDto,
  type SourceKind,
} from '@flowstudio/scene-model';
import type { IconName } from '../../core/ui/icon.component';
import {
  KIND_ICON,
  sourceLamp,
  sourceStateView,
  type LampTone,
  type SourceStateView,
} from '../shared/source-view';

/**
 * Pure helpers of the Quellen dock (prototype «Auswahl und Quellenliste», «Quelle hinzufügen»): row models in reverse
 * z-order, the addable sources grouped by kind, and where a medium is used. No Angular, no DOM.
 */

/** One row of the Quellen dock. */
export interface SourceRowView {
  readonly itemId: string;
  readonly sourceId: string;
  /** Slot code, «–» for a deleted source. */
  readonly code: string;
  /** Source label, «Quelle fehlt» for a deleted source. */
  readonly name: string;
  readonly icon: IconName;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
  /** Lamp of a device source; null for media (no lamp). */
  readonly lamp: LampTone | null;
  /** State line («verbindet neu» + timer), or null while ok. */
  readonly state: SourceStateView | null;
  /** Start of the current status (timer base). */
  readonly statusSince: string | null;
  /** The source no longer exists («Quelle fehlt»). */
  readonly missing: boolean;
}

/** Kind of a source, guessed from the reference when the source was deleted. */
export function kindOfReference(
  sourceId: string,
  source: SourceDto | null | undefined,
): SourceKind {
  if (source) {
    return source.kind;
  }
  const parsed = parseSourceRef(sourceId);
  return parsed?.kind === 'device' ? (slotKind(parsed.slot) ?? 'camera') : 'image';
}

/** Rows of the edit scene, front to back (prototype: reversed item order). */
export function sourceRows(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
  selectedItemId: string | null,
): SourceRowView[] {
  return [...scene.items].reverse().map((item) => {
    const source = sources.get(item.source) ?? null;
    return {
      itemId: item.id,
      sourceId: item.source,
      code: source?.code ?? '–',
      name: source?.label ?? 'Quelle fehlt',
      icon: KIND_ICON[kindOfReference(item.source, source)],
      hidden: item.hidden,
      locked: item.locked,
      selected: item.id === selectedItemId && !item.hidden,
      lamp: sourceLamp(source),
      state: sourceStateView(source),
      statusSince: source?.statusSince ?? null,
      missing: source === null,
    };
  });
}

/** A group of the «+ Quelle» menu. */
export interface SourceGroup {
  readonly id: 'camera' | 'screen' | 'media';
  readonly label: 'Kameras' | 'Screens' | 'Medien';
  readonly sources: readonly SourceDto[];
}

/**
 * Sources that can be added to the scene (prototype `renderAddSource`): every source not yet in the scene and not
 * blocked, grouped into Kameras, Screens and Medien, each sorted by slot code. Empty groups are left out.
 */
export function addableSourceGroups(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
): SourceGroup[] {
  const used = new Set(scene.items.map((item) => item.source));
  const free = [...sources.values()]
    .filter((source) => !used.has(source.id) && source.status !== 'blocked')
    .sort((a, b) => compareCodes(a.code, b.code));
  const groups: SourceGroup[] = [
    { id: 'camera', label: 'Kameras', sources: free.filter((source) => source.kind === 'camera') },
    { id: 'screen', label: 'Screens', sources: free.filter((source) => source.kind === 'screen') },
    {
      id: 'media',
      label: 'Medien',
      sources: free.filter((source) => source.kind === 'image' || source.kind === 'video'),
    },
  ];
  return groups.filter((group) => group.sources.length > 0);
}

/**
 * Where a medium is used (spec 4.7: scene items, scene backgrounds, fallbacks, slates), as German phrases such as
 * «in «Pause»», «als Hintergrund von «Intro»», «als Ersatzquelle in «Gespräch»», «auf dem Slate «Bereit»». Empty when
 * the medium can be deleted.
 */
export function assetUsage(
  assetId: string,
  scenes: readonly SceneDto[],
  production: ProductionDto | null,
): string[] {
  const usage: string[] = [];
  for (const scene of scenes) {
    if (scene.items.some((item) => item.source === assetId)) {
      usage.push(`in «${scene.name}»`);
    }
    if (scene.background.assetId === assetId) {
      usage.push(`als Hintergrund von «${scene.name}»`);
    }
    if (scene.items.some((item) => item.onLost.fallbackSource === assetId)) {
      usage.push(`als Ersatzquelle in «${scene.name}»`);
    }
  }
  if (production?.standbySlate.backgroundAssetId === assetId) {
    usage.push('auf dem Slate vor der Sendung');
  }
  if (production?.endSlate.backgroundAssetId === assetId) {
    usage.push('auf dem Slate nach der Sendung');
  }
  return usage;
}

/** «Wird in «Pause» und als Hintergrund von «Intro» verwendet.» for {@link assetUsage}. */
export function usageSentence(usage: readonly string[]): string {
  if (usage.length === 0) {
    return 'Wird noch verwendet.';
  }
  const shown = usage.slice(0, 3);
  const more = usage.length - shown.length;
  const list =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(', ')} und ${shown[shown.length - 1]}`;
  return `Wird ${list}${more > 0 ? ` (und ${more} weitere)` : ''} verwendet.`;
}

/** Media sorted by code (M1, M2 …) for the media list. */
export function sortedAssets(assets: ReadonlyMap<string, AssetDto>): AssetDto[] {
  return [...assets.values()].sort((a, b) => compareCodes(a.code, b.code));
}
