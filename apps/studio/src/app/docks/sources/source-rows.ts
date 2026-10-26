import { msg, t, tm, type Msg } from '@studioflow/i18n';
import {
  compareCodes,
  parseSourceRef,
  slotKind,
  type AssetDto,
  type ProductionDto,
  type SceneDto,
  type SourceDto,
  type SourceKind,
} from '@studioflow/scene-model';
import type { IconName } from '../../core/ui/icon.component';
import {
  KIND_ICON,
  sourceLamp,
  sourceStateView,
  type LampTone,
  type SourceStateView,
} from '../shared/source-view';

/**
 * Pure helpers of the Sources dock (prototype "selection and source list", "add source"): row models in reverse
 * z-order, the addable sources grouped by kind, and where a medium is used. No Angular, no DOM. The texts are looked
 * up when a model is built, so build it inside a `computed` (or a template) to follow a language switch.
 */

/** One row of the Sources dock. */
export interface SourceRowView {
  readonly itemId: string;
  readonly sourceId: string;
  /** Slot code, "–" for a deleted source. */
  readonly code: string;
  /** Source label, "Source missing" for a deleted source. */
  readonly name: string;
  readonly icon: IconName;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
  /** The row shows a text: it can be selected while hidden and is shown and hidden live. */
  readonly isText: boolean;
  /** Lamp of a device source; null for media and texts (no lamp). */
  readonly lamp: LampTone | null;
  /** State line ("reconnecting" + timer), or null while ok. */
  readonly state: SourceStateView | null;
  /** Start of the current status (timer base). */
  readonly statusSince: string | null;
  /** The source no longer exists ("Source missing"). */
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
  switch (parsed?.kind) {
    case 'device':
      return slotKind(parsed.slot) ?? 'camera';
    case 'text':
      return 'text';
    default:
      return 'image';
  }
}

/**
 * Item order back to front (the z-order of a scene, first = back) from the dock's row order front to back, and the
 * other way round: the list is the reversed order, so position n from the top is item index count − n.
 */
export function flipOrder<T>(order: readonly T[]): T[] {
  return [...order].reverse();
}

/** Rows of the edit scene, front to back (prototype: reversed item order). */
export function sourceRows(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
  selectedItemId: string | null,
): SourceRowView[] {
  return flipOrder(scene.items).map((item) => {
    const source = sources.get(item.source) ?? null;
    const kind = kindOfReference(item.source, source);
    return {
      itemId: item.id,
      sourceId: item.source,
      code: source?.code ?? '–',
      name: source?.label ?? t('model.scene.sourceMissing'),
      icon: KIND_ICON[kind],
      hidden: item.hidden,
      locked: item.locked,
      selected: item.id === selectedItemId && (!item.hidden || kind === 'text'),
      isText: kind === 'text',
      lamp: sourceLamp(source),
      state: sourceStateView(source),
      statusSince: source?.statusSince ?? null,
      missing: source === null,
    };
  });
}

/** A group of the "+ Source" menu. */
export interface SourceGroup {
  readonly id: 'camera' | 'screen' | 'media' | 'text';
  readonly label: string;
  readonly sources: readonly SourceDto[];
}

/**
 * Sources that can be added to the scene (prototype `renderAddSource`): every source not yet in the scene and not
 * blocked, grouped into Cameras, Screens, Media and Texts, each sorted by slot code. Empty groups are left out.
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
    {
      id: 'camera',
      label: t('regie.sources.group.camera'),
      sources: free.filter((source) => source.kind === 'camera'),
    },
    {
      id: 'screen',
      label: t('regie.sources.group.screen'),
      sources: free.filter((source) => source.kind === 'screen'),
    },
    {
      id: 'media',
      label: t('regie.sources.group.media'),
      sources: free.filter((source) => source.kind === 'image' || source.kind === 'video'),
    },
    {
      id: 'text',
      label: t('regie.sources.group.text'),
      sources: free.filter((source) => source.kind === 'text'),
    },
  ];
  return groups.filter((group) => group.sources.length > 0);
}

/**
 * Where a medium is used (spec 4.7: scene items, scene backgrounds, fallbacks, slates), as phrases such as
 * "in “Break”", "as background of “Intro”", "as fallback in “Talk”", "on the slate before the broadcast". They are
 * messages, so a list that stays on screen (the media popover) follows a language switch. Empty when the medium can
 * be deleted.
 */
export function assetUsage(
  assetId: string,
  scenes: readonly SceneDto[],
  production: ProductionDto | null,
): Msg[] {
  const usage: Msg[] = [];
  for (const scene of scenes) {
    if (scene.items.some((item) => item.source === assetId)) {
      usage.push(msg('regie.media.usage.inScene', { scene: scene.name }));
    }
    if (scene.background.assetId === assetId) {
      usage.push(msg('regie.media.usage.asBackground', { scene: scene.name }));
    }
    if (scene.items.some((item) => item.onLost.fallbackSource === assetId)) {
      usage.push(msg('regie.media.usage.asFallback', { scene: scene.name }));
    }
  }
  if (production?.standbySlate.backgroundAssetId === assetId) {
    usage.push(msg('regie.media.usage.onStandbySlate'));
  }
  if (production?.endSlate.backgroundAssetId === assetId) {
    usage.push(msg('regie.media.usage.onEndSlate'));
  }
  return usage;
}

/** "Used in “Break” and as background of “Intro”." for {@link assetUsage}; at most three phrases are listed. */
export function usageSentence(usage: readonly Msg[]): string {
  if (usage.length === 0) {
    return t('regie.media.usage.stillUsed');
  }
  const shown = usage.slice(0, 3).map((phrase) => tm(phrase));
  const more = usage.length - shown.length;
  const list =
    shown.length === 1
      ? shown[0]
      : t('regie.media.usage.listAnd', {
          head: shown.slice(0, -1).join(', '),
          last: shown[shown.length - 1],
        });
  return more > 0
    ? t('regie.media.usage.sentenceMore', { list, more })
    : t('regie.media.usage.sentence', { list });
}

/** Media sorted by code (M1, M2 …) for the media list. */
export function sortedAssets(assets: ReadonlyMap<string, AssetDto>): AssetDto[] {
  return [...assets.values()].sort((a, b) => compareCodes(a.code, b.code));
}
