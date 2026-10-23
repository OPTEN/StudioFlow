import type { Namespace } from '../../types';

/** The Scenes dock: list, rows, row menu, names of new and copied scenes, and the toasts of the scene commands. */
export const regieScenes = {
  'regie.scenes.dock.add': 'Scene',
  'regie.scenes.dock.addLabel': 'Add scene',
  'regie.scenes.dock.addTitle': 'New scene at the end of the list',
  'regie.scenes.dock.addTitleMax': 'At most {max} scenes',
  'regie.scenes.dock.emptyText': 'Create the first scene with “+ Scene”.',
  'regie.scenes.dock.emptyTitle': 'No scenes yet.',
  'regie.scenes.dock.keysHint': 'Keys 1–9',
  'regie.scenes.dock.loadingTitle': 'Loading scenes…',

  'regie.scenes.name.copy': '{name} (copy)',
  'regie.scenes.name.copyNth': '{name} (copy {number})',
  'regie.scenes.name.new': 'New scene {number}',

  'regie.scenes.row.ariaDisrupted': '{code} disrupted',
  'regie.scenes.row.ariaPreview': 'in Preview',
  'regie.scenes.row.ariaProgram': 'live on Program',
  'regie.scenes.row.disrupted': 'disrupted',
  'regie.scenes.row.duplicate': 'Duplicate',
  'regie.scenes.row.empty': 'empty',
  'regie.scenes.row.menuLabel': 'Scene {name}',
  'regie.scenes.row.menuTriggerLabel': 'Actions for scene {name}',
  'regie.scenes.row.moveDown': 'Move down',
  'regie.scenes.row.moveUp': 'Move up',
  'regie.scenes.row.nameLabel': 'Scene name',

  'regie.scenes.toast.created': 'Scene “{name}” created',
  'regie.scenes.toast.deleted': 'Scene “{name}” deleted',
  'regie.scenes.toast.limit': 'A production has at most {max} scenes.',
  'regie.scenes.toast.liveDelete': 'The live scene cannot be deleted.',
  'regie.scenes.toast.nameLength': 'The name needs 1 to {max} characters.',
} as const satisfies Namespace<'regie.scenes'>;
