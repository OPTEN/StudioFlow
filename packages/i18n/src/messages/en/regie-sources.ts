import type { Namespace } from '../../types';

/** The Sources dock: the item list, the "+ Source" menu and the hint under the list. */
export const regieSources = {
  'regie.sources.add.allUsed': 'All sources are already in this scene.',
  'regie.sources.add.label': 'Add source',
  'regie.sources.add.liveLocked': 'This scene is live. Switch another scene to Program first.',
  'regie.sources.add.manage': 'Manage media…',
  'regie.sources.add.noSources':
    'No sources yet. Pair devices under Stations or upload an image or video.',
  'regie.sources.add.offline':
    'No connection to the server. Adding works again as soon as the control room is connected.',
  'regie.sources.add.sceneFallback': 'Scene',
  'regie.sources.add.title': 'Add to “{scene}”',
  'regie.sources.add.upload': 'Upload image or video…',

  'regie.sources.dock.add': 'Source',
  'regie.sources.dock.drop': 'Drop image or video here',
  'regie.sources.dock.emptyText': 'Add a source or apply a template.',
  'regie.sources.dock.emptyTitle': 'This scene is empty.',
  'regie.sources.dock.listLabel': 'Items of the scene',
  'regie.sources.dock.loadingTitle': 'Loading sources…',
  'regie.sources.dock.noSceneText': 'Create a scene under Scenes with “+ Scene”.',
  'regie.sources.dock.noSceneTitle': 'No scene.',
  'regie.sources.dock.undo': 'Undo (Ctrl+Z)',

  'regie.sources.group.camera': 'Cameras',
  'regie.sources.group.media': 'Media',
  'regie.sources.group.screen': 'Screens',

  'regie.sources.hint.autoGrid':
    'Auto grid: the order of the items is their position in the grid. Drag a row to move an item to another cell.',
  'regie.sources.hint.preview':
    'Click an item in the Preview monitor, then drag it or scale it at the corners.',
  'regie.sources.hint.program':
    'Click an item in the Program monitor, then drag it or scale it at the corners. Without Studio Mode every change goes live immediately.',

  'regie.sources.row.hide': 'Hide: {name}',
  'regie.sources.row.lock': 'Lock: {name}',
  'regie.sources.row.select': 'Select: {code} {name}',
  'regie.sources.row.show': 'Show: {name}',
  'regie.sources.row.unlock': 'Unlock: {name}',
} as const satisfies Namespace<'regie.sources'>;
