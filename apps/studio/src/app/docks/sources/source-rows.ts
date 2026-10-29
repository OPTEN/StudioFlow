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
  type SourcePlaceholderDto,
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
  /** Id of the placeholder the row shows (a device of the original production, issue #14), or null. */
  readonly placeholderId: string | null;
}

/** Kind of a source, guessed from the reference when the source was deleted. */
export function kindOfReference(
  sourceId: string,
  source: SourceDto | null | undefined,
  placeholder?: SourcePlaceholderDto | null,
): SourceKind {
  if (source) {
    return source.kind;
  }
  if (placeholder) {
    return placeholder.kind;
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

/**
 * Rows of the edit scene, front to back (prototype: reversed item order). An item that shows a placeholder of a copied
 * production keeps the code and name of the original device and says "Source missing" until a source is assigned.
 */
export function sourceRows(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
  selectedItemId: string | null,
  placeholders: readonly SourcePlaceholderDto[] = [],
): SourceRowView[] {
  return flipOrder(scene.items).map((item) => {
    const source = sources.get(item.source) ?? null;
    const placeholder = source
      ? null
      : (placeholders.find((p) => p.sourceId === item.source) ?? null);
    const kind = kindOfReference(item.source, source, placeholder);
    return {
      itemId: item.id,
      sourceId: item.source,
      code: source?.code ?? placeholder?.code ?? '–',
      name:
        source?.label ??
        (placeholder
          ? (placeholder.label ?? t('regie.placeholders.unnamed'))
          : t('model.scene.sourceMissing')),
      icon: KIND_ICON[kind],
      hidden: item.hidden,
      locked: item.locked,
      selected: item.id === selectedItemId && (!item.hidden || kind === 'text'),
      isText: kind === 'text',
      lamp: sourceLamp(source),
      state: placeholder
        ? { word: t('model.scene.sourceMissing'), tone: 'muted', timer: false }
        : sourceStateView(source),
      statusSince: source?.statusSince ?? null,
      missing: source === null,
      placeholderId: placeholder?.id ?? null,
    };
  });
}

/** One entry of the "+ Source" menu. */
export interface SourceMenuEntry {
  readonly source: SourceDto;
  /** Already in the scene: listed with a checkmark, not addable. */
  readonly inScene: boolean;
  /** A blocked device: listed with its state word, not addable. */
  readonly blocked: boolean;
}

/** A group of the "+ Source" menu. */
export interface SourceGroup {
  readonly id: 'camera' | 'screen' | 'media' | 'text';
  readonly label: string;
  readonly entries: readonly SourceMenuEntry[];
}

/**
 * The sources of the "+ Source" menu, grouped into Cameras, Screens, Media and Texts, each sorted by slot code. Every
 * source is listed, so the operator can tell "not paired" from "already added": the ones already in the scene and the
 * blocked devices are marked and cannot be added. Empty groups are left out.
 */
export function sourceMenuGroups(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
): SourceGroup[] {
  const used = new Set(scene.items.map((item) => item.source));
  const entries = [...sources.values()]
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((source) => ({
      source,
      inScene: used.has(source.id),
      blocked: source.status === 'blocked',
    }));
  const of = (kinds: readonly SourceKind[]): SourceMenuEntry[] =>
    entries.filter((entry) => kinds.includes(entry.source.kind));
  const groups: SourceGroup[] = [
    { id: 'camera', label: t('regie.sources.group.camera'), entries: of(['camera']) },
    { id: 'screen', label: t('regie.sources.group.screen'), entries: of(['screen']) },
    { id: 'media', label: t('regie.sources.group.media'), entries: of(['image', 'video']) },
    { id: 'text', label: t('regie.sources.group.text'), entries: of(['text']) },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

/** True when an entry of the menu can be added (not in the scene, not blocked). */
export function canAddEntry(entry: SourceMenuEntry): boolean {
  return !entry.inScene && !entry.blocked;
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
