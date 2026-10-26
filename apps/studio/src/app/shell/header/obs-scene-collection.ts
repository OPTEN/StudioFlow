import type { CanvasSize } from '@studioflow/scene-model';

/**
 * The OBS scene collection of an output link (issue #9, spec 9.1): one scene with one browser source that shows the
 * output page. The operator imports it with "Scene Collection → Import" and clicks "Start Virtual Camera".
 *
 * Targets OBS Studio 31 and 32 (the layout of the scene collection file has been stable since OBS 28): the keys are the
 * ones OBS itself writes for a scene (`id: "scene"`) and a browser source (`id: "browser_source"`, obs-browser). The
 * collection is generated in the browser from the link URL the Regie already holds, so no secret travels anywhere new.
 */

/** Frame rate of the browser source (the output page renders at the display rate, nominally 30 fps). */
export const OBS_FPS = 30;

/** The collection format version OBS reads in `prev_ver`: OBS 31.0.0 (major version in the top byte). */
const OBS_API_VERSION = 31 << 24;

/** Names in OBS: the scene, and the browser source in it (scenes and inputs share one namespace, so they differ). */
const SCENE_NAME = 'StudioFlow';
const SOURCE_NAME = 'StudioFlow output';

/** Where a browser source of the OBS default shows nothing but the page: transparent body, no margins, no scrollbars. */
const OBS_DEFAULT_CSS =
  'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }';

/** What OBS writes for every source (scene or input), around the type specific `settings`. */
function source(
  id: string,
  name: string,
  settings: object,
  mixers: number,
): Record<string, unknown> {
  return {
    balance: 0.5,
    deinterlace_field_order: 0,
    deinterlace_mode: 0,
    enabled: true,
    flags: 0,
    hotkeys: {},
    id,
    mixers,
    monitoring_type: 0,
    muted: false,
    name,
    prev_ver: OBS_API_VERSION,
    private_settings: {},
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    settings,
    sync: 0,
    versioned_id: id,
    volume: 1.0,
  };
}

/** The scene item that puts the browser source on the canvas, full size at the top left corner. */
function sceneItem({ width, height }: CanvasSize): Record<string, unknown> {
  return {
    align: 5,
    blend_method: 'default',
    blend_type: 'normal',
    bounds: { x: 0.0, y: 0.0 },
    bounds_align: 0,
    bounds_crop: false,
    bounds_type: 0,
    crop_bottom: 0,
    crop_left: 0,
    crop_right: 0,
    crop_top: 0,
    group_item_backup: false,
    hide_transition: { duration: 0 },
    id: 1,
    locked: false,
    name: SOURCE_NAME,
    pos: { x: 0.0, y: 0.0 },
    private_settings: {},
    rot: 0.0,
    scale: { x: 1.0, y: 1.0 },
    scale_filter: 'disable',
    scale_ref: { x: width, y: height },
    show_transition: { duration: 0 },
    visible: true,
  };
}

/**
 * The scene collection for an output link, as the text of the JSON file. The browser source has the size of the canvas
 * of the production (its format and resolution, so a 9:16 production is a portrait virtual camera), 30 fps, "Control audio via OBS" (the page's audio goes to the OBS mixer, for #7), keeps running while hidden and is not
 * refreshed when the scene becomes active, so the virtual camera never restarts the page.
 */
export function obsSceneCollection(linkName: string, linkUrl: string, canvas: CanvasSize): string {
  const { width, height } = canvas;
  const collection = {
    current_program_scene: SCENE_NAME,
    current_scene: SCENE_NAME,
    current_transition: 'Cut',
    groups: [],
    modules: {},
    name: `StudioFlow – ${linkName}`,
    preview_locked: false,
    quick_transitions: [],
    saved_projectors: [],
    scaling_enabled: false,
    scaling_level: 0,
    scaling_off_x: 0.0,
    scaling_off_y: 0.0,
    scene_order: [{ name: SCENE_NAME }],
    sources: [
      source(
        'scene',
        SCENE_NAME,
        { custom_size: false, id_counter: 1, items: [sceneItem(canvas)] },
        0,
      ),
      source(
        'browser_source',
        SOURCE_NAME,
        {
          css: OBS_DEFAULT_CSS,
          fps: OBS_FPS,
          fps_custom: true,
          height,
          reroute_audio: true,
          restart_when_active: false,
          shutdown: false,
          url: linkUrl,
          width,
        },
        255,
      ),
    ],
    transition_duration: 300,
    transitions: [],
  };
  return JSON.stringify(collection, null, 4);
}

/** File name of the download: the link name without characters a file system dislikes. */
export function obsSceneCollectionFileName(linkName: string): string {
  const safe = linkName
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `StudioFlow-${safe || 'output'}.json`;
}
