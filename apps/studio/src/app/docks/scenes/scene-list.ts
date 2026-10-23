import { t } from '@studioflow/i18n';
import { LIMITS, sourcesInScene, type SceneDto, type SceneHealth } from '@studioflow/scene-model';

/**
 * Pure helpers of the Scenes dock (prototype "scene list"): row texts and labels, names for new and copied scenes,
 * reordering. No Angular, no DOM. The texts are looked up when a row model is built, so build it inside a `computed`
 * (or a template) to follow a language switch.
 */

/** Everything a scene row shows. */
export interface SceneRowView {
  readonly id: string;
  readonly name: string;
  /** Keycap "1"…"9" for the first nine scenes (keys 1–9), else null. */
  readonly key: string | null;
  readonly isProgram: boolean;
  /** In the preview (only in Studio Mode). */
  readonly isPreview: boolean;
  /** `aria-pressed`: the preview in Studio Mode, else the program. */
  readonly pressed: boolean;
  /** Worst outage of the scene ("K2 disrupted"), or null. */
  readonly health: SceneHealth | null;
  /** Slot codes of the visible items in z-order, "S1 · K1"; "empty" without visible items. */
  readonly codes: string;
  /** Accessible name like the prototype: "Lea presents, live on Program, K2 disrupted". */
  readonly ariaLabel: string;
}

/** Context of {@link sceneRowView}. */
export interface SceneRowContext {
  readonly programSceneId: string | null;
  readonly previewSceneId: string | null;
  readonly studioMode: boolean;
  readonly health: SceneHealth | null;
  /** Slot code of a source, undefined for deleted sources (they are left out). */
  readonly codeOf: (sourceId: string) => string | undefined;
}

/** Row model of a scene at list position `index` (0-based). */
export function sceneRowView(
  scene: SceneDto,
  index: number,
  context: SceneRowContext,
): SceneRowView {
  const isProgram = scene.id === context.programSceneId;
  const isPreview = context.studioMode && scene.id === context.previewSceneId;
  const codes = sourcesInScene(scene)
    .map((sourceId) => context.codeOf(sourceId))
    .filter((code): code is string => !!code);
  const health = context.health;
  const labelParts = [scene.name];
  if (isProgram) {
    labelParts.push(t('regie.scenes.row.ariaProgram'));
  }
  if (isPreview) {
    labelParts.push(t('regie.scenes.row.ariaPreview'));
  }
  if (health) {
    labelParts.push(t('regie.scenes.row.ariaDisrupted', { code: health.code }));
  }
  return {
    id: scene.id,
    name: scene.name,
    key: index < 9 ? String(index + 1) : null,
    isProgram,
    isPreview,
    pressed: context.studioMode ? isPreview : isProgram,
    health,
    codes: codes.length > 0 ? codes.join(' · ') : t('regie.scenes.row.empty'),
    ariaLabel: labelParts.join(', '),
  };
}

function trimToLength(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

/**
 * Name of a new scene: "New scene N" with N = number of scenes + 1 (the keycap it will get), counting up while the
 * name is taken.
 */
export function nextSceneName(scenes: readonly Pick<SceneDto, 'name'>[]): string {
  const taken = new Set(scenes.map((scene) => scene.name.trim()));
  let number = scenes.length + 1;
  while (taken.has(t('regie.scenes.name.new', { number }))) {
    number += 1;
  }
  return t('regie.scenes.name.new', { number });
}

/** Name of a duplicate: "Name (copy)", then "Name (copy 2)" …, at most 80 characters. */
export function copyName(name: string, scenes: readonly Pick<SceneDto, 'name'>[]): string {
  const taken = new Set(scenes.map((scene) => scene.name.trim()));
  const base = name.trim();
  for (let number = 1; ; number += 1) {
    // The suffix is what the message adds around an empty name; the name is cut so that the whole stays within range.
    const suffix = copyLabel('', number);
    const candidate = copyLabel(trimToLength(base, LIMITS.sceneNameLength - suffix.length), number);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

function copyLabel(name: string, number: number): string {
  return number === 1
    ? t('regie.scenes.name.copy', { name })
    : t('regie.scenes.name.copyNth', { name, number });
}

/** Scene ids after moving `sceneId` one place up (−1) or down (+1); null when it cannot move. */
export function moveSceneOrder(
  sceneIds: readonly string[],
  sceneId: string,
  direction: -1 | 1,
): string[] | null {
  const index = sceneIds.indexOf(sceneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sceneIds.length) {
    return null;
  }
  const next = [...sceneIds];
  next.splice(index, 1);
  next.splice(target, 0, sceneId);
  return next;
}
