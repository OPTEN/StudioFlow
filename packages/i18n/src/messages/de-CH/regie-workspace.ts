import type { Translation } from '../../types';
import type { regieWorkspace as en } from '../en/regie-workspace';

export const regieWorkspace: Translation<typeof en> = {
  'regie.workspace.dock.audio': 'Ton',
  'regie.workspace.dock.insp': 'Eigenschaften',
  'regie.workspace.dock.pair': 'Gerät koppeln',
  'regie.workspace.dock.scenes': 'Szenen',
  'regie.workspace.dock.src': 'Quellen',
  'regie.workspace.dock.st': 'Stationen',
  'regie.workspace.dockRegion.src': 'Quellen der Szene',

  'regie.workspace.docked.bottom': '{dock} ist unten angedockt',
  'regie.workspace.docked.left': '{dock} ist links angedockt',
  'regie.workspace.docked.right': '{dock} ist rechts angedockt',

  'regie.workspace.dropStrip.bottom': 'Unten andocken',
  'regie.workspace.dropStrip.left': 'Links andocken',
  'regie.workspace.dropStrip.right': 'Rechts andocken',

  'regie.workspace.grip': 'Dock {title} verschieben, mit Pfeiltasten',

  'regie.workspace.layout.reset': 'Layout zurücksetzen',
  'regie.workspace.layout.resetDone': 'Layout zurückgesetzt',

  'regie.workspace.splitter.between': 'Grösse von {first} und {second}',
  'regie.workspace.splitter.bottom': 'Höhe der Docks unten',
  'regie.workspace.splitter.left': 'Breite der Docks links',
  'regie.workspace.splitter.right': 'Breite der Docks rechts',

  'regie.workspace.stage': 'Monitore',
};
