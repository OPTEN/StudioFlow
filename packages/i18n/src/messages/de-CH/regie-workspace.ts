import type { Translation } from '../../types';
import type { regieWorkspace as en } from '../en/regie-workspace';

export const regieWorkspace: Translation<typeof en> = {
  'regie.workspace.dock.audio': 'Ton',
  'regie.workspace.dock.insp': 'Eigenschaften',
  'regie.workspace.dock.pair': 'Gerät hinzufügen',
  'regie.workspace.dock.scenes': 'Szenen',
  'regie.workspace.dock.src': 'Quellen',
  'regie.workspace.dock.st': 'Geräte',
  'regie.workspace.dockRegion.src': 'Quellen der Szene',

  'regie.workspace.docked.bottom': '{dock} ist unten angedockt',
  'regie.workspace.docked.left': '{dock} ist links angedockt',
  'regie.workspace.docked.right': '{dock} ist rechts angedockt',

  'regie.workspace.dropStrip.bottom': 'Unten andocken',
  'regie.workspace.dropStrip.left': 'Links andocken',
  'regie.workspace.dropStrip.right': 'Rechts andocken',

  'regie.workspace.grip': 'Dock {title} verschieben, mit Pfeiltasten',
  'regie.workspace.gripTitle': 'Ziehen verschiebt das Dock, die Pfeiltasten auch',

  'regie.workspace.layout.moveUndone': 'Verschieben von {dock} rückgängig gemacht',
  'regie.workspace.layout.reset': 'Layout zurücksetzen',
  'regie.workspace.layout.resetConfirm':
    'Alle Docks kommen wieder nach unten, ausgeblendete erscheinen wieder und alle Grössen gehen auf den Standard zurück.',
  'regie.workspace.layout.resetDone': 'Layout zurückgesetzt',
  'regie.workspace.layout.resetMenu': 'Layout zurücksetzen …',
  'regie.workspace.layout.stacked':
    'Das Fenster ist schmal, darum stehen die Docks unter den Monitoren. Breiter ziehen, um Docks zu verschieben und ihre Grösse zu ändern.',
  'regie.workspace.layout.undo': 'Rückgängig',

  'regie.workspace.menu.bottom': 'Nach unten verschieben',
  'regie.workspace.menu.hidden': '{dock} ist ausgeblendet',
  'regie.workspace.menu.hide': 'Dock ausblenden',
  'regie.workspace.menu.left': 'Nach links verschieben',
  'regie.workspace.menu.resetSize': 'Grösse zurücksetzen',
  'regie.workspace.menu.right': 'Nach rechts verschieben',

  'regie.workspace.splitter.between': 'Grösse von {first} und {second}',
  'regie.workspace.splitter.bottom': 'Höhe der Docks unten',
  'regie.workspace.splitter.left': 'Breite der Docks links',
  'regie.workspace.splitter.right': 'Breite der Docks rechts',

  'regie.workspace.stage': 'Monitore',
};
