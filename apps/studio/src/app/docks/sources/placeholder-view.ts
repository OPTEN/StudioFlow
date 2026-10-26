import { t } from '@studioflow/i18n';
import {
  compareCodes,
  type SceneDto,
  type SourceDto,
  type SourceKind,
  type SourcePlaceholderDto,
} from '@studioflow/scene-model';
import { isDeviceKind } from '../shared/source-view';

/**
 * Pure helpers for the placeholders of a copied production (issue #14): names, where they are used, the sources an
 * operator can assign them to and the offers "Use as K1 · Stage phone" of a newly paired station. No Angular, no DOM.
 * The texts are looked up when a model is built, so build it inside a `computed` (or a template) to follow a language
 * switch.
 */

/** “K1 · Stage phone”, or “K1” while the original device had no name. */
export function placeholderName(placeholder: Pick<SourcePlaceholderDto, 'code' | 'label'>): string {
  return placeholder.label ? `${placeholder.code} · ${placeholder.label}` : placeholder.code;
}

/** Where a placeholder shows up: scenes (items or fallbacks) and the scene items that show it. */
export interface PlaceholderUsage {
  readonly scenes: number;
  readonly items: number;
}

/** How many scenes and scene items use the placeholder's source reference. */
export function placeholderUsage(sourceId: string, scenes: readonly SceneDto[]): PlaceholderUsage {
  let used = 0;
  let items = 0;
  for (const scene of scenes) {
    const shown = scene.items.filter((item) => item.source === sourceId).length;
    const fallback = scene.items.some((item) => item.onLost.fallbackSource === sourceId);
    items += shown;
    if (shown > 0 || fallback) {
      used++;
    }
  }
  return { scenes: used, items };
}

/** A row of the "Missing sources" list. */
export interface PlaceholderRowView {
  readonly id: string;
  readonly sourceId: string;
  readonly code: string;
  readonly kind: SourceKind;
  /** The name of the original device; “removed source” while it had none. */
  readonly label: string;
  /** “K1 · Stage phone”. */
  readonly name: string;
  /** “in 3 scenes”. */
  readonly usedIn: string;
  readonly usage: PlaceholderUsage;
}

/** The placeholders sorted by code, each with where it is used. */
export function placeholderRows(
  placeholders: readonly SourcePlaceholderDto[],
  scenes: readonly SceneDto[],
): PlaceholderRowView[] {
  return [...placeholders]
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((placeholder) => {
      const usage = placeholderUsage(placeholder.sourceId, scenes);
      return {
        id: placeholder.id,
        sourceId: placeholder.sourceId,
        code: placeholder.code,
        kind: placeholder.kind,
        label: placeholder.label ?? t('regie.placeholders.unnamed'),
        name: placeholderName(placeholder),
        usedIn: t('regie.placeholders.dock.usedIn', { count: usage.scenes }),
        usage,
      };
    });
}

/** A group of the assignment menu. */
export interface AssignGroup {
  readonly id: 'camera' | 'screen' | 'media';
  readonly label: string;
  readonly sources: readonly SourceDto[];
}

/**
 * Sources a placeholder can be assigned to: every camera, screen and medium that is not blocked, grouped and sorted by
 * code. Texts are not offered (the server refuses them), and empty groups are left out.
 */
export function assignableGroups(sources: ReadonlyMap<string, SourceDto>): AssignGroup[] {
  const free = [...sources.values()]
    .filter((source) => source.kind !== 'text' && source.status !== 'blocked')
    .sort((a, b) => compareCodes(a.code, b.code));
  const groups: AssignGroup[] = [
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
  ];
  return groups.filter((group) => group.sources.length > 0);
}

/** “Use as K1 · Stage phone”: the new source of a station could take the place of this placeholder. */
export interface PlaceholderOffer {
  readonly source: SourceDto;
  readonly placeholder: SourcePlaceholderDto;
  /** “K1 · Stage phone”. */
  readonly name: string;
}

/**
 * The offers for the sources of one station: a camera or screen that no scene uses yet can take the place of a
 * placeholder of the same kind (a screen offers the screen placeholders only). Sorted by the code of the placeholder.
 * A source that is in use already is not offered; it can still be assigned from the Sources dock.
 */
export function placeholderOffers(
  sources: readonly SourceDto[],
  placeholders: readonly SourcePlaceholderDto[],
  isUsed: (sourceId: string) => boolean,
): PlaceholderOffer[] {
  if (placeholders.length === 0) {
    return [];
  }
  const offers: PlaceholderOffer[] = [];
  for (const source of sources) {
    if (!isDeviceKind(source.kind) || source.status === 'blocked' || isUsed(source.id)) {
      continue;
    }
    for (const placeholder of placeholders) {
      if (placeholder.kind === source.kind) {
        offers.push({ source, placeholder, name: placeholderName(placeholder) });
      }
    }
  }
  return offers.sort((a, b) => compareCodes(a.placeholder.code, b.placeholder.code));
}
