import type { Namespace } from '../../types';

/**
 * The Sources dock: the item list, the "+ Source" menu, the hint under the list and the status line that the Sources
 * and Properties docks show above the edit scene.
 */
export const regieSources = {
  'regie.sources.add.allUsed': 'All sources are already in this scene.',
  'regie.sources.add.inScene': 'In scene',
  'regie.sources.add.label': 'Add source',
  'regie.sources.add.liveLocked': 'This scene is live. Switch another scene to Program first.',
  'regie.sources.add.manage': 'Media library…',
  'regie.sources.add.newText': 'New text',
  'regie.sources.add.newTextHint': 'Added hidden, so you can write it first.',
  'regie.sources.add.noSources':
    'No sources yet. Add a device under Devices, or upload an image or video.',
  'regie.sources.add.offline':
    'No connection to the server. Adding works again as soon as the control room is connected.',
  'regie.sources.add.sceneFallback': 'Scene',
  'regie.sources.add.title': 'Add to “{scene}”',
  'regie.sources.add.upload': 'Upload image or video…',

  'regie.sources.dock.add': 'Source',
  'regie.sources.dock.addLabel': 'Add source',
  'regie.sources.dock.drop': 'Drop images or videos to upload them',
  'regie.sources.dock.editing': 'in {scene}',
  'regie.sources.dock.emptyAdd': 'Add a source',
  'regie.sources.dock.emptyLowerThird': 'New lower third',
  'regie.sources.dock.emptyText': 'Add a camera, a screen, media or a text.',
  'regie.sources.dock.emptyTitle': 'This scene is empty.',
  'regie.sources.dock.emptyUpload': 'Upload media',
  'regie.sources.dock.listLabel': 'Items of the scene',
  'regie.sources.dock.loadingTitle': 'Loading sources…',
  'regie.sources.dock.noSceneText': 'Add a scene in the Scenes dock first.',
  'regie.sources.dock.noSceneTitle': 'No scene.',
  'regie.sources.dock.redo': 'Redo (Ctrl+Shift+Z)',
  'regie.sources.dock.undo': 'Undo (Ctrl+Z)',

  'regie.sources.group.camera': 'Cameras',
  'regie.sources.group.media': 'Media',
  'regie.sources.group.screen': 'Screens',
  'regie.sources.group.text': 'Texts',

  'regie.sources.hint.autoGrid':
    'Auto grid: the order of the items is their position in the grid. Drag a row to move an item to another cell.',
  'regie.sources.hint.preview':
    'The top row is in front. Click a source in the Preview monitor to move it or to resize it at the corners.',
  'regie.sources.hint.program':
    'The top row is in front. Click a source in the Program monitor to move it or to resize it at the corners.',

  'regie.sources.row.hiddenHint': 'Hidden on the output. Show it to edit it.',
  'regie.sources.row.hide': 'Hide: {name}',
  'regie.sources.row.hideTitle': 'Hide on the output',
  'regie.sources.row.lock': 'Lock: {name}',
  'regie.sources.row.lockTitle': 'Lock: keep its place and size on the monitor',
  'regie.sources.row.select': 'Select: {code} {name}',
  'regie.sources.row.show': 'Show: {name}',
  'regie.sources.row.showTitle': 'Show on the output',
  'regie.sources.row.unlock': 'Unlock: {name}',
  'regie.sources.row.unlockTitle': 'Unlock: allow moving and resizing',

  'regie.sources.status.live': 'Live scene: every change goes on air at once.',
  'regie.sources.status.locked':
    'This scene is live in Program. Switch another scene to Program to edit it.',
  'regie.sources.status.offline':
    'No connection to the server. Editing works again when it is back.',
} as const satisfies Namespace<'regie.sources'>;
