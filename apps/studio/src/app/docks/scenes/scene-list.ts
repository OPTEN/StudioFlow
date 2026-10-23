import { LIMITS, sourcesInScene, type SceneDto, type SceneHealth } from '@studioflow/scene-model';

/**
 * Pure helpers of the Szenen dock (prototype «Szenenliste»): row texts and labels, names for new and copied scenes,
 * reordering. No Angular, no DOM.
 */

/** Everything a scene row shows. */
export interface SceneRowView {
  readonly id: string;
  readonly name: string;
  /** Keycap «1»…«9» for the first nine scenes (keys 1–9), else null. */
  readonly key: string | null;
  readonly isProgram: boolean;
  /** In the preview (only in Studio-Modus). */
  readonly isPreview: boolean;
  /** `aria-pressed`: the preview in Studio-Modus, else the program. */
  readonly pressed: boolean;
  /** Worst outage of the scene («K2 gestört»), or null. */
  readonly health: SceneHealth | null;
  /** Slot codes of the visible items in z-order, «S1 · K1»; «leer» without visible items. */
  readonly codes: string;
  /** Accessible name like the prototype: «Lea präsentiert, live im Program, K2 gestört». */
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

/** Text of a scene without visible items. */
export const EMPTY_SCENE_CODES = 'leer';

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
  return {
    id: scene.id,
    name: scene.name,
    key: index < 9 ? String(index + 1) : null,
    isProgram,
    isPreview,
    pressed: context.studioMode ? isPreview : isProgram,
    health,
    codes: codes.length > 0 ? codes.join(' · ') : EMPTY_SCENE_CODES,
    ariaLabel:
      scene.name +
      (isProgram ? ', live im Program' : '') +
      (isPreview ? ', in der Preview' : '') +
      (health ? `, ${health.code} gestört` : ''),
  };
}

function trimToLength(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

/**
 * Name of a new scene: «Neue Szene N» with N = number of scenes + 1 (the keycap it will get), counting up while the
 * name is taken.
 */
export function nextSceneName(scenes: readonly Pick<SceneDto, 'name'>[]): string {
  const taken = new Set(scenes.map((scene) => scene.name.trim()));
  let number = scenes.length + 1;
  while (taken.has(`Neue Szene ${number}`)) {
    number += 1;
  }
  return `Neue Szene ${number}`;
}

/** Name of a duplicate: «Name (Kopie)», then «Name (Kopie 2)» …, at most 80 characters. */
export function copyName(name: string, scenes: readonly Pick<SceneDto, 'name'>[]): string {
  const taken = new Set(scenes.map((scene) => scene.name.trim()));
  const base = name.trim();
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? ' (Kopie)' : ` (Kopie ${number})`;
    const candidate = trimToLength(base, LIMITS.sceneNameLength - suffix.length) + suffix;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
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
