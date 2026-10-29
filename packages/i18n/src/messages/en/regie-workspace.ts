import type { Namespace } from '../../types';

/** The dock workspace: dock titles and region names, splitters, the drop strips, the layout toasts and the reset confirmation. */
export const regieWorkspace = {
  'regie.workspace.dock.audio': 'Audio',
  'regie.workspace.dock.insp': 'Properties',
  'regie.workspace.dock.pair': 'Add device',
  'regie.workspace.dock.scenes': 'Scenes',
  'regie.workspace.dock.src': 'Sources',
  'regie.workspace.dock.st': 'Devices',
  'regie.workspace.dockRegion.src': 'Sources of the scene',

  'regie.workspace.docked.bottom': '{dock} is docked at the bottom',
  'regie.workspace.docked.left': '{dock} is docked on the left',
  'regie.workspace.docked.right': '{dock} is docked on the right',

  'regie.workspace.dropStrip.bottom': 'Dock at the bottom',
  'regie.workspace.dropStrip.left': 'Dock on the left',
  'regie.workspace.dropStrip.right': 'Dock on the right',

  'regie.workspace.grip': 'Move dock {title} with the arrow keys',
  'regie.workspace.gripTitle': 'Drag to move the dock, or use the arrow keys',

  'regie.workspace.layout.moveUndone': 'Move of {dock} undone',
  'regie.workspace.layout.reset': 'Reset layout',
  'regie.workspace.layout.resetConfirm':
    'Every dock goes back to the bottom, hidden docks reappear and all sizes return to their defaults.',
  'regie.workspace.layout.resetDone': 'Layout reset',
  'regie.workspace.layout.resetMenu': 'Reset layout…',
  'regie.workspace.layout.stacked':
    'The window is narrow, so the docks stack below the monitors. Widen it to move and resize docks.',
  'regie.workspace.layout.undo': 'Undo',

  'regie.workspace.splitter.between': 'Size of {first} and {second}',
  'regie.workspace.splitter.bottom': 'Height of the docks at the bottom',
  'regie.workspace.splitter.left': 'Width of the docks on the left',
  'regie.workspace.splitter.right': 'Width of the docks on the right',

  'regie.workspace.stage': 'Monitors',
} as const satisfies Namespace<'regie.workspace'>;
