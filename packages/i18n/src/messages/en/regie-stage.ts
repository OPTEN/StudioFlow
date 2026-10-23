import type { Namespace } from '../../types';

/** The stage: the two monitors, the control column (transition, Take), the edit overlay and the editing toasts. */
export const regieStage = {
  'regie.stage.control.cut': 'Cut',
  'regie.stage.control.fade': 'Fade',
  'regie.stage.control.fadeDuration': 'Fade duration',
  'regie.stage.control.fadeLonger': 'Longer fade',
  'regie.stage.control.fadeShorter': 'Shorter fade',
  'regie.stage.control.space': 'Space',
  'regie.stage.control.studioMode': 'Studio Mode',
  'regie.stage.control.take': 'Take',
  'regie.stage.control.transition': 'Transition',
  'regie.stage.control.transitionKind': 'Transition type',

  'regie.stage.crop.bottom': 'B',
  'regie.stage.crop.left': 'L',
  'regie.stage.crop.right': 'R',
  'regie.stage.crop.summary': 'Crop {sides}',
  'regie.stage.crop.top': 'T',

  'regie.stage.editor.addSourceFirst': 'Add a source first',
  'regie.stage.editor.itemFallback': 'Item',
  'regie.stage.editor.itemLimit': {
    one: 'A scene has at most {count} item.',
    other: 'A scene has at most {count} items.',
  },
  'regie.stage.editor.itemRemoved': '{code} removed from “{scene}”',
  'regie.stage.editor.liveLocked': 'This scene is live. Switch another scene to Program first.',
  'regie.stage.editor.liveUnchanged': 'This scene is live and stays unchanged',
  'regie.stage.editor.nothingToRedo': 'Nothing to redo',
  'regie.stage.editor.nothingToUndo': 'Nothing to undo',
  'regie.stage.editor.offline':
    'No connection to the server. Changes work again as soon as the control room is connected.',
  'regie.stage.editor.redone': 'Redone',
  'regie.stage.editor.sourceAdded': '{code} added to “{scene}”',
  'regie.stage.editor.sourceFallback': 'Source',
  'regie.stage.editor.templateApplied': 'Template “{name}” applied',
  'regie.stage.editor.undo': 'Undo',
  'regie.stage.editor.undone': 'Undone',

  'regie.stage.monitor.connecting': 'Connecting…',
  'regie.stage.monitor.liveEdit': 'Changes go live immediately',
  'regie.stage.monitor.liveNote':
    'This scene is live right now. Editing is possible once another scene is on Program.',
  'regie.stage.monitor.noScene': 'No scene',
  'regie.stage.monitor.noSceneName': 'no scene',
  'regie.stage.monitor.preview': 'Preview',
  'regie.stage.monitor.previewLabel': 'Preview monitor: {name}',
  'regie.stage.monitor.program': 'Program',
  'regie.stage.monitor.programLabel': 'Program monitor: {name}, matches the output',

  'regie.stage.overlay.label':
    'Items of the scene. Drag to move, corners to resize, arrow keys to fine-tune.',

  'regie.stage.previewOff.hint': 'With Studio Mode the Preview appears here.',
  'regie.stage.previewOff.title': 'Preview off',

  'regie.stage.split.label': 'Size of Preview and Program',

  'regie.stage.switch.hintDirect': 'Click a scene to switch it live directly.',
  'regie.stage.switch.hintStudio': 'Click a scene to load it into Preview. Take switches it live.',
  'regie.stage.switch.live': '“{name}” is live',
  'regie.stage.switch.offline':
    'No connection to the server. Switching works again as soon as the control room is connected.',
  'regie.stage.switch.studioOff': 'Studio Mode off: scenes switch live directly',
  'regie.stage.switch.studioOn': 'Studio Mode on: Preview and Take',

  'regie.stage.view.label': 'Scene',
} as const satisfies Namespace<'regie.stage'>;
